import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { captureConfigSchema } from "../dist/src/capture.js";
import { recallPrompt } from "../dist/src/prompt-recall.js";
import { boundedContext } from "../dist/src/context-budget.js";
import { MemoryGateway } from "../dist/src/memory.js";

// Deterministic retrieval fixtures measure bridge behavior, not backend ranking
// or a model's tool selection. No production credentials or network required.
const config = captureConfigSchema.parse({});
const scope = { owner: "eval-owner", namespace: "eval-project" };
const fixtures = [
  { name: "prior decision", prompt: "Why did we choose retry backoff?", matches: [{ text: "Decision: use exponential backoff to reduce contention." }], expected: "exponential backoff" },
  { name: "irrelevant query", prompt: "What color is the moon?", matches: [], expected: "", calls: 1 },
  { name: "trivial greeting", prompt: "hello", matches: [], expected: "", calls: 0 },
  { name: "oversized memories", prompt: "Recall retry decisions", matches: [{ text: "Decision: use exponential backoff. " + '\u0000\n"'.repeat(50000) }, { text: "Keep seven attempts." }], expected: "exponential backoff" },
];
const rows = [];
for (const fixture of fixtures) {
  const times = [];
  let output, calls;
  for (let i = 0; i < 25; i++) {
    calls = 0;
    const start = performance.now();
    output = await recallPrompt(config, scope, fixture.prompt, async () => { calls++; return fixture.matches; });
    times.push(performance.now() - start);
    assert(output.length <= config.promptContextChars);
    assert(fixture.expected ? output.includes(fixture.expected) : output === "");
    if (fixture.calls !== undefined) assert.equal(calls, fixture.calls);
  }
  times.sort((a, b) => a - b);
  rows.push({ scenario: fixture.name, useful: true, calls, chars: output.length,
    p50_ms: +times[12].toFixed(3), p95_ms: +times[23].toFixed(3) });
}
const client = {
  getSessionMemory: async () => ({ sessionId: "eval-task", events: Array.from({ length: 100 }, (_, i) => ({ eventId: `e-${i}`, content: [{ text: "work" }] })) }),
  getLongTermMemory: async () => ({ id: "checkpoint", text: "Resume: run retry validation next." }),
  searchLongTermMemory: async () => ({ items: [{ id: "decision", text: "Use exponential backoff." }] }),
};
const gateway = new MemoryGateway(client, { ownerId: "eval-owner", agentId: "eval-agent" });
const times = [];
let output;
for (let i = 0; i < 25; i++) {
  const start = performance.now();
  output = JSON.stringify(boundedContext(await gateway.resumeContext("eval-task", "continue retries"), 1024));
  times.push(performance.now() - start);
  assert(output.length <= 1024);
  assert(output.includes("run retry validation"));
  assert(output.includes("e-99"));
}
times.sort((a, b) => a - b);
rows.push({ scenario: "task resumption", useful: true, calls: 3, chars: output.length, p50_ms: +times[12].toFixed(3), p95_ms: +times[23].toFixed(3) });
console.log(JSON.stringify({ kind: "local deterministic fixtures", repetitions: 25, tokenCounts: "not measured", promptCache: "not observable in hook/MCP protocol; no client cache telemetry available", results: rows }, null, 2));
