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

test("append and both checkpoint write branches sanitize text and nested metadata", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, config);
  await gateway.append({ sessionId: "privacy-test", role: "USER", text: "password: hunter2", metadata: { nested: { password: "two\nlines" }, contact: "person@example.com" } });
  await gateway.saveCheckpoint("privacy-test", { summary: "Contact person@example.com", notes: ["password: hunter2"] });
  await gateway.saveCheckpoint("privacy-test", { summary: "Updated", notes: ["password: hunter2"] });
  const sent = JSON.stringify([client.added, client.created, client.updated]);
  for (const sensitive of ["hunter2", "two", "person@example.com"]) assert(!sent.includes(sensitive));
  assert(sent.includes("[REDACTED]"));
});

test("MCP writes honor project policy for roles, metadata, and checkpoints", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, {...config, guardrails: {
    redact: {email: false, credentials: false}, captureResponses: false,
    sensitiveFields: ["internalId"], omitFields: ["repoPath"], customPatterns: ["CLIENT-[0-9]+"],
  }});
  const skipped = await gateway.append({sessionId: "task-1", role: "ASSISTANT", text: "skip"});
  assert("skipped" in skipped && skipped.skipped);
  assert.equal(client.added.length, 0);
  await gateway.append({sessionId: "task-1", role: "USER", text: "person@example.com secret CLIENT-123", metadata: {internalId: 123}});
  assert.equal(client.added[0].content[0].text, "person@example.com [REDACTED] [REDACTED]");
  assert.deepEqual(client.added[0].metadata, {internalId: "[REDACTED]"});
  await gateway.saveCheckpoint("task-1", {summary: "person@example.com secret CLIENT-123", repoPath: "/private/project"});
  const checkpoint = client.created[0].memories[0].text;
  assert(checkpoint.includes("person@example.com"));
  assert(!checkpoint.includes("secret"));
  assert(!checkpoint.includes("CLIENT-123"));
  assert(!checkpoint.includes("repoPath"));
});

test("resume removes checkpoint/search duplicates and includes the latest session page", async () => {
  const client = new FakeClient();
  const gateway = new MemoryGateway(client, config);
  await gateway.saveCheckpoint("task-1", { summary: "Run validation next" });
  const checkpoint = client.records.get(gateway.checkpointId("task-1"));
  client.searchLongTermMemory = async () => ({ items: [checkpoint, { id: "a", text: "Use retries" }, { id: "b", text: "Use retries" }] });
  client.getSessionMemory = async () => ({ sessionId: "task-1", events: Array.from({ length: 50 }, (_, i) => ({ eventId: `e-${i}` })) });
  const context = await gateway.resumeContext("task-1", "continue");
  assert.deepEqual(context.recalled.items.map(item => item.id), ["a"]);
  assert.equal(context.session.events?.[0].eventId, "e-30");
  assert.equal(context.session.events?.at(-1)?.eventId, "e-49");
  assert.equal(context.eventPage.nextOffset, 20);
});
