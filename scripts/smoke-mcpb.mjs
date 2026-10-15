import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { unzipSync } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "build", "mcpb", "server", "index.js");
await access(server);
const packageDocument = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const archive = unzipSync(await readFile(join(root, "build", `redis-agent-memory-${packageDocument.version}.mcpb`)));
assert.deepEqual(Object.keys(archive).sort(), ["README.md", "manifest.json", "server/index.js"]);
assert.equal(JSON.parse(new TextDecoder().decode(archive["manifest.json"])).name, "redis-agent-memory");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: {
    AGENT_MEMORY_BASE_URL: "https://memory.example.test",
    AGENT_MEMORY_STORE_ID: "smoke-test",
    AGENT_MEMORY_API_KEY: "test-only",
    AGENT_MEMORY_NAMESPACE: "smoke-test",
  },
  stderr: "pipe",
});
const client = new Client({ name: "mcpb-smoke-test", version: "0.1.4" });

try {
  await client.connect(transport);
  const result = await client.listTools();
  assert.deepEqual(
    result.tools.map((tool) => tool.name).sort(),
    [
      "checkpoint_save",
      "memory_append",
      "memory_get_session",
      "memory_health",
      "memory_search",
      "resume_context",
    ],
  );
  process.stdout.write("MCPB bundled server exposes all expected tools.\n");
} finally {
  await client.close();
}
