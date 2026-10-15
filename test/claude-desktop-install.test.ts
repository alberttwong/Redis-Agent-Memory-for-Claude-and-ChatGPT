import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  claudeDesktopBridgeStatus,
  claudeDesktopServerName,
  defaultClaudeDesktopConfigPath,
  installClaudeDesktopBridge,
  uninstallClaudeDesktopBridge,
} from "../src/claude-desktop-install.js";

test("Claude Desktop installer preserves existing configuration and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-claude-desktop-"));
  const project = join(root, "project");
  const configPath = join(root, "Claude", "claude_desktop_config.json");
  try {
    await mkdir(project);
    await mkdir(join(root, "Claude"));
    await writeFile(configPath, JSON.stringify({
      theme: "dark",
      mcpServers: { existing: { command: "keep-me" } },
    }));

    const first = await installClaudeDesktopBridge(
      project,
      configPath,
      "/usr/bin/node",
      "/opt/ram bridge/index.js",
    );
    const firstDocument = JSON.parse(await readFile(configPath, "utf8"));
    const second = await installClaudeDesktopBridge(
      project,
      configPath,
      "/usr/bin/node",
      "/opt/ram bridge/index.js",
    );
    const secondDocument = JSON.parse(await readFile(configPath, "utf8"));

    assert.equal(first.changed, true);
    assert.equal(first.createdEnvironment, true);
    assert.equal(second.changed, false);
    assert.equal(second.createdEnvironment, false);
    assert.deepEqual(firstDocument, secondDocument);
    assert.equal(firstDocument.theme, "dark");
    assert.deepEqual(firstDocument.mcpServers.existing, { command: "keep-me" });
    assert.deepEqual(firstDocument.mcpServers[claudeDesktopServerName], {
      command: "/usr/bin/node",
      args: [`--env-file=${join(project, ".env")}`, "/opt/ram bridge/index.js"],
      env: { REDIS_AGENT_MEMORY_MCP_MANAGED: "1" },
    });
    assert.match(await readFile(join(project, ".env"), "utf8"), /AGENT_MEMORY_API_KEY=/);
    assert.equal(await readFile(join(project, ".gitignore"), "utf8"), ".env\n");

    const status = await claudeDesktopBridgeStatus(configPath);
    assert.equal(status.installed, true);
    assert.equal(status.managed, true);
    assert.equal(status.captureMode, "best-effort");
    assert.equal(status.retryQueue, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude Desktop installer refuses to overwrite an unmanaged server", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-claude-conflict-"));
  const configPath = join(root, "claude_desktop_config.json");
  try {
    await writeFile(configPath, JSON.stringify({
      mcpServers: { [claudeDesktopServerName]: { command: "custom-server" } },
    }));
    await assert.rejects(
      installClaudeDesktopBridge(root, configPath, "/usr/bin/node", "/opt/index.js"),
      /not managed by ram-capture/,
    );
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
      mcpServers: { [claudeDesktopServerName]: { command: "custom-server" } },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude Desktop uninstall removes only the managed bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-claude-uninstall-"));
  const configPath = join(root, "claude_desktop_config.json");
  try {
    await installClaudeDesktopBridge(root, configPath, "/usr/bin/node", "/opt/index.js");
    const result = await uninstallClaudeDesktopBridge(configPath);
    const remaining = JSON.parse(await readFile(configPath, "utf8"));

    assert.equal(result.changed, true);
    assert.deepEqual(remaining, { mcpServers: {} });
    assert.match(await readFile(join(root, ".env"), "utf8"), /AGENT_MEMORY_BASE_URL=/);
    assert.equal((await uninstallClaudeDesktopBridge(configPath)).changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude Desktop default paths cover macOS and Windows", () => {
  assert.equal(
    defaultClaudeDesktopConfigPath("darwin", "/Users/test"),
    "/Users/test/Library/Application Support/Claude/claude_desktop_config.json",
  );
  assert.equal(
    defaultClaudeDesktopConfigPath("win32", "C:\\Users\\test", "C:\\Users\\test\\AppData\\Roaming"),
    "C:\\Users\\test\\AppData\\Roaming/Claude/claude_desktop_config.json",
  );
  assert.throws(() => defaultClaudeDesktopConfigPath("linux", "/home/test"), /macOS and Windows/);
});

test("CLI installs, diagnoses, reports, and removes the Claude Desktop bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-claude-cli-"));
  const project = join(root, "project");
  const configPath = join(root, "claude_desktop_config.json");
  const cli = fileURLToPath(new URL("../src/capture-cli.js", import.meta.url));
  try {
    await mkdir(project);
    const common = ["--claude-desktop", "--claude-config", configPath, "--project", project];
    const install = spawnSync(process.execPath, [cli, "install", ...common], { encoding: "utf8" });
    assert.equal(install.status, 0, install.stderr);
    assert.equal(JSON.parse(install.stdout).captureMode, "best-effort");

    await writeFile(join(project, ".env"), [
      "AGENT_MEMORY_BASE_URL=https://memory.example.test",
      "AGENT_MEMORY_STORE_ID=store-1",
      "AGENT_MEMORY_API_KEY=test-only",
      "",
    ].join("\n"));
    const doctor = spawnSync(process.execPath, [cli, "doctor", ...common], { encoding: "utf8" });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.deepEqual(JSON.parse(doctor.stdout).issues, []);

    const status = spawnSync(process.execPath, [cli, "status", ...common], { encoding: "utf8" });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).retryQueue, false);

    const flush = spawnSync(process.execPath, [cli, "flush", ...common], { encoding: "utf8" });
    assert.equal(flush.status, 1);
    assert.match(flush.stderr, /has no local retry queue/);

    const uninstall = spawnSync(process.execPath, [cli, "uninstall", ...common], { encoding: "utf8" });
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(JSON.parse(uninstall.stdout).changed, true);
    assert.match(await readFile(join(project, ".env"), "utf8"), /AGENT_MEMORY_API_KEY=test-only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
