import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const { version } = await readJson(join(root, "package.json"));
const catalog = await readJson(join(root, ".claude-plugin", "marketplace.json"));
assert.ok(catalog.name && catalog.owner?.name, "Claude marketplace needs a name and owner");
assert.ok(catalog.plugins?.length, "Claude marketplace must list an installable plugin");
for (const entry of catalog.plugins) {
  assert.equal(typeof entry.source, "string", "Claude local sources use a relative path string");
  assert.ok(entry.source.startsWith("./") && !entry.source.split("/").includes(".."));
  const pluginRoot = join(root, entry.source);
  const plugin = await readJson(join(pluginRoot, ".claude-plugin", "plugin.json"));
  assert.equal(entry.name, plugin.name);
  assert.equal(entry.version, version);
  assert.equal(plugin.version, version);
  assert.equal(plugin.mcpServers,
    `https://github.com/alberttwong/redis-agent-memory-mcp/releases/download/v${version}/redis-agent-memory-${version}.mcpb`,
    "Claude plugin must reference the versioned release bundle, not an untracked build directory");
  await access(join(pluginRoot, "skills", "use-redis-memory", "SKILL.md"));
}
process.stdout.write("Claude marketplace catalog, plugin paths, and release bundle reference are valid.\n");
