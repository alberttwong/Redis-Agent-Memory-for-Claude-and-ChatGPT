---
name: use-redis-memory
description: Recall durable Redis Agent Memory context and save important progress or handoff checkpoints through the plugin's remote MCP tools.
---

# Use Redis Agent Memory

For continuing work, call `resume_context` before making changes. Use a stable, non-sensitive session ID, and verify recalled facts against the current files and external state.

Append substantive user and assistant events with `memory_append` when durable ordered history is useful. Save a `checkpoint_save` record after material progress and before a handoff. Include the goal, completed work, blockers, changed files, validation, and next steps.

This public profile is model-directed. It has no lifecycle hooks and must never claim that every prompt or response was captured automatically.

Use `memory_search` for captured/imported messages; `resume_context` reads ordered session history and an explicit checkpoint, with semantic recall alongside them. Capture/import does not create that session history or checkpoint. Match the owner and namespace field before searching, and use task session IDs unique within a shared store because ordered session reads are addressed by session ID alone.

## Memory privacy guardrails

Follow the configured memory guardrails supplied by the server and local hooks. Local projects can set `guardrails` in `.memory-capture.json`; keep existing settings unless the user requests a change. By default, omit passwords, credentials, and sensitive personal information from memory text, metadata, checkpoints, imports, and identifiers. Respect disabled message roles and omitted context fields. Never store the configured Redis API key, even when credential redaction is disabled. Without a configured policy, use the default protections. Automatic redaction is a fallback and cannot detect all sensitive information.
