import assert from "node:assert/strict";
import test from "node:test";
import { boundedContext } from "../src/context-budget.js";
import { loadConfig } from "../src/config.js";

test("bounded JSON preserves identifiers and relevance order with escaped oversized memories", () => {
  for (const maxChars of [1024, 5400, 12000, 100000]) {
    const packet = boundedContext({ items: Array.from({ length: 100 }, (_, i) => ({
      id: `memory-${i}`, text: `Decision ${i}: use retries. ` + '\u0000\n"🚀'.repeat(10000),
      metadata: { notes: "x".repeat(10000) },
    })) }, maxChars);
    assert(JSON.stringify(packet).length <= maxChars);
    assert.equal((packet.contextBudget as any).truncated, true);
    assert.equal((packet.items as any[])[0].id, "memory-0");
    assert.match((packet.items as any[])[0].text, /^Decision 0/);
    assert.match((packet.contextBudget as any).detailHint, /maxChars/);
  }
});

test("small packets remain complete and session trimming retains recent events", () => {
  const small = boundedContext({ items: [{ id: "one", text: "decision" }] });
  assert.deepEqual(small.items, [{ id: "one", text: "decision" }]);
  assert.equal((small.contextBudget as any).truncated, false);
  const packet = boundedContext({ events: Array.from({ length: 100 }, (_, i) => ({
    eventId: `event-${i}`, content: [{ text: "x".repeat(2000) }],
  })) }, 1024);
  const events = packet.events as any[];
  assert.equal(events.at(-1).eventId, "event-99");
  assert(JSON.stringify(packet).length <= 1024);
});

test("bridge environment rejects invalid budgets", () => {
  const env = { AGENT_MEMORY_BASE_URL: "https://example.test", AGENT_MEMORY_STORE_ID: "store", AGENT_MEMORY_API_KEY: "key" };
  assert.equal(loadConfig(env).contextChars, 12000);
  assert.equal(loadConfig({ ...env, AGENT_MEMORY_CONTEXT_CHARS: "2048" }).contextChars, 2048);
  for (const value of ["", "0", "NaN", "1024.5", "100001"]) {
    assert.throws(() => loadConfig({ ...env, AGENT_MEMORY_CONTEXT_CHARS: value }), /CONTEXT_CHARS/);
  }
});

test("size-trimmed event pages advance by actual returned events without skipping history", () => {
  const packet = boundedContext({ events: Array.from({ length: 20 }, (_, i) => ({
    eventId: `event-${i}`, content: [{ text: "x".repeat(2000) }],
  })), eventPage: { eventOffset: 0, eventLimit: 20, total: 50, nextOffset: 20 } }, 1024);
  const events = packet.events as any[];
  const page = packet.eventPage as any;
  assert(events.length > 0 && events.length < 20);
  assert.equal(events.at(-1).eventId, "event-19");
  assert.equal(page.nextOffset, events.length);
  assert.equal(page.returned, events.length);
  assert(JSON.stringify(packet).length <= 1024);
});
