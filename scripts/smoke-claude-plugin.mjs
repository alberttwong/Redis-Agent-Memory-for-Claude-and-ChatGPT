import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const directory = await mkdtemp(join(tmpdir(), "claude-memory-installed-"));
const installed = join(directory, "plugin with spaces");
await cp(resolve("plugins/redis-agent-memory-claude"), installed, { recursive: true });
const client = new Client({ name: "claude-plugin-smoke", version: "1.0.0" });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [join(installed, "server", "index.mjs")],
    env: { AGENT_MEMORY_CONFIG_FILE: join(directory, "private", "connection.json") }, stderr: "ignore" }));
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "memory_setup"));
  assert.ok(tools.tools.some((tool) => tool.name === "memory_health"));
  const missing = await client.callTool({ name: "memory_health", arguments: {} });
  assert.equal(missing.isError, true);
  assert.ok(JSON.stringify(missing.content).includes("memory_setup"));
  const setup = await client.callTool({ name: "memory_setup", arguments: {} });
  const link = setup.structuredContent;
  const url = new URL(link.url);
  const form = await fetch(url);
  assert.equal(form.status, 200);
  assert.ok((await form.text()).includes("Set up Redis Memory"));
  const saved = await fetch(`${url.origin}/settings`, { method: "POST", headers: {
    "Content-Type": "application/json", "X-Setup-Token": url.hash.slice(1), Origin: url.origin,
  }, body: JSON.stringify({ baseUrl: "https://memory.example.test", storeId: "smoke", apiKey: "test-key" }) });
  assert.equal(saved.status, 200);
  // Run the installed commands, with spaces in both plugin and project paths,
  // and no source tree, node_modules, real credentials, or network requests.
  const project = join(directory, "target project");
  await mkdir(project);
  const settings = join(directory, "private", "connection.json");
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    CLAUDE_PLUGIN_ROOT: installed, CLAUDE_PROJECT_DIR: project,
    CLAUDE_PLUGIN_DATA: join(directory, "private"),
    AGENT_MEMORY_SHARED_SETTINGS_FILE: join(directory, "no-shared-settings.json") };
  const cli = (...args) => {
    const result = spawnSync(process.execPath, [join(installed, "server/capture-cli.mjs"), ...args,
      "--project", project], { env, cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(cli("configure").environment.projectEnvExists, true);
  const captureConfigPath = join(project, ".memory-capture.json");
  await writeFile(captureConfigPath, JSON.stringify({ ...JSON.parse(await readFile(captureConfigPath, "utf8")), sessionCapture: false }));
  assert.equal(cli("doctor", "--plugin").ok, true, "Browser credentials must also configure capture");
  const hooks = JSON.parse(await readFile(join(installed, "hooks/hooks.json"), "utf8")).hooks;
  const hook = (event, fields = {}, context = false) => {
    const command = hooks[event][0].hooks[0].command;
    const result = spawnSync(command, { shell: true, env, cwd: directory, encoding: "utf8",
      input: JSON.stringify({ hook_event_name: event, session_id: "smoke-session", cwd: project, ...fields }) });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    if (!context) assert.deepEqual(output, {});
    return output;
  };
  const queued = async () => {
    try {
      const queue = join(project, ".memory-capture/queue");
      const names = (await readdir(queue)).filter(name => name.endsWith(".json"));
      return Promise.all(names.map(async name => JSON.parse(await readFile(join(queue, name), "utf8"))));
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  // Force delivery to fail before fetch; the hook must retain events and allow the chat to continue.
  const savedSettings = JSON.parse(await readFile(settings, "utf8"));
  await writeFile(settings, JSON.stringify({ ...savedSettings, AGENT_MEMORY_BASE_URL: "http://offline.invalid" }));
  hook("UserPromptSubmit", { prompt: "Remember test-key" });
  hook("UserPromptSubmit", { prompt: "Remember test-key" });
  hook("Stop", { last_assistant_message: "Saved your decision" });
  hook("Stop");
  hook("SessionStart");
  const entries = await queued();
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map(entry => entry.memories[0].id)).size, 3);
  const messages = entries.flatMap(entry => entry.memories.map(memory => JSON.parse(memory.text)));
  assert.equal(messages.filter(message => message.role === "USER").length, 2);
  assert.ok(messages.every(message => message.source === "claude"));
  assert.ok(messages.some(message => message.role === "ASSISTANT" && message.content === "Saved your decision"));
  assert.ok(messages.filter(message => message.role === "USER").every(message => message.content === "Remember [REDACTED]"));
  // Exercise successful MCP delivery and recall through the bundled handler.
  // A preload intercepts fetch, so this test never contacts an external service.
  const calls = join(directory, "calls.jsonl");
  const mock = join(directory, "mock-redis.mjs");
  await writeFile(mock, `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://memory.example.test/v1/stores/smoke/mcp') throw new Error('Unexpected endpoint');
  const request = JSON.parse(options.body);
  if (new Headers(options.headers).get('authorization') !== 'Bearer test-key') throw new Error('Wrong credentials');
  if (request.id === undefined) return new Response(null, { status: 202 });
  let result;
  if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mock-memory', version: '1' } };
  else if (request.method === 'tools/call') {
    appendFileSync(process.env.TEST_MEMORY_CALLS, JSON.stringify(request.params) + '\\n');
    const data = request.params.name === 'create_long_term_memories'
      ? { created: request.params.arguments.memories.map(memory => memory.id) }
      : { memories: [{ text: 'Previously saved project context' }] };
    result = { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } else throw new Error('Unexpected MCP method');
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
};`);
  await writeFile(settings, JSON.stringify(savedSettings));
  env.NODE_OPTIONS = '--import=' + pathToFileURL(mock).href;
  env.TEST_MEMORY_CALLS = calls;
  const started = hook("SessionStart", {}, true);
  assert.ok(started.hookSpecificOutput.additionalContext.includes("Previously saved project context"));
  assert.equal((await queued()).length, 0, "Acknowledged writes must drain the outage queue");
  const requests = (await readFile(calls, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  const delivered = requests.filter(call => call.name === "create_long_term_memories").flatMap(call => call.arguments.memories);
  assert.deepEqual(new Set(delivered.map(memory => memory.id)), new Set(entries.flatMap(entry => entry.memories.map(memory => memory.id))));
  const recall = requests.find(call => call.name === "search_long_term_memory");
  assert.equal(recall.arguments.namespace, delivered[0].namespace);
  assert.equal(recall.arguments.owner_id, delivered[0].owner_id);
  await writeFile(join(project, ".memory-capture.json"), JSON.stringify({ enabled: false }));
  hook("UserPromptSubmit", { prompt: "Do not save" });
  assert.equal((await queued()).length, 0);
  await rm(join(project, ".memory-capture.json"));
  hook("UserPromptSubmit", { prompt: "Unconfigured project" });
  assert.equal((await queued()).length, 0);
  console.log("Installed Claude plugin: browser setup, credential reuse, prompt/response hooks, outage/retry delivery, startup recall, redaction, and opt-out passed.");
} finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
