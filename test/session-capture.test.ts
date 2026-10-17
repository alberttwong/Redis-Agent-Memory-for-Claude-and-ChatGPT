import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@redis-iris/agent-memory/models";
import { captureConfigSchema, digest, enqueue, flush, makeEntry, scope, type CaptureTransport } from "../src/capture.js";

const config = captureConfigSchema.parse({ ownerId: "owner", namespace: "project" });
const input = { hook_event_name: "UserPromptSubmit", session_id: "chat", turn_id: "turn-1", prompt: "Use three checkout retries" };
function backend() {
  const events: SessionEvent[] = [];
  const memories = new Map<string, unknown>();
  let appends = 0;
  const transport: CaptureTransport = { destinationId: "test-store", create: async batch => {
    batch.forEach(memory => memories.set(memory.id, memory)); return { created: batch.map(memory => memory.id) };
  }, recall: async () => [], session: {
    append: async request => {
      const event: SessionEvent = { ...request, sessionId: request.sessionId!, eventId: `event-${++appends}`, systemTimestamp: new Date() };
      events.push(event); return { event };
    },
    read: async sessionId => {
      const found = events.filter(event => event.sessionId === sessionId);
      if (!found.length) throw Object.assign(new Error("missing"), { statusCode: 404 });
      return { sessionId, ownerId: "owner", namespace: "project", events: found };
    },
  } };
  return { transport, events, memories, appends: () => appends };
}
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "ram-session-capture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("default sessions isolate owner/project/client while a deliberate task alias shares only its scope", () => {
  const base = scope(config, "/project", "codex", input).session;
  assert.notEqual(base, scope({ ...config, ownerId: "other" }, "/project", "codex", input).session);
  assert.notEqual(base, scope({ ...config, namespace: "other" }, "/project", "codex", input).session);
  assert.notEqual(base, scope(config, "/project", "claude", input).session);
  const shared = { ...config, sessionId: "shared-task" };
  assert.equal(scope(shared, "/project", "claude", input).session, scope(shared, "/project", "codex", { ...input, session_id: "other-chat" }).session);
  assert.notEqual(scope(shared, "/project", "claude", input).session, scope({ ...shared, ownerId: "other" }, "/project", "claude", input).session);
});

test("compatibility record identity survives the upgrade to scoped session routing", () => {
  const legacySession = `chat-${digest(`codex:${input.session_id}`)}`;
  const expected = `turn-${digest(JSON.stringify([{ owner: "owner", namespace: "project", session: legacySession }, "codex", "turn-1", "USER", 0]))}`;
  const memory = makeEntry(config, "/project", "codex", input)!.memories[0];
  assert.equal(memory.id, expected);
  assert.notEqual(memory.session_id, legacySession);
});

test("conversation chunks preserve role, original timestamp, grouping, source order and extraction owner", async t => {
  const directory = await fixture(t);
  const db = backend();
  const content = "Decision ".repeat(2000);
  const first = makeEntry(config, "/project", "codex", { ...input, prompt: content }, [], "2026-10-16T12:00:00Z")!;
  const second = makeEntry(config, "/project", "codex", { ...input, hook_event_name: "Stop", turn_id: "turn-2", last_assistant_message: "Implemented with tests" }, [], "2026-10-16T12:01:00Z")!;
  await enqueue(directory, first); await enqueue(directory, second);
  const result = await flush(directory, db.transport);
  assert.equal(result.sessionSent, first.memories.length + 1);
  assert.equal(db.events.slice(0, -1).map(event => event.content[0].text).join(""), content);
  assert(db.events.slice(0, -1).every(event => event.role === "USER" && event.createdAt.toISOString() === "2026-10-16T12:00:00.000Z"));
  assert.equal(db.events.at(-1)!.role, "ASSISTANT");
  assert(db.events.every(event => event.actorId === "owner"));
  assert.equal(new Set(db.events.map(event => event.sessionId)).size, 1);
  assert.deepEqual(db.events.slice(0, -1).map(event => event.metadata.part), [1, 2, 3]);
  assert.equal(new Set(db.events.slice(0, -1).map(event => event.metadata.captureGroup)).size, 1);
  assert(db.events.at(-1)!.metadata.captureSequence > db.events[0].metadata.captureSequence);
  assert.equal(db.memories.size, db.events.length);
});

test("assistant-first capture establishes the owner through actor attribution", async t => {
  const directory = await fixture(t); const db = backend();
  await enqueue(directory, makeEntry(config, "/project", "claude", { ...input, hook_event_name: "Stop", last_assistant_message: "Available response" })!);
  await flush(directory, db.transport);
  assert.equal(db.events[0].role, "ASSISTANT"); assert.equal(db.events[0].actorId, "owner");
});

test("accepted-but-response-lost append reconciles after restart without resending", async t => {
  const directory = await fixture(t); const db = backend();
  const append = db.transport.session!.append;
  db.transport.session!.append = async request => { await append(request); throw new Error("lost response"); };
  const entry = makeEntry(config, "/project", "codex", input)!;
  await enqueue(directory, entry);
  await assert.rejects(flush(directory, db.transport));
  assert.equal(db.memories.size, 0, "no long-term-only fallback");
  db.transport.session!.append = async () => { throw new Error("must reconcile, not append"); };
  const result = await flush(directory, { ...db.transport, session: { ...db.transport.session! } });
  assert.equal(result.sessionReconciled, 1); assert.equal(db.appends(), 1); assert.equal(result.pending, 0);
  await enqueue(directory, entry);
  await flush(directory, db.transport);
  assert.equal(db.appends(), 1, "replayed stable hook must not append again");
});

test("missing uncertain readback blocks later events until explicit duplicate-risk recovery", async t => {
  const directory = await fixture(t); const db = backend();
  const append = db.transport.session!.append;
  db.transport.session!.append = async () => { throw new Error("ambiguous transport failure"); };
  await enqueue(directory, makeEntry(config, "/project", "codex", input)!);
  await enqueue(directory, makeEntry(config, "/project", "codex", { ...input, turn_id: "turn-2", prompt: "Later event" })!);
  await assert.rejects(flush(directory, db.transport));
  db.transport.session!.append = append;
  await assert.rejects(flush(directory, db.transport), /outcome uncertain/);
  assert.equal(db.appends(), 0);
  const result = await flush(directory, db.transport, [], {}, undefined, { ...config, retryUncertain: true });
  assert.equal(result.sessionSent, 2);
  assert.deepEqual(db.events.map(event => event.content[0].text), [input.prompt, "Later event"]);
});

test("definitively rejected append remains retryable and never allows later events to overtake", async t => {
  const directory = await fixture(t); const db = backend(); const append = db.transport.session!.append;
  db.transport.session!.append = async () => { throw Object.assign(new Error("rejected"), { statusCode: 429 }); };
  await enqueue(directory, makeEntry(config, "/project", "codex", input)!);
  await enqueue(directory, makeEntry(config, "/project", "codex", { ...input, turn_id: "turn-2", prompt: "Later event" })!);
  await assert.rejects(flush(directory, db.transport));
  db.transport.session!.append = append;
  await flush(directory, db.transport);
  assert.deepEqual(db.events.map(event => event.content[0].text), [input.prompt, "Later event"]);
});

test("compatibility failure retries independently without repeating session appends", async t => {
  const directory = await fixture(t); const db = backend(); const create = db.transport.create;
  db.transport.create = async () => { throw new Error("compatibility unavailable"); };
  await enqueue(directory, makeEntry(config, "/project", "codex", input)!);
  await assert.rejects(flush(directory, db.transport));
  assert.equal(db.appends(), 1);
  db.transport.create = create;
  await flush(directory, db.transport);
  assert.equal(db.appends(), 1); assert.equal(db.memories.size, 1);
});

test("current privacy and role/event opt-outs apply to both destinations", async t => {
  const directory = await fixture(t); const db = backend();
  const entry = makeEntry(config, "/project", "codex", { ...input, prompt: "CLIENT-123 private-key" }, ["private-key"])!;
  const path = await enqueue(directory, entry, ["private-key"]);
  assert(!(await readFile(path, "utf8")).includes("private-key"));
  await flush(directory, db.transport, [], { customPatterns: ["CLIENT-[0-9]+"], omitFields: ["sourceSessionId", "turnId", "repoPath"] });
  assert.equal(db.events[0].content[0].text, "[REDACTED] [REDACTED]");
  assert.equal(db.events[0].metadata.sourceSessionId, undefined);
  assert.equal(db.events[0].metadata.turnId, undefined);
  assert.equal(db.events[0].metadata.repoPath, undefined);
  assert(!JSON.stringify([...db.memories.values()]).includes("CLIENT-123"));
  await enqueue(directory, makeEntry(config, "/project", "codex", { ...input, turn_id: "disabled-role" })!);
  await flush(directory, db.transport, [], { capturePrompts: false });
  assert.equal(db.events.length, 1);
});

test("tool outcomes are optional SYSTEM evidence and noisy lifecycle boundaries stay direct-only", async t => {
  const directory = await fixture(t); const db = backend();
  const tool = { ...input, tool_name: "Bash", tool_use_id: "call-1", tool_response: "test output", hook_event_name: "PostToolUse" };
  await enqueue(directory, makeEntry(config, "/project", "codex", tool)!);
  await flush(directory, db.transport); assert.equal(db.events.length, 0);
  const observations = { ...config, sessionObservations: true };
  await enqueue(directory, makeEntry(observations, "/project", "codex", { ...tool, tool_use_id: "call-2" })!);
  await enqueue(directory, makeEntry(observations, "/project", "codex", { ...input, hook_event_name: "PreCompact", trigger: "auto" })!);
  await flush(directory, db.transport);
  assert.equal(db.events.length, 1); assert.equal(db.events[0].role, "SYSTEM");
  assert.equal(db.events[0].metadata.captureKind, "observation");
  assert(db.events[0].content[0].text!.includes("not a user instruction"));
});

test("legacy/import queues remain direct-only; missing session transport cannot silently downgrade", async t => {
  const directory = await fixture(t); const db = backend();
  await enqueue(directory, makeEntry({ ...config, sessionCapture: false }, "/project", "codex", input)!);
  await flush(directory, { ...db.transport, session: undefined }); assert.equal(db.events.length, 0);
  await enqueue(directory, makeEntry(config, "/project", "codex", { ...input, turn_id: "new" })!);
  await assert.rejects(flush(directory, { ...db.transport, session: undefined }), /Session transport unavailable/);
});

test("concurrent enqueue commits use a durable sequence and concurrent flushes cannot append twice", async t => {
  const directory = await fixture(t); const db = backend();
  await Promise.all(Array.from({ length: 8 }, (_, index) => enqueue(directory, makeEntry(config, "/project", "codex", { ...input, turn_id: `turn-${index}`, prompt: `message ${index}` })!)));
  const files = (await readdir(directory)).filter(name => name.endsWith(".json")).sort();
  assert.equal(new Set(files.map(name => name.split("-")[0])).size, 8);
  const first = flush(directory, db.transport);
  const second = flush(directory, db.transport);
  const results = await Promise.all([first, second]);
  assert(results.some(result => result.busy)); assert.equal(db.appends(), 8);
  assert.deepEqual(db.events.map(event => event.metadata.captureSequence), [...db.events.map(event => event.metadata.captureSequence)].sort((a, b) => a - b));
});

test("session-only and explicit retry-time destination opt-outs are honored", async t => {
  const directory = await fixture(t); const db = backend();
  await enqueue(directory, makeEntry({ ...config, compatibilityCapture: false }, "/project", "codex", input)!);
  await flush(directory, db.transport); assert.equal(db.appends(), 1); assert.equal(db.memories.size, 0);
  await enqueue(directory, makeEntry(config, "/project", "codex", { ...input, turn_id: "optout" })!);
  await flush(directory, db.transport, [], {}, undefined, { ...config, sessionCapture: false });
  assert.equal(db.appends(), 1); assert.equal(db.memories.size, 1);
});

test("uncertain writes cannot be blindly retried after privacy changes or conflicting readback", async t => {
  const directory = await fixture(t); const db = backend(); const append = db.transport.session!.append;
  db.transport.session!.append = async request => { await append(request); throw new Error("response lost"); };
  await enqueue(directory, makeEntry(config, "/project", "codex", input)!);
  await assert.rejects(flush(directory, db.transport));
  await assert.rejects(flush(directory, db.transport, [], { customPatterns: ["checkout"] }, undefined, { ...config, retryUncertain: true }), /changed under current privacy policy/);
  db.events.push({ ...db.events[0], eventId: "duplicate" });
  await assert.rejects(flush(directory, db.transport, [], {}, undefined, { ...config, retryUncertain: true }), /reconciliation conflict/);
  assert.equal(db.appends(), 1);
});

test("explicit imports cannot accidentally flush captured work while project capture is disabled", async t => {
  const directory = await fixture(t); const db = backend();
  const captured = makeEntry(config, "/project", "codex", input)!;
  await enqueue(directory, captured);
  const imported = { ...captured.memories[0], id: "import-record", topics: ["import", "claude"] };
  await enqueue(directory, { version: 1, memories: [imported] });
  const result = await flush(directory, db.transport, [], {}, undefined, { ...config, enabled: false });
  assert.equal(result.pending, 1); assert.equal(db.events.length, 0);
  assert.deepEqual([...db.memories.keys()], ["import-record"]);
});

test("destination receipts are isolated by endpoint/store identity", async t => {
  const directory = await fixture(t); const db = backend();
  const entry = makeEntry(config, "/project", "codex", input)!;
  await enqueue(directory, entry); await flush(directory, db.transport);
  await enqueue(directory, entry); await flush(directory, { ...db.transport, destinationId: "another-store" });
  assert.equal(db.appends(), 2, "a receipt for one store must not acknowledge a different destination");
});

test("malformed delivery plans are retained rather than silently dropping required destinations", async t => {
  const directory = await fixture(t); const db = backend();
  const path = join(directory, "00000000000000000001-invalid.json");
  const raw = JSON.stringify({ version: 2, memories: makeEntry(config, "/project", "codex", input)!.memories });
  await writeFile(path, raw);
  await assert.rejects(flush(directory, db.transport), /Invalid capture queue delivery plan/);
  assert.equal(await readFile(path, "utf8"), raw);
  assert.equal(db.appends(), 0); assert.equal(db.memories.size, 0);
});
