---
name: use-redis-memory
description: Recall durable Redis Agent Memory context and save important progress or handoff checkpoints through the plugin's remote MCP tools.
---

# Use Redis Agent Memory

For continuing work, call `resume_context` before making changes. Use a stable, non-sensitive session ID, and verify recalled facts against the current files and external state.

Append substantive user and assistant events with `memory_append` when durable ordered history is useful. Save a `checkpoint_save` record after material progress and before a handoff. Include the goal, completed work, blockers, changed files, validation, and next steps.

This public profile is model-directed. It has no lifecycle hooks and must never claim that every prompt or response was captured automatically.

## Memory privacy guardrails

Never store passwords, API keys, access tokens, private keys, raw environment files, or sensitive personal information (PII), including contact details, government IDs, financial details, and medical information. Apply this rule to memory text, metadata, checkpoints, imports, and identifiers. Omit sensitive details or use placeholders; when unsure, leave the detail out. Automatic redaction is a fallback and cannot detect all sensitive information.
