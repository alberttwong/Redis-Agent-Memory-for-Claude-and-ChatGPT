import { AgentMemory } from "@redis-iris/agent-memory";
import { loadConfig, type AppConfig } from "./config.js";
import { MemoryGateway } from "./memory.js";
import { MemorySetup, memoryConfigPath, readMemorySettings } from "./memory-setup.js";
import { loadProjectGuardrails } from "./privacy.js";
import { createServer } from "./server.js";

import { Telemetry } from "./telemetry.js";

function connect(config: AppConfig) {
  const client = new AgentMemory({ serverURL: config.baseUrl, storeId: config.storeId, apiKey: config.apiKey });
  return new MemoryGateway(client, config);
}

export function createClaudePlugin(configPath = memoryConfigPath(), gatewayFor: (config: AppConfig) => MemoryGateway = connect, telemetry = new Telemetry("claude-plugin")) {
  const setup = new MemorySetup(configPath);
  const gateway = new Proxy({} as MemoryGateway, {
    get(_target, property) {
      return async (...args: unknown[]) => {
        const saved = await readMemorySettings(configPath);
        let config;
        try { config = loadConfig({ ...process.env, ...saved }); }
        catch { throw new Error("Redis is not configured. Call memory_setup and open its local browser form, then retry this tool."); }
        const instance = gatewayFor(config);
        return Reflect.apply(Reflect.get(instance, property), instance, args);
      };
    },
  });
  const server = createServer(gateway, loadProjectGuardrails(process.env.MEMORY_CAPTURE_PROJECT_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()), telemetry);
  server.registerTool("memory_setup", {
    title: "Set up Redis Memory",
    description: "Create a local browser form to configure the Redis URL, store ID, and API key without sharing credentials in chat. Also use to update connection settings.",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async () => {
    const link = await telemetry.observe("memory_setup", () => setup.open());
    return { content: [{ type: "text", text: JSON.stringify(link) }], structuredContent: link };
  });
  server.server.onclose = () => { setup.close(); void telemetry.shutdown(); };
  return server;
}

// A separate entry file lets tests import the factory without starting stdio.
