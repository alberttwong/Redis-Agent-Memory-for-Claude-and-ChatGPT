import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as z from "zod/v4";
import { redactSensitiveText } from "./privacy.js";
import { claudeCaptureEvents, codexCaptureEvents } from "./hook-observations.js";

const recallSchema = z.object({
  outcome: z.enum(["disabled", "empty", "returned", "unavailable"]),
  attempted: z.boolean(), count: z.number().int().nonnegative(), ids: z.array(z.string().max(128)).max(100),
  context: z.enum(["none", "prepared", "emitted-to-host"]),
  queryTruncated: z.boolean(), contextTruncated: z.boolean(),
});
export type RecallDiagnostic = z.infer<typeof recallSchema>;
const recordSchema = z.object({
  at: z.string().datetime(), owner: z.string(), namespace: z.string(), source: z.string(),
  kind: z.enum(["capture", "delivery", "prompt-recall", "startup-recall", ...claudeCaptureEvents]),
  count: z.number().int().nonnegative().optional(), recall: recallSchema.optional(),
});
type Record = z.infer<typeof recordSchema>;
export type DiagnosticScope = Pick<Record, "owner" | "namespace" | "source">;
function path(directory: string, scope: DiagnosticScope, kind: Record["kind"]) {
  const hash = createHash("sha256").update(JSON.stringify([scope.owner, scope.namespace, scope.source])).digest("hex");
  return join(directory, `${hash}-${kind}.json`);
}
// Explicit metadata fields only: never persist prompts, results, raw exceptions, or headers.
export async function recordDiagnostic(directory: string, scope: DiagnosticScope,
  kind: Record["kind"], detail: Pick<Record, "count" | "recall"> = {}): Promise<void> {
  try {
    const record = recordSchema.parse({ at: new Date().toISOString(), ...scope, kind, ...detail });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = path(directory, scope, kind);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    await rename(temporary, destination);
  } catch {
    console.error("Redis diagnostics: metadata could not be recorded; diagnostic state may be unknown or stale.");
  }
}
export async function readDiagnostics(directory: string, scope: DiagnosticScope) {
  const read = async (kind: Record["kind"]) => {
    try {
      const value = recordSchema.parse(JSON.parse(await readFile(path(directory, scope, kind), "utf8")));
      if (value.owner !== scope.owner || value.namespace !== scope.namespace || value.source !== scope.source || value.kind !== kind) throw new Error();
      return { state: "observed" as const, ...value };
    } catch (error) {
      return { state: (error as NodeJS.ErrnoException).code === "ENOENT" ? "unknown" as const : "unavailable" as const };
    }
  };
  return { scope, lastCapture: await read("capture"), lastDelivery: await read("delivery"),
    promptRecall: await read("prompt-recall"), startupRecall: await read("startup-recall"),
    hookDispatch: Object.fromEntries(await Promise.all((scope.source === "claude" ? claudeCaptureEvents : codexCaptureEvents)
      .map(async event => [event, await read(event)]))),
    modelUse: "unknown", injectionEvidence: "emitted-to-host means hook output only; host acceptance and model use are not observable here" };
}
export function emptyRecall(outcome: RecallDiagnostic["outcome"], attempted = false): RecallDiagnostic {
  return { outcome, attempted, count: 0, ids: [], context: "none", queryTruncated: false, contextTruncated: false };
}
export function memoryIds(memories: Array<{ id?: unknown }>, secrets: string[] = []): string[] {
  return memories.slice(0, 100).flatMap(memory => typeof memory.id === "string"
    && /^[A-Za-z0-9_-]{1,128}$/.test(memory.id) && redactSensitiveText(memory.id, secrets) === memory.id ? [memory.id] : []);
}
