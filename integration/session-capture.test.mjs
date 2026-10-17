import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { AgentMemory } from "@redis-iris/agent-memory";
import { MemoryGateway } from "../dist/src/memory.js";
import { captureConfigSchema, scope } from "../dist/src/capture.js";
import { loadMemoryEnvironment } from "../dist/src/shared-settings.js";

test("packaged capture: scoped session delivery, compatibility, and extraction verification", { timeout: 600000 }, async t => {
  await loadMemoryEnvironment(resolve("."));
  for (const name of ["AGENT_MEMORY_BASE_URL", "AGENT_MEMORY_STORE_ID", "AGENT_MEMORY_API_KEY"]) assert(process.env[name]?.trim(), `Configure ${name} for this opt-in live test`);
  const run = randomUUID();
  const config = captureConfigSchema.parse({ ownerId: `e2e-${run}`, namespace: "capture-session-e2e", sessionId: `task-${run}`, promptRecall: false, recallLimit: 0 });
  const directory = await mkdtemp(join(tmpdir(), "ram-live-session-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, ".memory-capture.json"), JSON.stringify(config));
  const sessionId = scope(config, directory, "claude", { hook_event_name: "Stop", session_id: run }).session;
  const api = new AgentMemory({ serverURL: process.env.AGENT_MEMORY_BASE_URL, storeId: process.env.AGENT_MEMORY_STORE_ID,
    apiKey: process.env.AGENT_MEMORY_API_KEY, debugLogger: { log() {}, group() {}, groupEnd() {} } });
  const options = { timeoutMs: 15000, retries: { strategy: "none" } };
  const filter = { ownerId: { eq: config.ownerId }, namespace: { eq: config.namespace } };
  t.after(async () => {
    try { await api.deleteSessionMemory(sessionId, options); } catch (error) { if (error.statusCode !== 404) throw new Error("Live session fixture cleanup failed"); }
    for (;;) {
      const result = await api.searchLongTermMemory({ filter: { ownerId: { eq: config.ownerId } }, filterOp: "all", limit: 100 }, options);
      if (!result.items.length) break;
      const removed = await api.bulkDeleteLongTermMemories({ memoryIds: result.items.map(item => item.id) }, options);
      assert.equal(removed.errors?.length ?? 0, 0, "Live memory fixture cleanup failed");
      if (result.items.length < 100) break;
    }
  });
  let expected = 0;
  for (const [source, folder] of [["claude", "redis-agent-memory-claude"], ["codex", "redis-agent-memory"]]) {
    const plugin = resolve("plugins", folder);
    const hooks = JSON.parse(await readFile(join(plugin, "hooks/hooks.json"), "utf8")).hooks;
    for (const event of ["UserPromptSubmit", "Stop"]) {
      const input = { hook_event_name: event, session_id: `${source}-${run}`, turn_id: `${source}-turn`,
        prompt: `For validation project ${run}, the agreed checkout retry limit is three attempts. Use exponential backoff between attempts.`,
        last_assistant_message: `Confirmed: project ${run} uses three checkout retry attempts with exponential backoff.` };
      const result = spawnSync(hooks[event][0].hooks[0].command, { shell: true, cwd: directory, timeout: 30000, encoding: "utf8", input: JSON.stringify(input), env: {
        ...process.env, PLUGIN_ROOT: plugin, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_PROJECT_DIR: directory,
        MEMORY_CAPTURE_PROJECT_ROOT: directory, MEMORY_CAPTURE_OWNER_ID: config.ownerId,
      } });
      assert.equal(result.status, 0, "Packaged capture handler failed");
      assert.deepEqual(JSON.parse(result.stdout), {});
      const session = await api.getSessionMemory(sessionId, true, options);
      assert.equal(session.ownerId, config.ownerId); assert.equal(session.namespace, config.namespace);
      assert.equal(session.events.length, ++expected);
      assert.equal(session.events.at(-1).role, event === "Stop" ? "ASSISTANT" : "USER");
    }
  }
  const session = await api.getSessionMemory(sessionId, true, options);
  assert.deepEqual(session.events.map(event => event.metadata.source), ["claude", "claude", "codex", "codex"]);
  assert.equal(new Set(session.events.map(event => event.metadata.captureId)).size, 4);
  const compatibility = await api.searchLongTermMemory({ filter: { ...filter, memoryType: { eq: "message" } }, filterOp: "all", limit: 20 }, options);
  assert.equal(compatibility.items.length, 4, "Compatibility transcripts must remain searchable");
  const gateway = new MemoryGateway(api, { baseUrl: process.env.AGENT_MEMORY_BASE_URL, storeId: process.env.AGENT_MEMORY_STORE_ID,
    apiKey: process.env.AGENT_MEMORY_API_KEY, ownerId: config.ownerId, legacyNamespace: config.namespace, agentId: "test" });
  const resumed = await gateway.resumeContext(sessionId, "retry limit");
  assert.equal(resumed.checkpointState, "automatic", "Packaged Stop must persist the current automatic checkpoint");
  assert.match(resumed.checkpoint.text, /three checkout retry/);
  assert.equal(resumed.session.events.length, 4);
  assert(!resumed.recalled.items.some(item => item.topics?.includes("automatic-checkpoint")));
  await writeFile(join(directory, ".memory-capture.json"), JSON.stringify({...config, recallLimit: 6}));
  const startup = spawnSync(process.execPath, [resolve("plugins/redis-agent-memory/server/capture-cli.js"), "hook", "codex", "--project", directory], {
    cwd: directory, encoding: "utf8", timeout: 30000, input: JSON.stringify({hook_event_name: "SessionStart", session_id: `fresh-${run}`}),
    env: {...process.env, MEMORY_CAPTURE_OWNER_ID: config.ownerId},
  });
  assert.equal(startup.status, 0);
  const startupPacket = JSON.parse(JSON.parse(startup.stdout).hookSpecificOutput.additionalContext);
  assert.equal(startupPacket.checkpoint?.sessionId, sessionId, "Fresh packaged local chat must discover the prior session checkpoint");
  console.log("Live automatic checkpoint saved across packaged clients and resumed through the shared bridge.");
  console.log("Live packaged capture: four ordered scoped turns and compatibility records verified.");
  await t.test("asynchronous extraction under the expected scope", { skip: process.env.RAM_CAPTURE_SKIP_EXTRACTION === "1" }, async () => {
    console.log("Polling asynchronous extraction for up to eight minutes.");
    const deadline = Date.now() + 480000;
    for (;;) {
      const result = await api.searchLongTermMemory({ text: "checkout retry limit three attempts exponential backoff",
        filter: { ...filter, memoryType: { in: ["semantic", "episodic"] } }, filterOp: "all", similarityThreshold: 0, limit: 20 }, options);
      const extracted = result.items.find(item => !item.topics?.includes("automatic-checkpoint") && /\b(?:three|3)\b/i.test(item.text) && /retr|attempt/i.test(item.text));
      if (extracted) {
        assert.equal(extracted.ownerId, config.ownerId); assert.equal(extracted.namespace, config.namespace);
        console.log("Live extracted fact verified under the expected owner and project namespace.");
        break;
      }
      assert(Date.now() < deadline, "Session delivery succeeded, but no scoped extracted fact appeared within eight minutes; verify service extraction configuration/provider availability");
      await delay(10000);
    }
  });
});
