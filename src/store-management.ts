import { setTimeout as delay } from "node:timers/promises";

export type SummarizationOptions = {
  storeId: string;
  apiKey: string;
  apiSecretKey: string;
  threshold: number;
  retainCount: number;
  timeoutMs?: number;
};

export function validateSummarization(threshold: number, retainCount: number) {
  for (const [name, value] of Object.entries({ threshold, retainCount })) {
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      throw new Error(`${name} must be an integer between 0 and 10000`);
    }
  }
  if (threshold <= retainCount) throw new Error("threshold must be greater than retainCount");
}

/** Configure the managed service, not the data-plane SDK or local capture runtime. */
export async function configureSummarization(
  options: SummarizationOptions,
  dependencies: { fetch?: typeof fetch; pollIntervalMs?: number } = {},
) {
  validateSummarization(options.threshold, options.retainCount);
  if (!options.storeId.trim()) throw new Error("AGENT_MEMORY_STORE_ID is required");
  if (!options.apiKey.trim() || !options.apiSecretKey.trim()) {
    throw new Error("REDIS_CLOUD_API_KEY and REDIS_CLOUD_API_SECRET_KEY are required; the Agent Memory bearer token cannot manage a store");
  }
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
  const signal = AbortSignal.timeout(timeoutMs);
  const requestFetch = dependencies.fetch ?? fetch;
  const storePath = `/v1/memory-stores/${encodeURIComponent(options.storeId)}`;
  const summarization = {
    enabled: true,
    triggerStrategy: "event_count",
    eventCount: { threshold: options.threshold, retainCount: options.retainCount },
  };
  let taskId: string | undefined;
  async function request(path: string, method = "GET", body?: unknown) {
    // Fixed origin and disabled redirects prevent management credentials from
    // following a data-plane URL or a server redirect to another destination.
    let response: Response;
    try {
      response = await requestFetch(`https://api.redislabs.com${path}`, {
        method, redirect: "error", signal,
        headers: {
          "x-api-key": options.apiKey, "x-api-secret-key": options.apiSecretKey,
          "Content-Type": "application/json", Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error("Redis Cloud management request failed; check connectivity and the store configuration before retrying");
    }
    if (!response.ok) throw new Error(`Redis Cloud management request failed (HTTP ${response.status})`);
    try { return await response.json(); }
    catch { throw new Error("Redis Cloud returned an invalid JSON response"); }
  }
  try {
    const accepted = await request(storePath, "PATCH", { summarization });
    if (typeof accepted?.taskId !== "string" || !accepted.taskId) {
      throw new Error("Redis Cloud accepted the update without a task ID; check the store configuration before retrying");
    }
    taskId = accepted.taskId;
    while (true) {
      const task = await request(`/v1/tasks/${encodeURIComponent(taskId!)}`);
      if (task?.status === "processing-error" || task?.response?.error) {
        throw new Error("Redis Cloud store update failed; inspect the task in Redis Cloud");
      }
      if (task?.status === "processing-completed") break;
      if (!["initialized", "received", "processing-in-progress"].includes(task?.status)) {
        throw new Error("Redis Cloud returned an unknown task status; inspect the task before retrying");
      }
      await delay(dependencies.pollIntervalMs ?? 2000, undefined, { signal });
    }
    const store = await request(storePath);
    const saved = store?.summarization;
    if (saved?.enabled !== true || saved?.eventCount?.threshold !== options.threshold
      || saved?.eventCount?.retainCount !== options.retainCount) {
      throw new Error("Store update completed, but saved summarization settings do not match; check Redis Cloud");
    }
    return { storeId: options.storeId, taskId, summarization };
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Timed out waiting for Redis Cloud${taskId ? ` task ${taskId}` : ""}; the update may still complete. Check the store before retrying.`);
    }
    throw error;
  }
}
