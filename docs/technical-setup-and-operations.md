# Technical setup and operations

[Back to the README](../README.md)

For local ChatGPT/Codex automatic capture, build and verify the desktop plugin:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
npm run plugin:test
```

Restart ChatGPT Desktop, choose **Redis Agent Memory local plugins** in the Plugins Directory, install **Redis Agent Memory**, and use its `setup-redis-memory` skill in the project. Add `AGENT_MEMORY_BASE_URL`, `AGENT_MEMORY_STORE_ID`, and `AGENT_MEMORY_API_KEY` to the generated `.env`, then start a new local chat after trusting the plugin hook. See [ChatGPT plugin packaging](chatgpt-plugin.md), [Automatic capture](automatic-capture.md), and [Automatic saving operations](automatic-saving-operations.md) for profiles, identity, retries, manual project-hook installation, and removal.

## Claude Desktop packaging

Run `npm run mcpb:test`, then install `build/redis-agent-memory-0.1.4.mcpb` from **Claude Desktop → Settings → Extensions → Advanced settings → Install Extension…**. The CLI installer remains available as a development fallback with `npm run capture:install:claude-desktop`. See [Claude Desktop setup and limitations](claude-desktop.md) for configuration, verification, status, retry, and removal.

## Optional direct native MCP access

Automatic saving does not require agent-facing native MCP access. See [Optional native MCP connector setup](native-mcp-setup.md) when Claude Desktop or Codex should also perform explicit memory searches, writes, or document operations.

## Optional bridge tools

- `memory_health` checks the configured Redis Agent Memory store.
- `memory_append` records an ordered user, assistant, or system event.
- `memory_get_session` retrieves the session summary and retained events.
- `memory_search` performs owner- and namespace-scoped semantic recall.
- `checkpoint_save` creates or updates the task's durable handoff record.
- `resume_context` returns the exact checkpoint, current session, and relevant long-term memories together.

## Optional bridge setup

For structured checkpoints and ordered session history, see the separate [optional bridge setup guide](bridge-setup.md). It includes Claude Code, Claude Desktop, Codex, and the bridge handoff workflow.
