import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { AgentMemory } from "@redis-iris/agent-memory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { captureConfigSchema, makeEntry } from "../dist/src/capture.js";
import { loadMemoryEnvironment } from "../dist/src/shared-settings.js";

// This intentionally tests live storage through packaged handlers, not host
// dispatch. An actual host tool invocation and /compact must be checked separately.
test("packaged Claude and Codex tool observations round-trip through live Redis with isolated scope", { timeout: 150_000 }, async t => {
  await loadMemoryEnvironment(resolve("."));
  for (const name of ["AGENT_MEMORY_BASE_URL", "AGENT_MEMORY_STORE_ID", "AGENT_MEMORY_API_KEY"]) {
    assert(process.env[name]?.trim(), `Configure ${name}; this is an opt-in live test`);
  }
  const run = randomUUID();
  const config = captureConfigSchema.parse({ ownerId: `e2e-${run}`, namespace: "lifecycle-e2e",
    sessionId: `capture-${run}` });
  const directory = await mkdtemp(join(tmpdir(), "ram-live-lifecycle-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, ".memory-capture.json"), JSON.stringify(config));
  const ids = [];
  const api = new AgentMemory({ serverURL: process.env.AGENT_MEMORY_BASE_URL,
    storeId: process.env.AGENT_MEMORY_STORE_ID, apiKey: process.env.AGENT_MEMORY_API_KEY });
  t.after(async () => {
    if (!ids.length) return;
    try {
      const result = await api.bulkDeleteLongTermMemories({ memoryIds: ids }, { timeoutMs: 15000 });
      assert.equal(result.errors?.length ?? 0, 0, "Live fixture cleanup failed");
    } catch { throw new Error("Live lifecycle fixture cleanup failed; remove only this run's isolated e2e owner records"); }
  });
  for (const [source, folder] of [["claude", "redis-agent-memory-claude"], ["codex", "redis-agent-memory"]]) {
    const plugin = resolve("plugins", folder);
    const hooks = JSON.parse(await readFile(join(plugin, "hooks/hooks.json"), "utf8")).hooks;
    for (const event of ["PreToolUse", "PostToolUse"]) {
      const input = { hook_event_name: event, session_id: run, turn_id: "live-turn", tool_use_id: "live-tool",
        tool_name: "Bash", tool_input: { command: "printf lifecycle-marker" }, tool_response: `Lifecycle verification ${run}` };
      ids.push(...makeEntry(config, directory, source, input).memories.map(memory => memory.id));
      const result = spawnSync(hooks[event][0].hooks[0].command, { shell: true, cwd: directory, timeout: 30000,
        encoding: "utf8", input: JSON.stringify(input), env: { ...process.env,
          MEMORY_CAPTURE_OWNER_ID: config.ownerId, MEMORY_CAPTURE_PROJECT_ROOT: directory,
          PLUGIN_ROOT: plugin, CLAUDE_PLUGIN_ROOT: plugin, CLAUDE_PROJECT_DIR: directory } });
      assert.equal(result.status, 0, "Packaged lifecycle handler did not exit successfully");
      assert.deepEqual(JSON.parse(result.stdout), {});
    }
  }
  const client = new Client({ name: "lifecycle-e2e", version: "1" });
  t.after(() => client.close());
  const endpoint = new URL(`/v1/stores/${encodeURIComponent(process.env.AGENT_MEMORY_STORE_ID)}/mcp`, process.env.AGENT_MEMORY_BASE_URL);
  await client.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${process.env.AGENT_MEMORY_API_KEY}` } },
  }));
  const deadline = Date.now() + 60000;
  for (;;) {
    const result = await client.callTool({ name: "search_long_term_memory", arguments: {
      owner_id: config.ownerId, namespace: config.namespace, topics: ["auto-observation"], limit: 20,
    } }, undefined, { timeout: 15000 });
    assert(!result.isError, "Live scoped retrieval failed");
    const data = result.structuredContent ?? JSON.parse(result.content.find(part => part.type === "text").text);
    const found = data.memories.filter(memory => ids.includes(memory.id));
    if (found.length === ids.length) {
      assert(found.every(memory => memory.owner_id === config.ownerId && memory.namespace === config.namespace));
      assert(found.every(memory => JSON.parse(memory.text).role === "OBSERVATION"));
      assert(found.some(memory => memory.text.includes(run)));
      break;
    }
    assert(Date.now() < deadline, "Captured observations were not retrieved within 60 seconds");
    await delay(2000);
  }
  t.diagnostic("Verified four scoped live tool observations from two packaged clients; host dispatch and extraction not tested.");
});
