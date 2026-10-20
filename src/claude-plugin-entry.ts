import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClaudePlugin } from "./claude-plugin.js";

import { loadMemoryEnvironment } from "./shared-settings.js";
import { createTelemetry, installTelemetryLifecycle, Telemetry } from "./telemetry.js";

let telemetry = new Telemetry("claude-plugin");
async function main() {
  await loadMemoryEnvironment(process.env.MEMORY_CAPTURE_PROJECT_ROOT ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  telemetry = createTelemetry("claude-plugin");
  installTelemetryLifecycle(telemetry);
  await createClaudePlugin(undefined, undefined, telemetry).connect(new StdioServerTransport());
}
main().catch(async (error: unknown) => {
  telemetry.failure("startup", error);
  await telemetry.shutdown();
  console.error("Could not start the Redis Agent Memory plugin.");
  process.exitCode = 1;
});
