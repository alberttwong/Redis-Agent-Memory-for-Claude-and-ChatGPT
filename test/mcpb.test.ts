import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const manifestPath = join(process.cwd(), "mcpb", "manifest.json");
const packagePath = join(process.cwd(), "package.json");

test("MCPB manifest packages the bridge with secure user configuration", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const packageDocument = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(manifest.manifest_version, "0.3");
  assert.equal(manifest.version, packageDocument.version);
  assert.equal(manifest.server.type, "node");
  assert.equal(manifest.server.entry_point, "server/index.js");
  assert.deepEqual(manifest.compatibility.platforms, ["darwin", "win32"]);
  assert.equal(manifest.user_config.api_key.sensitive, true);
  assert.equal(manifest.user_config.api_key.required, true);
  assert.equal(manifest.server.mcp_config.env.AGENT_MEMORY_API_KEY, "${user_config.api_key}");
  assert.equal(JSON.stringify(manifest).includes("AGENT_MEMORY_API_KEY="), false);
  assert.deepEqual(
    manifest.tools.map((tool: { name: string }) => tool.name),
    [
      "memory_health",
      "memory_append",
      "memory_get_session",
      "memory_search",
      "checkpoint_save",
      "resume_context",
      "feedback_submit",
    ],
  );
});
