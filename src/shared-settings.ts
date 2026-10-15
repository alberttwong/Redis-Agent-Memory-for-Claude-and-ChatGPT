import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";

export const memorySettingKeys = [
  "AGENT_MEMORY_BASE_URL", "AGENT_MEMORY_STORE_ID", "AGENT_MEMORY_API_KEY",
  "AGENT_MEMORY_OWNER_ID", "AGENT_MEMORY_NAMESPACE_ID", "AGENT_MEMORY_NAMESPACE", "AGENT_MEMORY_AGENT_ID",
] as const;
const credentials = memorySettingKeys.slice(0, 3);
const parseProjectEnv = (text: string): Record<string, string> => Object.fromEntries(
  Object.entries(parseEnv(text)).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

export function sharedSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.AGENT_MEMORY_SHARED_SETTINGS_FILE || join(homedir(), ".config", "redis-agent-memory", "shared.json");
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Could not read Redis settings file: ${path}`);
  }
}

export async function loadMemoryEnvironment(projectRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const projectEnvPath = join(projectRoot, ".env");
  const sharedPath = sharedSettingsPath(env);
  const [projectText, sharedText] = await Promise.all([readOptional(projectEnvPath), readOptional(sharedPath)]);
  let shared: Record<string, string> = {};
  let project: Record<string, string> = {};
  try {
    if (projectText !== undefined) project = parseProjectEnv(projectText);
    if (sharedText !== undefined) {
      const parsed = JSON.parse(sharedText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      for (const key of memorySettingKeys) {
        if (typeof parsed[key] === "string") shared[key] = parsed[key];
      }
    }
  } catch { throw new Error("Invalid Redis settings file. Check the project .env or shared settings JSON locally."); }
  const sources: Record<string, string> = {};
  for (const key of memorySettingKeys) {
    // Empty installer templates should not shadow configured shared credentials.
    const source = env[key]?.trim() ? "environment" : project[key]?.trim() ? "project" : shared[key]?.trim() ? "shared" : "missing";
    if (source === "project") env[key] = project[key];
    else if (source === "shared") env[key] = shared[key];
    if (credentials.includes(key)) sources[key] = source;
  }
  // Preserve the old project dotenv behavior for non-Redis options such as
  // MEMORY_CAPTURE_OWNER_ID; never import arbitrary keys from the shared file.
  for (const [key, value] of Object.entries(project)) {
    if (!(memorySettingKeys as readonly string[]).includes(key) && env[key] === undefined) env[key] = value;
  }
  return { projectEnvPath, projectEnvExists: projectText !== undefined, sharedSettingsPath: sharedPath,
    sharedSettingsExists: sharedText !== undefined, credentialSources: sources };
}

export async function shareProjectSettings(projectRoot: string, env: NodeJS.ProcessEnv = process.env, replace = false) {
  const text = await readOptional(join(projectRoot, ".env"));
  if (text === undefined) throw new Error("Project .env is missing. Configure it locally before sharing settings.");
  let project: Record<string, string>;
  try { project = parseProjectEnv(text); } catch { throw new Error("Could not parse the project .env. Check it locally."); }
  const values = Object.fromEntries(memorySettingKeys.filter((key) => project[key]?.trim()).map((key) => [key, project[key]]));
  for (const key of credentials) {
    if (!values[key]?.trim()) throw new Error(`Project .env is missing ${key}; shared settings were not changed.`);
  }
  try {
    const url = new URL(values.AGENT_MEMORY_BASE_URL);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch { throw new Error("Project AGENT_MEMORY_BASE_URL must be an HTTPS URL without embedded credentials."); }
  const path = sharedSettingsPath(env);
  const contents = `${JSON.stringify(values, null, 2)}\n`;
  const existing = await readOptional(path);
  if (existing !== undefined && !replace) {
    let same = false;
    try { same = JSON.stringify(JSON.parse(existing)) === JSON.stringify(values); } catch {}
    if (same) return { sharedSettingsPath: path, saved: false, keys: Object.keys(values) };
    throw new Error("Shared settings already exist. Use share-settings --replace to overwrite them intentionally.");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (existing === undefined) {
    // Exclusive creation prevents a concurrent first-time setup from being overwritten.
    await writeFile(path, contents, { mode: 0o600, flag: "wx" });
  } else {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  return { sharedSettingsPath: path, saved: true, keys: Object.keys(values) };
}
