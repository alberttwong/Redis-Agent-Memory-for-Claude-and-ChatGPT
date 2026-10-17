import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { automaticCheckpointId, canonicalCheckpointId, evidenceCheckpoint, persistAutomaticCheckpoint } from "../src/automatic-checkpoint.js";
import { captureConfigSchema, enqueue, flush, makeEntry, checkpointPlan, type CaptureTransport } from "../src/capture.js";
import { guardrailsSchema, redactSensitiveText } from "../src/privacy.js";
import { MemoryGateway, type MemoryClient } from "../src/memory.js";

const scope = { ownerId: "owner", namespace: "project", sessionId: "task", source: "codex" };
function backend() {
  let session: any = { ...scope, events: [
    { eventId: "u1", role: "USER", content: [{ text: "Change retries from seven to three" }], systemTimestamp: "2026-10-16T12:00:00Z" },
    { eventId: "a1", role: "ASSISTANT", content: [{ text: "I changed retries; tests not run" }], systemTimestamp: "2026-10-16T12:01:00Z" },
  ] };
  const records = new Map<string, any>();
  const missing = () => Object.assign(new Error("missing"), { statusCode: 404 });
  const store: MemoryClient = {
    storeHealth: async () => ({}) as any,
    getSessionMemory: async () => structuredClone(session),
    getLongTermMemory: async id => { if (!records.has(id)) throw missing(); return records.get(id); },
    bulkCreateLongTermMemories: async request => { request.memories.forEach(memory => records.set(memory.id!, memory)); return { created: request.memories.map(memory => memory.id!) }; },
    updateLongTermMemory: async () => ({}) as any,
    addSessionEvent: async () => ({}) as any,
    searchLongTermMemory: async () => ({ items: [...records.values()] }),
  };
  return { store, records, session: () => session, replace: (value: any) => { session = value; } };
}
const app = { baseUrl: "https://example.test", storeId: "store", apiKey: "test-key", ownerId: "owner", legacyNamespace: "project", agentId: "agent" };

test("automatic evidence quotes goals and reports without inventing completion or validation", () => {
  const db = backend(); const checkpoint = evidenceCheckpoint(db.session())!;
  assert.match(checkpoint.currentGoal!, /seven to three/);
  assert.match(checkpoint.summary, /unverified.*tests not run/);
  assert.deepEqual([checkpoint.completed, checkpoint.nextSteps, checkpoint.blockers], [[], [], []]);
  db.replace({ ...db.session(), events: [db.session().events[0]] });
  assert.match(evidenceCheckpoint(db.session())!.summary, /completion and validation are unknown/);
  assert.equal(evidenceCheckpoint({ ...db.session(), events: [] }), null);
});

test("checkpoint evidence reapplies role controls, omissions, secret redaction and JSON budget", () => {
  const db = backend();
  db.session().events[0].content = [{ text: '"\\'.repeat(10000) + " test-key person@example.com" }];
  const checkpoint = evidenceCheckpoint(db.session(), { captureResponses: false, omitFields: ["eventId"] }, ["test-key"], 2048)!;
  const text = JSON.stringify(checkpoint);
  assert(text.length <= 2048); assert(!text.includes("test-key")); assert(!text.includes("person@example.com"));
  assert(!text.includes("eventId")); assert(!text.includes("I changed"));
  assert.equal(checkpoint.automatic!.evidence.length, 1);
});

test("delayed old checkpoint writes cannot replace the current revision; resume resolves current history", async () => {
  const db = backend(); const old = structuredClone(db.session());
  await persistAutomaticCheckpoint(db.store, scope);
  const oldId = automaticCheckpointId(scope, old);
  db.session().events.push({ eventId: "u2", role: "USER", content: [{ text: "Correction: use two attempts" }], systemTimestamp: "2026-10-16T12:02:00Z" });
  const current = structuredClone(db.session());
  await persistAutomaticCheckpoint(db.store, scope);
  const currentId = automaticCheckpointId(scope, current); assert.notEqual(oldId, currentId);
  db.replace(old); await persistAutomaticCheckpoint(db.store, scope); db.replace(current);
  const gateway = new MemoryGateway(db.store, app);
  const result = await gateway.resumeContext("task", "continue");
  assert.equal(result.checkpoint?.id, canonicalCheckpointId(scope, "task"));
  assert.equal(result.checkpoint?.revisionId, currentId);
  assert.match(result.checkpoint?.text ?? "", /two attempts/);
  assert.equal(result.recalled.items.length, 0, "historical snapshots cannot become current semantic guidance");
  assert.equal((await gateway.search({ query: "history", includeHistory: true })).items.length, 2);
});

test("resume marks missing saved evidence as derived and never substitutes an old checkpoint", async () => {
  const db = backend(); const gateway = new MemoryGateway(db.store, app);
  const id = canonicalCheckpointId(scope, "task");
  db.records.set(id, { id, text: "obsolete explicit guidance", updatedAt: "2026-10-15T00:00:00Z" });
  const packet = await gateway.resumeContext("task", "continue");
  assert.equal(packet.checkpointState, "derived-not-persisted");
  assert(!packet.checkpoint?.text.includes("obsolete"));
  db.records.get(id).updatedAt = "2026-10-17T00:00:00Z";
  assert.equal((await gateway.resumeContext("task", "continue")).checkpointState, "explicit");
  assert.equal((await new MemoryGateway(db.store, { ...app, automaticCheckpoints: false }).resumeContext("task", "continue")).checkpointState, "explicit");
});

test("checkpoint scope validation prevents writes from another owner or namespace", async () => {
  const db = backend();
  await assert.rejects(persistAutomaticCheckpoint(db.store, { ...scope, ownerId: "other" }), /scope mismatch/);
  await assert.rejects(persistAutomaticCheckpoint(db.store, { ...scope, namespace: "other" }), /scope mismatch/);
  assert.equal(db.records.size, 0);
});

test("generation failures retry independently after conversation delivery; opt-outs preserve pending jobs", async t => {
  const directory = await mkdtemp(join(tmpdir(), "ram-checkpoint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = backend(); let creates = 0; let appends = 0;
  const config = captureConfigSchema.parse({ ownerId: "owner", namespace: "project" });
  const input = { hook_event_name: "Stop", session_id: "chat", last_assistant_message: "Captured report" };
  const entry = makeEntry(config, "/project", "codex", input)!;
  db.session().sessionId = entry.memories[0].session_id;
  const transport: CaptureTransport = { create: async batch => { creates++; return { created: batch.map(m => m.id) }; }, recall: async () => [],
    session: { append: async request => { appends++; return { event: { ...request, eventId: "server-id" } } as any; }, read: db.store.getSessionMemory },
    checkpoints: { ...db.store, bulkCreateLongTermMemories: async () => { throw new Error("generator unavailable"); } } };
  await enqueue(directory, entry);
  const failed = await flush(directory, transport);
  assert.equal(failed.pending, 0); assert.equal(failed.checkpointPending, 1);
  const options = { enabled: true, sessionCapture: true, sessionObservations: false, compatibilityCapture: true, automaticCheckpoints: false };
  await flush(directory, transport, [], {}, undefined, options);
  transport.checkpoints = db.store;
  const success = await flush(directory, transport);
  assert.equal(success.checkpointSaved, 1); assert.equal(success.checkpointPending, 0);
  assert.equal(creates, 1); assert.equal(appends, 1);
  await flush(directory, transport); assert.equal(db.records.size, 1);
});

test("boundary with no final response still checkpoints retained session evidence", async t => {
  const directory = await mkdtemp(join(tmpdir(), "ram-boundary-checkpoint-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = backend(); const config = captureConfigSchema.parse({ ownerId: "owner", namespace: "project" });
  const plan = checkpointPlan(config, "/project", "codex", { hook_event_name: "PreCompact", session_id: "chat" });
  db.session().sessionId = plan.sessionId;
  await enqueue(directory, { version: 2, memories: [], compatibility: false, checkpoint: plan });
  const result = await flush(directory, { checkpoints: db.store, create: async () => { throw new Error("no message write"); }, recall: async () => [] });
  assert.equal(result.checkpointSaved, 1);
});

 test("equivalent implicit and normalized privacy defaults resolve the same revision", () => {
  const db = backend();
  assert.equal(automaticCheckpointId(scope, db.session()), automaticCheckpointId(scope, db.session(), guardrailsSchema.parse({})));
});

test("checkpoint routing IDs survive credential redaction without weakening key protection", () => {
  const id = "task-0d205d880fb8785f0d390c7f7bd088fc";
  assert.equal(redactSensitiveText(id), id);
  assert.equal(redactSensitiveText("sk-proj-abcdefghijklmnop"), "[REDACTED]");
  assert.equal(redactSensitiveText(id, [id]), "[REDACTED]");
});
