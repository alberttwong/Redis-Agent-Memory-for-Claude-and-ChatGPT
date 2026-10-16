import assert from "node:assert/strict";
import test from "node:test";
import { configureSummarization } from "../src/store-management.js";

const options = { storeId: "store/test", apiKey: "cloud-key", apiSecretKey: "cloud-secret", threshold: 20, retainCount: 10 };
const saved = { enabled: true, triggerStrategy: "event_count", eventCount: { threshold: 20, retainCount: 10 } };
function mock(responses: unknown[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    assert.ok(responses.length, "Unexpected management request");
    const next = responses.shift();
    return next instanceof Response ? next : Response.json(next);
  };
  return { calls, fetch: request, pollIntervalMs: 0 };
}

test("patches only summarization, waits through pending task states and verifies the store", async () => {
  const network = mock([{ taskId: "task-1" }, { status: "received" },
    { status: "processing-in-progress" }, { status: "processing-completed" }, { summarization: saved }]);
  const result = await configureSummarization(options, network);
  assert.deepEqual(result.summarization, saved);
  assert.equal(network.calls[0].url, "https://api.redislabs.com/v1/memory-stores/store%2Ftest");
  assert.equal(network.calls[0].init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(network.calls[0].init?.body)), { summarization: saved });
  assert.equal(network.calls[0].init?.redirect, "error");
  assert.equal(new Headers(network.calls[0].init?.headers).get("x-api-secret-key"), "cloud-secret");
  assert.equal(network.calls[1].url, "https://api.redislabs.com/v1/tasks/task-1");
  assert.equal(network.calls.at(-1)?.init?.method, "GET");
});

test("supports custom thresholds", async () => {
  const custom = { ...saved, eventCount: { threshold: 40, retainCount: 15 } };
  const network = mock([{ taskId: "task-2" }, { status: "processing-completed" }, { summarization: custom }]);
  const result = await configureSummarization({ ...options, threshold: 40, retainCount: 15 }, network);
  assert.deepEqual(result.summarization, custom);
});

test("invalid thresholds and missing management credentials never send requests", async () => {
  const network = mock([]);
  for (const values of [{ threshold: 10 }, { threshold: 10001 }, { retainCount: -1 },
    { threshold: 20.5 }, { apiKey: "" }, { apiSecretKey: "" }, { storeId: "" }]) {
    await assert.rejects(configureSummarization({ ...options, ...values }, network));
  }
  assert.equal(network.calls.length, 0);
});

test("HTTP and asynchronous task failures do not disclose response bodies", async () => {
  await assert.rejects(configureSummarization(options, mock([new Response("cloud-secret", { status: 403 })])), /HTTP 403/);
  await assert.rejects(configureSummarization(options, mock([{ taskId: "task-1" },
    { status: "processing-error", response: { error: "cloud-secret", additionalInfo: "private" } }])),
  { message: "Redis Cloud store update failed; inspect the task in Redis Cloud" });
});

test("fails rather than reporting success for missing task ID, unknown status or mismatched readback", async () => {
  await assert.rejects(configureSummarization(options, mock([{}])), /without a task ID/);
  await assert.rejects(configureSummarization(options, mock([{ taskId: "task-1" }, { status: "unknown" }])), /unknown task status/);
  await assert.rejects(configureSummarization(options, mock([{ taskId: "task-1" },
    { status: "processing-completed" }, { summarization: { ...saved, enabled: false } }])), /do not match/);
});

test("timeout reports the pending task and does not resubmit the update", async () => {
  const network = mock([{ taskId: "task-1" }, { status: "processing-in-progress" }]);
  await assert.rejects(configureSummarization({ ...options, timeoutMs: 30 },
    { ...network, pollIntervalMs: 1000 }), /Timed out waiting for Redis Cloud task task-1/);
  assert.equal(network.calls.filter((call) => call.init?.method === "PATCH").length, 1);
});
