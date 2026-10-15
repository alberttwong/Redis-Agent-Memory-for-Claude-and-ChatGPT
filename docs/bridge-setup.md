# Optional bridge setup

[Back to the README](../README.md)

These steps install the optional local bridge for ordered session history and structured checkpoints. They are separate from [automatic prompt capture](automatic-capture.md), which uses the native endpoint directly. Run shell commands from the repository root.

### 1. Configure Redis Agent Memory

Clone the repository (requires access while the repository is private):

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
```

Create an Agent Memory service in Redis Cloud and copy `.env.example` to `.env`:

```sh
cp -n .env.example .env
```

Fill in:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
# Optional: stable personal owner across computers; otherwise generated locally.
# AGENT_MEMORY_OWNER_ID=your-stable-user-id
AGENT_MEMORY_NAMESPACE_ID=your-namespace-resource-id
AGENT_MEMORY_AGENT_ID=shared-agent
```

`AGENT_MEMORY_NAMESPACE_ID` is preferred. For an older store without namespace resources, set `AGENT_MEMORY_NAMESPACE=project-memory` instead. Never commit `.env`.

### 2. Build and verify

```sh
npm install
npm test
```

The launch script loads `.env`, finds Node through NVM when necessary, builds on first run, and starts the stdio MCP server:

```sh
./scripts/start.sh
```

### 3. Connect Claude Code

Copy `.mcp.json.example` to `.mcp.json` in the project Claude will work in. Update the absolute path if this bridge moves:

```sh
cp -n .mcp.json.example .mcp.json
```

Copy the guidance in [integration/CLAUDE.md.snippet](../integration/CLAUDE.md.snippet) into that project's `CLAUDE.md`. Start a fresh Claude Code session after changing MCP configuration.

### Claude Desktop: optional local bridge

After completing bridge setup steps 1–2, configure Claude Desktop to launch it on macOS:

1. Open **Claude → Settings → Developer → Edit Config**. The file is `~/Library/Application Support/Claude/claude_desktop_config.json`.
2. Merge this entry into the existing `mcpServers` object, preserving other servers:

```json
{
  "mcpServers": {
    "redis-agent-memory-bridge": {
      "command": "/bin/zsh",
      "args": ["/absolute/path/to/redis-agent-memory-mcp/scripts/start.sh"]
    }
  }
}
```

3. Replace the path with the actual clone location. The launcher reads that clone's `.env`; do not put the key in the JSON.
4. Fully quit and reopen Claude Desktop. Enable the bridge in the conversation's connector menu and ask it to call `memory_health`.

Claude Desktop does not load the project's `.mcp.json` or `CLAUDE.md` as Claude Code does. Provide the save/resume guidance from `integration/CLAUDE.md.snippet` in your Desktop conversation or project instructions. The supplied launcher uses zsh and is intended for macOS; this is not a Windows launcher.

For connection failures, inspect `~/Library/Logs/Claude/`. See the [official local MCP setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

### 4. Connect Codex

These steps add the optional structured session/checkpoint tools. Automatic saving is configured separately through the README's [quick start](../README.md#quick-start).

Register the stdio bridge under a separate name to preserve an existing native connection:

```sh
codex mcp add redis-agent-memory-bridge -- zsh /absolute/path/to/redis-agent-memory-mcp/scripts/start.sh
codex mcp list
```

Copy [integration/AGENTS.md.snippet](../integration/AGENTS.md.snippet) into the target project's `AGENTS.md`. Start a fresh Codex session so it discovers the new tools.

## Suggested handoff flow

Use a stable session ID such as `project-feature-123` in both agents.

1. Claude calls `memory_append` for important turns while working.
2. Claude calls `checkpoint_save` before the switch.
3. Codex calls `resume_context` using the same session ID.
4. Codex verifies the repository and Git state, continues the work, appends important turns, and updates the same checkpoint.

Long-term extraction is asynchronous. `resume_context` does not rely only on extraction: it fetches the deterministic checkpoint directly, then adds current session history and semantic recall.
