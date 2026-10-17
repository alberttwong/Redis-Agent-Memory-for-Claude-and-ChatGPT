import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureConfigSchema, flush, type CapturedMemory, type CaptureTransport } from "../src/capture.js";
import { readDiagnostics, type RecallDiagnostic } from "../src/diagnostics.js";
import { checkMarker, queueCheck, verifyCheck } from "../src/memory-check.js";
import { recallPrompt, type PromptSearch } from "../src/prompt-recall.js";

const config = captureConfigSchema.parse({sessionCapture: false, ownerId: "person", namespace: "shared"});
const identity = {owner: "person", namespace: "shared", source: "codex"};
test("marker check survives outage, retries the same ID, and recalls across clients only in the same scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-check-"));
  const queue = join(root, ".memory-capture", "queue");
  const directory = join(root, ".memory-capture", "diagnostics");
  const memories = new Map<string, CapturedMemory>();
  let outage = true;
  const storage: CaptureTransport = { create: async batch => {
    // Lost acknowledgement after storage: retry must preserve IDs.
    batch.forEach(memory => memories.set(memory.id, memory));
    if (outage) throw new Error("server failed with private credentials");
    return {created: batch.map(memory => memory.id)};
  }, recall: async () => [] };
  const search: PromptSearch = async args => [...memories.values()].filter(memory => memory.owner_id === args.owner_id && memory.namespace === args.namespace);
  try {
    assert.equal((await readDiagnostics(directory, identity)).lastCapture.state, "unknown");
    const marker = checkMarker();
    const resolved = await queueCheck(config, root, "codex", queue, marker, []);
    const failed = await verifyCheck(config, resolved, marker, queue, storage, search, []);
    assert.equal(failed.ok, false);
    assert.equal(failed.delivery, "pending");
    assert.equal(failed.pending, 1);
    let diagnostics = await readDiagnostics(directory, identity);
    assert.equal(diagnostics.lastCapture.state, "observed");
    assert.equal(diagnostics.lastDelivery.state, "unknown");
    outage = false;
    assert.equal((await flush(queue, storage)).pending, 0);
    assert.equal(memories.size, 1);
    // Another client's configured scope resolves to the same project memories.
    const claudeScope = await import("../src/capture.js").then(({scope}) => scope(config, root, "claude", {hook_event_name: "SessionStart", session_id: "other-chat"}));
    const verified = await verifyCheck(config, claudeScope, marker, queue, storage, search, [], true);
    assert.equal(verified.ok, true);
    assert.equal(verified.delivery, "not-tested");
    assert.equal(verified.injection, "not-tested");
    assert.equal(verified.modelUse, "unknown");
    for (const wrong of [{...resolved, owner: "other"}, {...resolved, namespace: "other"}]) {
      assert.equal((await verifyCheck(config, wrong, marker, queue, storage, search, [], true)).ok, false);
    }
    diagnostics = await readDiagnostics(directory, identity);
    assert.equal(diagnostics.lastDelivery.state, "observed");
    assert.equal((await readDiagnostics(directory, {...identity, source: "claude"})).lastCapture.state, "unknown");
    const files = await readdir(directory);
    const metadata = (await Promise.all(files.map(file => readFile(join(directory, file), "utf8")))).join("");
    assert(!metadata.includes(marker) && !metadata.includes("credentials") && !metadata.includes('"text"'));
    await writeFile(join(directory, files[0]), "broken");
    assert(Object.values(await readDiagnostics(directory, identity)).some(value => typeof value === "object" && value && "state" in value && value.state === "unavailable"));
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("check respects disabled capture and redaction policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-check-policy-"));
  try {
    for (const override of [{enabled: false}, {guardrails: {capturePrompts: false}}, {guardrails: {customPatterns: ["ram-diagnostic"]}}]) {
      await assert.rejects(queueCheck(captureConfigSchema.parse({...config, ...override}), root, "codex", join(root, "queue"), checkMarker(), []), /blocked by capture policy/);
    }
    assert.throws(() => checkMarker("private conversation"), /requires/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("recall diagnostics expose counts, safe IDs, both truncations, empty and unavailable without content", async () => {
  const observations: RecallDiagnostic[] = [];
  const context = await recallPrompt(config, identity, "p".repeat(8000), async () => [
    {id: "memory-1", text: "private text ".repeat(1000)}, {id: "secret", text: "other"},
  ], ["secret"], value => observations.push(value));
  assert(context.length <= 5400);
  assert.deepEqual(observations[0], {outcome: "returned", attempted: true, count: 2, ids: ["memory-1"], context: "prepared", queryTruncated: true, contextTruncated: true});
  await recallPrompt(config, identity, "find prior retry decisions", async () => [], [], value => observations.push(value));
  await assert.rejects(recallPrompt(config, identity, "private prompt", async () => {throw new Error("secret");}, [], value => observations.push(value)));
  assert.equal(observations[1].outcome, "empty");
  assert.equal(observations[2].outcome, "unavailable");
  assert(!JSON.stringify(observations).includes("private"));
});

test("marker verification and recall diagnostics preserve legacy namespace fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "ram-check-legacy-"));
  const marker = checkMarker();
  const resolved = {owner: "person", namespace: "primary", legacyNamespaces: ["legacy"]};
  const storage: CaptureTransport = {create: async () => {throw new Error("verify must not write");}, recall: async () => []};
  try {
    for (const location of ["primary", "legacy"]) {
      const searched: string[] = [];
      const result = await verifyCheck(config, resolved, marker, join(root, "queue"), storage, async args => {
        searched.push(args.namespace);
        assert.equal(args.owner_id, "person");
        return args.namespace === location ? [{id: "legacy-marker", text: JSON.stringify({content: marker})}] : [];
      }, [], true);
      assert.equal(result.ok, true);
      assert.equal(result.recall.outcome, "returned");
      assert.deepEqual(result.recall.ids, ["legacy-marker"]);
      assert.deepEqual(searched, ["primary", "legacy"]);
    }
  } finally { await rm(root, {recursive: true, force: true}); }
});
