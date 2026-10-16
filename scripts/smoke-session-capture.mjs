import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "ram-session-packaged-"));
try {
  const mock = join(directory, "mock.mjs");
  await writeFile(mock, `import { readFileSync, writeFileSync } from 'node:fs';
globalThis.fetch = async (input, options) => {
  const request = new Request(input, options);
  const url = new URL(request.url);
  if (url.origin !== 'https://memory.example.test') throw new Error('Unexpected origin');
  if (request.headers.get('authorization') !== 'Bearer test-key') throw new Error('Wrong credentials');
  const db = JSON.parse(readFileSync(process.env.TEST_DATABASE, 'utf8'));
  const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/v1/stores/test/session-memory/events') {
    const body = await request.json();
    const event = { ...body, eventId: 'event-' + (db.events.length + 1), systemTimestamp: new Date().toISOString() };
    db.events.push(event); writeFileSync(process.env.TEST_DATABASE, JSON.stringify(db));
    if (process.env.TEST_MODE === 'response-lost') throw new Error('private server failure test-key');
    return json({ event });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/v1/stores/test/session-memory/')) {
    const sessionId = url.pathname.split('/').at(-1);
    return json({ sessionId, ownerId: 'owner', namespace: 'project', events: db.events.filter(event => event.sessionId === sessionId) });
  }
  if (url.pathname !== '/v1/stores/test/mcp') throw new Error('Unexpected path');
  if (process.env.TEST_MODE === 'native-down') throw new Error('native unavailable test-key');
  const body = await request.json();
  if (body.id === undefined) return new Response(null, { status: 202 });
  let result;
  if (body.method === 'initialize') result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } };
  else if (body.method === 'tools/call') {
    if (body.params.name === 'create_long_term_memories') {
      for (const memory of body.params.arguments.memories) db.memories[memory.id] = memory;
      writeFileSync(process.env.TEST_DATABASE, JSON.stringify(db));
      result = { content: [{ type: 'text', text: JSON.stringify({ created: body.params.arguments.memories.map(memory => memory.id) }) }] };
    } else result = { content: [{ type: 'text', text: JSON.stringify({ memories: [] }) }] };
  } else throw new Error('Unexpected method');
  return json({ jsonrpc: '2.0', id: body.id, result });
};`);
  for (const [source, folder] of [["claude", "redis-agent-memory-claude"], ["codex", "redis-agent-memory"]]) {
    const installed = join(directory, `${source} plugin`); const project = join(directory, `${source} project`);
    await cp(resolve("plugins", folder), installed, { recursive: true }); await mkdir(project);
    const database = join(directory, `${source}-db.json`); await writeFile(database, JSON.stringify({ events: [], memories: {} }));
    const config = { enabled: true, ownerId: "owner", namespace: "project", promptRecall: false, recallLimit: 0 };
    await writeFile(join(project, ".memory-capture.json"), JSON.stringify(config));
    const cli = join(installed, "server", source === "claude" ? "capture-cli.mjs" : "capture-cli.js");
    function run(mode, payload, testMode = "success") {
      const result = spawnSync(process.execPath, [cli, mode, source, "--project", project], {
        cwd: project, encoding: "utf8", input: payload ? JSON.stringify(payload) : undefined,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          NODE_OPTIONS: "--import=" + pathToFileURL(mock).href, TEST_DATABASE: database, TEST_MODE: testMode,
          AGENT_MEMORY_BASE_URL: "https://memory.example.test", AGENT_MEMORY_STORE_ID: "test", AGENT_MEMORY_API_KEY: "test-key",
          AGENT_MEMORY_DEBUG: "true", // Even parent SDK debug settings must not expose request content/headers.
          AGENT_MEMORY_CONFIG_FILE: join(directory, "absent-settings.json"), AGENT_MEMORY_SHARED_SETTINGS_FILE: join(directory, "absent-shared.json") },
      });
      assert.equal(result.status, 0, result.stderr);
      assert(!result.stderr.includes("test-key") && !result.stdout.includes("test-key"));
      return JSON.parse(result.stdout);
    }
    const prompt = { hook_event_name: "UserPromptSubmit", session_id: "chat", turn_id: "turn-1", prompt: "Use three retries test-key" };
    assert.deepEqual(run("hook", prompt, "response-lost"), {});
    let db = JSON.parse(await readFile(database, "utf8"));
    assert.equal(db.events.length, 1); assert.equal(Object.keys(db.memories).length, 0);
    const reconciled = run("flush");
    assert.equal(reconciled.sessionReconciled, 1); assert.equal(reconciled.pending, 0);
    run("hook", prompt);
    db = JSON.parse(await readFile(database, "utf8")); assert.equal(db.events.length, 1);
    const response = { ...prompt, hook_event_name: "Stop", last_assistant_message: "Agreed on three attempts" };
    run("hook", response, "native-down");
    db = JSON.parse(await readFile(database, "utf8")); assert.equal(db.events.length, 2, "REST append must not depend on native MCP availability");
    const delivered = run("flush"); assert.equal(delivered.sessionSent, 0);
    db = JSON.parse(await readFile(database, "utf8")); assert.equal(db.events.length, 2); assert.equal(Object.keys(db.memories).length, 2);
    assert.deepEqual(db.events.map(event => event.role), ["USER", "ASSISTANT"]);
    assert(db.events.every(event => event.actorId === "owner" && event.sessionId === db.events[0].sessionId));
    assert.equal(db.events[0].content[0].text, "Use three retries [REDACTED]");
    const status = run("status");
    assert.equal(status.diagnostics.sessionDelivery.state, "observed"); assert.equal(status.diagnostics.extraction, "not-verified");
    console.log(`${source}: packaged session-first capture, REST/native failure independence, lost-response reconciliation, replay, ownership, privacy, and diagnostics passed.`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
