import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const catalog = await readJson(join(root, ".claude-plugin", "marketplace.json"));
assert.ok(catalog.name && catalog.owner?.name, "Claude marketplace needs a name and owner");
assert.ok(catalog.plugins?.length, "Claude marketplace must list an installable plugin");
for (const entry of catalog.plugins) {
  assert.equal(typeof entry.source, "string", "Claude local sources use a relative path string");
  assert.ok(entry.source.startsWith("./") && !entry.source.split("/").includes(".."));
  const pluginRoot = join(root, entry.source);
  const plugin = await readJson(join(pluginRoot, ".claude-plugin", "plugin.json"));
  assert.equal(entry.name, plugin.name);
  // Claude plugin revisions are independent of the root package release.
  assert.equal(entry.version, plugin.version);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  const server = plugin.mcpServers?.["redis-agent-memory"];
  assert.equal(server?.command, "node");
  assert.deepEqual(server.args, ["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"],
    "Claude must launch the packaged server using its supported plugin root variable");
  await access(join(pluginRoot, "server", "index.mjs"));
  await access(join(pluginRoot, "server", "capture-cli.mjs"));
  const hooks = await readJson(join(pluginRoot, "hooks", "hooks.json"));
  for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact", "Stop", "PostToolUseFailure", "SubagentStart", "SubagentStop", "Notification", "TaskCompleted", "SessionEnd"]) {
    const handler = hooks.hooks?.[event]?.[0]?.hooks?.[0];
    assert.equal(handler?.type, "command");
    assert.equal(handler.command, 'node "${CLAUDE_PLUGIN_ROOT}/server/capture-cli.mjs" hook claude --project "${CLAUDE_PROJECT_DIR}"');
  }
  await access(join(pluginRoot, "skills", "setup-redis-memory", "SKILL.md"));
  await access(join(pluginRoot, "skills", "use-redis-memory", "SKILL.md"));
}
process.stdout.write("Claude marketplace catalog, plugin paths, and packaged runtime are valid.\n");
