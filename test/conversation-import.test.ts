import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { enqueueImport, planChatGptImport, planClaudeImport } from "../src/claude-import.js";

const options = { ownerId: "test-owner", namespace: "test-project" };

test("Claude conversation exports produce deterministic, filterable records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ram-claude-import-"));
  const input = join(directory, "conversations.json");
  try {
    await writeFile(input, JSON.stringify([{
      uuid: "conversation-1",
      name: "Checkout retries",
      chat_messages: [
        { uuid: "message-1", sender: "human", created_at: "2026-01-01T00:00:00Z", text: "Retry checkout" },
        { uuid: "message-2", sender: "assistant", created_at: "2026-01-02T00:00:00Z", text: "Use backoff" },
      ],
    }]));
    const first = await planClaudeImport(input, {
      ...options,
      conversation: "checkout",
      after: new Date("2026-01-02T00:00:00Z"),
    });
    const second = await planClaudeImport(input, {
      ...options,
      conversation: "checkout",
      after: new Date("2026-01-02T00:00:00Z"),
    });
    assert.equal(first.records.length, 1);
    assert.equal(first.skipped, 1);
    assert.deepEqual(first.records, second.records);
    assert.equal(JSON.parse(first.records[0].text).role, "ASSISTANT");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ChatGPT data exports preserve roles, timestamps, and conversation identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ram-chatgpt-import-"));
  const input = join(directory, "conversations.json");
  try {
    await writeFile(input, JSON.stringify([{
      id: "chat-1",
      title: "Redis design",
      mapping: {
        first: { id: "first", message: {
          id: "message-1", author: { role: "user" }, create_time: 1_767_225_600,
          content: { content_type: "text", parts: ["Store this decision"] },
        } },
        second: { id: "second", message: {
          id: "message-2", author: { role: "assistant" }, create_time: 1_767_225_601,
          content: { content_type: "text", parts: ["Use deterministic IDs"] },
        } },
      },
    }]));
    const plan = await planChatGptImport(input, options);
    assert.equal(plan.conversations, 1);
    assert.equal(plan.records.length, 2);
    assert.deepEqual(plan.records.map((record) => JSON.parse(record.text).role), ["USER", "ASSISTANT"]);
    assert(plan.records.every((record) => record.session_id.startsWith("chatgpt-")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ChatGPT copied memory text can be previewed without an export archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ram-chatgpt-memory-"));
  const input = join(directory, "memory.md");
  try {
    await writeFile(input, "- Prefers concise implementation notes\n- Uses TypeScript\n");
    const plan = await planChatGptImport(input, options);
    assert.equal(plan.records.length, 2);
    assert.equal(JSON.parse(plan.records[0].text).conversationTitle, "ChatGPT memory");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ZIP and memory-text imports redact credentials and deduplicate queued records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ram-export-import-"));
  const input = join(directory, "claude-export.zip");
  const queue = join(directory, "queue");
  try {
    const memory = "[2026-01-03] - Never expose sk-ant-secret-value\n- Prefer TypeScript\n";
    await writeFile(input, zipSync({ "export/memories.md": strToU8(memory) }));
    const plan = await planClaudeImport(input, options);
    assert.equal(plan.records.length, 2);
    assert(!plan.records.some((record) => record.text.includes("sk-ant-secret-value")));
    assert.equal((await enqueueImport(queue, plan.records)).enqueued, 2);
    assert.deepEqual(await enqueueImport(queue, plan.records), { enqueued: 0, alreadyPending: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI previews by default and preserves write attempts for retry", async () => {
  const project = await mkdtemp(join(tmpdir(), "ram-import-cli-"));
  const input = join(project, "memories.md");
  const cli = fileURLToPath(new URL("../src/capture-cli.js", import.meta.url));
  const environment: NodeJS.ProcessEnv = { ...process.env, AGENT_MEMORY_SHARED_SETTINGS_FILE: join(project, "missing-shared.json") };
  delete environment.AGENT_MEMORY_API_KEY;
  delete environment.AGENT_MEMORY_BASE_URL;
  delete environment.AGENT_MEMORY_STORE_ID;
  try {
    await writeFile(input, "- Use bounded exponential backoff\n");
    const dryRun = spawnSync(process.execPath, [cli, "import-claude", "--input", input, "--project", project], {
      encoding: "utf8", env: environment,
    });
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.equal(JSON.parse(dryRun.stdout).dryRun, true);
    assert.equal((await readdir(project)).includes(".memory-capture"), false);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const write = spawnSync(process.execPath, [cli, "import-claude", "--input", input, "--project", project, "--write"], {
        encoding: "utf8", env: environment,
      });
      assert.equal(write.status, 1);
      assert.match(write.stderr, /credentials are not configured/);
    }
    const queued = (await readdir(join(project, ".memory-capture", "queue"))).filter((name) => name.endsWith(".json"));
    assert.equal(queued.length, 1);

    const flush = spawnSync(process.execPath, [cli, "flush", "--project", project], {
      encoding: "utf8", env: environment,
    });
    assert.equal(flush.status, 1);
    assert.doesNotMatch(flush.stderr, /\.memory-capture\.json/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
