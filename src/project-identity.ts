import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function legacyProjectNamespace(root: string): string {
  const slug = basename(root).replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 28) || "project";
  return `${slug}-${hash(root)}`;
}

// Transport, userinfo, ports, query strings and fragments are not repository identity.
// Preserve path case: self-hosted Git servers can have case-sensitive repositories.
export function canonicalRemote(remote: string): string | undefined {
  let host: string;
  let path: string;
  try {
    if (remote.includes("://")) {
      const url = new URL(remote);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return;
      host = url.hostname.toLowerCase();
      path = url.pathname;
    } else {
      const match = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(remote);
      if (!match) return;
      host = match[1].toLowerCase();
      path = match[2].split(/[?#]/, 1)[0];
    }
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    if (!host || !path) return;
    return `${host}/${path}`;
  } catch { return; }
}

function git(root: string, ...args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000, maxBuffer: 65536,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    }).trim() || undefined;
  } catch { return; }
}

export function projectIdentity(root: string): { namespace: string; legacyNamespaces: string[] } {
  const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir");
  // The shared Git directory also gives linked worktrees the same local fallback.
  const localRoot = common ? resolve(common) : root;
  const names = (git(root, "remote") ?? "").split("\n").filter(Boolean).sort();
  const selected = names.includes("origin") ? "origin" : names[0];
  const remote = selected ? git(root, "remote", "get-url", selected) : undefined;
  const canonical = remote ? canonicalRemote(remote) : undefined;
  const namespace = canonical ? `repo-${hash(canonical)}`
    : common ? `local-${hash(localRoot)}` : legacyProjectNamespace(root);
  const legacyNamespaces = [legacyProjectNamespace(root)];
  // Standard main checkouts store .git directly below their old project root.
  if (common && basename(common) === ".git") legacyNamespaces.push(legacyProjectNamespace(dirname(common)));
  return { namespace, legacyNamespaces: [...new Set(legacyNamespaces)].filter(value => value !== namespace) };
}

export function projectNamespace(root: string): string {
  return projectIdentity(root).namespace;
}

// Primary scope wins; compatibility reads fill unused context without duplicating it.
export async function recallNamespaces<T extends { text: string }>(
  scope: { namespace: string; legacyNamespaces?: string[] }, limit: number,
  search: (namespace: string) => Promise<T[]>,
): Promise<T[]> {
  if (!limit) return [];
  const memories: T[] = [];
  const seen = new Set<string>();
  for (const namespace of new Set([scope.namespace, ...scope.legacyNamespaces ?? []])) {
    for (const memory of await search(namespace)) {
      if (!seen.has(memory.text)) { seen.add(memory.text); memories.push(memory); }
      if (memories.length >= limit) return memories;
    }
  }
  return memories;
}
