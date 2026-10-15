import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config.js";
import { MemoryGateway, type MemoryClient } from "../src/memory.js";

class FakeClient implements MemoryClient {
  added: any[] = [];
  searches: any[] = [];
  created: any[] = [];
  updated: any[] = [];
  records = new Map<string, any>();

  async storeHealth(): Promise<any> {
    return { status: "ok" };
  }

  async addSessionEvent(request: any): Promise<any> {
    this.added.push(request);
    return { event: { eventId: "event-1", ...request } };
  }

  async getSessionMemory(sessionId: string): Promise<any> {
    return {
      sessionId,
      ownerId: "user-1",
      events: [{ eventId: "event-1", content: [{ text: "hello" }] }],
    };
  }

  async searchLongTermMemory(request: any): Promise<any> {
    this.searches.push(request);
    return { items: [{ id: "memory-1", text: "remembered" }] };
  }

  async bulkCreateLongTermMemories(request: any): Promise<any> {
    this.created.push(request);
    for (const memory of request.memories) this.records.set(memory.id, memory);
    return { created: request.memories.map((memory: any) => memory.id) };
  }

  async getLongTermMemory(memoryId: string): Promise<any> {
    const record = this.records.get(memoryId);
    if (!record) throw Object.assign(new Error("not found"), { statusCode: 404 });
    return record;
  }

  async updateLongTermMemory(memoryId: string, body: any): Promise<any> {
    const record = { ...this.records.get(memoryId), ...body, id: memoryId };
    this.updated.push({ memoryId, body });
    this.records.set(memoryId, record);
    return record;
  }
}

const config: AppConfig = {
  baseUrl: "https://memory.example.test",
  storeId: "store-1",
  apiKey: "secret",
  ownerId: "user-1",
  namespaceId: "namespace-1",
  agentId: "shared-agent",
};

test("append uses stable owner and namespace defaults", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, config);

  await gateway.append({
    sessionId: "task-1",
    role: "USER",
    text: "Continue the implementation",
    createdAt: new Date("2026-10-15T12:00:00Z"),
  });

  assert.equal(client.added[0].actorId, "user-1");
  assert.deepEqual(client.added[0].namespaceRef, {
    namespaceId: "namespace-1",
  });
  assert.equal(client.added[0].content[0].text, "Continue the implementation");
});

test("search always scopes recall to owner and namespace", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, config);

  await gateway.search({ query: "What is left?", topics: ["checkpoint"] });

  assert.deepEqual(client.searches[0].filter.ownerId, { eq: "user-1" });
  assert.deepEqual(client.searches[0].filter.namespaceRef, {
    eq: "namespace-1",
  });
  assert.deepEqual(client.searches[0].filter.topics, { all: ["checkpoint"] });
});

test("checkpoint save creates once and updates the canonical record", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, config);

  const first = await gateway.saveCheckpoint("task-1", {
    summary: "Initial handoff",
    nextSteps: ["Run tests"],
  });
  const second = await gateway.saveCheckpoint("task-1", {
    summary: "Updated handoff",
    nextSteps: ["Deploy"],
  });

  assert.equal(first.operation, "created");
  assert.equal(second.operation, "updated");
  assert.equal(client.created.length, 1);
  assert.equal(client.updated.length, 1);
  assert.match(client.updated[0].body.text, /Updated handoff/);
  assert.deepEqual(client.updated[0].body.topics, [
    "agent-handoff",
    "checkpoint",
  ]);
});

test("resume context returns exact checkpoint, session, and semantic recall", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, config);
  await gateway.saveCheckpoint("task-1", { summary: "Ready for Codex" });

  const packet = await gateway.resumeContext("task-1", "next steps");

  assert.match(packet.checkpoint?.text ?? "", /Ready for Codex/);
  assert.equal(packet.session.sessionId, "task-1");
  assert.equal(packet.recalled.items[0].text, "remembered");
});
