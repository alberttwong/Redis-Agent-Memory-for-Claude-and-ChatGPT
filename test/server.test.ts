import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { MemoryGateway } from "../src/memory.js";
import { createServer } from "../src/server.js";

test("an MCP client can discover and call the bridge tools", async () => {
  const gateway = {
    health: async () => ({ status: "ok" }),
  } as unknown as MemoryGateway;
  const server = createServer(gateway, {redact: {email: false}, captureResponses: false});
  const client = new Client(
    { name: "bridge-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  assert(client.getInstructions()?.includes('"email":false'));
  assert(client.getInstructions()?.includes("saving ASSISTANT messages is disabled"));
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "checkpoint_save",
      "memory_append",
      "memory_get_session",
      "memory_health",
      "memory_search",
      "resume_context",
    ],
  );

  const response = await client.callTool({ name: "memory_health", arguments: {} });
  assert.deepEqual(response.structuredContent, { status: "ok" });

  await client.close();
  await server.close();
});

test("MCP read responses enforce configured and per-call budgets and page older events", async () => {
  const gateway = {
    contextChars: () => 2048,
    search: async () => ({ items: [{ id: "best", text: "decision: " + "x".repeat(40000) }] }),
    getSession: async () => ({ sessionId: "task", events: Array.from({ length: 50 }, (_, i) => ({ eventId: `event-${i}`, content: [{ text: "hello" }] })) }),
    resumeContext: async () => ({ checkpoint: { id: "checkpoint", text: "Continue retries. " + "x".repeat(40000) }, recalled: { items: [] }, session: { events: [] } }),
  } as unknown as MemoryGateway;
  const server = createServer(gateway);
  const client = new Client({ name: "budget-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    for (const name of ["memory_search", "resume_context"]) {
      for (const maxChars of [undefined, 1024, 4000]) {
        const response = await client.callTool({ name, arguments: { query: "retry decisions", sessionId: "task", ...(maxChars ? { maxChars } : {}) } });
        assert(!response.isError);
        assert.equal(JSON.stringify(response.structuredContent), (response.content as any[])[0].text);
        assert((response.content as any[])[0].text.length <= (maxChars ?? 2048));
        assert.equal(((response.structuredContent as any)?.contextBudget as any).truncated, true);
      }
    }
    const response = await client.callTool({ name: "memory_get_session", arguments: { sessionId: "task", eventOffset: 20, eventLimit: 10 } });
    assert.deepEqual(((response.structuredContent as any)?.events as any[]).map(e => e.eventId), Array.from({ length: 10 }, (_, i) => `event-${20 + i}`));
    assert.equal(((response.structuredContent as any)?.eventPage as any).nextOffset, 30);
    const invalid = await client.callTool({ name: "memory_search", arguments: { query: "retry", maxChars: 100001 } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); await server.close(); }
});
