import { randomUUID } from "node:crypto";
import { redactSensitiveText } from "./privacy.js";
import { feedbackSchema, type Feedback } from "./feedback.js";
import { basename } from "node:path";
import { PostHog } from "posthog-node";

export type Surface = "mcp" | "claude-plugin" | "capture";
export type Operation = "memory_health" | "memory_append" | "memory_get_session" |
  "memory_search" | "checkpoint_save" | "resume_context" | "memory_setup" |
  "share-settings" | "configure" | "install" | "uninstall" | "help" | "doctor" |
  "status" | "flush" | "import-claude" | "import-chatgpt" | "watch-imports" | "hook" | "unknown" |
  "prompt_recall" | "queue_flush" | "startup" | "runtime" | "feedback_submit" | "feedback" | "check";
type Properties = Record<string, string | number | boolean>;

// A narrow sink interface keeps telemetry behavior testable without network access.
export interface TelemetrySink {
  capture(event: string, properties: Properties): void;
  exception(error: Error, properties: Properties): void;
  feedback(properties: Properties): Promise<void>;
  shutdown(): Promise<void>;
}

function errorType(error: unknown): string {
  // Error names/messages can contain server responses and user data.
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof SyntaxError) return "SyntaxError";
  return "Error";
}

export function safeException(error: unknown, operation: Operation): Error {
  const sanitized = new Error(`${operation} failed`);
  sanitized.name = errorType(error);
  // Preserve line locations for grouping, but never source snippets, absolute paths,
  // arbitrary function names, exception messages, causes, or custom properties.
  const frames = error instanceof Error ? (error.stack ?? "").split("\n").slice(1)
    .flatMap(line => {
      const match = line.match(/(?:\/|\\)([A-Za-z0-9_-]+\.[cm]?[jt]s):(\d+):(\d+)\)?$/);
      return match ? [`    at ${basename(match[1])}:${match[2]}:${match[3]}`] : [];
    }).slice(0, 20) : [];
  sanitized.stack = `${sanitized.name}: ${sanitized.message}\n${frames.join("\n")}`;
  return sanitized;
}

export class Telemetry {
  private closing?: Promise<void>;
  constructor(private readonly surface: Surface, private readonly sink?: TelemetrySink,
    private readonly secrets: string[] = []) {}

  get enabled(): boolean { return Boolean(this.sink); }

  async submitFeedback(input: Feedback): Promise<{ submitted: true }> {
    const feedback = feedbackSchema.parse(input);
    if (!this.sink || this.closing) throw new Error("PostHog is disabled or unavailable; feedback was not submitted.");
    const properties: Properties = { surface: this.surface, category: feedback.category,
      message: redactSensitiveText(feedback.message, this.secrets) };
    if (feedback.rating !== undefined) properties.rating = feedback.rating;
    try { await this.sink.feedback(properties); }
    catch { throw new Error("PostHog could not accept feedback; please try again later."); }
    return { submitted: true };
  }

  private attempt(action: () => void): void {
    try { if (!this.closing) action(); } catch { /* Observability must not break memory operations. */ }
  }

  failure(operation: Operation, error: unknown): void {
    const properties = { surface: this.surface, operation, error_type: errorType(error) };
    this.attempt(() => this.sink?.exception(safeException(error, operation), properties));
  }

  async observe<T>(operation: Operation, handler: () => Promise<T>): Promise<T> {
    const start = performance.now();
    let success = false;
    try {
      const result = await handler();
      success = true;
      return result;
    } catch (error) {
      this.failure(operation, error);
      throw error;
    } finally {
      const properties = { surface: this.surface, operation, success,
        duration_ms: Math.max(0, Math.round(performance.now() - start)) };
      this.attempt(() => this.sink?.capture("memory operation completed", properties));
    }
  }

  shutdown(): Promise<void> {
    // The exporter has a short request timeout; never propagate failures.
    return this.closing ??= Promise.resolve().then(() => this.sink?.shutdown()).then(() => {}, () => {});
  }
}

export function createTelemetry(surface: Surface, env: NodeJS.ProcessEnv = process.env): Telemetry {
  const key = env.POSTHOG_API_KEY?.trim();
  if (!key || env.POSTHOG_ENABLED !== "true" || env.DO_NOT_TRACK === "1") return new Telemetry(surface);
  try {
    const host = new URL(env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com");
    if (host.protocol !== "https:" || host.username || host.password || host.search || host.hash || host.pathname !== "/") {
      return new Telemetry(surface);
    }
    const distinctId = env.POSTHOG_DISTINCT_ID?.trim() || randomUUID();
    const common = { service: "redis-agent-memory-mcp", $process_person_profile: false };
    const client = new PostHog(key, { host: host.origin, flushAt: 20, flushInterval: 5000,
      requestTimeout: 1500, fetchRetryCount: 0, maxQueueSize: 500,
      enableExceptionAutocapture: false, disableGeoip: true });
    client.on("error", () => {});
    return new Telemetry(surface, {
      capture: (event, properties) => client.capture({ distinctId, event, properties: { ...common, ...properties } }),
      exception: (error, properties) => { client.captureException(error, distinctId, { ...common, ...properties }); },
      // The SDK treats capture errors as best-effort. Explicit feedback needs an
      // HTTP acknowledgement so we can tell the user when submission failed.
      feedback: async (properties) => {
        const response = await fetch(`${host.origin}/i/v0/e/`, {
          method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
          signal: AbortSignal.timeout(1500),
          body: JSON.stringify({ api_key: key, event: "feedback submitted", distinct_id: distinctId,
            uuid: randomUUID(), timestamp: new Date().toISOString(),
            properties: { ...common, ...properties, $geoip_disable: true } }),
        });
        if (!response.ok) throw new Error("Feedback ingestion rejected");
        const result = await response.json() as { status?: number; quota_limited?: unknown[] };
        if (result.status === 0 || (Array.isArray(result.quota_limited) && result.quota_limited.length > 0)) {
          throw new Error("Feedback ingestion rejected");
        }
      },
      shutdown: async () => { await client.shutdown(2500); },
    }, [key, env.AGENT_MEMORY_API_KEY ?? ""]);
  } catch { return new Telemetry(surface); }
}

// No exit handlers when disabled. beforeExit covers stdio EOF and short-lived hooks.
// SIGINT/SIGTERM flush before preserving the conventional signal exit status.
export function installTelemetryLifecycle(telemetry: Telemetry, handleSignals = true): void {
  if (!telemetry.enabled) return;
  process.once("beforeExit", () => { void telemetry.shutdown(); });
  process.once("uncaughtException", (error: unknown) => {
    telemetry.failure("runtime", error);
    console.error("Redis Agent Memory: unexpected runtime failure.");
    void telemetry.shutdown().finally(() => process.exit(1));
  });
  if (!handleSignals) return;
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
    process.once(signal, () => { void telemetry.shutdown().finally(() => process.exit(code)); });
  }
}
