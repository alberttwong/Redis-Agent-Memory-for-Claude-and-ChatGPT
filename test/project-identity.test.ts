import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRemote, legacyProjectNamespace, projectIdentity, projectNamespace, recallNamespaces } from "../src/project-identity.js";
import { captureConfigSchema, makeEntry, scope } from "../src/capture.js";
import { recallPrompt } from "../src/prompt-recall.js";

const git = (root: string, ...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });

test("remote identity ignores transport and credentials while keeping repository and host distinct", () => {
  for (const remote of ["https://user:secret@EXAMPLE.com/team/repo.git?token=secret#fragment", "ssh://git@example.com:2222/team/repo.git", "git@example.com:team/repo.git", "git://example.com/team/repo/"]) {
    assert.equal(canonicalRemote(remote), "example.com/team/repo");
  }
  assert.equal(canonicalRemote("/local/repo.git"), undefined);
  assert.equal(canonicalRemote("file:///local/repo.git"), undefined);
  assert.notEqual(canonicalRemote("git@elsewhere.com:team/repo"), canonicalRemote("git@example.com:team/repo"));
  assert.notEqual(canonicalRemote("git@example.com:fork/repo"), canonicalRemote("git@example.com:team/repo"));
});

test("clones, nested paths and worktrees share remote scope with local compatibility and explicit isolation", () => {
  const temp = mkdtempSync(join(tmpdir(), "ram-identity-"));
  const main = join(temp, "main");
  const clone = join(temp, "different-name");
  const worktree = join(temp, "worktree");
  try {
    mkdirSync(main); mkdirSync(clone);
    git(main, "init"); git(clone, "init");
    git(main, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial");
    git(main, "remote", "add", "origin", "https://user:secret@example.com/team/repo.git");
    git(main, "remote", "add", "upstream", "https://example.com/other/repo");
    git(clone, "remote", "add", "origin", "git@example.com:team/repo.git");
    git(main, "worktree", "add", "--detach", worktree);
    assert.equal(projectNamespace(main), projectNamespace(worktree));
    assert.equal(projectNamespace(main), projectNamespace(clone));
    const sub = join(main, "nested"); mkdirSync(sub);
    assert.equal(projectNamespace(sub), projectNamespace(main));
    assert.deepEqual(projectIdentity(worktree).legacyNamespaces, [legacyProjectNamespace(worktree), legacyProjectNamespace(realpathSync(main))]);
    const defaults = captureConfigSchema.parse({ ownerId: "same-owner" });
    const input = { hook_event_name: "UserPromptSubmit", session_id: "chat", turn_id: "one", prompt: "hello", cwd: sub };
    const entry = makeEntry(defaults, main, "codex", input)!;
    assert.equal(JSON.parse(entry.memories[0].text).repoPath, sub);
    assert(!JSON.stringify(entry).includes("secret"));
    const privateEntry = makeEntry(captureConfigSchema.parse({ ...defaults, guardrails: { omitFields: ["repoPath"] } }), main, "codex", input)!;
    assert.equal(JSON.parse(privateEntry.memories[0].text).repoPath, undefined);
    assert.equal(entry.memories[0].id, makeEntry(defaults, worktree, "codex", input)!.memories[0].id);
    const explicit = scope(captureConfigSchema.parse({ namespace: "separate" }), worktree, "codex", input);
    assert.equal(explicit.namespace, "separate"); assert.deepEqual(explicit.legacyNamespaces, []);
    assert.deepEqual(scope(captureConfigSchema.parse({ namespace: "separate", legacyNamespaces: ["old"] }), main, "codex", input).legacyNamespaces, ["old"]);
    git(clone, "remote", "set-url", "origin", "https://example.com/fork/repo.git");
    assert.notEqual(projectNamespace(main), projectNamespace(clone));
    git(main, "remote", "remove", "origin");
    assert.equal(projectNamespace(main), projectNamespace(worktree));
    assert.notEqual(projectNamespace(main), projectNamespace(clone));
    git(main, "remote", "remove", "upstream");
    assert.equal(projectNamespace(main), projectNamespace(worktree));
    assert.match(projectNamespace(main), /^local-/);
    assert.equal(projectNamespace(temp), legacyProjectNamespace(temp));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("same-basename repositories and local folders remain isolated", () => {
  const temp = mkdtempSync(join(tmpdir(), "ram-isolation-"));
  try {
    const first = join(temp, "one", "repo");
    const second = join(temp, "two", "repo");
    mkdirSync(first, { recursive: true }); mkdirSync(second, { recursive: true });
    assert.notEqual(projectNamespace(first), projectNamespace(second));
    git(first, "init"); git(second, "init");
    assert.notEqual(projectNamespace(first), projectNamespace(second));
    git(first, "remote", "add", "origin", "file:///local/one");
    assert.match(projectNamespace(first), /^local-/);
    git(first, "remote", "set-url", "origin", "https://example.com/one/repo.git");
    git(second, "remote", "add", "origin", "https://example.com/two/repo.git");
    assert.notEqual(projectNamespace(first), projectNamespace(second));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("multiple remotes without origin select the alphabetically first remote", () => {
  const root = mkdtempSync(join(tmpdir(), "ram-remotes-"));
  try {
    git(root, "init");
    git(root, "remote", "add", "z-last", "https://example.com/team/z");
    git(root, "remote", "add", "a-first", "https://example.com/team/a");
    const before = projectNamespace(root);
    git(root, "remote", "remove", "z-last");
    assert.equal(projectNamespace(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("legacy recall fills bounded context, deduplicates, and prompt recall preserves owner filters", async () => {
  const resolved = { owner: "owner", namespace: "new", legacyNamespaces: ["old", "old"] };
  const calls: string[] = [];
  const records = await recallNamespaces(resolved, 2, async namespace => {
    calls.push(namespace);
    return namespace === "new" ? [{ text: "one" }] : [{ text: "one" }, { text: "two" }, { text: "three" }];
  });
  assert.deepEqual(calls, ["new", "old"]);
  assert.deepEqual(records, [{ text: "one" }, { text: "two" }]);
  const context = await recallPrompt(captureConfigSchema.parse({}), resolved, "prompt", async args => {
    assert.equal(args.owner_id, "owner");
    return args.namespace === "old" ? [{ text: "legacy decision" }] : [];
  });
  assert.match(context, /legacy decision/);
});
