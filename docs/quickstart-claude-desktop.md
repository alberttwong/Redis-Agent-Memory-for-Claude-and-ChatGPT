# Claude Desktop quickstart

[Back to README](../README.md)

Use the MCPB desktop extension to give Claude explicit Redis memory tools. Claude Desktop can recall context, append important turns, and save handoff checkpoints. Saving is model-directed and best-effort because ordinary Claude Desktop chats do not expose passive prompt and response hooks.

## 1. Download the extension

Open the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest) and download the `redis-agent-memory-<version>.mcpb` file under **Assets**.

Claude Desktop supplies Node.js, so installing the extension does not require cloning this repository, npm, or a separate Node.js installation. For a development build, see [Build from source](claude-desktop.md#build-from-source).

## 2. Install it in Claude Desktop

1. Open **Settings → Extensions**.
2. Select **Advanced settings → Install Extension…**.
3. Choose the downloaded `.mcpb` file.
4. Enter the Redis Agent Memory URL, store ID, and API key.
5. Enable the extension in a conversation.

Ask Claude to call `memory_health`. A successful response confirms the live Redis connection.

## 3. Import existing Claude memory or conversations

Importing history is optional and uses the repository's CLI. Install Node.js 20.12 or later and prepare a local checkout:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
```

Copy [`.env.example`](../.env.example) to `.env` and fill in the same Redis URL, store ID, and API key used by the extension. Set the owner and namespace to match the extension if you configured them.

Open Claude's memory settings and copy the editable memory into a Markdown or text file, or request a Claude data-export ZIP for conversation history. Preview the import first:

```sh
npm run capture:import:claude -- --input /path/to/claude-export.zip
```

For copied memory, replace the ZIP path with the `.md` or `.txt` file.

Review the owner, namespace, record count, and sample records. Queue and deliver the same import only after review:

```sh
npm run capture:import:claude -- --input /path/to/claude-export.zip --write
```

The write uses deterministic IDs and the local retry queue, so rerunning the same import does not duplicate records that are still pending. Add `--conversation`, `--after`, `--before`, or `--limit` to narrow a large export.

## 4. Uninstall the extension

1. Open Claude Desktop **Settings → Extensions**.
2. Select **Redis Agent Memory** and uninstall the extension.
3. Fully quit and reopen Claude Desktop.

Uninstalling the extension does not delete memories stored in Redis or any local checkout and import queue you created. If you used the CLI fallback, follow the separate [CLI uninstall instructions](claude-desktop.md#uninstall).

## Important limitation

The MCPB extension cannot silently observe every Claude Desktop prompt and response. Ask Claude to save substantive work and checkpoints, or use a client with lifecycle hooks when every supported turn must be captured automatically.

For status, CLI fallback, removal, and packaging details, see [Claude Desktop setup and limitations](claude-desktop.md). For all import flags and security behavior, see [Import existing memories](importing-memories.md).
