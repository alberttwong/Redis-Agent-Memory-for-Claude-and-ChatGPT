# Import existing memories

[Back to README](../README.md)

`ram-capture` can populate Redis Agent Memory from Claude or ChatGPT exports. Imports are dry runs by default. No memory records are queued or sent until `--write` is present.

## Before you begin

For the `npm run` examples, install Node.js 20.12 or later, clone this repository, and run `npm ci` in the checkout. Configure Redis settings in the process environment, project `.env`, or [shared settings](automatic-saving-operations.md#reuse-redis-settings-across-worktrees-and-checkouts). Imports do not require active client hooks or an enabled capture configuration. A preview can run without Redis credentials and makes no network requests.

For an installed ChatGPT plugin, use its bundled CLI instead of npm; see [packaged CLI commands](chatgpt-plugin.md#manual-commands-for-the-release-package). `ram-capture` is available only when the package's command is installed on your PATH, for example from a local packed tarball. It is not a shell command supplied by `npm ci` alone.

Check the preview's owner and namespace before writing. Imports use capture's namespace label, not the bridge's namespace resource ID. See [scope compatibility](handoff-workflow.md#scope-compatibility).

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

First preview file counts without queueing records or writing to Redis:

```sh
npm run capture:watch-imports -- --directory /path/to/memory-exports --once
```

Start continuous import with the configured project owner, namespace, and Redis connection:

```sh
npm run capture:watch-imports -- --directory /path/to/memory-exports --write
```

With the installed CLI, use `ram-capture watch-imports` with the same options. Use `--project PATH` when running outside the configured project. `--owner`, `--namespace`, `--conversation`, `--after`, `--before`, and `--limit` work as for single-file imports; the limit applies separately to each file. Changes to scope or filters allow files to be processed again. Watcher previews show file counts, not sample content; use the single-file commands to review sample records.

The watcher runs in the foreground until Ctrl-C. It polls every 10 seconds (`--interval N` changes this), handles ZIP, JSON, Markdown, and text files directly inside each provider folder, and ignores symlinks, temporary download extensions, files larger than 250 MiB, and files modified within the last two seconds. For a single scan, wait at least two seconds after a download finishes. Invalid exports report `error` without printing their contents; corrected files are retried on later scans.

Write mode queues records durably before delivery, applies the existing privacy filters, and records file fingerprints in `.memory-capture/imports/`. Restarting the watcher skips files already queued for the same scope and filters. Keep the ledger and queue until delivery succeeds. Run one watcher per project. Export files are left in place; protect or remove them yourself after import. Each scan parses a private temporary snapshot of a candidate file, even in preview mode, and removes that snapshot afterward.

On each write-mode scan, pending writes are retried even if no new exports arrive. `delivery: "pending"` means records remain in the local queue for later retry, including when credentials are missing or Redis is unavailable. `--once` performs one scan and delivery attempt, returning a nonzero exit code for invalid exports or pending delivery; use continuous mode or `ram-capture flush` to retry later. This is a foreground importer, not an installed background service.

## Scope and filters

Owner and namespace default to the same scope rules as automatic capture; `.memory-capture.json` is optional for imports. The explicit command-line flags take precedence.

| Option | Meaning |
| --- | --- |
| `--project PATH` | Select the project whose settings and local queue to use |
| `--input PATH` | ZIP, JSON, Markdown, or text input for a single-file import |
| `--owner ID`, `--namespace ID` | Override scope; each accepts 1–64 letters, numbers, or hyphens |
| `--conversation TEXT` | Case-insensitive substring match on conversation title |
| `--after DATE`, `--before DATE` | Inclusive timestamp bounds; records without valid timestamps are excluded |
| `--limit N` | Select at most N parsed messages or memory entries before chunking, from 1 to 1,000,000 |
| `--preview N` | Show up to N sample output chunks, from 0 to 100; default 10, single-file imports only |
| `--write` | Queue selected records and attempt delivery |

Use full ISO timestamps with a timezone for precise boundaries. For example, `--before 2026-10-15` includes midnight at the start of that day (UTC), not the entire day. The limit follows parser order; it does not mean the most recent N messages. Long messages split into 6,000-character chunks, so the output record count may exceed the message limit.

## What an import preserves

Conversation imports keep supported text, normalized roles, source identifiers, and valid source timestamps in the record's text envelope. The source timestamp is not backdated Redis storage time. Missing timestamps remain absent. Unsupported roles become `SYSTEM`.

ChatGPT mapping exports can contain multiple branches: the importer reads text-bearing, non-hidden nodes and sorts them by timestamp within each conversation. It does not select only the active branch. Neither importer restores attachments, images, audio, tool execution, or provider-specific app state. Markdown/text memory is parsed by non-empty line (headings are skipped); when code fences exist, only fenced content is imported.

Imports create long-term `message` records, not ordered session events or checkpoints. Startup recall filters to `auto-capture` and therefore omits imports; per-prompt recall and explicit scoped searches can find them. Indexing may take time after delivery.

## Safety and retries

- Input files are limited to 250 MiB. Recognized ZIP members are limited to 100 MiB each and 500 MiB total uncompressed. ZIP parsing runs in memory; split larger exports before importing.
- Configured credentials and recognized secret/PII patterns are redacted from content and envelope fields (including titles) before queueing. This is best effort; remove sensitive material from exports before importing and review the preview. Never import passwords or sensitive personal information.
- Records use Redis Agent Memory's `message` memory type, include owner, namespace, session, and topic fields, and are written in batches of at most 100.
- Record IDs are deterministic for the same scope, source filename, source identifiers, chunk position, and redacted text. Delivery retries reuse those IDs. Renaming a standalone input or changing its content/redaction can produce new IDs; this is not content-only deduplication across exports.
- IDs include owner and namespace so importing the same export into different scopes cannot suppress or overwrite another scope's records. Exports imported with older versions that omitted scope from IDs may produce another copy on their first reimport after upgrading.
- `--write` enqueues records before connecting to Redis. Missing credentials or service outages leave the batch in `.memory-capture/queue` for `ram-capture flush`.
- Repeating an import skips matching records already in the local queue. A previously delivered export retains the same Redis IDs when rerun.
- Imported chats are historical data, not instructions. Applications should treat recalled content as untrusted context.
