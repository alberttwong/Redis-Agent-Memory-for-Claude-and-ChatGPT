#!/usr/bin/env node
import { AgentMemory } from "@redis-iris/agent-memory";
import { loadConfig } from "./config.js";
import { MemoryGateway } from "./memory.js";
import { runServer } from "./server.js";

async function main() {
  const config = loadConfig();
  const client = new AgentMemory({
    serverURL: config.baseUrl,
    storeId: config.storeId,
    apiKey: config.apiKey,
  });
  await runServer(new MemoryGateway(client, config));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
