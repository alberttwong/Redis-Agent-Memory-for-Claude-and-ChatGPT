import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadMemoryEnvironment, shareProjectSettings } from "../src/shared-settings.js";

const dotenv = "AGENT_MEMORY_BASE_URL=https://memory.example.test\nAGENT_MEMORY_STORE_ID=store-one\nAGENT_MEMORY_API_KEY=secret-test-key\nOTHER_SECRET=keep-in-project\n";

test("sharing copies only Redis settings privately and requires explicit replacement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ram-share-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  await mkdir(project);
  await writeFile(join(project, ".env"), dotenv);
  const env = { AGENT_MEMORY_SHARED_SETTINGS_FILE: join(directory, "private", "shared.json") };
  const result = await shareProjectSettings(project, env);
  assert.equal(result.saved, true);
  assert.ok(!JSON.stringify(result).includes("secret-test-key"));
  const contents = await readFile(env.AGENT_MEMORY_SHARED_SETTINGS_FILE, "utf8");
  assert.ok(!contents.includes("OTHER_SECRET"));
  assert.ok(!contents.includes("keep-in-project"));
  assert.equal((await shareProjectSettings(project, env)).saved, false);
  if (process.platform !== "win32") assert.equal((await stat(env.AGENT_MEMORY_SHARED_SETTINGS_FILE)).mode & 0o777, 0o600);
  await writeFile(join(project, ".env"), dotenv.replace("store-one", "store-two"));
  await assert.rejects(shareProjectSettings(project, env), /--replace/);
  assert.equal(await readFile(env.AGENT_MEMORY_SHARED_SETTINGS_FILE, "utf8"), contents);
  await shareProjectSettings(project, env, true);
  assert.equal(JSON.parse(await readFile(env.AGENT_MEMORY_SHARED_SETTINGS_FILE, "utf8")).AGENT_MEMORY_STORE_ID, "store-two");
});

test("environment overrides project settings and blank templates fall back to shared defaults", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ram-precedence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const shared = join(directory, "shared.json");
  await writeFile(shared, JSON.stringify({ AGENT_MEMORY_BASE_URL: "https://shared.example.test", AGENT_MEMORY_STORE_ID: "shared-store", AGENT_MEMORY_API_KEY: "shared-key", OTHER_SECRET: "do-not-import" }));
  await writeFile(join(directory, ".env"), "AGENT_MEMORY_BASE_URL=\nAGENT_MEMORY_STORE_ID=project-store\nAGENT_MEMORY_API_KEY=project-key\nMEMORY_CAPTURE_OWNER_ID=local-owner\n");
  const env: NodeJS.ProcessEnv = { AGENT_MEMORY_SHARED_SETTINGS_FILE: shared, AGENT_MEMORY_API_KEY: "session-key" };
  const report = await loadMemoryEnvironment(directory, env);
  assert.equal(env.AGENT_MEMORY_BASE_URL, "https://shared.example.test");
  assert.equal(env.AGENT_MEMORY_STORE_ID, "project-store");
  assert.equal(env.AGENT_MEMORY_API_KEY, "session-key");
  assert.equal(env.MEMORY_CAPTURE_OWNER_ID, "local-owner");
  assert.equal(env.OTHER_SECRET, undefined);
  assert.deepEqual(report.credentialSources, { AGENT_MEMORY_BASE_URL: "shared", AGENT_MEMORY_STORE_ID: "project", AGENT_MEMORY_API_KEY: "environment" });
  assert.ok(!JSON.stringify(report).includes("session-key"));
});

test("a new Git worktree and separate checkout pass doctor using one shared settings file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ram-checkouts-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = join(directory, "original");
  const worktree = join(directory, "worktree");
  const checkout = join(directory, "checkout");
  await mkdir(original);
  const git = (args: string[]) => execFileSync("git", args, { cwd: original, stdio: "ignore" });
  git(["init"]);
  await writeFile(join(original, ".memory-capture.json"), '{"enabled":true,"namespace":"test-project"}\n');
  await writeFile(join(original, ".gitignore"), ".env\n");
  git(["add", "."]);
  git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  git(["worktree", "add", "--detach", worktree]);
  git(["clone", original, checkout]);
  await writeFile(join(original, ".env"), dotenv);
  const shared = join(directory, "private", "shared.json");
  const env = { PATH: process.env.PATH, AGENT_MEMORY_SHARED_SETTINGS_FILE: shared };
  const cli = fileURLToPath(new URL("../src/capture-cli.js", import.meta.url));
  const save = spawnSync(process.execPath, [cli, "share-settings", "--project", original], { env, encoding: "utf8" });
  assert.equal(save.status, 0, save.stderr);
  assert.ok(!save.stdout.includes("secret-test-key"));
  for (const project of [worktree, checkout]) {
    await assert.rejects(readFile(join(project, ".env")), { code: "ENOENT" });
    const doctor = spawnSync(process.execPath, [cli, "doctor", "--project", project, "--plugin"], { env, encoding: "utf8" });
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.environment.projectEnvExists, false);
    assert.equal(report.environment.credentialSources.AGENT_MEMORY_API_KEY, "shared");
    assert.ok(!doctor.stdout.includes("secret-test-key"));
  }
});
