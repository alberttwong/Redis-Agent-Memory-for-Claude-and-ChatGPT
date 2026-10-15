import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const claudeDesktopServerName = "redis-agent-memory-bridge";
const managedMarker = "REDIS_AGENT_MEMORY_MCP_MANAGED";

type JsonObject = Record<string, unknown>;

export function defaultClaudeDesktopConfigPath(
  platform = process.platform,
  home = homedir(),
  appData = process.env.APPDATA,
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    return join(appData?.trim() || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  throw new Error("Claude Desktop installation is supported only on macOS and Windows");
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

async function ensureEnvironment(projectRoot: string): Promise<boolean> {
  const path = join(projectRoot, ".env");
  try {
    await writeFile(
      path,
      [
        "# Redis Agent Memory bridge credentials (keep this file private)",
        "AGENT_MEMORY_BASE_URL=",
        "AGENT_MEMORY_STORE_ID=",
        "AGENT_MEMORY_API_KEY=",
        "# Optional bridge defaults",
        "AGENT_MEMORY_OWNER_ID=",
        "AGENT_MEMORY_NAMESPACE_ID=",
        "AGENT_MEMORY_AGENT_ID=shared-agent",
        "",
      ].join("\n"),
      { mode: 0o600, flag: "wx" },
    );
    await chmod(path, 0o600);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export function claudeDesktopBridge(
  nodePath: string,
  serverPath: string,
  environmentPath: string,
): JsonObject {
  return {
    command: nodePath,
    args: [`--env-file=${environmentPath}`, serverPath],
    env: { [managedMarker]: "1" },
  };
}

function isManagedBridge(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const env = (value as JsonObject).env;
  return Boolean(
    env &&
    typeof env === "object" &&
    !Array.isArray(env) &&
    (env as JsonObject)[managedMarker] === "1",
  );
}

function serverMap(document: JsonObject): JsonObject {
  if (document.mcpServers === undefined) return {};
  if (!document.mcpServers || typeof document.mcpServers !== "object" || Array.isArray(document.mcpServers)) {
    throw new Error("Claude Desktop mcpServers must be a JSON object");
  }
  return document.mcpServers as JsonObject;
}

export type ClaudeDesktopInstallResult = {
  configPath: string;
  serverName: string;
  changed: boolean;
  createdEnvironment: boolean;
  captureMode: "best-effort";
  retryQueue: false;
};

export async function installClaudeDesktopBridge(
  projectRoot: string,
  configPath: string,
  nodePath: string,
  serverPath: string,
): Promise<ClaudeDesktopInstallResult> {
  const document = await readJson(configPath);
  const servers = serverMap(document);
  const existing = servers[claudeDesktopServerName];
  if (existing !== undefined && !isManagedBridge(existing)) {
    throw new Error(
      `Claude Desktop server ${claudeDesktopServerName} already exists and is not managed by ram-capture`,
    );
  }

  const environmentPath = join(projectRoot, ".env");
  const bridge = claudeDesktopBridge(nodePath, serverPath, environmentPath);
  const changed = JSON.stringify(existing) !== JSON.stringify(bridge);
  if (changed) {
    await writeJsonAtomic(configPath, {
      ...document,
      mcpServers: { ...servers, [claudeDesktopServerName]: bridge },
    });
  }
  const createdEnvironment = await ensureEnvironment(projectRoot);
  await ensureLine(join(projectRoot, ".gitignore"), ".env");

  return {
    configPath,
    serverName: claudeDesktopServerName,
    changed,
    createdEnvironment,
    captureMode: "best-effort",
    retryQueue: false,
  };
}

export async function claudeDesktopBridgeStatus(configPath: string): Promise<{
  configPath: string;
  serverName: string;
  installed: boolean;
  managed: boolean;
  captureMode: "best-effort";
  retryQueue: false;
}> {
  const existing = serverMap(await readJson(configPath))[claudeDesktopServerName];
  return {
    configPath,
    serverName: claudeDesktopServerName,
    installed: existing !== undefined,
    managed: isManagedBridge(existing),
    captureMode: "best-effort",
    retryQueue: false,
  };
}

export async function uninstallClaudeDesktopBridge(configPath: string): Promise<{
  configPath: string;
  serverName: string;
  changed: boolean;
}> {
  const document = await readJson(configPath);
  const servers = serverMap(document);
  const existing = servers[claudeDesktopServerName];
  if (existing === undefined) {
    return { configPath, serverName: claudeDesktopServerName, changed: false };
  }
  if (!isManagedBridge(existing)) {
    throw new Error(
      `Refusing to remove Claude Desktop server ${claudeDesktopServerName} because it is not managed by ram-capture`,
    );
  }
  const remaining = Object.fromEntries(
    Object.entries(servers).filter(([name]) => name !== claudeDesktopServerName),
  );
  await writeJsonAtomic(configPath, { ...document, mcpServers: remaining });
  return { configPath, serverName: claudeDesktopServerName, changed: true };
}
