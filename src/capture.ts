import { recordDiagnostic } from "./diagnostics.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { redactSensitiveText, sanitizeMemory, sanitizeCapturedText, guardrailsSchema, roleAllowed, type Guardrails } from "./privacy.js";
import { defaultOwnerId } from "./identity.js";
import { projectIdentity } from "./project-identity.js";
export { projectNamespace } from "./project-identity.js";
import * as z from "zod/v4";
import { observation, observationAllowed, observationConfigSchema, type HookInput, type ObservationConfig } from "./hook-observations.js";
import { deliverSession, sessionRequest, SessionCaptureError, type SessionCapture, type SessionCaptureTransport } from "./session-capture.js";
import { setTimeout as delay } from "node:timers/promises";
export type { HookInput } from "./hook-observations.js";

const identifier = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
export const captureConfigSchema = z.object({
  guardrails: guardrailsSchema.optional(),
  ownerId: identifier.optional(),
  namespace: identifier.optional(),
  legacyNamespaces: z.array(identifier).max(20).default([]),
  sessionId: identifier.optional(),
  enabled: z.boolean().default(true),
  sessionCapture: z.boolean().default(true),
  sessionObservations: z.boolean().default(false),
  compatibilityCapture: z.boolean().default(true),
  observations: observationConfigSchema,
  startupContextChars: z.number().int().min(1024).max(100000).default(18000),
  promptContextChars: z.number().int().min(1024).max(100000).default(5400),
  recallLimit: z.number().int().min(0).max(20).default(6),
  promptRecall: z.boolean().default(true),
  promptRecallLimit: z.number().int().min(0).max(20).default(5),
  promptRecallThreshold: z.number().min(0).max(1).default(0.7),
});
export type CaptureConfig = z.infer<typeof captureConfigSchema>;
export type CapturedMemory = {
  id: string;
  text: string;
  memory_type: "message";
  owner_id: string;
  namespace: string;
  session_id: string;
  topics: string[];
};
export type QueueEntry = { version: 1; memories: CapturedMemory[] }
  | { version: 2; memories: CapturedMemory[]; session?: SessionCapture; compatibility: boolean };
export type DeliveryOptions = Pick<CaptureConfig, "enabled" | "sessionCapture" | "sessionObservations" | "compatibilityCapture"> & { retryUncertain?: boolean };
export interface CaptureTransport {
  destinationId?: string;
  session?: SessionCaptureTransport;
  create(memories: CapturedMemory[]): Promise<{ created: string[]; errors?: unknown[] | null }>;
  recall(owner: string, namespace: string, limit: number): Promise<Array<{ text: string; id?: string }>>;
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function scope(config: CaptureConfig, root: string, source: string, input: HookInput) {
  const identity = config.namespace ? { namespace: config.namespace, legacyNamespaces: [] } : projectIdentity(root);
  const owner = identifier.parse(process.env.MEMORY_CAPTURE_OWNER_ID ?? config.ownerId ?? process.env.AGENT_MEMORY_OWNER_ID ?? defaultOwnerId());
  return {
    owner,
    namespace: identity.namespace,
    legacyNamespaces: [...new Set([...identity.legacyNamespaces, ...config.legacyNamespaces])],
    session: `${config.sessionId ? "task" : "chat"}-${digest(JSON.stringify([owner, identity.namespace,
      ...(config.sessionId ? ["shared-task", config.sessionId] : [source, input.session_id])]))}`,
  };
}

export function redactCaptureText(text: string, secrets: string[] = [], guardrails: Guardrails = {}): string {
  return redactSensitiveText(text, secrets, guardrails);
}

export function makeEntry(
  config: CaptureConfig, root: string, source: string, input: HookInput,
  secrets: string[] = [], now = new Date().toISOString(),
): QueueEntry | null {
  if (!config.enabled) return null;
  const role = input.hook_event_name === "UserPromptSubmit" ? "USER"
    : input.hook_event_name === "Stop" ? "ASSISTANT" : "OBSERVATION";
  const observed = role === "OBSERVATION" ? observation(input, config.observations, secrets, config.guardrails ?? {}) : undefined;
  let content = role === "USER" ? input.prompt : role === "ASSISTANT" ? input.last_assistant_message : undefined;
  if ((!content && !observed) || !roleAllowed(role, config.guardrails)) return null;
  if (role !== "OBSERVATION" && config.observations.excludedEvents.includes(input.hook_event_name as "Stop")) return null;
  content = observed ? JSON.stringify(observed) : redactCaptureText(content!, secrets, config.guardrails);
  const resolved = scope(config, root, source, input);
  if (secrets.filter(Boolean).some(secret => [resolved.owner, resolved.namespace, resolved.session, source].some(value => value.includes(secret)))) {
    throw new Error("Capture routing contains a configured credential");
  }
  // Codex provides a turn ID. Claude events without one get a fresh identity so
  // submitting the same prompt twice still captures two separate turns.
  const eventIdentity = input.event_id ?? (observed ? input.tool_use_id
    ?? (input.agent_id && /^Subagent/.test(input.hook_event_name) ? `${input.agent_id}:${input.turn_id ?? ""}` : undefined)
    ?? (input.task_id && input.hook_event_name === "TaskCompleted" ? `${input.task_id}:${input.turn_id ?? ""}` : undefined)
    ?? (input.turn_id ? `${input.turn_id}:${digest(content)}` : undefined) : input.turn_id) ?? randomUUID();
  const timestamp = input.timestamp && !Number.isNaN(Date.parse(input.timestamp)) ? new Date(input.timestamp).toISOString() : now;
  // Preserve compatibility record IDs across the session-ID migration. These
  // hashes already include owner and namespace; only session routing changes.
  const compatibilitySession = config.sessionId ?? `chat-${digest(`${source}:${input.session_id}`)}`;
  // JSON can expand control characters to six bytes; leave room for the envelope.
  const chunks = content.match(/[\s\S]{1,6000}/g) ?? [];
  const memories: CapturedMemory[] = chunks.map((text, index) => ({
    id: `turn-${digest(JSON.stringify([{ owner: resolved.owner, namespace: resolved.namespace, session: compatibilitySession }, source, eventIdentity, role, ...(observed ? [input.hook_event_name] : []), index]))}`,
    text: JSON.stringify(sanitizeMemory({ role, source, sourceSessionId: redactCaptureText(input.session_id, secrets, config.guardrails).slice(0, 512),
      repoPath: redactCaptureText(input.cwd ?? root, secrets, config.guardrails).slice(0, 512),
      turnId: input.turn_id ? redactCaptureText(input.turn_id, secrets, config.guardrails).slice(0, 512) : undefined, capturedAt: timestamp,
      eventType: input.hook_event_name, eventId: digest(eventIdentity),
      ...(observed ? { toolName: observed.toolName, toolCallId: observed.toolCallId, agentId: observed.agentId, taskId: observed.taskId } : {}),
      part: index + 1, parts: chunks.length, content: text }, secrets, config.guardrails)),
    memory_type: "message", owner_id: resolved.owner, namespace: resolved.namespace,
    session_id: resolved.session, topics: [observed ? "auto-observation" : "auto-capture", source, role.toLowerCase(), input.hook_event_name],
  }));
  if (!config.sessionCapture && config.compatibilityCapture) return { version: 1, memories };
  if (!config.sessionCapture && !config.compatibilityCapture) return null;
  return { version: 2, memories, compatibility: config.compatibilityCapture,
    session: { createdAt: timestamp, eventGroup: digest(eventIdentity), observations: config.sessionObservations } };
}

function capturedRoleAllowed(text: string, guardrails: Guardrails, policy?: ObservationConfig): boolean {
  try {
    const envelope = JSON.parse(text);
    return roleAllowed(envelope.role, guardrails) && (!policy || (
      !policy.excludedEvents.includes(envelope.eventType)
      && (envelope.role !== "OBSERVATION" || observationAllowed(envelope.eventType, envelope.toolName, policy))));
  }
  catch { return guardrails.capturePrompts !== false && guardrails.captureResponses !== false; }
}

export async function enqueue(directory: string, entry: QueueEntry, secrets: string[] = [], guardrails: Guardrails = {}): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Serialize only local enqueue commits, never network delivery. A durable
  // monotonic sequence orders same-millisecond and concurrent hook writes.
  const lockPath = join(directory, ".enqueue-lock");
  let lock;
  const deadline = Date.now() + 5000;
  while (!lock) {
    try {
      const opened = await open(lockPath, "wx", 0o600);
      try { await opened.writeFile(String(process.pid)); lock = opened; }
      catch (error) { await opened.close(); await unlink(lockPath); throw error; }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(lockPath, "utf8").catch(() => ""));
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (probe) { if ((probe as NodeJS.ErrnoException).code === "ESRCH") await unlink(lockPath).catch(() => {}); }
      }
      if (Date.now() >= deadline) throw new Error("Capture queue is busy; enqueue did not complete");
      await delay(10);
    }
  }
  let final: string;
  try {
    const sequencePath = join(directory, ".enqueue-sequence");
    const previous = Number(await readFile(sequencePath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "0";
      throw error;
    }));
    if (!Number.isSafeInteger(previous) || previous < 0) throw new Error("Invalid capture queue sequence");
    const sequence = Math.max(Date.now() * 1000, previous + 1);
    const next = `${sequencePath}.${randomUUID()}.tmp`;
    await writeFile(next, String(sequence), { mode: 0o600, flag: "wx" });
    await rename(next, sequencePath);
    const filename = `${String(sequence).padStart(20, "0")}-${randomUUID()}.json`;
    const temporary = join(directory, `${filename}.tmp`);
    final = join(directory, filename);
    await writeFile(temporary, JSON.stringify({ ...entry, memories: entry.memories.filter(memory => capturedRoleAllowed(memory.text, guardrails)).map(memory => ({ ...memory, text: sanitizeCapturedText(memory.text, secrets, guardrails) })) }), { mode: 0o600, flag: "wx" });
    await rename(temporary, final);
  } finally { await lock.close(); await unlink(lockPath); }
  await recordBatch(directory, "capture", entry.memories.filter(memory => capturedRoleAllowed(memory.text, guardrails)));
  return final;
}

export async function pendingCount(directory: string): Promise<number> {
  return (await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter(file => file.endsWith(".json")).length;
}

export async function flush(directory: string, transport: CaptureTransport, secrets: string[] = [], guardrails: Guardrails = {}, policy?: ObservationConfig, options?: DeliveryOptions): Promise<{ sent: number; pending: number; busy?: boolean; sessionSent?: number; sessionReconciled?: number }> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, ".flush-lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(String(process.pid));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Recover only a lock belonging to a process confirmed to have exited.
    const pid = Number(await readFile(lockPath, "utf8").catch(() => ""));
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); }
      catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === "ESRCH") {
          await unlink(lockPath).catch(() => {});
        }
      }
    }
    return { sent: 0, pending: await pendingCount(directory), busy: true };
  }
  let sent = 0;
  let sessionSent = 0;
  let sessionReconciled = 0;
  let sessionWork = false;
  try {
    const receipts = join(directory, ".receipts");
    await mkdir(receipts, { recursive: true, mode: 0o700 });
    for (const name of (await readdir(directory)).filter(file => file.endsWith(".json")).sort()) {
      const path = join(directory, name);
      const entry = JSON.parse(await readFile(path, "utf8")) as QueueEntry;
      if (![1, 2].includes(entry.version) || !Array.isArray(entry.memories)) throw new Error("Invalid capture queue entry");
      if (entry.version === 2 && (typeof entry.compatibility !== "boolean" || entry.session && (
        typeof entry.session.observations !== "boolean" || !/^[a-f0-9]{32}$/.test(entry.session.eventGroup)
        || typeof entry.session.createdAt !== "string" || Number.isNaN(Date.parse(entry.session.createdAt))
      ))) throw new Error("Invalid capture queue delivery plan; retained for recovery");
      if (options?.enabled === false && entry.memories.some(memory => ["auto-capture", "auto-observation"].includes(memory.topics[0]))) continue;
      if (entry.version === 2 && entry.session && options?.sessionCapture !== false) {
        for (const memory of entry.memories.filter(memory => capturedRoleAllowed(memory.text, guardrails, policy))) {
          const request = sessionRequest(memory, { ...entry.session,
            observations: entry.session.observations && options?.sessionObservations !== false },
            Number(name.split("-")[0]), secrets, guardrails);
          if (!request) continue;
          sessionWork = true;
          if (!transport.session) throw new Error("Session transport unavailable; retained in queue without long-term-only fallback");
          try {
            const outcome = await deliverSession(receipts, transport.destinationId ?? "default", request, transport.session, options?.retryUncertain);
            if (outcome === "sent") sessionSent++;
            if (outcome === "reconciled") sessionReconciled++;
            if (outcome !== "skipped") await recordBatch(directory, "session-delivery", [memory]);
          } catch (error) {
            await recordBatch(directory, "session-failure", [memory], error instanceof SessionCaptureError ? error.reason : "unavailable");
            throw error;
          }
        }
      }
      if (entry.version === 2 && (!entry.compatibility || options?.compatibilityCapture === false)) { await unlink(path); continue; }
      for (let start = 0; start < entry.memories.length; start += 100) {
        const candidates = entry.memories.slice(start, start + 100).filter(memory => capturedRoleAllowed(memory.text, guardrails, policy));
        const batch: CapturedMemory[] = [];
        for (const memory of candidates) {
          const acknowledged = await readFile(join(receipts, digest(transport.destinationId ? JSON.stringify([transport.destinationId, memory.id]) : memory.id)), "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
          if (!acknowledged) batch.push({ ...memory, text: sanitizeCapturedText(memory.text, secrets, guardrails) });
        }
        if (!batch.length) continue;
        const response = await transport.create(batch);
        // Persist accepted IDs even when another record in this batch failed.
        // A lost response still replays the same ID to the service's idempotent create.
        const accepted = batch.filter(memory => response.created.includes(memory.id));
        for (const memory of accepted) {
          const receipt = join(receipts, digest(transport.destinationId ? JSON.stringify([transport.destinationId, memory.id]) : memory.id));
          const temporary = `${receipt}.${randomUUID()}.tmp`;
          await writeFile(temporary, "acknowledged", { mode: 0o600, flag: "wx" });
          await rename(temporary, receipt);
        }
        sent += accepted.length;
        await recordBatch(directory, "delivery", accepted);
        if (response.errors?.length || batch.some(memory => !response.created.includes(memory.id))) {
          throw new Error("Capture write was not fully acknowledged; retained for retry");
        }
      }
      await unlink(path);
    }
    return { sent, pending: await pendingCount(directory), ...(sessionWork ? { sessionSent, sessionReconciled } : {}) };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function recordBatch(directory: string, kind: "capture" | "delivery" | "session-delivery" | "session-failure", memories: CapturedMemory[], reason?: SessionCaptureError["reason"]) {
  const groups = new Map<string, { owner: string; namespace: string; source: string; count: number }>();
  for (const memory of memories) {
    const identity = { owner: memory.owner_id, namespace: memory.namespace, source: ["auto-capture", "auto-observation"].includes(memory.topics[0]) ? memory.topics[1] ?? "unknown" : memory.topics[0] ?? "unknown" };
    const key = JSON.stringify(identity);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { ...identity, count: 1 });
  }
  for (const { count, ...identity } of groups.values()) {
    await recordDiagnostic(join(dirname(directory), "diagnostics"), identity, kind, { count, ...(reason ? { reason } : {}) });
  }
}
