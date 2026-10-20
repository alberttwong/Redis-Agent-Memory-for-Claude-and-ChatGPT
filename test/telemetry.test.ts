import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { MemoryGateway } from "../src/memory.js";
import { createTelemetry, safeException, Telemetry, type TelemetrySink } from "../src/telemetry.js";

function recorder() {
  const events: unknown[] = [];
  const errors: Error[] = [];
  const feedback: unknown[] = [];
  let shutdowns = 0;
  const sink: TelemetrySink = {
    capture: (event, properties) => { events.push({ event, properties }); },
    exception: (error, properties) => { errors.push(error); events.push({ properties }); },
    feedback: async properties => { feedback.push(properties); },
    shutdown: async () => { shutdowns++; },
  };
  return { sink, events, errors, feedback, shutdowns: () => shutdowns };
}

test("telemetry requires explicit enablement and honors opt out and safe hosts", async () => {
  for (const env of [{}, { POSTHOG_API_KEY: "test" }, { POSTHOG_ENABLED: "true" },
    { POSTHOG_ENABLED: "true", POSTHOG_API_KEY: "test", DO_NOT_TRACK: "1" },
    ...["http://example.test", "https://user:pass@example.test", "https://example.test/?key=secret", "not-a-url"].map(POSTHOG_HOST => ({ POSTHOG_HOST, POSTHOG_ENABLED: "true", POSTHOG_API_KEY: "test" }))]) {
    const telemetry = createTelemetry("mcp", env);
    assert.equal(telemetry.enabled, false);
    assert.equal(await telemetry.observe("memory_health", async () => 42), 42);
    await assert.rejects(telemetry.submitFeedback({ message: "test" }), /not submitted/);
    await telemetry.shutdown();
  }
});

test("operation telemetry preserves results and excludes tool arguments and results", async () => {
  const r = recorder();
  const telemetry = new Telemetry("mcp", r.sink);
  const secretResult = { text: "private prompt and memories", apiKey: "private-key" };
  assert.equal(await telemetry.observe("memory_search", async () => secretResult), secretResult);
  const output = JSON.stringify(r.events);
  assert.ok(!output.includes("private"));
  assert.match(output, /memory_search/);
  assert.match(output, /duration_ms/);
  assert.match(output, /"success":true/);
  await Promise.all([telemetry.shutdown(), telemetry.shutdown()]);
  assert.equal(r.shutdowns(), 1);
});

test("handled errors are tracked with safe stacks and rethrow the original error", async () => {
  const r = recorder();
  const telemetry = new Telemetry("capture", r.sink);
  const error = new Error("Bearer sensitive-token prompt user@example.com");
  error.stack = "Error: private\n    at secretFunction (/Users/private/project/src/capture.ts:12:4)\n    private source snippet";
  await assert.rejects(telemetry.observe("hook", async () => { throw error; }), value => value === error);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].message, "hook failed");
  assert.match(r.errors[0].stack!, /capture.ts:12:4/);
  assert.doesNotMatch(r.errors[0].stack!, /private|secretFunction|sensitive|user@/);
  assert.match(JSON.stringify(r.events), /"success":false/);
  assert.equal(safeException({ name: "secret", message: "secret", cause: error }, "flush").name, "Error");
});

test("telemetry sink failures never change application outcomes", async () => {
  const fail = () => { throw new Error("export offline"); };
  const telemetry = new Telemetry("mcp", { capture: fail, exception: fail, feedback: fail, shutdown: async () => fail() });
  assert.equal(await telemetry.observe("memory_append", async () => "ok"), "ok");
  const original = new Error("memory offline");
  await assert.rejects(telemetry.observe("memory_append", async () => { throw original; }), value => value === original);
  await telemetry.shutdown();
});

test("feedback is validated and redacted and excluded from usage events", async () => {
  const r = recorder();
  const telemetry = new Telemetry("mcp", r.sink, ["known-redis-key"]);
  const result = await telemetry.submitFeedback({ message: "Search is slow. known-redis-key user@example.com phc_abcdefghi", category: "bug", rating: 2 });
  assert.deepEqual(result, { submitted: true });
  assert.deepEqual(r.feedback, [{ surface: "mcp", message: "Search is slow. [REDACTED] [REDACTED] [REDACTED]", category: "bug", rating: 2 }]);
  assert.deepEqual(r.events, []);
  for (const input of [{ message: " " }, { message: "x".repeat(4001) }, { message: "ok", rating: 6 }, { message: "ok", rating: 1.5 }]) {
    await assert.rejects(telemetry.submitFeedback(input));
  }
  const broken = new Telemetry("mcp", { ...r.sink, feedback: async () => { throw new Error("private response"); } });
  await assert.rejects(broken.submitFeedback({ message: "hello" }), /could not accept feedback/);
  assert.equal(r.feedback.length, 1);
});

test("MCP tools report success, handled failures, and explicit feedback", async () => {
  const r = recorder();
  const gateway = { health: async () => { throw new Error("private backend response"); } } as unknown as MemoryGateway;
  const server = createServer(gateway, {}, new Telemetry("mcp", r.sink));
  const client = new Client({ name: "telemetry-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  try {
    const health = await client.callTool({ name: "memory_health", arguments: {} });
    assert.equal(health.isError, true);
    assert.equal(r.errors.length, 1);
    const feedback = await client.callTool({ name: "feedback_submit", arguments: { message: "Please improve search", category: "feature", rating: 4 } });
    assert.deepEqual(feedback.structuredContent, { submitted: true });
    assert.equal(r.feedback.length, 1);
    assert.doesNotMatch(JSON.stringify(r.events), /Please improve search|private backend response/);
    const invalid = await client.callTool({ name: "feedback_submit", arguments: { message: "", rating: 7 } });
    assert.equal(invalid.isError, true);
    assert.equal(r.feedback.length, 1);
  } finally { await client.close(); await server.close(); }
});

test("production feedback transport awaits ingestion and reports failed requests", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Record<string, any>[] = [];
  let status = 200;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(status === 200 ? '{"status":1}' : '{"error":"private backend details"}', { status });
  };
  const telemetry = createTelemetry("mcp", { POSTHOG_ENABLED: "true", POSTHOG_API_KEY: "test-project-token", POSTHOG_DISTINCT_ID: "test-installation" });
  try {
    assert.equal(telemetry.enabled, true);
    assert.deepEqual(await telemetry.submitFeedback({ message: "Search is helpful user@example.com", rating: 5 }), { submitted: true });
    assert.match(JSON.stringify(requests), /feedback submitted/);
    assert.match(JSON.stringify(requests), /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(requests), /user@example.com/);
    status = 500;
    await assert.rejects(telemetry.submitFeedback({ message: "Try again" }), /could not accept feedback/);
  } finally { await telemetry.shutdown(); globalThis.fetch = originalFetch; }
});

test("uncaught failures and rejections flush safe diagnostics and keep a failure exit status", async () => {
  const { spawnSync } = await import("node:child_process");
  const moduleUrl = new URL("../src/telemetry.js", import.meta.url).href;
  for (const trigger of ['throw new Error("private-token")', 'Promise.reject(new Error("private-token"))']) {
    const script = `
      import { Telemetry, installTelemetryLifecycle } from ${JSON.stringify(moduleUrl)};
      const telemetry = new Telemetry("mcp", {
        capture() {}, feedback: async () => {},
        exception(error) { console.log(JSON.stringify({message: error.message})); },
        shutdown: async () => { console.log("flushed"); }
      });
      installTelemetryLifecycle(telemetry);
      ${trigger};
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stdout, /runtime failed/);
    assert.match(child.stdout, /flushed/);
    assert.doesNotMatch(child.stdout + child.stderr, /private-token/);
  }
});
