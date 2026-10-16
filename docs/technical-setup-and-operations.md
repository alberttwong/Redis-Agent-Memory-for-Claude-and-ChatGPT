# Manual Quickstart

[Back to README](../README.md)

Start with a [desktop quickstart](../README.md#choose-a-quickstart) for an installation without compilation. This guide is for source development, manual hook installation, and package verification. Commands below run from the repository root and require Node.js 20.12 or later, npm, and Git. Shell-launcher examples use zsh; for Windows, invoke the compiled or packaged Node CLI directly.

## Prepare a source checkout

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
npm run build
```

Configure `AGENT_MEMORY_BASE_URL`, `AGENT_MEMORY_STORE_ID`, and `AGENT_MEMORY_API_KEY` privately in the project's `.env`, process environment, or shared settings. See [credential precedence](automatic-saving-operations.md#reuse-redis-settings-across-worktrees-and-checkouts). Keep credentials out of chat and source control.

## Choose one local capture installation

For manual Codex project hooks:

```sh
npm run capture:install
npm run capture:doctor
```

The installer creates missing configuration and merges project hooks. Review and trust them, then start a fresh local session. To target another project, pass `-- --project /absolute/path/to/project`. The installer references this checkout's compiled CLI, so keep the checkout available and rebuild after changing source.

For the ChatGPT/Codex marketplace plugin, use the [ChatGPT quickstart](quickstart-chatgpt-desktop.md). The plugin supplies hooks; its setup skill configures each project without adding another set. For local Claude Code, follow the [Claude quickstart](quickstart-claude-desktop.md) and browser connection flow. Do not combine manual and plugin capture handlers in the same project.

Doctor verifies local setup, not connectivity or client hook activation. Submit a test prompt in a fresh session, inspect capture status, and retrieve the record from Redis before treating capture as working. See [troubleshooting](automatic-saving-operations.md#troubleshooting).

## Build and validate packages

| Command | Purpose | Live Redis required? |
| --- | --- | --- |
| `npm run check` | Type-check source | No |
| `npm test` | Build, unit tests, and prompt-recall smoke checks | No |
| `npm run plugin:test` | Check ChatGPT runtime freshness, validate profiles, build ZIPs, and smoke-test packages | No |
| `npm run claude-plugin:test` | Validate Claude marketplace, runtime freshness, setup tests, and plugin smoke checks | No |
| `npm run mcpb:test` | Validate, build, and smoke-test the desktop MCPB | No |
| `npm run test:e2e:handoff` | Write and resume a handoff through both packaged servers | Yes; use a test store |

After runtime source changes, regenerate tracked bundles with `npm run plugin:runtime` and `npm run claude-plugin:build` before running freshness checks. Documentation-only changes do not require runtime regeneration. Plugin skills and READMEs are copied into packages during packaging.

ChatGPT packaging produces `build/redis-agent-memory-chatgpt-desktop-<version>.zip` (marketplace plus plugin) and `build/redis-agent-memory-chatgpt-local-<version>.zip` (plugin only). MCPB packaging produces `build/redis-agent-memory-<version>.mcpb`. Asset filenames use `package.json`'s version; marketplace plugin versions can advance separately. Check the installed plugin version when a feature requires a minimum version.

The handoff integration test exercises real storage through packaged server processes, not the apps' UI or model tool selection. It requires read/write/delete access and may leave derived memories if background promotion is enabled. See [live-test coverage and cleanup](handoff-workflow.md#test-the-claude-to-chatgpt-handoff).

## Native and bridge tools

Automatic capture talks to the native MCP endpoint itself. An agent-facing connection is optional; see [native MCP setup](native-mcp-setup.md) and the [recorded native tool inventory](native-tools.md).

The local bridge adds these explicit tools:

| Tool | Behavior |
| --- | --- |
| `memory_health` | Check the configured store |
| `memory_append` | Append an ordered user, assistant, or system event |
| `memory_get_session` | Read retained session events and an optional summary |
| `memory_search` | Search long-term memories by meaning, with owner and optional namespace filters |
| `checkpoint_save` | Create or update the durable checkpoint for an owner, namespace, and task session |
| `resume_context` | Read the checkpoint, session, and semantic recall together |

`memory_search` defaults to 8 results and a similarity threshold of 0.65; prompt-hook recall defaults to 5 and 0.7. These are separate settings. Session reads use the session ID directly. See [scope compatibility](handoff-workflow.md#scope-compatibility) before combining bridge tools with capture or imports.

For installation, see [bridge setup](bridge-setup.md). For history migration, see [imports and format limits](importing-memories.md). For operations, see [status, retries, and removal](automatic-saving-operations.md).

## Evidence and platform references

Repository behavior is defined by the current source, manifests, and tests. Historical endpoint tests in the native-tool guide are deployment snapshots. They do not prove that an app activated hooks or that another deployment exposes the same tools.

Platform claims were checked against these primary sources during the October 15, 2026 documentation review:

- [OpenAI hooks](https://learn.chatgpt.com/docs/hooks): event payloads, trust review, and local versus cloud orchestration.
- [OpenAI plugins](https://learn.chatgpt.com/docs/plugins) and [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp): installation surfaces and connection settings.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks) and [plugin installation](https://code.claude.com/docs/en/discover-plugins): lifecycle events and installation syntax.
- [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp): custom headers and remote setup.
- [Redis Agent Memory](https://redis.io/docs/latest/develop/ai/context-engine/agent-memory/): session history, long-term storage, retrieval, and background processing.

Desktop menu labels and authentication flows may change. The Claude marketplace credential issue reports linked in its quickstart explain the browser workaround; they do not establish that every current Desktop version behaves identically. Verify live delivery on the client and deployment you use.
