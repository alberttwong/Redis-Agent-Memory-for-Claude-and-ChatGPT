import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { unzipSync } from "fflate";

const root = resolve(import.meta.dirname, "..");
const packageDocument = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const localArchive = unzipSync(await readFile(join(root, "build", `redis-agent-memory-chatgpt-local-${packageDocument.version}.zip`)));
const remoteArchive = unzipSync(await readFile(join(root, "build", "redis-agent-memory-chatgpt-remote-test.zip")));
const desktopArchive = unzipSync(await readFile(join(root, "build", `redis-agent-memory-chatgpt-desktop-${packageDocument.version}.zip`)));
const desktopMarketplace = JSON.parse(new TextDecoder().decode(desktopArchive[".agents/plugins/marketplace.json"]));
const desktopPluginPath = desktopMarketplace.plugins[0].source.path.replace(/^\.\//, "");
for (const [name, contents] of Object.entries(localArchive)) {
  assert.deepEqual(desktopArchive[`${desktopPluginPath}/${name}`], contents, `Desktop marketplace plugin is missing or differs: ${name}`);
}

for (const name of ["plugin.json", "package.json", "mcp.json", "hooks/hooks.json", "server/index.js", "server/capture-cli.js", "skills/setup-redis-memory/SKILL.md"]) {
  assert(localArchive[name], `Local plugin is missing ${name}`);
}
assert.equal(Object.keys(remoteArchive).some((name) => name.startsWith("hooks/") || name.startsWith("server/")), false);
assert.equal(
  JSON.parse(new TextDecoder().decode(remoteArchive["mcp.json"])).mcpServers["redis-agent-memory"].url,
  "https://memory.example.test/mcp",
);

const installed = await mkdtemp(join(tmpdir(), "ram-plugin-installed-"));
const project = await mkdtemp(join(tmpdir(), "ram-plugin-hook-"));
try {
  for (const [name, contents] of Object.entries(desktopArchive)) {
    const path = join(installed, name);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, contents);
  }
  async function smokePlugin(pluginDirectory) {
    const server = join(pluginDirectory, "server", "index.js");
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], stderr: "pipe" });
    const client = new Client({ name: "chatgpt-plugin-smoke-test", version: "0.1.1" });
    try {
      await client.connect(transport);
      const result = await client.listTools();
      assert.deepEqual(result.tools.map((tool) => tool.name).sort(), [
        "checkpoint_save",
        "memory_append",
        "memory_get_session",
        "memory_health",
        "memory_search",
        "resume_context",
      ]);
    } finally {
      await client.close();
    }
    const hook = spawnSync(process.execPath, [
      join(pluginDirectory, "server", "capture-cli.js"),
      "hook",
      "codex",
      "--project",
      project,
    ], {
      encoding: "utf8",
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "smoke" }),
    });
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stdout, "{}\n");
    assert.equal(hook.stderr, "");
  }
  await smokePlugin(join(installed, desktopPluginPath));

  // Reproduce a Git marketplace snapshot: only the catalog and tracked plugin,
  // with no build/, node_modules/, npm install, or compilation on the target.
  const checkout = join(installed, "fresh repository");
  await cp(join(root, ".agents"), join(checkout, ".agents"), { recursive: true });
  const repositoryCatalog = JSON.parse(await readFile(join(checkout, ".agents/plugins/marketplace.json"), "utf8"));
  const repositoryPath = repositoryCatalog.plugins[0].source.path;
  await cp(join(root, repositoryPath), join(checkout, repositoryPath), { recursive: true });
  await assert.rejects(access(join(checkout, "build")));
  await assert.rejects(access(join(checkout, "node_modules")));
  for (const name of ["server/index.js", "server/capture-cli.js"]) {
    assert.deepEqual(await readFile(join(checkout, repositoryPath, name)), Buffer.from(localArchive[name]),
      `Repository runtime and release archive differ: ${name}`);
  }
  await smokePlugin(join(checkout, repositoryPath));

} finally {
  await rm(installed, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
}

process.stdout.write("ChatGPT repository marketplace, release archives, MCP tools, and hooks passed smoke tests.\n");
