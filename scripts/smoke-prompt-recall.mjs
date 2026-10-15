import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "prompt-recall-"));
try {
  const mock = join(directory, "mock.mjs");
  await writeFile(mock, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://memory.example.test/v1/stores/test/mcp') throw new Error('Unexpected endpoint');
  const request = JSON.parse(options.body);
  if (request.id === undefined) return new Response(null, { status: 202 });
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } };
  else if (request.method === 'tools/call') {
    appendFileSync(process.env.TEST_CALLS, JSON.stringify(request.params) + '\\n');
    const search = request.params.name === 'search_long_term_memory';
    const fail = search ? process.env.TEST_MODE === 'search-error' : process.env.TEST_MODE === 'write-error';
    const data = search ? { memories: process.env.TEST_MODE === 'empty' ? [] : [{ text: 'Checkout retries allow seven attempts' }] }
      : { created: request.params.arguments.memories.map(memory => memory.id) };
    result = fail ? { isError: true, content: [{ type: 'text', text: 'Simulated failure' }] }
      : { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } else throw new Error('Unexpected method');
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
};`);
  for (const [source, folder] of [["claude", "redis-agent-memory-claude"], ["codex", "redis-agent-memory"]]) {
    const installed = join(directory, `${source} plugin`);
    const project = join(directory, `${source} project`);
    await cp(resolve("plugins", folder), installed, { recursive: true });
    await mkdir(project);
    const calls = join(directory, `${source}-calls.jsonl`);
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      CLAUDE_PLUGIN_ROOT: installed, PLUGIN_ROOT: installed, CLAUDE_PROJECT_DIR: project,
      AGENT_MEMORY_BASE_URL: "https://memory.example.test", AGENT_MEMORY_STORE_ID: "test", AGENT_MEMORY_API_KEY: "test-key",
      AGENT_MEMORY_CONFIG_FILE: join(directory, "no-browser-settings.json"),
      AGENT_MEMORY_SHARED_SETTINGS_FILE: join(directory, "no-shared-settings.json"),
      MEMORY_CAPTURE_PROJECT_ROOT: project,
      NODE_OPTIONS: '--import=' + pathToFileURL(mock).href, TEST_CALLS: calls };
    const config = { enabled: true, ownerId: "test-person", namespace: "test-project" };
    const configPath = join(project, ".memory-capture.json");
    const hooks = JSON.parse(await readFile(join(installed, "hooks/hooks.json"), "utf8"));
    const command = hooks.hooks.UserPromptSubmit[0].hooks[0].command;
    async function run(mode, settings = {}) {
      await writeFile(configPath, JSON.stringify({ ...config, ...settings }));
      await writeFile(calls, "");
      const result = spawnSync(command, { shell: true, env: { ...env, TEST_MODE: mode }, cwd: project, encoding: "utf8",
        input: JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "session", prompt: "Checkout retries test-key mem1_sample" }) });
      assert.equal(result.status, 0, result.stderr);
      return { output: JSON.parse(result.stdout), calls: (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) };
    }
    const success = await run("success");
    assert.ok(success.output.hookSpecificOutput.additionalContext.includes("seven attempts"));
    assert.equal(success.calls[0].name, "search_long_term_memory", "Recall must precede the current prompt's upload");
    assert.deepEqual(success.calls[0].arguments, { text: "Checkout retries [REDACTED] [REDACTED]", owner_id: "test-person", namespace: "test-project", limit: 5, similarity_threshold: 0.7 });
    assert.equal(success.calls[1].name, "create_long_term_memories");
    const empty = await run("empty");
    assert.ok(!empty.output.hookSpecificOutput.additionalContext.includes("Relevant Redis memories"));
    const failedSearch = await run("search-error");
    assert.ok(failedSearch.calls.some(call => call.name === "create_long_term_memories"), "A recall error must not prevent saving");
    assert.ok(!failedSearch.output.hookSpecificOutput.additionalContext.includes("seven attempts"));
    const failedWrite = await run("write-error");
    assert.ok(failedWrite.output.hookSpecificOutput.additionalContext.includes("seven attempts"), "A write error must not discard retrieved context");
    const disabled = await run("success", { promptRecall: false });
    assert.ok(disabled.calls.every(call => call.name !== "search_long_term_memory"));
    assert.ok(disabled.calls.some(call => call.name === "create_long_term_memories"), "Turning off retrieval must preserve saving");
    console.log(`${source}: packaged prompt recall, scoped semantic query, search-before-save, independent failures, and retrieval opt-out passed.`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
