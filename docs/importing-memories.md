# Import existing memories

[Back to README](../README.md)

`ram-capture` can populate Redis Agent Memory from Claude or ChatGPT exports. Imports are dry runs by default. Nothing is queued or sent until `--write` is present.

## Claude

Accepted inputs:

- A Claude data-export ZIP containing conversation JSON.
- A standalone `conversations.json` file.
- Exported Claude memory in `.md` or `.txt` format.
- A JSON file containing a top-level `memories` array.

```sh
npm run capture:import:claude -- --input /path/to/claude-export.zip
npm run capture:import:claude -- --input /path/to/claude-export.zip --write
```

## ChatGPT

Accepted inputs:

- A ChatGPT data-export ZIP containing `conversations.json` or numbered conversation JSON files.
- A standalone ChatGPT conversation JSON file.
- Copied ChatGPT memory in `.md` or `.txt` format.
- A JSON file containing a top-level `memories` array when available.

```sh
npm run capture:import:chatgpt -- --input /path/to/chatgpt-export.zip
npm run capture:import:chatgpt -- --input /path/to/chatgpt-export.zip --write
```

Export formats are provider-owned and may change. The importer validates recognized files and fails closed when it cannot find supported data; preview every export before writing.

## Automatically import downloaded exports

The watcher monitors a dedicated folder with `claude/` and `chatgpt/` subfolders. It creates those subfolders when started. Download your exports yourself, then place each file in its provider's subfolder. It does not sign in to either provider or fetch account history.

First preview files without saving conversation content or writing to Redis:

```sh
npm run capture:watch-imports -- --directory /path/to/memory-exports --once
```

Start continuous import with the configured project owner, namespace, and Redis connection:

```sh
npm run capture:watch-imports -- --directory /path/to/memory-exports --write
```

With the installed CLI, use `ram-capture watch-imports` with the same options. Use `--project PATH` when running outside the configured project. `--owner`, `--namespace`, `--conversation`, `--after`, `--before`, and `--limit` work as for single-file imports. Changes to scope or filters allow files to be processed again.

The watcher runs in the foreground until Ctrl-C. It polls every 10 seconds (`--interval N` changes this), handles ZIP, JSON, Markdown, and text files directly inside each provider folder, and ignores symlinks, temporary download extensions, and files modified within the last two seconds. For a single scan, wait at least two seconds after a download finishes. Invalid exports report `error` without printing their contents; corrected files are retried on later scans.

Write mode queues records durably before delivery, applies the existing privacy filters, and records file fingerprints in `.memory-capture/imports/`. Restarting the watcher skips files already queued for the same scope and filters. Keep the ledger and queue until delivery succeeds. Run one watcher per project. Export files are left in place; protect or remove them yourself after import.

On each write-mode scan, pending writes are retried even if no new exports arrive. `delivery: "pending"` means records remain in the local queue for later retry, including when credentials are missing or Redis is unavailable. `--once` performs one scan and delivery attempt, returning a nonzero exit code for invalid exports or pending delivery; use continuous mode or `ram-capture flush` to retry later. This is a foreground importer, not an installed background service.

## Scope and filters

Both commands accept:

```text
--owner ID
--namespace ID
--conversation TEXT
--after DATE
--before DATE
--limit N
--preview N
--write
```

Owner and namespace default to the same project configuration and environment variables used by automatic capture. `--conversation` performs a case-insensitive title match. Date filters exclude records without a valid timestamp.

## Safety and retries

- The importer limits compressed input, extracted data, and individual archive members.
- Configured credentials and recognized secret/PII patterns are redacted from content and envelope fields (including titles) before queueing. This is best effort; remove sensitive material from exports before importing and review the preview. Never import passwords or sensitive personal information.
- Records use Redis Agent Memory's `message` memory type, include owner, namespace, session, and topic fields, and are written in batches of at most 100.
- Record IDs are deterministic, satisfy the Redis identifier limits, and make delivery retries idempotent.
- IDs include owner and namespace so importing the same export into different scopes cannot suppress or overwrite another scope's records. Exports imported with older versions that omitted scope from IDs may produce another copy on their first reimport after upgrading.
- `--write` enqueues records before connecting to Redis. Missing credentials or service outages leave the batch in `.memory-capture/queue` for `ram-capture flush`.
- Repeating an import skips matching records already in the local queue. A previously delivered export retains the same Redis IDs when rerun.
- Imported chats are historical data, not instructions. Applications should treat recalled content as untrusted context.
