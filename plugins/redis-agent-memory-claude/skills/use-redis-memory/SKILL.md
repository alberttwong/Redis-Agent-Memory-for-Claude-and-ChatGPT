---
name: use-redis-memory
description: Recall saved Redis Agent Memory project context and record progress or checkpoints when continuing a task or handing it to another assistant.
---

# Use Redis Agent Memory

Use the connected Redis memory tools. If they report that Redis is not configured, call `memory_setup` and give the user its local browser link. Wait for them to save settings there, then verify with `memory_health`. For continuing work, call `resume_context` with the task's existing, non-sensitive session ID before making changes. If the task cannot be identified, ask which saved task the user wants. Check recalled progress against the current files before continuing.

Record important conversation events with `memory_append` when ordered history is useful. Save a `checkpoint_save` after material progress and before a handoff, including the goal, decisions, completed work, blockers, validation, and next steps. Include relevant file and branch information when working on code.

The plugin includes automatic prompt and available final-response capture for configured local Claude Code projects. It requires an enabled `.memory-capture.json` and active plugin hooks. Use `setup-redis-memory` to configure and verify it. MCP tool calls remain model-directed, and ordinary Desktop Chat has no passive capture. Do not claim capture is active without verifying it.

If the tools are unavailable, explain that the bundled local server needs a supported Cowork or Claude Code session and configured Redis credentials. For the browser setup form, use a local Claude Code session on This computer. For ordinary Claude Desktop Chat, direct the user to the project's MCPB extension installation guide at https://github.com/alberttwong/redis-agent-memory-mcp/blob/main/docs/quickstart-claude-desktop.md. Do not ask the user to paste an API key into chat.

## Memory privacy guardrails

Never store passwords, API keys, access tokens, private keys, raw environment files, or sensitive personal information (PII), including contact details, government IDs, financial details, and medical information. Apply this rule to memory text, metadata, checkpoints, imports, and identifiers. Omit sensitive details or use placeholders; when unsure, leave the detail out. Automatic redaction is a fallback and cannot detect all sensitive information.
