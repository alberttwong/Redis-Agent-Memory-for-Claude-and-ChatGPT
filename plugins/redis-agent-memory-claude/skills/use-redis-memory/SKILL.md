---
name: use-redis-memory
description: Recall saved Redis Agent Memory project context and record progress or checkpoints when continuing a task or handing it to another assistant.
---

# Use Redis Agent Memory

Use the connected Redis memory tools. If they report that Redis is not configured, call `memory_setup` and give the user its local browser link. Wait for them to save settings there, then verify with `memory_health`. For continuing work, call `resume_context` with the task's existing, non-sensitive session ID before making changes. If the task cannot be identified, ask which saved task the user wants. Check recalled progress against the current files before continuing.

Record important conversation events with `memory_append` when ordered history is useful. Save a `checkpoint_save` after material progress and before a handoff, including the goal, decisions, completed work, blockers, validation, and next steps. Include relevant file and branch information when working on code.

The plugin includes automatic prompt and available final-response capture for configured local Claude Code projects. It requires an enabled `.memory-capture.json` and active plugin hooks. Use `setup-redis-memory` to configure and verify it. MCP tool calls remain model-directed, and ordinary Desktop Chat has no passive capture. Do not claim capture is active without verifying it.

If the tools are unavailable, explain that the bundled local server needs a supported Cowork or Claude Code session and configured Redis credentials. For the browser setup form, use a local Claude Code session on This computer. For ordinary Claude Desktop Chat, direct the user to the project's MCPB extension installation guide at https://github.com/alberttwong/redis-agent-memory-mcp/blob/main/docs/quickstart-claude-desktop.md. Do not ask the user to paste an API key into chat.

Use `memory_search` for captured/imported messages; `resume_context` reads ordered session history and an explicit checkpoint, with semantic recall alongside them. New automatic conversation capture creates ordered session history, but does not create a checkpoint; imports remain direct-only. Use capture’s derived session ID rather than its task alias. Match the owner and namespace field before searching, and use task session IDs unique within a shared store because ordered session reads are addressed by session ID alone.


## Choosing tools and controlling context

Use `memory_search` when a prior decision or saved fact could help, or when the task session ID is unknown. Use `resume_context` for “continue where we left off” with a known session ID; it already includes search, so do not repeat the same lookup. Verify recalled facts against current files. Skip retrieval for self-contained trivial questions and reuse context already available in this conversation.

Use `memory_append` to save an important individual turn or decision as ordered history. Use `checkpoint_save` after material progress and before switching agents to replace the canonical compact handoff. Avoid copying the full transcript into a checkpoint or appending turns already captured by verified hooks. There is no separate save tool to select.

Read responses have a serialized character budget. If `contextBudget.truncated` is true, narrow `memory_search` or increase `maxChars` (1024–100000). Use `memory_get_session` with `eventLimit` and `eventOffset` for older events; `eventPage.nextOffset` identifies the next page. See [recall budgets and evaluation](https://github.com/alberttwong/redis-agent-memory-mcp/blob/main/docs/recall-budgets.md).

## Memory privacy guardrails

Follow the configured memory guardrails supplied by the server and local hooks. Local projects can set `guardrails` in `.memory-capture.json`; keep existing settings unless the user requests a change. By default, omit passwords, credentials, and sensitive personal information from memory text, metadata, checkpoints, imports, and identifiers. Respect disabled message roles and omitted context fields. Never store the configured Redis API key, even when credential redaction is disabled. Without a configured policy, use the default protections. Automatic redaction is a fallback and cannot detect all sensitive information.
