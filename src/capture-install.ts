import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const captureHookStatus = "Redis Agent Memory capture";
export const captureEvents = ["SessionStart", "UserPromptSubmit", "Stop"] as const;

type JsonObject = Record<string, unknown>;

function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function windowsQuote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function captureHookHandler(nodePath: string, cliPath: string): JsonObject {
  return {
    type: "command",
    command: `${posixQuote(nodePath)} ${posixQuote(cliPath)} hook codex`,
    commandWindows: `${windowsQuote(nodePath)} ${windowsQuote(cliPath)} hook codex`,
    timeout: 30,
    statusMessage: captureHookStatus,
    additionalContextLimit: 6000,
  };
}

function isCaptureHandler(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const handler = value as JsonObject;
  if (handler.statusMessage === captureHookStatus) return true;
  return (
    typeof handler.command === "string" &&
    /(?:capture\.sh|capture-cli\.js)["']?\s+hook\s+codex(?:\s|$)/.test(handler.command)
  );
}

function withoutCaptureHandlers(groups: unknown): JsonObject[] {
  if (!Array.isArray(groups)) return [];
  const retained: JsonObject[] = [];
  for (const value of groups) {
    if (!value || typeof value !== "object") continue;
    const group = value as JsonObject;
    const handlers = Array.isArray(group.hooks)
      ? group.hooks.filter((handler) => !isCaptureHandler(handler))
      : [];
    if (handlers.length) retained.push({ ...group, hooks: handlers });
  }
  return retained;
}

export function mergeCaptureHooks(
  document: JsonObject,
  nodePath: string,
  cliPath: string,
): JsonObject {
  const hooks =
    document.hooks && typeof document.hooks === "object"
      ? { ...(document.hooks as JsonObject) }
      : {};
  for (const event of captureEvents) {
    hooks[event] = [
      ...withoutCaptureHandlers(hooks[event]),
      { hooks: [captureHookHandler(nodePath, cliPath)] },
    ];
  }
  return { ...document, hooks };
}

export function removeCaptureHooks(document: JsonObject): JsonObject {
  if (!document.hooks || typeof document.hooks !== "object") return document;
  const hooks = { ...(document.hooks as JsonObject) };
  for (const event of captureEvents) {
    const retained = withoutCaptureHandlers(hooks[event]);
    if (retained.length) hooks[event] = retained;
    else delete hooks[event];
  }
  return Object.keys(hooks).length
    ? { ...document, hooks }
    : Object.fromEntries(Object.entries(document).filter(([key]) => key !== "hooks"));
}

export function hasCaptureHooks(document: JsonObject): boolean {
  if (!document.hooks || typeof document.hooks !== "object") return false;
  const hooks = document.hooks as JsonObject;
  return captureEvents.every((event) =>
    Array.isArray(hooks[event]) &&
    hooks[event].some(
      (group) =>
        group &&
        typeof group === "object" &&
        Array.isArray((group as JsonObject).hooks) &&
        ((group as JsonObject).hooks as unknown[]).some(isCaptureHandler),
    ),
  );
}

async function readJson(path: string): Promise<JsonObject> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path} must contain a JSON object`);
    }
    return parsed as JsonObject;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: JsonObject): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

async function ensureLine(path: string, line: string): Promise<boolean> {
  let existing = "";
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing.split(/\r?\n/).includes(line)) return false;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${existing}${prefix}${line}\n`, { mode: 0o600 });
  return true;
}

async function ensureFile(path: string, contents: string): Promise<boolean> {
  try {
    await writeFile(path, contents, { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export type InstallResult = {
  projectRoot: string;
  hooksPath: string;
  createdCaptureConfig: boolean;
  createdEnvironment: boolean;
  updatedGitignore: boolean;
};

export async function installCapture(
  projectRoot: string,
  nodePath: string,
  cliPath: string,
): Promise<InstallResult> {
  const hooksPath = join(projectRoot, ".codex", "hooks.json");
  const existing = await readJson(hooksPath);
  await writeJsonAtomic(hooksPath, mergeCaptureHooks(existing, nodePath, cliPath));

  const namespace =
    (projectRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? "project")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project";
  const createdCaptureConfig = await ensureFile(
    join(projectRoot, ".memory-capture.json"),
    `${JSON.stringify({ enabled: true, namespace, recallLimit: 6 }, null, 2)}\n`,
  );
  const createdEnvironment = await ensureFile(
    join(projectRoot, ".env"),
    [
      "# Redis Agent Memory capture credentials (keep this file private)",
      "AGENT_MEMORY_BASE_URL=",
      "AGENT_MEMORY_STORE_ID=",
      "AGENT_MEMORY_API_KEY=",
      "",
    ].join("\n"),
  );
  if (createdEnvironment) await chmod(join(projectRoot, ".env"), 0o600);
  const updatedGitignore = await ensureLine(join(projectRoot, ".gitignore"), ".memory-capture/");
  await ensureLine(join(projectRoot, ".gitignore"), ".env");

  return {
    projectRoot,
    hooksPath,
    createdCaptureConfig,
    createdEnvironment,
    updatedGitignore,
  };
}

export async function uninstallCapture(projectRoot: string): Promise<{ hooksPath: string; changed: boolean }> {
  const hooksPath = join(projectRoot, ".codex", "hooks.json");
  const existing = await readJson(hooksPath);
  const updated = removeCaptureHooks(existing);
  const changed = JSON.stringify(existing) !== JSON.stringify(updated);
  if (changed) await writeJsonAtomic(hooksPath, updated);
  return { hooksPath, changed };
}

export async function captureHooksInstalled(projectRoot: string): Promise<boolean> {
  return hasCaptureHooks(await readJson(join(projectRoot, ".codex", "hooks.json")));
}
