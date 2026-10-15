# Redis Agent Memory MCP bridge

Share Redis Agent Memory between Claude Desktop, Claude Code, and Codex using Redis's native MCP endpoint. For standard long-term memory operations, connect directly to Redis without running this project's local server. This repository also includes an optional bridge for ordered session events and structured task checkpoints.

**Want automatic saving?** The [automatic capture guide](docs/automatic-capture.md) installs project hooks for Codex and Claude Code. Prompts, available final responses, and recent-context recall use generated identifiers and per-user owner defaults, with a local retry queue. Ordinary Claude Desktop chat does not use Claude Code hooks.

**Using Claude Desktop?** Follow [Claude Desktop: native connector](#claude-desktop-native-connector) below. For the local bridge, see the [separate bridge setup guide](docs/bridge-setup.md#claude-desktop-optional-local-bridge).

**Using Codex Desktop?** Start with [automatic prompt capture](#codex-desktop-automatic-prompt-capture). The [native MCP connection](#codex-desktop-native-mcp) adds tools for the agent to call; it does not save prompts by itself.

## Recommended: connect to the native MCP endpoint

Configure both clients to use the same Agent Memory service and store:

```json
{
  "mcpServers": {
    "redis-agent-memory": {
      "url": "<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer <MEMORY_KEY>"
      }
    }
  }
}
```

This illustrates the endpoint and authentication; use your client's supported configuration format and secret storage. `<MEMORY_URL>` is the HTTPS service endpoint, `<MEMORY_STORE_ID>` identifies your store, and `<MEMORY_KEY>` is its API key. The placeholder template is also available in `.mcp.native.json.example`. No local Node process or bridge installation is required for a direct connection. Keep populated configuration containing the key outside source control.

### Claude Desktop: native connector

Add the remote connector through Claude's account settings; the generic JSON example above is not a Claude Desktop local-server configuration.

1. Open **Customize → Connectors → + Add → Add custom connector**. On Team/Enterprise, an authorized owner may need to add it under **Organization settings → Connectors** first.
2. Name it `Redis Agent Memory` and enter `<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp` as the remote server URL. Click **Continue**.
3. For the Redis API-key endpoint tested here, choose **No sign in** for OAuth authentication. Under **Request headers**, add `Authorization` with value `Bearer <MEMORY_KEY>`. Enter the actual key privately in that field, not in chat or the URL.
4. Click **Add**, then connect if prompted. In a conversation, open **+ → Connectors** and enable Redis Agent Memory.
5. Ask: “Use `search_long_term_memory` with `owner_id` `desktop-test`, `namespace` `desktop-test`, and `limit` 1. Do not create or delete memories.” An empty successful result is sufficient.

Remote connectors run from Anthropic's infrastructure. Our SDK test verified the Redis endpoint, not this Desktop setup end to end. See [Anthropic's remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Codex Desktop: native MCP

Codex Desktop shares MCP configuration with the CLI on the same host.

This section connects the agent's memory tools. For automatic saving without asking the agent to call a tool, complete the capture setup below as well.

Use the configuration-file route below; it does not depend on a Desktop settings menu being available.

1. Open your private `~/.codex/config.toml` in a text editor (create the file if needed).
2. Merge this table, replacing any existing table with the same server name rather than duplicating it. Preserve unrelated configuration:

```toml
[mcp_servers.redis-agent-memory]
url = "<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp"
http_headers = { Authorization = "Bearer <MEMORY_KEY>" }
```

3. Replace the placeholders privately. This configuration contains a credential; keep it out of Git. Alternatively, replace `http_headers` with `bearer_token_env_var = "AGENT_MEMORY_API_KEY"` and ensure that variable is present in the Desktop app's launch environment. The project's `.env` is not automatically loaded by a native HTTP connection.
4. Save the file, fully quit and reopen Codex Desktop, and start a fresh local chat. If the Codex CLI is installed, run `codex mcp list` to confirm the server is configured; listing alone does not verify live connectivity.
5. Ask Codex to call `search_long_term_memory` with `owner_id` `desktop-test`, `namespace` `desktop-test`, and `limit` 1, without writing or deleting memories.

For an environment-based configuration, the CLI can also register the server with `codex mcp add redis-agent-memory --url "<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp" --bearer-token-env-var AGENT_MEMORY_API_KEY`. The Desktop process must still receive that environment variable.

See the [official OpenAI MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=app#configure-with-configtoml). The endpoint was tested with an SDK client; Desktop setup has not been verified end to end.

### Codex Desktop: automatic prompt capture

The capture handler runs locally on macOS with Node.js 20.12+ and zsh. It connects to Redis's native MCP endpoint directly; registering the optional stdio bridge is not required.

1. Clone this repository, or pull the merged capture implementation into a clean existing checkout:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
npm run build
cp -n .env.example .env
```

If `.env` already exists, keep it and edit its values instead of copying over it. Set these three values privately:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

2. Review `.memory-capture.json`. This repository enables capture with namespace `redis-agent-memory-mcp`. There is no required owner or session to enter: the owner defaults to a hash of the OS account and hostname, sessions derive from each client conversation, and memory IDs are generated automatically. For the same identity across computers, set `AGENT_MEMORY_OWNER_ID` in your private `.env` to a stable personal identifier.
3. Open **this repository folder** as the project in Codex Desktop. The checked-in `.codex/hooks.json` registers `SessionStart`, `UserPromptSubmit`, and `Stop`. Trust the project configuration and review/trust the exact hooks when Codex requests it. Fully quit and reopen the app and start a fresh local chat. Merely registering the native MCP server does not activate these hooks.
4. Submit an ordinary prompt such as “My project needs checkout retry tests.” Once hooks are active, the prompt is queued locally and sent to Redis, and the final assistant response is saved when available. Startup hooks retrieve recent memories for the same owner and namespace.
5. Check delivery from a terminal in the repository:

```sh
npm run capture:status
# Retry delivery if pending is greater than zero:
npm run capture:flush
```

The status command reports the resolved owner, namespace, and pending queue count. Use those values to inspect Redis records with the `auto-capture` topic, or ask the agent: “Retrieve my recent project memories using the scope supplied by the capture hook.” A zero pending count only describes the queue; verify a saved record to confirm that the client actually invoked a hook.

Capture is project-scoped. Opening another project does not install hooks there. To record work in your own application repository, follow [Use another project](docs/automatic-capture.md#use-another-project), which covers merging hooks, using the installed handler's absolute path, and configuring a separate project namespace. See the [full capture guide](docs/automatic-capture.md) for retry behavior, identity overrides, and supported events.

The handler has been tested live for prompt delivery, final-response capture, retry, and cross-client recall using hook payloads. Automatic lifecycle execution still requires the installed Codex version to support the hooks and the user to trust them. Records use long-term-memory type `message`, not Redis's ordered session-memory API.

### Verified native tools

A live test on October 15, 2026 successfully authenticated, initialized an MCP client, discovered nine tools, and executed a read-only `search_long_term_memory` call scoped to a synthetic test owner and namespace. It returned an empty result without errors. No memories were written or deleted during testing.

The tested endpoint exposed:

- `create_long_term_memories`
- `search_long_term_memory`
- `edit_long_term_memory`
- `delete_long_term_memories`
- `create_document_ingestion`
- `get_document_ingestion`
- `list_document_ingestion_outputs`
- `list_memory_sources`
- `list_source_memories`

Session-history, health, and combined resume tools were not present in that endpoint's discovered tool list. Availability can differ by deployment; discover the tools on your own service before relying on them. Write operations, embeddings, and document extraction were not verified by this read-only test.

### Handoff using native tools

In Claude Code, use `create_long_term_memories` to save progress under a stable memory ID such as `checkout-retry-123-handoff`, with the same `owner_id`, `namespace`, and `session_id` throughout the task. Include the current goal, decisions, completed work, next steps, blockers, branch, and test results in the memory text. Use `edit_long_term_memory` to update the existing handoff record as work progresses.

In Codex, use `search_long_term_memory` with the matching `owner_id`, `namespace`, and `session_id` to retrieve the saved handoff. Filter-only searches can use `sort_by: "updatedAt"` and `sort_order: "desc"`. Inspect the shared repository before continuing. Save regularly so a sudden credit limit leaves a recent checkpoint available.

The native tools use snake_case arguments; the optional bridge tools below use camelCase. The snippets in `integration/` are specifically for the bridge and reference its tool names.

## Redis Agent Memory capabilities

Redis Agent Memory provides:

- Ordered session history for exact conversational context.
- Long-term semantic memory across sessions.
- Automatic summarization and extraction of durable facts.
- Semantic, keyword, and hybrid retrieval with metadata filters.
- Python, TypeScript, and REST APIs.
- Compatibility with any model provider or agent framework.

See the [Redis Agent Memory documentation](https://redis.io/docs/latest/develop/ai/context-engine/agent-memory/) for the service's full capabilities. This bridge currently exposes semantic search through `memory_search`; keyword and hybrid search are not exposed as separate bridge tools. When automatic summarization is enabled, session retrieval can return a summary and recent events rather than every original turn; use `includeSummarisedEvents` when requesting the underlying session history.

## Use cases

The examples below use the optional bridge's tools. For a direct native connection, use the native handoff workflow above.

### Switch agents when credits run out

Start a task in Claude Code and continue in Codex when you reach your Claude usage limit. Both clients connect to this bridge using the same Redis store, owner, namespace, and task session ID. Save checkpoints during the work so the next agent can retrieve the latest saved goal, decisions, completed work, blockers, and next steps with `resume_context`.

Example prompts, using `checkout-retry-123` as the shared session ID:

> **In Claude Code:** Work on checkout retries using memory session `checkout-retry-123`. Record important progress and save a checkpoint after each milestone, including the repository path, branch, changed files, test results, and next steps.

> **In Codex:** Call `resume_context` for session `checkout-retry-123` with query "checkout retries, decisions, tests, blockers, and next steps". Inspect the repository and current Git state, then continue from the latest checkpoint.

Saving regularly matters: if a usage limit interrupts Claude before its next checkpoint, Codex can recover only what was already written to Redis and the shared working tree.

### Resume after a break or a new chat

Return to an unfinished feature or investigation without explaining the whole task again. Use the original session ID to retrieve its checkpoint, ordered conversation events, and any session summary returned by Redis. The next agent can establish what was tried and where to continue.

### Recall decisions across related tasks

Use `memory_search` to recall earlier architectural decisions, project constraints, or durable preferences before starting related work. For example, query "why did we choose exponential backoff for checkout retries?" within the same owner and project namespace. Relevant long-term memories can be retrieved across task sessions after Redis has extracted them.

### Hand off an investigation between agents

Have Claude Code investigate a failing test, record attempted fixes and findings, and save a checkpoint. Codex can retrieve that context and implement the next proposed step. Both agents need access to the relevant repository and files; memory records describe the work but do not transfer files or running processes.

### Keep project context separate

Configure a separate namespace for each project and use a distinct session ID for each task. Semantic recall includes the owner filter and, when configured, the namespace filter. This keeps unrelated project memories out of ordinary searches; these filters organize retrieval and do not replace service authentication or authorization.

## Architecture

The recommended direct connection shares long-term memory through the native endpoint:

```mermaid
flowchart TD
    Claude[Claude Code] -->|MCP over HTTPS with bearer authentication| Native[Redis Agent Memory native MCP endpoint]
    Codex[Codex] -->|MCP over HTTPS with bearer authentication| Native
    Native --> Memories[Shared long-term memory in Redis]
    Claude -->|Read and edit files| Repo[Shared repository and Git state]
    Codex -->|Read and edit files| Repo
```

The optional bridge adds session history and structured resume tools through the Redis SDK:

```mermaid
flowchart TD
    Claude[Claude Code] -->|MCP over stdio| ClaudeBridge[Local bridge process]
    Codex[Codex] -->|MCP over stdio| CodexBridge[Local bridge process]

    subgraph Bridge[Same bridge implementation and Redis configuration]
        ClaudeBridge
        CodexBridge
    end

    ClaudeBridge -->|Official Redis SDK over HTTPS| RAM[Redis Agent Memory service]
    CodexBridge -->|Official Redis SDK over HTTPS| RAM

    subgraph Redis[Shared memory in Redis]
        RAM --> Sessions[Session events and optional summary]
        RAM --> Checkpoints[Canonical task checkpoint]
        RAM --> Memories[Searchable long-term memories]
        Sessions -.->|Background extraction when enabled| Memories
    end

    Claude -->|Read and edit files| Repo[Shared repository and Git state]
    Codex -->|Read and edit files| Repo
```

Each client launches its own local bridge process. Both processes use the same Redis Agent Memory endpoint and store, with matching owner and namespace settings. A shared task session ID links the work across clients.

`memory_append` writes session events. `checkpoint_save` writes or updates a deterministic long-term memory record for the task. `resume_context` fetches that checkpoint directly, retrieves session history, and searches for relevant long-term memories in parallel.

The MCP bridge itself records content agents send through its tools. The optional [capture hooks](docs/automatic-capture.md) additionally save submitted prompts and available final responses without tool calls by the model. Neither mechanism detects exhausted credits, switches clients, or transfers hidden reasoning. Share or synchronize the working tree separately.

## Optional bridge tools

- `memory_health` checks the configured Redis Agent Memory store.
- `memory_append` records an ordered user, assistant, or system event.
- `memory_get_session` retrieves the session summary and retained events.
- `memory_search` performs owner- and namespace-scoped semantic recall.
- `checkpoint_save` creates or updates the task's durable handoff record.
- `resume_context` returns the exact checkpoint, current session, and relevant long-term memories together.

## Optional bridge setup

For structured checkpoints and ordered session history, see the separate [optional bridge setup guide](docs/bridge-setup.md). It includes Claude Code, Claude Desktop, Codex, and the bridge handoff workflow.

## Security notes

- For the optional bridge, the store API key stays in `.env` and is never returned by a bridge tool. For native connections, use the client's secret storage or a local untracked configuration.
- The optional bridge filters semantic search by `ownerId` and applies namespace filtering when configured. With native tools, explicitly pass the appropriate `owner_id` and `namespace` filters.
- Redis semantic exclusions are advisory. Do not send secrets or sensitive transient data to session memory.
- The optional bridge exposes no delete tool. The native endpoint does expose `delete_long_term_memories`; use it only for intended memory removals.
