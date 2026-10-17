import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Executes packaged commands from both manifests. This verifies handler delivery,
// not that a real host dispatches these events (in particular PreCompact).
const directory = await mkdtemp(join(tmpdir(), "ram-lifecycle-smoke-"));
try {
  const mock = join(directory, "mock.mjs");
  await writeFile(mock, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  if (process.env.TEST_OUTAGE === 'true') throw new Error('private response test-key');
  if (String(url) !== 'https://memory.example.test/v1/stores/test/mcp') throw new Error('Unexpected endpoint');
  const request = JSON.parse(options.body);
  if (request.id === undefined) return new Response(null, { status: 202 });
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } };
  else if (request.method === 'tools/call') {
    appendFileSync(process.env.TEST_CALLS, JSON.stringify(request.params) + '\\n');
    const data = request.params.name === 'create_long_term_memories'
      ? { created: request.params.arguments.memories.map(memory => memory.id) } : { memories: [] };
    result = { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } else throw new Error('Unexpected method');
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
};`);
  for (const [source, folder, expected] of [["claude", "redis-agent-memory-claude", 12], ["codex", "redis-agent-memory", 6]]) {
    const installed = join(directory, `${source} plugin`);
    const project = join(directory, `${source} project`);
    await cp(resolve("plugins", folder), installed, { recursive: true });
    await mkdir(project);
    const calls = join(directory, `${source}-calls.jsonl`);
    await writeFile(calls, "");
    const configPath = join(project, ".memory-capture.json");
    const config = { automaticCheckpoints: false, enabled: true, ownerId: "test-person", namespace: "test-project", observations: { inputChars: 100, outputChars: 100 } };
    await writeFile(configPath, JSON.stringify(config));
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      CLAUDE_PLUGIN_ROOT: installed, PLUGIN_ROOT: installed, CLAUDE_PROJECT_DIR: project,
      MEMORY_CAPTURE_PROJECT_ROOT: project,
      AGENT_MEMORY_BASE_URL: "https://memory.example.test", AGENT_MEMORY_STORE_ID: "test", AGENT_MEMORY_API_KEY: "test-key",
      AGENT_MEMORY_CONFIG_FILE: join(directory, "no-browser-settings.json"),
      AGENT_MEMORY_SHARED_SETTINGS_FILE: join(directory, "no-shared-settings.json"),
      NODE_OPTIONS: "--import=" + pathToFileURL(mock).href, TEST_CALLS: calls };
    const hooks = JSON.parse(await readFile(join(installed, "hooks/hooks.json"), "utf8")).hooks;
    assert.equal(Object.keys(hooks).length, expected);
    function run(event, fields = {}, outage = false) {
      const result = spawnSync(hooks[event][0].hooks[0].command, { shell: true, env: { ...env, TEST_OUTAGE: String(outage) }, cwd: project,
        encoding: "utf8", input: JSON.stringify({ hook_event_name: event, session_id: "session", turn_id: "turn", ...fields }) });
      assert.equal(result.status, 0, result.stderr);
      assert(!result.stderr.includes("test-key"));
      assert.deepEqual(JSON.parse(result.stdout), {});
    }
    const tool = { tool_name: "Bash", tool_use_id: "tool-1", tool_input: { command: "npm test", apiKey: "test-key" } };
    run("PreToolUse", tool, true);
    const queue = join(project, ".memory-capture/queue");
    const pending = (await readdir(queue)).filter(name => name.endsWith(".json"));
    assert.equal(pending.length, 1);
    assert(!(await readFile(join(queue, pending[0]), "utf8")).includes("test-key"));
    run("PostToolUse", { ...tool, tool_response: "validation output " + "x".repeat(50000) });
    assert.equal((await readdir(queue)).filter(name => name.endsWith(".json")).length, 0);
    run("PostToolUse", { ...tool, tool_response: "validation output " + "x".repeat(50000) });
    run("PreCompact", { trigger: "manual", custom_instructions: "Preserve timeout investigation" });
    if (source === "claude") {
      run("PostToolUseFailure", { ...tool, tool_use_id: "tool-2", error: "test-key command failed", duration_ms: 10 });
      run("SubagentStart", { agent_id: "agent-1", agent_type: "Explore" });
      run("SubagentStop", { agent_id: "agent-1", last_assistant_message: "Investigated timeout" });
      run("Notification", { notification_type: "idle_prompt", message: "Awaiting input" });
      run("TaskCompleted", { task_id: "task-1", task_subject: "Investigate timeout" });
      run("SessionEnd", { reason: "other" });
    }
    const reads = async () => (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const requests = await reads();
    const delivered = requests.flatMap(call => call.arguments.memories ?? []);
    assert.equal(delivered.length, expected - 3);
    assert.equal(new Set(delivered.map(memory => memory.id)).size, delivered.length);
    assert(delivered.every(memory => memory.owner_id === "test-person" && memory.namespace === "test-project"));
    assert(!JSON.stringify(delivered).includes("test-key"));
    assert(delivered.every(memory => JSON.parse(memory.text).role === "OBSERVATION"));
    run("PreToolUse", { ...tool, tool_name: "mcp__redis-agent-memory__memory_health" });
    await writeFile(configPath, JSON.stringify({ ...config, observations: { excludedTools: ["Bash"] } }));
    run("PreToolUse", { ...tool, tool_use_id: "excluded" });
    await writeFile(configPath, JSON.stringify({ ...config, enabled: false }));
    run("PreToolUse", { ...tool, tool_use_id: "disabled" });
    assert.equal((await reads()).length, requests.length);
    await writeFile(configPath, JSON.stringify(config));
    run("PreToolUse", { ...tool, tool_use_id: "outage-before-optout" }, true);
    await writeFile(configPath, JSON.stringify({ ...config, enabled: false }));
    const flush = spawnSync(process.execPath, [join(installed, "server", source === "claude" ? "capture-cli.mjs" : "capture-cli.js"),
      "flush", source, "--project", project], { env, cwd: project, encoding: "utf8" });
    assert.equal(flush.status, 0, flush.stderr);
    assert.deepEqual(JSON.parse(flush.stdout), { enabled: false, sent: 0, pending: 1 });
    assert.equal((await reads()).length, requests.length);
    await writeFile(configPath, JSON.stringify({ ...config, observations: { excludedTools: ["Bash"] } }));
    run("PreToolUse", { ...tool, tool_use_id: "excluded-at-retry" });
    assert.equal((await readdir(queue)).filter(name => name.endsWith(".json")).length, 0);
    assert.equal((await reads()).length, requests.length);
    const diagnosticFiles = await readdir(join(project, ".memory-capture/diagnostics"));
    assert(diagnosticFiles.some(file => file.endsWith("-PreCompact.json")));
    console.log(`${source}: ${expected} manifest hooks, bounded observations, privacy, exclusions, outage/retry, replay receipts, and event dispatch diagnostics passed (mock transport; no host dispatch claim).`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
