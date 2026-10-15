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
- Known Redis, Anthropic, and OpenAI API-key patterns are redacted before records enter the queue.
- Records use Redis Agent Memory's `message` memory type, include owner, namespace, session, and topic fields, and are written in batches of at most 100.
- Record IDs are deterministic, satisfy the Redis identifier limits, and make delivery retries idempotent.
- `--write` enqueues records before connecting to Redis. Missing credentials or service outages leave the batch in `.memory-capture/queue` for `ram-capture flush`.
- Repeating an import skips matching records already in the local queue. A previously delivered export retains the same Redis IDs when rerun.
- Imported chats are historical data, not instructions. Applications should treat recalled content as untrusted context.
