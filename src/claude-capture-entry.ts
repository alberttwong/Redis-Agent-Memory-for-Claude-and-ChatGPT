// The installed Claude plugin shares browser-form credentials with its hooks.
import { resolve } from "node:path";
import { memoryConfigPath, readMemorySettings } from "./memory-setup.js";
import { loadMemoryEnvironment, memorySettingKeys } from "./shared-settings.js";

try {
  const option = (name: string) => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing option value");
    return value;
  };
  const project = resolve(option("--project") ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  process.env.MEMORY_CAPTURE_PROJECT_ROOT = project;
  await loadMemoryEnvironment(project);
  const saved = await readMemorySettings(option("--settings") ?? memoryConfigPath());
  for (const key of memorySettingKeys) {
    if (!process.env[key]?.trim() && typeof saved[key] === "string" && saved[key]?.trim()) {
      process.env[key] = saved[key];
    }
  }
  await import("./capture-cli.js");
} catch {
  console.error("Redis capture: could not load configuration; run the setup-redis-memory skill again.");
  if ((process.argv[2] ?? "hook") === "hook") process.stdout.write("{}\n");
  else process.exitCode = 1;
}
