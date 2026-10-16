import { randomUUID } from "node:crypto";
import { enqueue, flush, makeEntry, pendingCount, scope, type CaptureConfig, type CaptureTransport } from "./capture.js";
import { recallPrompt, type PromptSearch } from "./prompt-recall.js";
import { emptyRecall, type RecallDiagnostic } from "./diagnostics.js";

export function checkMarker(value = `ram-diagnostic-${randomUUID()}`): string {
  if (!/^ram-diagnostic-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) {
    throw new Error("--verify requires the ram-diagnostic marker printed by check");
  }
  return value;
}
// Queue before connecting, just like a real UserPromptSubmit. Do not bypass opt-outs.
export async function queueCheck(config: CaptureConfig, root: string, source: string, queue: string, marker: string, secrets: string[]) {
  const input = { hook_event_name: "UserPromptSubmit", session_id: marker, turn_id: marker, prompt: marker };
  const entry = makeEntry(config, root, source, input, secrets);
  if (!entry || JSON.parse(entry.memories[0].text).content !== marker) {
    throw new Error("Check marker blocked by capture policy; review enabled, capturePrompts, and redaction settings");
  }
  await enqueue(queue, entry, secrets, config.guardrails);
  return scope(config, root, source, input);
}
export async function verifyCheck(config: CaptureConfig, resolved: { owner: string; namespace: string; legacyNamespaces?: string[] }, marker: string,
  queue: string, storage: CaptureTransport, search: PromptSearch, secrets: string[], verifyOnly = false) {
  let delivery: "acknowledged" | "pending" | "not-tested" = verifyOnly ? "not-tested" : "pending";
  if (!verifyOnly) {
    try { const result = await flush(queue, storage, secrets, config.guardrails); if (!result.busy && result.pending === 0) delivery = "acknowledged"; }
    catch { /* Retain marker and other pending writes for normal retries. */ }
  }
  let recall = emptyRecall("unavailable");
  let markerFound = false;
  try {
    await recallPrompt({ ...config, promptRecall: true, promptRecallLimit: 20, promptRecallThreshold: 0 }, resolved, marker,
      async args => {
        const matches = await search(args);
        // Exact marker in the captured envelope, not a fuzzy match or derived summary.
        const exact = matches.filter(memory => {
          try { return JSON.parse(memory.text).content === marker; } catch { return false; }
        });
        markerFound ||= exact.length > 0;
        return exact;
      }, secrets, value => { recall = value; });
  } catch { /* Report unavailable, never raw server errors. */ }
  return { ok: markerFound && (verifyOnly || delivery === "acknowledged"), marker, ...resolved, delivery,
    pending: await pendingCount(queue), markerFound, recall: recall as RecallDiagnostic,
    injection: "not-tested", modelUse: "unknown",
    nextStep: markerFound
      ? "Start a fresh supported local chat with the same owner/namespace. Submit the marker and inspect prompt-recall diagnostics for emitted-to-host. Host acceptance and model use still require independent evidence."
      : "Run status and flush; compare owner/namespace and store in both clients. Retry --verify after indexing; check capture policy and service access. No result is not proof of data loss." };
}
