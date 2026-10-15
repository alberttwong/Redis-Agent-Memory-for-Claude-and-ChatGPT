#!/usr/bin/env node
import { AgentMemory } from "@redis-iris/agent-memory";
import { loadConfig } from "./config.js";
import { MemoryGateway } from "./memory.js";
import { runServer } from "./server.js";

function lazyGateway(): MemoryGateway {
  let gateway: MemoryGateway | undefined;
  const resolve = () => {
    if (gateway) return gateway;
    const config = loadConfig();
    const client = new AgentMemory({
      serverURL: config.baseUrl,
      storeId: config.storeId,
      apiKey: config.apiKey,
    });
    gateway = new MemoryGateway(client, config);
    return gateway;
  };
  return new Proxy({} as MemoryGateway, {
    get(_target, property) {
      const value = Reflect.get(resolve(), property);
      return typeof value === "function" ? value.bind(resolve()) : value;
    },
  });
}

async function main() {
  await runServer(lazyGateway());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
