import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureConfigSchema, enqueue, flush, makeEntry, type CaptureTransport } from "../src/capture.js";
import { claudeCaptureEvents, type HookInput } from "../src/hook-observations.js";

const config = captureConfigSchema.parse({ ownerId: "owner", namespace: "project" });
const input: HookInput = { hook_event_name: "PreToolUse", session_id: "conversation", turn_id: "turn",
  tool_use_id: "call-1", tool_name: "Bash", tool_input: { command: "npm test", apiKey: "configured-secret" },
  timestamp: "2026-10-16T12:00:00Z" };
const transport = (create: CaptureTransport["create"]): CaptureTransport => ({ create, recall: async () => [] });
function envelope(event: HookInput, settings = config) {
  const entry = makeEntry(settings, "/project", "claude", event, ["configured-secret"])!;
  return { entry, saved: JSON.parse(entry.memories[0].text), content: JSON.parse(entry.memories.map(memory => JSON.parse(memory.text).content).join("")) };
}

test("all additional Claude lifecycle events preserve observation identity and scope", () => {
  for (const event of claudeCaptureEvents.filter(event => !["SessionStart", "UserPromptSubmit", "Stop"].includes(event))) {
    const { entry, saved } = envelope({ ...input, hook_event_name: event, agent_id: "agent", task_id: "task" });
    assert.equal(saved.role, "OBSERVATION");
    assert.equal(saved.eventType, event);
    assert.equal(saved.capturedAt, "2026-10-16T12:00:00.000Z");
    assert.equal(saved.toolCallId, "call-1");
    assert.equal(saved.agentId, "agent");
    assert.equal(saved.taskId, "task");
    assert.equal(entry.memories[0].owner_id, "owner");
    assert.equal(entry.memories[0].namespace, "project");
    assert(entry.memories[0].topics.includes("observation"));
    assert(entry.memories[0].topics.includes("auto-observation"));
    assert(!entry.memories[0].topics.includes("auto-capture"), "tool traffic must not crowd startup conversation recall");
  }
  assert.equal(makeEntry(config, "/project", "claude", { ...input, hook_event_name: "UnknownEvent" }), null);
});

test("tool intent, result and failure share correlation without collapsing into one record", () => {
  const pre = envelope(input);
  const post = envelope({ ...input, hook_event_name: "PostToolUse", tool_response: { output: "12 tests passed", exit_code: 0 } });
  const fail = envelope({ ...input, hook_event_name: "PostToolUseFailure", error: "exit 1", duration_ms: 30, is_interrupt: false });
  assert.equal(new Set([pre, post, fail].map(value => value.entry.memories[0].id)).size, 3);
  assert.equal(pre.saved.toolCallId, post.saved.toolCallId);
  assert(pre.content.details.text.includes("npm test"));
  assert(!post.content.details.text.includes("npm test"));
  assert(post.content.outcome.text.includes("12 tests passed"));
  assert(fail.content.outcome.text.includes("exit 1"));
  assert.equal(pre.entry.memories[0].id, envelope(input).entry.memories[0].id);
  assert.notEqual(pre.entry.memories[0].id, envelope({ ...input, tool_use_id: "call-2" }).entry.memories[0].id);
});

test("redaction happens on structured values before excerpts and metadata reach disk", () => {
  const policy = captureConfigSchema.parse({ ...config, guardrails: { redact: { credentials: false },
    sensitiveFields: ["employeeCode"], omitFields: ["toolCallId", "sourceSessionId", "turnId", "repoPath"] },
    observations: { inputChars: 80, outputChars: 80 } });
  const { entry, saved, content } = envelope({ ...input, tool_use_id: "configured-secret", session_id: "configured-secret",
    tool_input: { apiKey: "configured-secret", employeeCode: "INTERNAL", description: "person@example.com", padding: "x".repeat(10000) } }, policy);
  const serialized = JSON.stringify(entry);
  for (const value of ["configured-secret", "INTERNAL", "person@example.com"]) assert(!serialized.includes(value), value);
  for (const field of ["sourceSessionId", "turnId", "toolCallId", "repoPath"]) assert.equal(saved[field], undefined);
  assert(content.details.text.length <= 80);
  assert.equal(content.details.truncated, true);
});

test("memory tools, handler commands, excluded events and tools never enter capture", () => {
  for (const tool_name of ["memory_append", "checkpoint_save", "resume_context", "mcp__redis__memory_health",
    "mcp__redis-agent-memory__checkpoint_save", "mcp__agentmemory__memory_smart_search", "create_long_term_memories"]) {
    assert.equal(makeEntry(config, "/project", "claude", { ...input, tool_name }), null, tool_name);
  }
  assert.equal(makeEntry(config, "/project", "claude", { ...input, tool_input: { command: "node capture-cli.js flush" } }), null);
  for (const observations of [{ enabled: false }, { excludedEvents: ["PreToolUse"] }, { excludedTools: ["Ba*"] }]) {
    assert.equal(makeEntry(captureConfigSchema.parse({ ...config, observations }), "/project", "claude", input), null);
  }
  assert.equal(makeEntry(captureConfigSchema.parse({ ...config, guardrails: { captureObservations: false } }), "/project", "claude", input), null);
  assert.equal(makeEntry({ ...config, enabled: false }, "/project", "claude", input), null);
});

test("file writes keep intent without duplicated content; reads omit full file results", () => {
  const pre = envelope({ ...input, tool_name: "Write", tool_input: { file_path: "src/app.ts", content: "file contents" } });
  assert(!pre.content.details.text.includes("file contents"));
  assert(pre.content.details.text.includes("src/app.ts"));
  const post = envelope({ ...input, hook_event_name: "PostToolUse", tool_name: "Read", tool_response: "entire file contents" });
  assert(!post.content.outcome.text.includes("entire file contents"));
});

test("escaped conversation content and large host metadata stay within the service text limit", () => {
  const controls = "\u0000".repeat(7000);
  const entry = makeEntry(config, "/project", "codex", { hook_event_name: "UserPromptSubmit",
    session_id: controls, turn_id: controls, cwd: controls, prompt: controls })!;
  assert(entry.memories.every(memory => memory.text.length <= 50000));
  assert.equal(entry.memories.map(memory => JSON.parse(memory.text).content).join(""), controls);
});

test("pre-compaction saves only provided context, never synthesizes progress or a checkpoint", () => {
  const { entry, content } = envelope({ hook_event_name: "PreCompact", session_id: "conversation", turn_id: "turn",
    trigger: "manual", custom_instructions: "Preserve investigation of the timeout" });
  assert(content.details.text.includes("Preserve investigation"));
  assert(!JSON.stringify(entry).includes("checkpoint"));
  assert.equal(entry.memories[0].memory_type, "message");
});

test("acknowledged observations are not reuploaded after replay, including partial batch failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ram-observation-replay-"));
  const first = envelope(input).entry;
  const second = envelope({ ...input, tool_use_id: "call-2" }).entry;
  try {
    await enqueue(directory, { version: 1, memories: [...first.memories, ...second.memories] });
    await assert.rejects(flush(directory, transport(async memories => ({ created: [memories[0].id], errors: ["second failed"] }))));
    await flush(directory, transport(async memories => {
      assert.deepEqual(memories.map(memory => memory.id), [second.memories[0].id]);
      return { created: memories.map(memory => memory.id) };
    }));
    await enqueue(directory, first);
    const replay = await flush(directory, transport(async () => { throw new Error("accepted event replayed"); }));
    assert.equal(replay.sent, 0);
    assert.equal(replay.pending, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("queued observations respect later privacy and event/tool opt-outs on delivery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ram-observation-policy-"));
  try {
    for (const settings of [captureConfigSchema.parse({ observations: { excludedTools: ["Bash"] } }),
      captureConfigSchema.parse({ observations: { excludedEvents: ["PreToolUse"] } }),
      captureConfigSchema.parse({ guardrails: { captureObservations: false } })]) {
      const path = await enqueue(directory, envelope(input).entry);
      assert(!(await readFile(path, "utf8")).includes("configured-secret"));
      const result = await flush(directory, transport(async () => { throw new Error("opt-out bypassed"); }), [], settings.guardrails, settings.observations);
      assert.deepEqual(result, { sent: 0, pending: 0 });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
