#!/usr/bin/env node
import { AgentMemory } from "@redis-iris/agent-memory";
import { loadConfig } from "./config.js";
import { MemoryGateway } from "./memory.js";
import { loadMemoryEnvironment } from "./shared-settings.js";
import { loadProjectGuardrails } from "./privacy.js";
import { runServer } from "./server.js";

import { createTelemetry, installTelemetryLifecycle, Telemetry } from "./telemetry.js";

let telemetry = new Telemetry("mcp");

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
  await loadMemoryEnvironment(process.env.MEMORY_CAPTURE_PROJECT_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  telemetry = createTelemetry("mcp");
  installTelemetryLifecycle(telemetry);
  await runServer(lazyGateway(), loadProjectGuardrails(process.env.MEMORY_CAPTURE_PROJECT_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()), telemetry);
}

main().catch(async (error: unknown) => {
  telemetry.failure("startup", error);
  await telemetry.shutdown();
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
