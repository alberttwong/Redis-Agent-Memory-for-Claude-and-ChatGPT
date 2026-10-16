import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = await mkdtemp(join(tmpdir(), "ram-diagnostic-smoke-"));
try {
  const mock = join(root, "mock.mjs");
  const database = join(root, "memories.json");
  await writeFile(database, "[]");
  await writeFile(mock, `import {readFileSync, writeFileSync} from 'node:fs';
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  if (request.id === undefined) return new Response(null, {status: 202});
  let result;
  if (request.method === 'initialize') result = {protocolVersion: request.params.protocolVersion, capabilities: {tools: {}}, serverInfo: {name: 'test', version: '1'}};
  else if (request.method === 'tools/call') {
    const args = request.params.arguments;
    const memories = JSON.parse(readFileSync(process.env.TEST_DATABASE, 'utf8'));
    let data;
    if (request.params.name === 'create_long_term_memories') {
      if (process.env.TEST_OUTAGE) throw new Error('Do not print credential test-key or captured content');
      const byId = new Map(memories.map(memory => [memory.id, memory]));
      args.memories.forEach(memory => byId.set(memory.id, memory));
      writeFileSync(process.env.TEST_DATABASE, JSON.stringify([...byId.values()]));
      data = {created: args.memories.map(memory => memory.id)};
    } else {
      data = {memories: memories.filter(memory => memory.owner_id === args.owner_id && memory.namespace === args.namespace).slice(0, args.limit)};
    }
    if (process.env.TEST_MALFORMED && request.params.name === 'search_long_term_memory') data = {};
    result = {content: [{type: 'text', text: JSON.stringify(data)}]};
  } else throw new Error('Unexpected method');
  return new Response(JSON.stringify({jsonrpc: '2.0', id: request.id, result}), {headers: {'Content-Type': 'application/json'}});
};`);
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, ".memory-capture.json"), JSON.stringify({ownerId: "test-person", namespace: "test-project"}));
  const clients = [
    ["codex", resolve("plugins/redis-agent-memory/server/capture-cli.js")],
    ["claude", resolve("plugins/redis-agent-memory-claude/server/capture-cli.mjs")],
  ];
  function run(client, args, extra = {}, input) {
    const [source, cli] = client;
    const result = spawnSync(process.execPath, [cli, ...args, "--client", source, "--project", project], {
      cwd: project, encoding: "utf8", input: input ? JSON.stringify(input) : undefined,
      env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        NODE_OPTIONS: "--import=" + pathToFileURL(mock).href, TEST_DATABASE: database,
        AGENT_MEMORY_BASE_URL: "https://memory.example.test", AGENT_MEMORY_STORE_ID: "test", AGENT_MEMORY_API_KEY: "test-key",
        AGENT_MEMORY_SHARED_SETTINGS_FILE: join(root, "no-shared.json"), AGENT_MEMORY_CONFIG_FILE: join(root, "no-browser.json"), ...extra},
    });
    assert(!result.stderr.includes("test-key"), "Errors must not leak credentials");
    return {...result, lines: result.stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line))};
  }
  const initial = run(clients[0], ["status"]);
  assert.equal(initial.lines[0].diagnostics.lastDelivery.state, "unknown");
  const outage = run(clients[0], ["check"], {TEST_OUTAGE: "1"});
  assert.equal(outage.status, 1, outage.stderr);
  const marker = outage.lines[0].marker;
  assert.equal(outage.lines.at(-1).delivery, "pending");
  assert.equal(outage.lines.at(-1).pending, 1);
  const retry = run(clients[0], ["flush"]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.lines[0].pending, 0);
  const other = run(clients[1], ["check", "--verify", marker]);
  assert.equal(other.status, 0, other.stderr);
  assert.equal(other.lines.at(-1).markerFound, true);
  assert.equal(other.lines.at(-1).injection, "not-tested");
  const mismatch = run(clients[1], ["check", "--verify", marker], {MEMORY_CAPTURE_OWNER_ID: "other-person"});
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.lines.at(-1).recall.outcome, "empty");
  for (const client of clients) {
    const hook = run(client, ["hook"], {}, {hook_event_name: "UserPromptSubmit", session_id: "next-chat", prompt: marker});
    assert.equal(hook.status, 0, hook.stderr);
    assert(hook.lines[0].hookSpecificOutput.additionalContext.includes(marker));
    const status = run(client, ["status"]).lines[0];
    assert.equal(status.diagnostics.promptRecall.recall.context, "emitted-to-host");
    assert(status.diagnostics.promptRecall.recall.ids.length > 0);
    assert.equal(status.diagnostics.lastCapture.state, "observed");
    assert.equal(status.diagnostics.lastDelivery.state, "observed");
    assert(!JSON.stringify(status).includes(marker));
    const startup = run(client, ["hook"], {}, {hook_event_name: "SessionStart", session_id: "fresh-chat"});
    assert.equal(startup.status, 0, startup.stderr);
    assert(startup.lines[0].hookSpecificOutput.additionalContext.includes(marker));
    assert.equal(run(client, ["status"]).lines[0].diagnostics.startupRecall.recall.context, "emitted-to-host");
    run(client, ["hook"], {TEST_MALFORMED: "1"}, {hook_event_name: "UserPromptSubmit", session_id: "bad-response", prompt: marker});
    assert.equal(run(client, ["status"]).lines[0].diagnostics.promptRecall.recall.outcome, "unavailable");
    // A configuration problem must replace previous success with unavailable.
    const missing = run(client, ["hook"], {AGENT_MEMORY_API_KEY: ""}, {hook_event_name: "UserPromptSubmit", session_id: "missing-key", prompt: "private prompt"});
    assert.equal(missing.status, 0);
    const unavailable = run(client, ["status"]).lines[0].diagnostics.promptRecall.recall;
    assert.equal(unavailable.outcome, "unavailable");
    assert.equal(unavailable.attempted, false);
  }
  assert(JSON.parse(await readFile(database, "utf8")).length > 0);
  await writeFile(join(project, ".memory-capture.json"), "broken");
  for (const mode of ["status", "doctor"]) {
    const invalid = run(clients[0], [mode]);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.lines[0].diagnostics.state, "unavailable");
    assert.equal(invalid.lines[0].ownerId, null);
  }
  console.log("Packaged clients: marker capture, outage/retry, cross-client scope, hook output and metadata diagnostics passed.");
} finally { await rm(root, {recursive: true, force: true}); }
