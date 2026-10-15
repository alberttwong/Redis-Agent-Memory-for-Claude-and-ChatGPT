---
name: use-redis-memory
description: Recall saved Redis Agent Memory project context and record progress or checkpoints when continuing a task or handing it to another assistant.
---

# Use Redis Agent Memory

Use the connected Redis memory tools. For continuing work, call `resume_context` with the task's existing, non-sensitive session ID before making changes. If the task cannot be identified, ask which saved task the user wants. Check recalled progress against the current files before continuing.

Record important conversation events with `memory_append` when ordered history is useful. Save a `checkpoint_save` after material progress and before a handoff, including the goal, decisions, completed work, blockers, validation, and next steps. Include relevant file and branch information when working on code.

Saving is model-directed. Do not claim that every prompt or response is captured automatically.

If the tools are unavailable, explain that the bundled local server needs a supported Cowork or Claude Code session and configured Redis credentials. For ordinary Claude Desktop Chat, direct the user to the project's MCPB extension installation guide at https://github.com/alberttwong/redis-agent-memory-mcp/blob/main/docs/quickstart-claude-desktop.md. Do not ask the user to paste an API key into chat.
