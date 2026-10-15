import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile, open } from "node:fs/promises";
import { basename, join } from "node:path";
import { defaultOwnerId } from "./identity.js";
import * as z from "zod/v4";

const identifier = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
export const captureConfigSchema = z.object({
  ownerId: identifier.optional(),
  namespace: identifier.optional(),
  sessionId: identifier.optional(),
  enabled: z.boolean().default(true),
  recallLimit: z.number().int().min(0).max(20).default(6),
});
export type CaptureConfig = z.infer<typeof captureConfigSchema>;
export type HookInput = {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  turn_id?: string;
  prompt?: string;
  last_assistant_message?: string | null;
};
export type CapturedMemory = {
  id: string;
  text: string;
  memory_type: "message";
  owner_id: string;
  namespace: string;
  session_id: string;
  topics: string[];
};
export type QueueEntry = { version: 1; memories: CapturedMemory[] };
export interface CaptureTransport {
  create(memories: CapturedMemory[]): Promise<{ created: string[]; errors?: unknown[] | null }>;
  recall(owner: string, namespace: string, limit: number): Promise<Array<{ text: string }>>;
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function projectNamespace(projectRoot: string): string {
  const slug = basename(projectRoot).replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 28) || "project";
  return `${slug}-${digest(projectRoot).slice(0, 12)}`;
}

export function scope(config: CaptureConfig, root: string, source: string, input: HookInput) {
  return {
    owner: identifier.parse(process.env.MEMORY_CAPTURE_OWNER_ID ?? config.ownerId ?? process.env.AGENT_MEMORY_OWNER_ID ?? defaultOwnerId()),
    namespace: config.namespace ?? projectNamespace(root),
    session: config.sessionId ?? `chat-${digest(`${source}:${input.session_id}`)}`,
  };
}

export function makeEntry(
  config: CaptureConfig, root: string, source: string, input: HookInput,
  secrets: string[] = [], now = new Date().toISOString(),
): QueueEntry | null {
  if (!config.enabled) return null;
  const role = input.hook_event_name === "UserPromptSubmit" ? "USER"
    : input.hook_event_name === "Stop" ? "ASSISTANT" : undefined;
  let content = role === "USER" ? input.prompt : role === "ASSISTANT" ? input.last_assistant_message : undefined;
  if (!content || !role) return null;
  for (const secret of secrets.filter(Boolean)) content = content.replaceAll(secret, "[REDACTED]");
  content = content.replace(/mem1_[A-Za-z0-9_=-]+/g, "[REDACTED]");
  const resolved = scope(config, root, source, input);
  // Codex provides a turn ID. Claude events without one get a fresh identity so
  // submitting the same prompt twice still captures two separate turns.
  const eventIdentity = input.turn_id ?? randomUUID();
  // JSON can expand control characters to six bytes; leave room for the envelope.
  const chunks = content.match(/[\s\S]{1,6000}/g) ?? [];
  return { version: 1, memories: chunks.map((text, index) => ({
    id: `turn-${digest(JSON.stringify([resolved, source, eventIdentity, role, index]))}`,
    text: JSON.stringify({ role, source, sourceSessionId: input.session_id,
      turnId: input.turn_id, capturedAt: now, part: index + 1, parts: chunks.length, content: text }),
    memory_type: "message", owner_id: resolved.owner, namespace: resolved.namespace,
    session_id: resolved.session, topics: ["auto-capture", source, role.toLowerCase()],
  })) };
}

export async function enqueue(directory: string, entry: QueueEntry): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `${Date.now()}-${randomUUID()}.json`;
  const temporary = join(directory, `${filename}.tmp`);
  const final = join(directory, filename);
  await writeFile(temporary, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
  await rename(temporary, final);
  return final;
}

export async function pendingCount(directory: string): Promise<number> {
  return (await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter(file => file.endsWith(".json")).length;
}

export async function flush(directory: string, transport: CaptureTransport): Promise<{ sent: number; pending: number; busy?: boolean }> {
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
  try {
    for (const name of (await readdir(directory)).filter(file => file.endsWith(".json")).sort()) {
      const path = join(directory, name);
      const entry = JSON.parse(await readFile(path, "utf8")) as QueueEntry;
      if (entry.version !== 1 || !Array.isArray(entry.memories)) throw new Error("Invalid capture queue entry");
      for (let start = 0; start < entry.memories.length; start += 100) {
        const batch = entry.memories.slice(start, start + 100);
        const response = await transport.create(batch);
        if (response.errors?.length || batch.some(memory => !response.created.includes(memory.id))) {
          throw new Error("Capture write was not fully acknowledged; retained for retry");
        }
      }
      await unlink(path);
      sent += entry.memories.length;
    }
    return { sent, pending: await pendingCount(directory) };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
