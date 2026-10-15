import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureHookStatus,
  configureCaptureProject,
  hasCaptureHooks,
  installCapture,
  removeCaptureHooks,
  uninstallCapture,
} from "../src/capture-install.js";

test("plugin configuration creates project files without installing project hooks", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-capture-plugin-configure-"));
  try {
    const result = await configureCaptureProject(project);

    assert.equal(result.createdCaptureConfig, true);
    assert.equal(result.createdEnvironment, true);
    assert.equal(JSON.parse(await readFile(join(project, ".memory-capture.json"), "utf8")).enabled, true);
    await assert.rejects(readFile(join(project, ".codex", "hooks.json")), { code: "ENOENT" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("installer preserves existing hooks and is idempotent", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-capture-install-"));
  const hooksPath = join(project, ".codex", "hooks.json");
  const existingHandler = {
    type: "command",
    command: "./existing-hook",
    statusMessage: "Existing hook",
  };
  try {
    await mkdir(join(project, ".codex"));
    await writeFile(
      hooksPath,
      JSON.stringify({ hooks: { Stop: [{ hooks: [existingHandler] }] } }),
    );

    const first = await installCapture(project, "/usr/bin/node", "/opt/ram capture/cli.js");
    const firstDocument = JSON.parse(await readFile(hooksPath, "utf8"));
    await installCapture(project, "/usr/bin/node", "/opt/ram capture/cli.js");
    const secondDocument = JSON.parse(await readFile(hooksPath, "utf8"));

    assert.equal(first.createdCaptureConfig, true);
    assert.equal(first.createdEnvironment, true);
    assert.equal(hasCaptureHooks(firstDocument), true);
    assert.deepEqual(firstDocument, secondDocument);
    assert(
      firstDocument.hooks.Stop.some((group: any) =>
        group.hooks.some((handler: any) => handler.statusMessage === "Existing hook"),
      ),
    );
    assert.equal(
      firstDocument.hooks.Stop.filter((group: any) =>
        group.hooks.some((handler: any) => handler.statusMessage === captureHookStatus),
      ).length,
      1,
    );
    assert.match(firstDocument.hooks.Stop.at(-1).hooks[0].command, /'\/opt\/ram capture\/cli\.js'/);
    assert.match(await readFile(join(project, ".gitignore"), "utf8"), /^\.memory-capture\/\n\.env\n$/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("installer never overwrites existing project configuration or credentials", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-capture-existing-"));
  try {
    await writeFile(join(project, ".memory-capture.json"), '{"enabled":false,"namespace":"kept"}\n');
    await writeFile(join(project, ".env"), "EXISTING=kept\n");

    const result = await installCapture(project, "/usr/bin/node", "/opt/capture-cli.js");

    assert.equal(result.createdCaptureConfig, false);
    assert.equal(result.createdEnvironment, false);
    assert.equal(await readFile(join(project, ".memory-capture.json"), "utf8"), '{"enabled":false,"namespace":"kept"}\n');
    assert.equal(await readFile(join(project, ".env"), "utf8"), "EXISTING=kept\n");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("generated project namespaces satisfy the capture identifier schema", async () => {
  const parent = await mkdtemp(join(tmpdir(), "ram-capture-namespace-"));
  const project = join(parent, "My project_with spaces");
  try {
    await mkdir(project);
    await installCapture(project, "/usr/bin/node", "/opt/capture-cli.js");
    const config = JSON.parse(await readFile(join(project, ".memory-capture.json"), "utf8"));
    assert.equal(config.namespace, "My-project-with-spaces");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("uninstall removes only capture handlers and preserves local data", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-capture-uninstall-"));
  try {
    await installCapture(project, "/usr/bin/node", "/opt/capture-cli.js");
    const hooksPath = join(project, ".codex", "hooks.json");
    const document = JSON.parse(await readFile(hooksPath, "utf8"));
    document.hooks.Stop[0].hooks.push({ type: "command", command: "./keep-me" });
    await writeFile(hooksPath, JSON.stringify(document));
    await mkdir(join(project, ".memory-capture", "queue"), { recursive: true });
    await writeFile(join(project, ".memory-capture", "queue", "queued.json"), "{}");

    const result = await uninstallCapture(project);
    const remaining = JSON.parse(await readFile(hooksPath, "utf8"));

    assert.equal(result.changed, true);
    assert.equal(hasCaptureHooks(remaining), false);
    assert.deepEqual(remaining.hooks.Stop[0].hooks, [{ type: "command", command: "./keep-me" }]);
    assert.equal(JSON.parse(await readFile(join(project, ".memory-capture.json"), "utf8")).enabled, true);
    assert.equal(await readFile(join(project, ".memory-capture", "queue", "queued.json"), "utf8"), "{}");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("legacy capture shell handlers are migrated instead of duplicated", () => {
  const legacy = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "zsh scripts/capture.sh hook codex" }] }],
    },
  };
  const removed = removeCaptureHooks(legacy);
  assert.deepEqual(removed, {});
});

test("CLI installs and diagnoses a configured project without network access", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-capture-cli-"));
  const cli = fileURLToPath(new URL("../src/capture-cli.js", import.meta.url));
  try {
    const install = spawnSync(process.execPath, [cli, "install", "--project", project], {
      encoding: "utf8",
    });
    assert.equal(install.status, 0, install.stderr);
    assert.equal(JSON.parse(install.stdout).projectRoot, project);

    await writeFile(
      join(project, ".env"),
      [
        "AGENT_MEMORY_BASE_URL=https://memory.example.test",
        "AGENT_MEMORY_STORE_ID=store-1",
        "AGENT_MEMORY_API_KEY=test-only",
        "",
      ].join("\n"),
    );
    const doctor = spawnSync(process.execPath, [cli, "doctor", "--project", project], {
      encoding: "utf8",
    });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.deepEqual(JSON.parse(doctor.stdout).issues, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("CLI configures and diagnoses a plugin-managed project without project hooks", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-capture-plugin-cli-"));
  const cli = fileURLToPath(new URL("../src/capture-cli.js", import.meta.url));
  try {
    const configure = spawnSync(process.execPath, [cli, "configure", "--project", project], {
      encoding: "utf8",
    });
    assert.equal(configure.status, 0, configure.stderr);

    await writeFile(
      join(project, ".env"),
      [
        "AGENT_MEMORY_BASE_URL=https://memory.example.test",
        "AGENT_MEMORY_STORE_ID=store-1",
        "AGENT_MEMORY_API_KEY=test-only",
        "",
      ].join("\n"),
    );
    const doctor = spawnSync(process.execPath, [cli, "doctor", "--plugin", "--project", project], {
      encoding: "utf8",
    });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).hookSource, "plugin");
    await assert.rejects(readFile(join(project, ".codex", "hooks.json")), { code: "ENOENT" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
