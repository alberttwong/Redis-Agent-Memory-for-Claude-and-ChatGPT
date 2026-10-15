import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
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
  console.log("Standalone Claude plugin exposes setup and serves its credential form without project dependencies.");
} finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
