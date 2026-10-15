# Claude Desktop quickstart

[Back to README](../README.md)

Use the MCPB desktop extension to give Claude explicit Redis memory tools. Claude Desktop can recall context, append important turns, and save handoff checkpoints. Saving is model-directed and best-effort because ordinary Claude Desktop chats do not expose passive prompt and response hooks.

## 1. Build the extension

Install Node.js 20.12 or later, then run:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
npm run mcpb:test
```

The extension is written to `build/redis-agent-memory-0.1.0.mcpb`.

## 2. Install it in Claude Desktop

1. Open **Settings → Extensions**.
2. Select **Advanced settings → Install Extension…**.
3. Choose `build/redis-agent-memory-0.1.0.mcpb`.
4. Enter the Redis Agent Memory URL, store ID, and API key.
5. Enable the extension in a conversation.

Ask Claude to call `memory_health`. A successful response confirms the live Redis connection.

## 3. Import existing Claude memory or conversations

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

## Important limitation

The MCPB extension cannot silently observe every Claude Desktop prompt and response. Ask Claude to save substantive work and checkpoints, or use a client with lifecycle hooks when every supported turn must be captured automatically.

For status, CLI fallback, removal, and packaging details, see [Claude Desktop setup and limitations](claude-desktop.md). For all import flags and security behavior, see [Import existing memories](importing-memories.md).
