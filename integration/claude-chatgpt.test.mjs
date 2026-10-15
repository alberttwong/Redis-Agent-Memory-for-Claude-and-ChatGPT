import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AgentMemory } from "@redis-iris/agent-memory";
import { unzipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  loadEnvFile(join(root, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 });
  assert.equal(result.isError, undefined, `${name} failed: ${JSON.stringify(result.content)}`);
  assert.ok(result.structuredContent, `${name} returned no structured content`);
  return result.structuredContent;
}

// Retry visibility assertions only. Authentication, transport, and tool errors fail immediately.
async function eventually(label, read, check) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const result = await read();
    try {
      check(result);
      return result;
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      if (Date.now() >= deadline) {
        throw new Error(`${label} was not visible within 60 seconds`, { cause: error });
      }
    }
    await delay(2_000);
  }
}

test("Claude MCPB memory is retrieved by the ChatGPT Desktop plugin through live Redis", { timeout: 240_000 }, async (t) => {
  for (const name of ["AGENT_MEMORY_BASE_URL", "AGENT_MEMORY_STORE_ID", "AGENT_MEMORY_API_KEY"]) {
    assert.ok(process.env[name]?.trim(), `Set ${name} in the environment or .env; this test requires a live Redis Agent Memory store`);
  }
  const runId = randomUUID();
  const sessionId = `handoff-${runId}`;
  const ownerId = `e2e-${runId}`;
  const env = {
    ...process.env,
    AGENT_MEMORY_OWNER_ID: ownerId,
    AGENT_MEMORY_AGENT_ID: "claude-handoff-test",
  };
  const fact = `The checkout retry limit is seven attempts. Handoff verification code: ${runId}.`;
  const summary = `Claude decided: ${fact}`;
  const nextStep = "ChatGPT should implement the seven-attempt retry limit.";
  const directory = await mkdtemp(join(tmpdir(), "ram-handoff-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const claudeArchive = unzipSync(await readFile(join(root, "build", `redis-agent-memory-${version}.mcpb`)));
  const chatgptArchive = unzipSync(await readFile(join(root, "build", `redis-agent-memory-chatgpt-desktop-${version}.zip`)));
  const marketplace = JSON.parse(new TextDecoder().decode(chatgptArchive[".agents/plugins/marketplace.json"]));
  const pluginRoot = marketplace.plugins[0].source.path.replace(/^\.\//, "");

  async function connect(label, bytes, agentId) {
    assert.ok(bytes, `${label} package is missing its bundled server`);
    const serverDirectory = join(directory, label);
    await mkdir(serverDirectory);
    const entry = join(serverDirectory, "index.mjs");
    await writeFile(entry, bytes);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: { ...env, AGENT_MEMORY_AGENT_ID: agentId },
      stderr: "ignore",
    });
    const client = new Client({ name: `${label}-handoff-test`, version: "1.0.0" });
    t.after(() => client.close());
    await client.connect(transport);
    await call(client, "memory_health");
    return client;
  }

  // The SDK is used only for cleanup; every write and retrieval assertion uses MCP.
  const cleanup = new AgentMemory({
    serverURL: env.AGENT_MEMORY_BASE_URL.replace(/\/+$/, ""),
    storeId: env.AGENT_MEMORY_STORE_ID,
    apiKey: env.AGENT_MEMORY_API_KEY,
  });
  const namespace = env.AGENT_MEMORY_NAMESPACE_ID?.trim() || env.AGENT_MEMORY_NAMESPACE?.trim() || "global";
  const checkpointId = `checkpoint-${createHash("sha256").update(`${ownerId}:${namespace}:${sessionId}`).digest("hex").slice(0, 32)}`;
  let sessionWritten = false;
  let checkpointWritten = false;
  t.after(async () => {
    // Attempt both removals even if one fails; never delete pre-existing records.
    const results = await Promise.allSettled([
      sessionWritten ? cleanup.deleteSessionMemory(sessionId, { timeoutMs: 15_000 }) : undefined,
      checkpointWritten ? cleanup.bulkDeleteLongTermMemories({ memoryIds: [checkpointId] }, { timeoutMs: 15_000 }).then((result) => {
        assert.equal(result.errors?.length ?? 0, 0, `Checkpoint cleanup failed for ${checkpointId}`);
      }) : undefined,
    ]);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
  });

  t.diagnostic(`Isolated session: ${sessionId}; owner: ${ownerId}`);
  const claude = await connect("claude", claudeArchive["server/index.js"], "claude-handoff-test");
  await call(claude, "memory_append", { sessionId, role: "USER", text: fact });
  sessionWritten = true;
  const saved = await call(claude, "checkpoint_save", { sessionId, summary, nextSteps: [nextStep] });
  checkpointWritten = true;
  assert.equal(saved.operation, "created");
  assert.equal(saved.id, checkpointId);
  await claude.close();

  // Start a separate process only after the writer exits: no shared in-process state.
  const chatgpt = await connect("chatgpt", chatgptArchive[`${pluginRoot}/server/index.js`], "chatgpt-handoff-test");
  const checkSession = (session) => {
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.ownerId, ownerId);
    assert.ok(session.events.some((event) => event.content.some((part) => part.text === fact)), "Missing exact Claude session event");
  };
  await eventually("Claude session event", () => call(chatgpt, "memory_get_session", { sessionId, includeSummarisedEvents: true }), checkSession);
  await eventually("Claude checkpoint in semantic search", () => call(chatgpt, "memory_search", {
    query: summary,
    topics: ["agent-handoff", "checkpoint"],
    similarityThreshold: 0.65,
  }), (result) => {
    const memory = result.items.find((item) => item.id === checkpointId);
    assert.ok(memory, "Search did not return the checkpoint written by Claude");
    assert.equal(memory.ownerId, ownerId);
    assert.ok(memory.text.includes(summary));
  });
  await eventually("Claude handoff context", () => call(chatgpt, "resume_context", { sessionId, query: summary }), (context) => {
    assert.equal(context.checkpoint?.id, checkpointId);
    const checkpoint = JSON.parse(context.checkpoint.text.slice(context.checkpoint.text.indexOf("\n") + 1));
    assert.equal(checkpoint.summary, summary);
    assert.deepEqual(checkpoint.nextSteps, [nextStep]);
    checkSession(context.session);
    assert.ok(context.recalled.items.some((item) => item.id === checkpointId));
  });
});
