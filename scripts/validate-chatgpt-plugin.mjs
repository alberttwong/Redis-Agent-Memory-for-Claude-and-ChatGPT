import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";

const pluginSchema = z.object({
  $schema: z.literal("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  description: z.string().min(1),
  extensions: z.object({
    "com.openai": z.object({
      requires_local_executor: z.boolean().optional(),
      hooks: z.string().startsWith("./").optional(),
      onboardingSkill: z.string().startsWith("./").optional(),
      interface: z.object({
        displayName: z.string().min(1),
        shortDescription: z.string().min(1),
        longDescription: z.string().min(1),
        developerName: z.string().min(1),
        category: z.string().min(1),
      }),
    }),
  }),
}).passthrough();

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDocument = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

export async function validateChatGptPluginSources() {
  const localRoot = join(root, "plugins", "redis-agent-memory");
  const remoteRoot = join(root, "plugins", "redis-agent-memory-remote");
  const local = pluginSchema.parse(JSON.parse(await readFile(join(localRoot, "plugin.json"), "utf8")));
  const remote = pluginSchema.parse(JSON.parse(await readFile(join(remoteRoot, "plugin.json"), "utf8")));
  if (local.version !== packageDocument.version || remote.version !== packageDocument.version) {
    throw new Error("Plugin versions must match package.json");
  }
  const localExtension = local.extensions["com.openai"];
  if (
    !localExtension.requires_local_executor
    || localExtension.hooks !== "./hooks/hooks.json"
    || localExtension.onboardingSkill !== "./skills/setup-redis-memory/SKILL.md"
  ) {
    throw new Error("Local plugin must require desktop execution and declare its hooks and onboarding skill");
  }
  const mcp = JSON.parse(await readFile(join(localRoot, "mcp.json"), "utf8"));
  const server = mcp.mcpServers?.["redis-agent-memory"];
  if (mcp.$schema !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json" || server?.type !== "stdio") {
    throw new Error("Local plugin must declare a portable stdio MCP server");
  }
  if (server.command !== "node" || server.args?.[0] !== "${PLUGIN_ROOT}/server/index.js") {
    throw new Error("Local plugin MCP entry point is invalid");
  }
  if (!Array.isArray(server.env_vars) || !server.env_vars.includes("AGENT_MEMORY_API_KEY")) {
    throw new Error("Local plugin must forward Redis environment variables by name");
  }
  if (JSON.stringify(mcp).includes("mem1_") || JSON.stringify(mcp).includes("AGENT_MEMORY_API_KEY=")) {
    throw new Error("Plugin configuration must not contain credentials");
  }
  const hooks = JSON.parse(await readFile(join(localRoot, "hooks", "hooks.json"), "utf8"));
  for (const event of ["SessionStart", "UserPromptSubmit", "Stop"]) {
    const handler = hooks.hooks?.[event]?.[0]?.hooks?.[0];
    if (handler?.type !== "command" || !handler.command?.includes("${PLUGIN_ROOT}/server/capture-cli.js")) {
      throw new Error(`Missing packaged capture handler for ${event}`);
    }
  }
  const remoteExtension = remote.extensions["com.openai"];
  if (remoteExtension.hooks || remoteExtension.requires_local_executor) {
    throw new Error("Public remote profile must not declare hooks or local execution");
  }
  const marketplace = JSON.parse(await readFile(join(root, ".agents", "plugins", "marketplace.json"), "utf8"));
  if (marketplace.plugins?.[0]?.source?.path !== "./build/chatgpt-plugin/local") {
    throw new Error("Repository marketplace must point to the built local plugin");
  }
  return { local, remote };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await validateChatGptPluginSources();
  process.stdout.write("ChatGPT plugin source validation passes!\n");
}
