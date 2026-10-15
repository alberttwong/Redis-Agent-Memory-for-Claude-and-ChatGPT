import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureConfigSchema, enqueue, flush, makeEntry, pendingCount, scope, type CapturedMemory, type CaptureTransport } from "../src/capture.js";

const config = captureConfigSchema.parse({ownerId: "test-user", namespace: "project"});
const input = {hook_event_name: "UserPromptSubmit", session_id: "source-chat", turn_id: "turn-1", prompt: "Add backoff tests"};
const client = (create: CaptureTransport["create"]): CaptureTransport => ({create, recall: async () => []});

test("same project uses separate owners, memory IDs, and safe session IDs", () => {
  const first = makeEntry(config, "/project", "codex", input)!;
  const second = makeEntry({...config, ownerId: "other-user"}, "/project", "codex", input)!;
  assert.equal(first.memories[0].namespace, second.memories[0].namespace);
  assert.notEqual(first.memories[0].owner_id, second.memories[0].owner_id);
  assert.notEqual(first.memories[0].id, second.memories[0].id);
  assert.match(first.memories[0].session_id, /^[a-zA-Z0-9-]{1,64}$/);
  assert.equal(scope(config, "/project", "codex", input).session, scope(config, "/project", "codex", input).session);
  assert.notEqual(scope(config, "/project", "codex", input).session, scope(config, "/project", "claude", input).session);
});

test("defaults need no hard-coded owner and explicit shared task identity is honored", () => {
  const defaults = captureConfigSchema.parse({});
  assert.match(scope(defaults, "/project", "codex", input).owner, /^user-[a-f0-9]{32}$/);
  assert.equal(scope({...config, sessionId: "shared-task"}, "/project", "claude", input).session, "shared-task");
});

test("captures assistant responses, skips absent messages and disabled capture", () => {
  assert.equal(makeEntry(config, "/project", "codex", { ...input, hook_event_name: "SessionStart" }), null);
  assert.equal(makeEntry({...config, enabled: false}, "/project", "codex", input), null);
  const saved = makeEntry(config, "/project", "claude", {...input, hook_event_name: "Stop", last_assistant_message: "Tests pass"})!;
  assert.equal(JSON.parse(saved.memories[0].text).role, "ASSISTANT");
});

test("redacts configured credentials and chunks without exceeding Redis text limits", () => {
  const saved = makeEntry(config, "/project", "codex", {...input, prompt: 'secret-value mem1_example-token== ' + '\u0000'.repeat(55000)}, ["secret-value"])!;
  assert(saved.memories.length > 1);
  for (const memory of saved.memories) {
    assert(memory.text.length <= 50000);
    assert(!memory.text.includes("secret-value"));
    assert(!memory.text.includes("mem1_example-token"));
  }
  const reconstructed = saved.memories.map(memory => JSON.parse(memory.text).content).join("");
  assert.equal(reconstructed, '[REDACTED] [REDACTED] ' + '\u0000'.repeat(55000));
});

test("identical prompts without a provider turn ID remain separate events", () => {
  const noTurn = {...input, turn_id: undefined};
  assert.notEqual(makeEntry(config, "/project", "claude", noTurn)!.memories[0].id, makeEntry(config, "/project", "claude", noTurn)!.memories[0].id);
});

test("lost response retains queue; replay uses the same IDs and clears only after acknowledgement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-capture-test-"));
  const persisted = new Map<string, CapturedMemory>();
  const entry = makeEntry(config, "/project", "codex", input)!;
  try {
    await enqueue(directory, entry);
    await assert.rejects(flush(directory, client(async memories => {
      memories.forEach(memory => persisted.set(memory.id, memory));
      throw new Error("Response lost after server accepted write");
    })));
    assert.equal(await pendingCount(directory), 1);
    const retry = await flush(directory, client(async memories => {
      memories.forEach(memory => persisted.set(memory.id, memory));
      return {created: memories.map(memory => memory.id)};
    }));
    assert.equal(persisted.size, 1);
    assert.equal(retry.pending, 0);
    assert.equal(retry.sent, 1);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test("partial failure preserves complete queued payload and concurrent flush does not send twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-capture-test-"));
  try {
    const entry = makeEntry(config, "/project", "codex", input)!;
    await enqueue(directory, entry);
    await assert.rejects(flush(directory, client(async () => ({created: [], errors: [{error: "failed"}]}))));
    const files = (await readdir(directory)).filter(name => name.endsWith(".json"));
    assert.deepEqual(JSON.parse(await readFile(join(directory, files[0]), "utf8")), entry);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {release = resolve;});
    let entered!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const first = flush(directory, client(async memories => {entered(); await waiting; return {created: memories.map(memory => memory.id)};}));
    await started;
    const second = await flush(directory, client(async () => {throw new Error("should not send");}));
    assert.equal(second.busy, true);
    release();
    await first;
    assert.equal(await pendingCount(directory), 0);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
