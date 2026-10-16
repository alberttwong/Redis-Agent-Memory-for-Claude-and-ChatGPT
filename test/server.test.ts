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
