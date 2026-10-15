# Automatic prompt capture

The project hooks save submitted prompts and final assistant responses to Redis without asking the user to supply memory IDs, an owner, a namespace, or a session on each turn. `SessionStart` fetches recent project memories and adds them as context for the next agent.

## Install in this repository

1. Install Node.js 20.12 or later, then run `npm install` and `npm run capture:install`.
2. Configure the generated private `.env` with the Redis endpoint, store ID, and API key. Existing `.env`, `.memory-capture.json`, hooks, and ignore rules are preserved or merged rather than replaced.
3. Run `npm run capture:doctor`. It reports missing local setup without contacting Redis.
4. Check `.memory-capture.json`. Capture is enabled for this project; edit `enabled` to `false` to turn it off.
5. For Codex, trust the project's `.codex/` configuration and review/trust the new hook definitions when the client requests it. Restart the app or session so it loads the hooks. A hook listed in the config is not proof that it has been trusted or executed.
6. Submit an ordinary prompt, then run `npm run capture:status`. A zero pending count means no entries are awaiting delivery; also verify a record in Redis or ask the connected agent to retrieve it.

Codex discovers `.codex/hooks.json`. Installer-managed hooks invoke the compiled CLI directly; the CLI derives the Git root, loads that project's `.env`, and uses that project's configuration and queue even when Codex starts from a subdirectory. The legacy shell launcher remains available for the checked-in Claude Code configuration and npm convenience commands.

Client versions and policy must support and allow `SessionStart`, `UserPromptSubmit`, and `Stop` command hooks. See the [Codex hook reference](https://learn.chatgpt.com/docs/hooks) and [Claude Code hook reference](https://code.claude.com/docs/en/hooks). Hooks need network access to the configured Redis endpoint. The SDK test does not prove that a particular Desktop installation has activated hooks; test a fresh session after trusting them.

## Identity defaults

| Identifier | Default | Override |
| --- | --- | --- |
| Owner | `user-` plus a hash of the hostname and OS username | `MEMORY_CAPTURE_OWNER_ID`, then `ownerId` in `.memory-capture.json`, then `AGENT_MEMORY_OWNER_ID` |
| Namespace | This repository explicitly uses `redis-agent-memory-mcp`; otherwise a project-directory slug plus path hash | `namespace` in `.memory-capture.json` |
| Session | Hash of client name and its conversation/session ID | `sessionId` in `.memory-capture.json` for an explicitly shared task |
| Memory ID | Hash including owner, namespace, session, client, turn identity, role, and chunk number | Generated automatically |

The owner is a local identity, not a claim about the signed-in OpenAI or Anthropic account. There is no shared provider-login identity resolution in this implementation. Two apps on one OS account and host derive the same owner; another account or host derives another. Set one stable owner explicitly to use the same memories across computers. For example, set `AGENT_MEMORY_OWNER_ID` in the private `.env`, rather than putting a personal owner into a shared repository.

Two people can use the same project namespace. Recall always combines **owner AND namespace**, and memory IDs include the owner, so their normal retrieval and writes stay distinct. These are organizational filters, not a security boundary: a shared store key grants the same service access to its holders. Use service-enforced access controls or separate stores/keys for isolation between untrusted users. Do not commit a shared `ownerId` if each contributor should retain their own identity.

Project namespaces must match across clones if cross-computer recall is desired. A different checkout path gets a different fallback namespace; configure the same explicit project namespace where needed. Separate conversations have separate sessions, while startup recall searches the owner's project namespace across conversations, including records captured by the other client.

## What is saved

- `UserPromptSubmit` saves the supplied prompt before the model processes it.
- `Stop` saves `last_assistant_message` when supplied by the client. Missing final-message fields are skipped; intermediate assistant messages, tool output, files, hidden reasoning, and aborted responses are not captured.
- Each record includes capture time, role, client, original session ID, optional turn ID, and chunk order. Long inputs are split into bounded records without discarding content.
- The configured Redis API key and recognizable `mem1_` credentials are redacted before queueing. This is not a general-purpose secret detector: other text is captured as supplied.

The handler uses the **native MCP `create_long_term_memories` tool with `memory_type: "message"`**. This is explicit transcript capture; it does not use Redis's ordered session-memory API or trigger that API's summarization/extraction path. Each captured chunk is embedded and subject to long-term-memory retention/cost. A native MCP session-append tool was not advertised by the tested deployment. The bridge's existing session tools remain available separately.

Startup recall uses filter-only `search_long_term_memory`, scoped to owner, namespace, and the `auto-capture` topic, ordered by update time. It returns at most `recallLimit` records (default 6) and limits context to 18,000 characters. This gives recent context, not a complete reconstruction of every conversation or a semantic summary. Retrieved content is marked as historical data; the agent still needs to verify the repository state.

## Retry behavior

Before network access, each event is written atomically to `.memory-capture/queue/` with private file permissions. Delivery removes an entry only when Redis acknowledges every record. Timeouts, outages, missing credentials, and partial failures retain the payload for later retry; the hook lets the conversation continue and emits a warning.

Queue replay preserves IDs so a retry of an accepted write reuses the same memory identity. The live native tool advertises idempotent create by ID. A single flush lock prevents concurrent queue drains; a lock belonging to an exited process is cleared for the next attempt. Without a client turn ID, each hook invocation receives a fresh identity so repeated identical prompts are not discarded. Reinvoking that hook is distinct from replaying its queued event.

Retries run on subsequent hook invocations, or manually:

```sh
npm run capture:status
npm run capture:flush
```

There is no background daemon or timer: if the client closes during an outage, queued entries wait for the next hook or manual flush. The network budget is 20 seconds within the configured 30-second hook timeout. Queue files contain conversation text, remain local and ignored by Git, and need to be retained until delivery; they do not survive loss of the local disk.

## Use another project

Install/build this package once, then point the installer at the target project:

```sh
node /absolute/path/to/redis-agent-memory-mcp/dist/src/capture-cli.js install --project /absolute/path/to/target
```

Or, after installing the package globally or from a packed tarball:

```sh
ram-capture install --project /absolute/path/to/target
```

The command merges all three Codex hooks, creates missing local configuration, and adds `.env` and `.memory-capture/` to the target's ignore file. Fill in the target's `.env`, run `ram-capture doctor --project /absolute/path/to/target`, then restart and trust/review the hooks as required. It does not silently approve hooks on the user's behalf.

`ram-capture uninstall --project /absolute/path/to/target` removes only handlers identified as Redis Agent Memory capture hooks. It preserves `.env`, `.memory-capture.json`, ignored queue data, and unrelated hook handlers so queued content cannot be deleted accidentally.

This installation is project-scoped. It does not record unrelated projects or ordinary Claude Desktop chats. Turn it off by setting `enabled: false`; pending entries remain on disk until capture is re-enabled and flushed.
