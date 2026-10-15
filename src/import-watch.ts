import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { enqueueImport, planChatGptImport, planClaudeImport, type ClaudeImportOptions, type ImportProvider } from "./claude-import.js";

export type WatchImportOptions = ClaudeImportOptions & {
  directory: string;
  stateDirectory: string;
  queue: string;
  write: boolean;
  settleMs?: number;
};

export type WatchImportEvent = {
  provider: ImportProvider;
  file: string;
  status: "preview" | "queued" | "error";
  records?: number;
  enqueued?: number;
};

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// Explicit provider folders avoid guessing the format of generic memory JSON/text.
// Polling also handles downloads completed by renaming a temporary file.
export class ImportWatcher {
  private previewed = new Set<string>();

  async scan(options: WatchImportOptions): Promise<WatchImportEvent[]> {
    const events: WatchImportEvent[] = [];
    const scope = hash(JSON.stringify([options.directory, options.ownerId, options.namespace,
      options.after, options.before, options.conversation, options.limit]));
    const statePath = join(options.stateDirectory, `${scope}.json`);
    let completed: Record<string, true> = {};
    try {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      if (state.version !== 1 || !state.completed || typeof state.completed !== "object" || Array.isArray(state.completed)
        || Object.values(state.completed).some(value => value !== true)) throw new Error("Invalid import watcher state");
      completed = state.completed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const provider of ["claude", "chatgpt"] as const) {
      const folder = join(options.directory, provider);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      for (const file of (await readdir(folder)).sort()) {
        if (!['.zip', '.json', '.md', '.txt'].includes(extname(file).toLowerCase())) continue;
        const path = join(folder, file);
        let temporary: string | undefined;
        try {
          const before = await lstat(path);
          const settleMs = options.settleMs ?? 2000;
          if (!before.isFile() || before.size > 250 * 1024 * 1024
            || (settleMs > 0 && Date.now() - before.mtimeMs < settleMs)) continue;
          const bytes = await readFile(path);
          const after = await lstat(path);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) continue;
          const fingerprint = hash(`${provider}:${file}:${hash(bytes)}`);
          if (completed[fingerprint]) continue;
          const previewKey = `${scope}:${fingerprint}`;
          if (!options.write && this.previewed.has(previewKey)) continue;
          // Parse an immutable private snapshot, then remove it even on errors.
          temporary = await mkdtemp(join(tmpdir(), "ram-import-watch-"));
          const snapshot = join(temporary, basename(file));
          await writeFile(snapshot, bytes, { mode: 0o600 });
          const planner = provider === "claude" ? planClaudeImport : planChatGptImport;
          const plan = await planner(snapshot, options);
          if (!options.write) {
            this.previewed.add(previewKey);
            events.push({ provider, file, status: "preview", records: plan.records.length });
            continue;
          }
          const result = await enqueueImport(options.queue, plan.records);
          // Persist only after durable queueing. Network outages are retried by flush.
          completed[fingerprint] = true;
          await mkdir(options.stateDirectory, { recursive: true, mode: 0o700 });
          const pending = `${statePath}.${randomUUID()}.tmp`;
          try {
            await writeFile(pending, JSON.stringify({ version: 1, completed }), { mode: 0o600 });
            await rename(pending, statePath);
          } finally { await rm(pending, { force: true }); }
          events.push({ provider, file, status: "queued", records: plan.records.length, enqueued: result.enqueued });
        } catch {
          // Provider/parser errors may contain private conversation text.
          events.push({ provider, file, status: "error" });
        } finally {
          if (temporary) await rm(temporary, { recursive: true, force: true });
        }
      }
    }
    return events;
  }
}
