# Redis Agent Memory MCP bridge

This local MCP server gives Claude Code and Codex the same Redis Agent Memory store. It keeps ordered session events, searches durable memory, and maintains one canonical checkpoint per task session.

## Tools

- `memory_health` checks the configured Redis Agent Memory store.
- `memory_append` records an ordered user, assistant, or system event.
- `memory_get_session` retrieves the session summary and retained events.
- `memory_search` performs owner- and namespace-scoped semantic recall.
- `checkpoint_save` creates or updates the task's durable handoff record.
- `resume_context` returns the exact checkpoint, current session, and relevant long-term memories together.

## 1. Configure Redis Agent Memory

Clone the repository (requires access while the repository is private):

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
```

Create an Agent Memory service in Redis Cloud and copy `.env.example` to `.env`:

```sh
cp .env.example .env
```

Fill in:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
AGENT_MEMORY_OWNER_ID=albert
AGENT_MEMORY_NAMESPACE_ID=your-namespace-resource-id
AGENT_MEMORY_AGENT_ID=shared-agent
```

`AGENT_MEMORY_NAMESPACE_ID` is preferred. For an older store without namespace resources, set `AGENT_MEMORY_NAMESPACE=project-memory` instead. Never commit `.env`.

## 2. Build and verify

```sh
npm install
npm test
```

The launch script loads `.env`, finds Node through NVM when necessary, builds on first run, and starts the stdio MCP server:

```sh
./scripts/start.sh
```

## 3. Connect Claude Code

Copy `.mcp.json.example` to `.mcp.json` in the project Claude will work in. Update the absolute path if this bridge moves:

```sh
cp .mcp.json.example .mcp.json
```

Copy the guidance in `integration/CLAUDE.md.snippet` into that project's `CLAUDE.md`. Start a fresh Claude Code session after changing MCP configuration.

## 4. Connect Codex

Register the same stdio server:

```sh
codex mcp add redis-agent-memory -- zsh /absolute/path/to/redis-agent-memory-mcp/scripts/start.sh
codex mcp list
```

Copy `integration/AGENTS.md.snippet` into the target project's `AGENTS.md`. Start a fresh Codex session so it discovers the new tools.

## Suggested handoff flow

Use a stable session ID such as `project-feature-123` in both agents.

1. Claude calls `memory_append` for important turns while working.
2. Claude calls `checkpoint_save` before the switch.
3. Codex calls `resume_context` using the same session ID.
4. Codex verifies the repository and Git state, continues the work, appends important turns, and updates the same checkpoint.

Long-term extraction is asynchronous. `resume_context` does not rely only on extraction: it fetches the deterministic checkpoint directly, then adds current session history and semantic recall.

## Security notes

- The store API key stays in `.env` and is never returned by an MCP tool.
- Every semantic search is filtered by `ownerId`; namespace filtering is applied when configured.
- Redis semantic exclusions are advisory. Do not send secrets or sensitive transient data to session memory.
- The MCP server performs no deletes. Deletion and export workflows should be added only with an explicit retention policy.
