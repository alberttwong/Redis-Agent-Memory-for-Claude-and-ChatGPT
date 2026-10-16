import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createClaudePlugin } from "../src/claude-plugin.js";
import type { MemoryGateway } from "../src/memory.js";
import { MemorySetup, readMemorySettings } from "../src/memory-setup.js";

const fields = { baseUrl: "https://memory.example.test/", storeId: "my-store", apiKey: "secret-value", namespace: "checkout" };

test("browser setup saves private settings without returning the API key", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ram-form-"));
  const path = join(directory, "private", "connection.json");
  const setup = new MemorySetup(path);
  t.after(async () => { setup.close(); await rm(directory, { recursive: true, force: true }); });
  assert.deepEqual(await readMemorySettings(path), {});
  const [link, other] = await Promise.all([setup.open(), setup.open()]);
  assert.equal(link.url, other.url);
  const url = new URL(link.url);
  const headers = { "Content-Type": "application/json", "X-Setup-Token": url.hash.slice(1), Origin: url.origin };
  const page = await fetch(link.url);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('type="password"'));
  assert.equal(page.headers.get("cache-control"), "no-store");
  const save = (body: object, overrides: Record<string, string> = {}) => fetch(`${url.origin}/settings`, {
    method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(body),
  });
  assert.equal((await save(fields, { Origin: "https://attacker.example" })).status, 403);
  assert.equal((await save(fields, { "X-Setup-Token": "x".repeat(64) })).status, 403);
  assert.equal((await save(fields, { "X-Setup-Token": "é".repeat(64) })).status, 403);
  assert.equal((await save({ ...fields, baseUrl: "http://memory.example.test" })).status, 400);
  assert.equal((await save({ ...fields, apiKey: "" })).status, 400);
  const saved = await save(fields);
  assert.deepEqual(await saved.json(), { saved: true });
  const config = await readMemorySettings(path);
  assert.equal(config.AGENT_MEMORY_API_KEY, fields.apiKey);
  assert.equal(config.AGENT_MEMORY_BASE_URL, "https://memory.example.test");
  assert.equal(config.AGENT_MEMORY_NAMESPACE, "checkout");
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  // A new setup link can update settings while leaving old settings private.
  const replacement = new URL((await setup.open()).url);
  assert.notEqual(replacement.hash, url.hash);
  const updated = await fetch(`${replacement.origin}/settings`, { method: "POST", headers: {
    ...headers, Origin: replacement.origin, "X-Setup-Token": replacement.hash.slice(1),
  }, body: JSON.stringify({ ...fields, apiKey: "replacement-key" }) });
  assert.equal(updated.status, 200);
  assert.equal((await readMemorySettings(path)).AGENT_MEMORY_API_KEY, "replacement-key");
  assert.ok(!(await readFile(path, "utf8")).includes("secret-value"));
});

test("setup links expire without saving settings", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ram-expire-"));
  const setup = new MemorySetup(join(directory, "connection.json"), 30);
  t.after(async () => { setup.close(); await rm(directory, { recursive: true, force: true }); });
  const link = await setup.open();
  await new Promise((resolve) => setTimeout(resolve, 70));
  await assert.rejects(fetch(link.url));
  assert.deepEqual(await readMemorySettings(join(directory, "connection.json")), {});
});


test("the same MCP session uses credentials saved through its setup form", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ram-mcp-setup-"));
  const server = createClaudePlugin(join(directory, "connection.json"), (config) => {
    assert.equal(config.baseUrl, "https://memory.example.test");
    assert.equal(config.storeId, fields.storeId);
    assert.equal(config.apiKey, fields.apiKey);
    return {
      health: async () => ({ status: "ready" }),
      contextChars: () => 2048,
      search: async () => ({ items: [{ id: "decision", text: "Use backoff. " + "x".repeat(10000) }] }),
    } as unknown as MemoryGateway;
  });
  const client = new Client({ name: "setup-test", version: "1.0.0" });
  t.after(async () => { await client.close(); await server.close(); await rm(directory, { recursive: true, force: true }); });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const setup = await client.callTool({ name: "memory_setup", arguments: {} });
  const url = new URL((setup.structuredContent as { url: string }).url);
  const saved = await fetch(`${url.origin}/settings`, { method: "POST", headers: {
    "Content-Type": "application/json", "X-Setup-Token": url.hash.slice(1), Origin: url.origin,
  }, body: JSON.stringify(fields) });
  assert.equal(saved.status, 200);
  const health = await client.callTool({ name: "memory_health", arguments: {} });
  assert.deepEqual(health.structuredContent, { status: "ready" });
  assert.ok(!JSON.stringify(health).includes(fields.apiKey));
  const recalled = await client.callTool({ name: "memory_search", arguments: { query: "prior decisions" } });
  assert(!recalled.isError, JSON.stringify(recalled));
  assert(JSON.stringify(recalled.structuredContent).length <= 2048);
  assert.equal((recalled.structuredContent as any).contextBudget.maxChars, 2048);
});
