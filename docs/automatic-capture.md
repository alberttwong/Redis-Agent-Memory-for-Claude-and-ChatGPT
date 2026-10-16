# Automatic prompt capture

[Back to README](../README.md)

For capture/delivery timestamps, scoped recall evidence, troubleshooting, and a cross-client marker check, see [Memory diagnostics](memory-diagnostics.md).

The project hooks save submitted prompts and final assistant responses to Redis without asking the user to supply memory IDs, an owner, a namespace, or a session on each turn. `SessionStart` fetches recent project memories and adds them as context for the next agent.

For routine status checks, retries, installation in another project, and removal, see [Automatic saving operations](automatic-saving-operations.md).

## Claude Code marketplace (default)

Install **Redis Agent Memory** through **Add marketplace**, then run `/redis-agent-memory:setup-redis-memory` in a local Claude Code project. Follow the [Claude Desktop quickstart](quickstart-claude-desktop.md). Claude plugin v0.1.10 registers 12 lifecycle events in `hooks/hooks.json` and bundles a standalone capture CLI; no clone or source build is required.

The setup skill creates a missing `.memory-capture.json` with capture enabled and adds the private queue to `.gitignore`. Existing opt-outs are preserved. An unconfigured project is skipped. Hooks use the current Claude project root, not the plugin install directory. Credentials resolve from environment, project `.env`, shared settings, then the browser form's `connection.json` in the plugin data directory. The setup skill passes the same settings path when checking configuration. Captured prompts are queued before network access and retried on later events; final responses are saved only when supplied by Claude Code.

Start a fresh local session with the plugin enabled, inspect `/hooks`, and retrieve a saved test prompt from Redis. `doctor --plugin` assumes the plugin provides hooks; it cannot verify the app activated them. To inspect pending writes or retry manually, ask the setup skill to run the packaged CLI's `status claude` or `flush claude` with the same project and settings paths.

Use one capture hook installation per project. When developing this repository with the marketplace plugin enabled, remove the redundant Redis handlers from `.claude/settings.json` to avoid capturing the same event twice. Ordinary Desktop Chat and Cowork are not covered by this verified local Claude Code flow.

## Source development setup

1. Install Node.js 20.12 or later, then run `npm ci` and `npm run capture:install` from a source checkout.
2. Configure the generated private `.env` with the Redis endpoint, store ID, and API key. Existing `.env`, `.memory-capture.json`, hooks, and ignore rules are preserved or merged rather than replaced.
3. Run `npm run capture:doctor`. It reports missing local setup without contacting Redis.
4. Check `.memory-capture.json`. Capture is enabled for this project; edit `enabled` to `false` to turn it off.
5. For Codex, use `/hooks` in a local session to inspect and trust the project's hook definitions. Trust is recorded against the exact definition, so changed hooks require another review. Start a new local session after installation or approval. A hook listed in the config is not proof that it has been trusted or executed.
6. Submit an ordinary prompt, then run `npm run capture:status`. A zero pending count means no entries are awaiting delivery; also verify a record in Redis or ask the connected agent to retrieve it.

Codex discovers `.codex/hooks.json`. Installer-managed hooks invoke the compiled CLI directly; the CLI derives the Git root, loads that project's `.env` with [shared settings as fallback](automatic-saving-operations.md#reuse-redis-settings-across-worktrees-and-checkouts), and uses that project's configuration and queue even when Codex starts from a subdirectory. The legacy shell launcher remains available for the checked-in Claude Code configuration and npm convenience commands.

Client versions and policy must support and allow the registered command hooks. The expanded manifests require all 12 Claude or six Codex events listed below; older hosts may reject unknown events. No minimum released host version has yet been verified for the expanded coverage. See the [Codex hook reference](https://learn.chatgpt.com/docs/hooks) and [Claude Code hook reference](https://code.claude.com/docs/en/hooks). Hooks need network access to the configured Redis endpoint. The SDK test does not prove that a particular Desktop installation has activated hooks; test a fresh session after trusting them.

Codex command hooks run with local-only orchestration. They are not supported in cloud-orchestrated Work chats, including chats using local computer access. Enterprise environments that need cloud-orchestrated lifecycle callbacks should use the supported managed MCP-hook path described in the Codex hook reference.

## Identity defaults

| Identifier | Default | Override |
| --- | --- | --- |
| Owner | `user-` plus a hash of the hostname and OS username | `MEMORY_CAPTURE_OWNER_ID`, then `ownerId` in `.memory-capture.json`, then `AGENT_MEMORY_OWNER_ID` |
| Namespace | This repository explicitly uses `redis-agent-memory-mcp`; otherwise a canonical Git remote hash | `namespace` in `.memory-capture.json` |
| Session | Hash including owner, project namespace, client, and conversation ID | `sessionId` is a shared task alias, hashed with owner and namespace; it is not the literal Redis session ID |
| Memory ID | Hash including owner, namespace, session, client, turn identity, role, and chunk number | Generated automatically |

The owner is a local identity, not a claim about the signed-in OpenAI or Anthropic account. There is no shared provider-login identity resolution in this implementation. Two apps on one OS account and host derive the same owner; another account or host derives another. Set one stable owner explicitly to use the same memories across computers. For example, set `AGENT_MEMORY_OWNER_ID` in the private `.env`, rather than putting a personal owner into a shared repository.

Two people can use the same project namespace. Recall always combines **owner AND namespace**, and memory IDs include the owner, so their normal retrieval and writes stay distinct. These are organizational filters, not a security boundary: a shared store key grants the same service access to its holders. Use service-enforced access controls or separate stores/keys for isolation between untrusted users. Do not commit a shared `ownerId` if each contributor should retain their own identity.

Automatic namespaces match across worktrees and differently named clones when their selected remote identifies the same repository. Cross-computer recall also requires the same owner, store, and credentials; the default owner includes the hostname, so set a stable private `ownerId` when moving between machines. Separate conversations have separate sessions, while startup recall searches the owner's project namespace across conversations, including records captured by the other client.

## Project configuration

A minimal configuration for matching scope across checkouts is:

```json
{
  "enabled": true,
  "namespace": "checkout-project"
}
```

Keep the same explicit namespace in each checkout that should share context. Set a stable owner in private settings when moving between machines. Capture owner, namespace, and explicit session IDs accept 1–64 letters, numbers, or hyphens. Do not use email addresses or secrets as identifiers.

`recallLimit` accepts 0–20 (default 6). `promptRecallLimit` accepts 0–20 (default 5), and `promptRecallThreshold` accepts 0–1 (default 0.7). Set `recallLimit: 0` to disable startup recent-memory retrieval; `promptRecall: false` controls the separate per-prompt search.

### Automatic repository identity and compatibility

Without an explicit `namespace`, capture and import defaults use `repo-` plus a hash of the canonical Git remote identity. Git is inspected locally; resolving identity does not contact the remote. The remote named `origin` wins; if absent, the alphabetically first remote name wins. Adding or changing that selected remote can change the namespace. Forks with different origins remain separate even when they share an upstream. To intentionally share fork context, set the same explicit namespace; to separate worktrees of one repository, set different explicit namespaces.

HTTPS, HTTP, SSH (including `git@host:path`), and Git transport URLs normalize to lowercase host plus repository path, removing credentials, ports, query strings, fragments, trailing slashes, and a final `.git`. Repository path case is preserved for case-sensitive hosts. Ports intentionally do not distinguish repositories; use explicit namespaces for separate services on the same host and path. Remote URLs are never recorded in captured memory. Local/file remotes and unrecognized URLs use the local fallback.

Repositories without a usable selected remote use `local-` plus a hash of the absolute shared Git directory. This keeps a main checkout and its linked worktrees together, but cannot identify unrelated clones or machines. Non-Git folders (or unavailable Git) retain the directory slug plus path hash. Distinct repositories with the same folder name remain isolated. Capture records `repoPath` from the hook working directory (or project root), independently of namespace; existing `omitFields: ["repoPath"]` guardrails can remove it.

New writes use the resolved namespace. Startup and prompt recall also read the old path-derived namespace for the current project root and, for standard linked worktrees, the main checkout. Results prefer the new scope, deduplicate identical text, and fill only the configured recall limit. Existing queued writes keep their original namespace and IDs. No records are copied or deleted.

Old namespaces from other paths or machines cannot be inferred from a remote. Before moving or deleting an old checkout, run its old CLI's `status` and retain the namespace. Add it to `.memory-capture.json` to keep those records discoverable:

```json
{
  "legacyNamespaces": ["old-checkout-012345abcdef"]
}
```

Up to 20 aliases are accepted. `status` reports the active namespace and compatibility aliases. An explicit `namespace` disables automatic path aliases, preserving intentional project separation; only explicitly configured `legacyNamespaces` are then searched. You can also pin the old namespace as `namespace` to continue writing there. Compatibility reads retain the same owner filter; a previous machine's owner must be configured separately. Import dry runs use the same new default namespace, but do not migrate old records.

Capture does not read `AGENT_MEMORY_NAMESPACE_ID` or `AGENT_MEMORY_NAMESPACE` for its namespace. Those are bridge settings. See [scope compatibility](handoff-workflow.md#scope-compatibility) before mixing capture, imports, and bridge checkpoints.

## What is saved

- `UserPromptSubmit` saves the supplied prompt before the model processes it.
- `Stop` saves `last_assistant_message` when supplied by the client. Missing final-message fields are skipped; intermediate assistant messages and hidden reasoning are not captured. Tool observations are handled separately below.
- By default, each record includes capture time, role, client, original session ID, optional turn ID, and chunk order. Long inputs are redacted and split into records of at most 6,000 characters per content chunk.
- By default, the configured Redis API key and recognized credentials, labelled sensitive values, email addresses, US phone/SSN patterns, and card-number-like sequences are redacted before new records enter the local queue. Queued text is checked again before upload. Detection is best effort: omit sensitive information and disable capture for sensitive conversations, since names, addresses, and contextual PII may not be recognized. Existing stored records are not retroactively cleaned; older queue files are checked against the current policy when retried.

New automatic conversation capture writes ordered session events through the official Redis TypeScript SDK before delivering compatibility long-term `message` records through native MCP. Configured service extraction can process session events asynchronously. It does not require a native MCP append tool and does not generate handoff checkpoints. See [session delivery, extraction, migration, and recovery](session-capture.md). Imports and queues from older releases remain direct-only unless deliberately migrated. Each compatibility chunk is still embedded and subject to long-term retention/cost; session extraction can create additional records.

Startup recall uses filter-only `search_long_term_memory`, scoped to owner, namespace, and the `auto-capture` topic, ordered by update time. It returns at most `recallLimit` records (default 6) and limits the complete serialized context to `startupContextChars` (default 18,000 characters). This gives recent context, not a complete reconstruction of every conversation or a semantic summary. Retrieved content is marked as historical data; the agent still needs to verify the repository state.

## Expanded lifecycle observations

Claude plugin v0.1.10 registers `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Notification`, `TaskCompleted`, `Stop`, and `SessionEnd`. Local ChatGPT/Codex plugin v0.1.9 and the project installer register the six shared events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, and `Stop`.

Additional events are long-term message records with `role: "OBSERVATION"`, an event type, event identity, source timestamp when supplied, and available tool-call, agent, and task identifiers. They use the `auto-observation` topic, keeping frequent tool activity out of the startup `auto-capture` conversation filter; per-prompt semantic recall can still retrieve relevant observations. They are not user speech, extracted facts, or handoff checkpoints. Useful outcomes can optionally enter ordered history as labeled SYSTEM evidence through `sessionObservations`; noisy lifecycle boundaries remain direct-only. Linked tool events share their tool-call identifier. Unknown events and tool events lacking a tool name are skipped. The handler accepts at most 2 MB of stdin; larger or malformed payloads fail without blocking the host.

`PreToolUse` keeps bounded intent and file paths. `PostToolUse` keeps bounded results; `PostToolUseFailure` keeps the available error, interruption flag, and duration. Inputs are captured once before the call. Structured file contents/patch fields in inputs and built-in `Read`/`read_file` results are omitted to avoid copying whole files. Other file/tool outputs may still contain excerpts. Notifications, subagent boundaries, task completion, and session end keep only allowlisted supplied fields. A host reporting `TaskCompleted` or `Stop` is not proof that implementation or validation succeeded.

`PreCompact` records the boundary, trigger, and supplied custom instructions. The handler never follows `transcript_path` or reads a transcript. It emits `{}`: neither Claude nor Codex receives additional context from this handler at compaction. Existing queued task evidence is retried, but this does not preserve context absent from prior observations or generate an automatic checkpoint. Tool hooks also emit `{}`; automatic context enrichment remains at startup and prompt submission only. These choices follow the event-specific [Claude](https://code.claude.com/docs/en/hooks) and [Codex](https://learn.chatgpt.com/docs/hooks) contracts.

Tune the expanded scope independently in `.memory-capture.json`:

```json
{
  "observations": {
    "enabled": true,
    "excludedEvents": ["Notification"],
    "excludedTools": ["mcp__browser__*", "Bash"],
    "inputChars": 2000,
    "outputChars": 4000
  },
  "guardrails": { "captureObservations": true }
}
```

Exclusions apply to exact event names and case-insensitive tool-name globs (`*` is the wildcard). Memory tools and this capture handler's own commands are always excluded. `inputChars` and `outputChars` each accept 0–6000 and bound sanitized JSON excerpts; truncation is explicit, and excerpts need not be complete JSON. Routing fields and bounded correlation metadata are separate. Set either budget to zero to omit that payload. Structured privacy filtering runs before excerpts are truncated. The configured API key is always removed. Existing role controls stay independent; use `captureObservations: false` or `observations.enabled: false` to stop observations while keeping conversation capture. Current privacy rules and event/tool exclusions apply again when queued records are uploaded. No remote-only profile or ordinary ChatGPT/Claude Chat gains passive capture.

### Verification and host support

The source and packaged-handler tests cover representative payloads, exclusions, privacy, replay, outage/retry, and context budgets. They directly launch manifest commands with mock transport and **do not prove host dispatch**. Installed CLI versions inspected during development were Claude Code 2.1.301 and Codex CLI 0.163.0; neither version is claimed as a verified minimum. The opt-in `npm run test:e2e:lifecycle` test passed against the configured live Redis store: four tool observations from both packaged clients were delivered and retrieved under an isolated owner/namespace, then removed. This directly invokes handlers; actual host tool and `PreCompact` dispatch and local desktop activation still require separate verification before those acceptance criteria can be marked complete.

After updating, review/trust the changed hook definitions and start a fresh supported local chat. Inspect `/hooks`, run a harmless tool, then check `status` for `diagnostics.hookDispatch.PreToolUse` and `PostToolUse`. The recorded count is the number of queued chunks for that invocation, including zero for a skipped observation. Confirm `lastDelivery` and retrieve the scoped observation from another client. Trigger an actual `/compact` separately and check `hookDispatch.PreCompact`; launching the handler with a synthetic payload is not this test. Unknown dispatch means unobserved, not successful or necessarily unsupported. A dispatch record with no delivery points to queue/credential/network problems; no record requires checking host support, policy, trust, project selection, and activation. `doctor --plugin` cannot establish host activation.

## Configure memory guardrails

Add `guardrails` to the project's `.memory-capture.json`, preserving its existing fields. Omitted settings retain their defaults. For example, this policy allows email addresses, keeps other default redaction rules, adds a custom rule and sensitive metadata field, disables response saving, and omits original session/turn IDs:

```json
{
  "enabled": true,
  "guardrails": {
    "redact": {
      "email": false
    },
    "sensitiveFields": ["employeeCode"],
    "customPatterns": ["CLIENT-[0-9]+"],
    "capturePrompts": true,
    "captureResponses": false,
    "omitFields": ["sourceSessionId", "turnId"]
  }
}
```

| Setting | Default | Effect |
| --- | --- | --- |
| `redact.credentials` | `true` | Recognized keys, tokens, private keys, bearer headers, credential URLs, and labelled credential values |
| `redact.email`, `redact.phone` | `true` | Email addresses and US phone patterns, plus matching labelled values and metadata keys |
| `redact.governmentIds` | `true` | US SSN patterns and labelled SSN/passport fields |
| `redact.financial` | `true` | Card-number-like sequences and labelled card/bank-account fields |
| `redact.personal` | `true` | Labelled name, address, birth-date, and medical-record fields |
| `sensitiveFields` | `[]` | Additional structured field names whose values are redacted, matched case-insensitively at any depth |
| `customPatterns` | `[]` | JavaScript regular expression strings applied to text and metadata strings with global, case-insensitive matching |
| `capturePrompts`, `captureResponses`, `captureObservations` | `true` | Allow USER messages, ASSISTANT messages, and separate tool/lifecycle observations, respectively |
| `omitFields` | `[]` | Remove selected optional context fields from structured envelopes, metadata, and checkpoints |

Allowed `omitFields` values are `sourceSessionId`, `turnId`, `capturedAt`, `sourceFile`, `sourceConversationId`, `conversationTitle`, `sourceMessageId`, `repoPath`, `branch`, `commit`, `changedFiles`, `eventId`, `toolCallId`, `agentId`, and `taskId`. This removes structured fields, not mentions inside prose. Owner, namespace, derived session ID, record ID, source client, and role remain for routing and retrieval; backend timestamps are unaffected. Disable capture entirely with `enabled: false` to stop local automatic saving and recall.

The configured Redis API key is always redacted, even with `redact.credentials: false`. A disabled category permits that information unless another enabled rule matches it. Default detection remains pattern-based and does not recognize every name, address, or sensitive context. Custom patterns are trusted project configuration; avoid expressions with expensive backtracking.

Capture, import previews/writes, and queue delivery use this policy. Retries apply the latest rules and discard queued USER/ASSISTANT records whose saving has since been disabled. Previously removed text cannot be recovered by relaxing a rule. The policy does not rewrite existing Redis memories. Prompt recall uses the same text redaction rules, but disabling prompt saving does not disable sending a redacted query to Redis; set `promptRecall: false` to stop per-prompt searches.

The local MCP bridge reads the same file from `MEMORY_CAPTURE_PROJECT_ROOT`, then `CLAUDE_PROJECT_DIR` when available, then its working directory. Restart the bridge/chat after changes so its policy and agent instructions reload. Hooks reload the file on each invocation; restart a running import watcher to reload its policy. Invalid guardrail settings prevent writes instead of falling back to permissive behavior. `status` reports the resolved guardrails. Native Redis connections outside this bridge do not apply these local settings; the remote-only plugin retains default instructions.

## Relevant memories before each prompt

For configured local Claude Code and Codex projects, `UserPromptSubmit` automatically searches Redis using the submitted prompt and injects matching historical memories before the model processes the turn. No model-selected memory tool call is required. This requires Claude plugin v0.1.6+ or local ChatGPT plugin v0.1.5+; update the marketplace installation and start a fresh session.

Search uses the native MCP tool's `text`, `owner_id`, and `namespace` fields together, with a default similarity threshold of 0.7 and at most 5 results. It covers the owner's project memories, including imported messages and checkpoints stored under the same namespace field; it is not limited to the current session or automatically captured messages. Ranking comes from Redis, so matches are useful context rather than a guarantee of relevance or completeness.

The current prompt enters the local retry queue first, then retrieval runs **before** queued writes are uploaded so that the new record does not match itself. Older identical prompts may still match. Search text is redacted using the capture credential rules and capped at 6,000 characters. Retrieved context is capped at 5,400 characters, keeps ranked order, and is labeled as untrusted historical data rather than instructions. The agent must still check current files and user instructions.

The search has a six-second request timeout within the hook's existing total network budget. Empty results add no memories. A retrieval failure warns and continues with saving; a delivery failure preserves the queue and any context already retrieved. This adds a search per submitted prompt and may add latency and service usage.

Existing project configurations get these defaults without being rewritten. To tune or disable retrieval separately from saving, add these fields to `.memory-capture.json` while preserving its other fields:

```json
{
  "promptRecall": true,
  "promptRecallLimit": 5,
  "promptRecallThreshold": 0.7
}
```

Set `promptRecall` to `false` (or its limit to zero) to keep saving without per-prompt searches. Setting the project's `enabled` to `false` disables both capture and automatic retrieval. Startup recent-memory recall still uses the separate `recallLimit` setting.

## Retry behavior

Before network access, each event is written atomically to `.memory-capture/queue/` with private file permissions. Delivery removes an entry only when Redis acknowledges every record. Timeouts, outages, missing credentials, and partial failures retain the payload for later retry; the hook lets the conversation continue and emits a warning.

Queue replay preserves IDs so a retry of an accepted write reuses the same memory identity. Private `.memory-capture/queue/.receipts/` files record acknowledged IDs, including partially accepted batches, so hook replay and later retries skip accepted records. Receipts contain no conversation content and are retained until removed manually; deleting them removes local replay suppression. An accepted write whose response is lost has no local receipt and retries by the same service ID. The live native tool advertises idempotent create by ID. A single flush lock prevents concurrent queue drains; a lock belonging to an exited process is cleared for the next attempt. Tool observations use event IDs or tool-call IDs when supplied, with the hook event type included to separate intent from outcome. Agent and task lifecycle events use their available IDs; other turn-scoped observations use turn ID plus a content hash. Without stable identity, each hook invocation receives a fresh identity so repeated identical prompts are not discarded. Reinvoking that hook is distinct from replaying its queued event.

Retries run on subsequent hook invocations, or manually:

```sh
npm run capture:status
npm run capture:flush
```

The capture hooks do not start a background daemon or timer: if the client closes during an outage, queued entries wait for the next hook or manual flush. The network budget is 20 seconds within the configured 30-second hook timeout. Queue files contain conversation text, remain local and ignored by Git, and need to be retained until delivery; they do not survive loss of the local disk.

## Use another project

Install/build this package once, then point the installer at the target project:

```sh
node /absolute/path/to/redis-agent-memory-mcp/dist/src/capture-cli.js install --project /absolute/path/to/target
```

Or, after installing the package globally or from a packed tarball:

```sh
ram-capture install --project /absolute/path/to/target
```

The command merges all six Codex hooks, creates missing local configuration, and adds `.env` and `.memory-capture/` to the target's ignore file. Fill in the target's `.env`, run `ram-capture doctor --project /absolute/path/to/target`, then restart and trust/review the hooks as required. It does not silently approve hooks on the user's behalf.

`ram-capture uninstall --project /absolute/path/to/target` removes only handlers identified as Redis Agent Memory capture hooks. It preserves `.env`, `.memory-capture.json`, ignored queue data, and unrelated hook handlers so queued content cannot be deleted accidentally.

This installation is project-scoped. It does not record unrelated projects or ordinary Claude Desktop chats. Turn it off by setting `enabled: false`; pending entries remain on disk. Automatic retries resume when capture is re-enabled; an explicit `flush` also respects an existing project opt-out and retains pending entries until capture is re-enabled. Imports also require their own `--write` flag and are not disabled by this setting.

Both automatic recall paths support full serialized character budgets: `startupContextChars` defaults to 18000 and `promptContextChars` to 5400; both accept 1024–100000. Notices and JSON escaping count toward the cap. Greeting-only prompts skip search, empty results inject no per-turn context, and exact duplicate matches are removed. See [recall budgets and evaluation](recall-budgets.md) for limits, detail recovery, and prompt-cache observations.
