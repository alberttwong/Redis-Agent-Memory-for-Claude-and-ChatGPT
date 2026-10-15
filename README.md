# Redis Agent Memory MCP bridge

Automatic memory saving is the default operating mode for configured Codex projects. Every submitted prompt and available final response is written to a private local retry queue before delivery to Redis Agent Memory. New sessions automatically recall recent context for the same user and project. Agents do not need to call a memory tool or ask the user for owner, namespace, session, or memory IDs on each turn.

The project can also expose native Redis MCP tools for explicit searches and writes, and includes an optional local bridge for ordered session events and structured task checkpoints. Ordinary Claude Desktop chat does not run local Codex or Claude Code hooks.

## Quick start

Install the project-scoped hooks and default-enabled capture configuration:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
npm run capture:install
```

The installer preserves existing hooks and configuration. It creates a private `.env` only when one does not exist, enables capture in `.memory-capture.json`, and ignores the local retry queue. Add the Redis values to `.env`:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

Confirm the local setup without contacting Redis:

```sh
npm run capture:doctor
```

Open the repository in a local Codex session, then use `/hooks` to inspect and trust the installed hook definition. Codex requires that security review and normal installers cannot approve it silently. Trust is tied to the exact hook definition, so changed hooks must be reviewed again. Start a new local session after installation or trust approval; saving and startup recall then happen automatically on ordinary turns. Set `enabled` to `false` in `.memory-capture.json` to opt out.

Local command hooks do not run in cloud-orchestrated Work chats, even when those chats use local computer access. This automatic-saving workflow requires local-only Codex orchestration; enterprise deployments can use supported managed MCP hooks instead. See the [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) for current support boundaries.

For another repository, run `ram-capture install --project /absolute/path/to/project`; see the [automatic capture guide](docs/automatic-capture.md) for installation, identity, retry, and uninstall details.

## Optional direct native MCP access

Automatic saving does not require agent-facing native MCP access. See [Optional native MCP connector setup](docs/native-mcp-setup.md) when Claude Desktop or Codex should also perform explicit memory searches, writes, or document operations.

## Claude Desktop

Build the one-click desktop extension:

```sh
npm ci
npm run mcpb:test
```

In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…** and select `build/redis-agent-memory-0.1.0.mcpb`. Claude Desktop collects the Redis connection settings during installation and stores the API key through its secure configuration mechanism.

The CLI installer remains available as a development fallback:

```sh
npm run capture:install:claude-desktop
```

This is not passive automatic capture: Desktop Chat does not expose the prompt and response lifecycle hooks used by local Codex. See [Claude Desktop setup and limitations](docs/claude-desktop.md) for configuration, verification, status, retry, and removal.

## Automatic saving operations

Status checks, retries, scope details, installation for another project, and removal instructions are in [Automatic saving operations](docs/automatic-saving-operations.md). For event behavior and implementation details, see the [automatic capture guide](docs/automatic-capture.md).

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

The examples below use the optional bridge's tools. For a direct native connection, use the [native handoff workflow](docs/native-tools.md#handoff-using-native-tools).

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

The MCP bridge records content agents send through its tools. The default-enabled [capture hooks](docs/automatic-capture.md) save submitted prompts and available final responses without tool calls by the model. Neither mechanism detects exhausted credits, switches clients, or transfers hidden reasoning. Share or synchronize the working tree separately.

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
