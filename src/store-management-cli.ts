#!/usr/bin/env node
import { loadMemoryEnvironment } from "./shared-settings.js";
import { configureSummarization } from "./store-management.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(`Configure service-wide Redis Agent Memory summarization.
Usage: npm run memory:configure-summarization -- [--summarize-after 20] [--keep-most-recent 10]
Defaults: AGENT_MEMORY_SUMMARIZE_AFTER (20), AGENT_MEMORY_KEEP_MOST_RECENT (10).
Requires AGENT_MEMORY_STORE_ID, REDIS_CLOUD_API_KEY, REDIS_CLOUD_API_SECRET_KEY.
Reads the current project's .env and existing shared memory settings.
Management credentials are separate from the Agent Memory bearer token.
Changes apply to every client using this store.`);
    return;
  }
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    if (!["--summarize-after", "--keep-most-recent"].includes(name)) throw new Error(`Unknown option: ${name}`);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    if (flags.has(name)) throw new Error(`Duplicate option: ${name}`);
    flags.set(name, value);
  }
  await loadMemoryEnvironment(process.cwd());
  function count(flag: string, key: string, fallback: string) {
    const value = flags.get(flag) ?? process.env[key] ?? fallback;
    if (!/^\d+$/.test(value)) throw new Error(`${flag} must be a non-negative integer`);
    return Number(value);
  }
  const result = await configureSummarization({
    storeId: process.env.AGENT_MEMORY_STORE_ID?.trim() ?? "",
    apiKey: process.env.REDIS_CLOUD_API_KEY?.trim() ?? "",
    apiSecretKey: process.env.REDIS_CLOUD_API_SECRET_KEY?.trim() ?? "",
    threshold: count("--summarize-after", "AGENT_MEMORY_SUMMARIZE_AFTER", "20"),
    retainCount: count("--keep-most-recent", "AGENT_MEMORY_KEEP_MOST_RECENT", "10"),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Redis Cloud configuration failed");
  process.exitCode = 1;
});
