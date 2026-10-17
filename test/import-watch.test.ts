import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportWatcher, type WatchImportOptions } from "../src/import-watch.js";

async function fixture(run: (options: WatchImportOptions) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ram-watch-test-"));
  try {
    await mkdir(join(root, "incoming", "claude"), { recursive: true });
    await mkdir(join(root, "incoming", "chatgpt"), { recursive: true });
    await run({ directory: join(root, "incoming"), stateDirectory: join(root, "state"),
      queue: join(root, "queue"), ownerId: "test-owner", namespace: "test-project", write: true, settleMs: 0 });
  } finally { await rm(root, { recursive: true, force: true }); }
}

const claude = (text: string) => JSON.stringify([{
  uuid: "claude-chat", name: "History", chat_messages: [{ uuid: "message", sender: "human", text }],
}]);
const chatgpt = JSON.stringify([{ id: "gpt-chat", title: "History", mapping: {
  first: { message: { id: "gpt-message", author: { role: "user" }, content: { parts: ["Remember this"] } } },
} }]);

test("watcher imports both providers, redacts, and remembers queued files across restarts", async () => {
  await fixture(async options => {
    await writeFile(join(options.directory, "claude", "history.json"), claude("password: topsecret"));
    await writeFile(join(options.directory, "chatgpt", "history.json"), chatgpt);
    const events = await new ImportWatcher().scan(options);
    assert.deepEqual(events.map(event => [event.provider, event.status, event.records]), [
      ["claude", "queued", 1], ["chatgpt", "queued", 1],
    ]);
    const files = (await readdir(options.queue)).filter(name => name.endsWith(".json"));
    assert.equal(files.length, 2);
    for (const file of files) {
      const raw = await readFile(join(options.queue, file), "utf8");
      assert(!raw.includes("topsecret"));
      const record = JSON.parse(raw).memories[0];
      assert.equal(record.owner_id, options.ownerId);
      assert.equal(record.namespace, options.namespace);
    }
    // Delivery may remove queue files. The persistent ledger must still prevent reimport.
    await rm(options.queue, { recursive: true });
    assert.deepEqual(await new ImportWatcher().scan(options), []);
  });
});

test("preview never queues or checkpoints; scope and changed contents are reprocessed", async () => {
  await fixture(async options => {
    const path = join(options.directory, "claude", "history.json");
    await writeFile(path, claude("First"));
    const watcher = new ImportWatcher();
    assert.equal((await watcher.scan({ ...options, write: false }))[0].status, "preview");
    await assert.rejects(readdir(options.queue), { code: "ENOENT" });
    await assert.rejects(readdir(options.stateDirectory), { code: "ENOENT" });
    assert.deepEqual(await watcher.scan({ ...options, write: false }), []);
    assert.equal((await watcher.scan(options))[0].status, "queued");
    await writeFile(path, claude("Changed"));
    assert.equal((await watcher.scan(options))[0].status, "queued");
    const changedScope = await watcher.scan({ ...options, namespace: "another-project" });
    assert.equal(changedScope[0].enqueued, 1);
  });
});

test("incomplete and invalid files do not block other exports and are retried after correction", async () => {
  await fixture(async options => {
    const folder = join(options.directory, "claude");
    await writeFile(join(folder, "broken.json"), "{private text");
    await writeFile(join(folder, "valid.json"), claude("Valid"));
    await writeFile(join(folder, "partial.zip.crdownload"), "unfinished");
    await symlink(join(folder, "valid.json"), join(folder, "link.json"));
    const watcher = new ImportWatcher();
    const events = await watcher.scan(options);
    assert.deepEqual(events.map(event => event.status), ["error", "queued"]);
    assert(!JSON.stringify(events).includes("private text"));
    await writeFile(join(folder, "broken.json"), claude("Corrected"));
    assert.equal((await watcher.scan(options))[0].status, "queued");
    await writeFile(join(folder, "recent.json"), claude("Still downloading"));
    await utimes(join(folder, "recent.json"), new Date(), new Date());
    assert.deepEqual(await watcher.scan({ ...options, settleMs: 60000 }), []);
  });
});

test("failed queue writes never checkpoint an export", async () => {
  await fixture(async options => {
    await writeFile(join(options.directory, "claude", "history.json"), claude("Retry me"));
    await writeFile(options.queue, "not a directory");
    assert.equal((await new ImportWatcher().scan(options))[0].status, "error");
    await assert.rejects(readdir(options.stateDirectory), { code: "ENOENT" });
    await rm(options.queue);
    assert.equal((await new ImportWatcher().scan(options))[0].status, "queued");
  });
});

test("CLI previews exports, queues on write, and reports pending delivery without credentials", async () => {
  await fixture(async options => {
    const path = join(options.directory, "claude", "history.json");
    await writeFile(path, claude("CLI import"));
    const past = new Date(Date.now() - 10000);
    await utimes(path, past, past);
    const cli = fileURLToPath(new URL("../src/capture-cli.js", import.meta.url));
    const env = { ...process.env, AGENT_MEMORY_API_KEY: "", AGENT_MEMORY_STORE_ID: "",
      AGENT_MEMORY_BASE_URL: "", AGENT_MEMORY_SHARED_SETTINGS_FILE: join(options.directory, "missing-settings.json") };
    const args = [cli, "watch-imports", "--project", options.directory, "--directory", options.directory,
      "--owner", options.ownerId, "--namespace", options.namespace, "--once"];
    const preview = spawnSync(process.execPath, args, { encoding: "utf8", env });
    assert.equal(preview.status, 0, preview.stderr);
    assert(preview.stdout.includes('"status":"preview"'));
    const write = spawnSync(process.execPath, [...args, "--write"], { encoding: "utf8", env });
    assert.equal(write.status, 1, write.stderr);
    assert(write.stdout.includes('"status":"queued"'));
    assert(write.stdout.includes('"delivery":"pending"'));
    const repeat = spawnSync(process.execPath, [...args, "--write"], { encoding: "utf8", env });
    assert.equal(repeat.status, 1, repeat.stderr);
    assert(!repeat.stdout.includes('"status":"queued"'));
    assert(repeat.stdout.includes('"delivery":"pending"'));
  });
});
