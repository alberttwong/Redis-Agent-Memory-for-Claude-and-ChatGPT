---
name: setup-redis-memory
description: Open the Redis Agent Memory credential setup form in a local Claude Code desktop session, or update its saved connection.
---

# Set up Redis Memory

Call the plugin's `memory_setup` tool. Give the user the returned local browser link so they can enter their Redis URL, store ID, and API key in the form. Do not ask them to put credentials in chat or edit the read-only connector details.

After the user saves the form, call `memory_health` to check the connection. If it fails, describe the error without exposing credentials. Do not claim a successful connection based on installing the plugin or discovering its tools.

The form runs on the same computer as the local MCP server. Use a local Claude Code session on This computer. A cloud or isolated VM session may not expose its loopback address to the user's browser.

For automatic saving in the current local Claude Code project, run the bundled CLI after the connection is configured:

```sh
node "${CLAUDE_PLUGIN_ROOT}/server/capture-cli.mjs" configure --project "${CLAUDE_PROJECT_DIR}" --settings "${CLAUDE_PLUGIN_DATA}/connection.json"
node "${CLAUDE_PLUGIN_ROOT}/server/capture-cli.mjs" doctor --plugin --project "${CLAUDE_PROJECT_DIR}" --settings "${CLAUDE_PLUGIN_DATA}/connection.json"
```

Claude substitutes the plugin paths in this skill when loading it. These commands create a missing `.memory-capture.json` with capture enabled and ignore the local retry queue. Existing configuration, including an explicit opt-out, is preserved. Explain that prompts and available final responses will be saved to Redis and temporarily queued locally during outages. No `.env` edits are needed when the browser connection is configured. Hooks fill missing credentials from that file after environment, project, and shared settings, while MCP tools prefer saved browser settings over environment values. Check for conflicting connections if health passes but capture reaches another store. Capture uses the namespace label in `.memory-capture.json`, not the browser form's namespace resource ID or legacy namespace. Match the actual scope before claiming that saved tool records and captured messages are jointly searchable. The doctor checks local setup; it does not prove live delivery or hook activation.

Start a new local Claude Code session with the plugin enabled and inspect `/hooks` for all 12 registered lifecycle events. Submit a test prompt and retrieve its saved record to verify delivery. Do not claim capture is active solely because doctor passes. To disable capture, set `enabled` to `false` in `.memory-capture.json`. Ordinary Desktop Chat does not run these hooks.

Configured local projects automatically retrieve owner- and namespace-scoped relevant memories at each submitted prompt as well as saving supported turns. Defaults are `promptRecall: true`, `promptRecallLimit: 5`, and `promptRecallThreshold: 0.7` in `.memory-capture.json`; existing files use these defaults without being rewritten. To disable per-prompt retrieval while keeping saving, set `promptRecall: false`, preserving other settings. Retrieval requires active plugin hooks and a working Redis connection; doctor alone does not prove it ran. Startup recent-memory recall uses the separate `recallLimit` setting.

## Memory privacy guardrails

Follow the configured memory guardrails supplied by the server and local hooks. Local projects can set `guardrails` in `.memory-capture.json`; keep existing settings unless the user requests a change. By default, omit passwords, credentials, and sensitive personal information from memory text, metadata, checkpoints, imports, and identifiers. Respect disabled message roles and omitted context fields. Never store the configured Redis API key, even when credential redaction is disabled. Without a configured policy, use the default protections. Automatic redaction is a fallback and cannot detect all sensitive information.

## Expanded observation controls and verification

The local Claude plugin registers 12 lifecycle events; the local ChatGPT/Codex plugin and project installer register six (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `Stop`). Review/trust changed definitions and start a fresh supported local chat. Additional hooks record bounded tool/lifecycle observations with a separate OBSERVATION role. Startup and submitted-prompt recall remain unchanged. PreCompact records supplied boundary context and queues an automatic evidence checkpoint from retained captured session history. It does not read a transcript or inject compaction context. Stop also generates a checkpoint, including when its payload has no final response. Generation is provider-free and quotes evidence without inferring completion or successful validation. Set automaticCheckpoints: false to disable it; enabled: false and sessionCapture: false also disable generation. Inspect checkpointPending and checkpoint diagnostics independently of session delivery. A fresh chat can discover the latest saved checkpoint through scoped compatibility startup recall; use resume_context with a known session ID for deliberate continuation. Historical automatic revisions are excluded from default bridge and prompt recall. Decision supersession and semantic synthesis remain separate capabilities; verify quoted historical statements against current evidence.

Preserve existing settings. Configure `observations.enabled`, `observations.excludedEvents`, `observations.excludedTools` (case-insensitive exact names or `*` globs), `observations.inputChars` (default 2000) and `observations.outputChars` (default 4000), or disable all observations through `guardrails.captureObservations: false`. Both budgets accept 0–6000. Memory tools and capture-handler commands are excluded automatically. Event/tool exclusions and privacy rules also apply to queued retries. `enabled: false` retains pending entries and prevents flush delivery until re-enabled.

Use status's `diagnostics.hookDispatch` to distinguish observed event invocations from unknown activation, and `lastDelivery` to check acknowledgments. Run a harmless real tool, retrieve its observation under the expected owner/namespace, and test an actual host compaction separately. Mock/handler tests and `doctor --plugin` do not prove live host dispatch, minimum host version support, desktop activation, or model use. Unknown dispatch requires checking version, trust, host support, project and policy. Ordinary ChatGPT/Claude Chat, Cowork, and the hook-free remote profile gain no verified passive capture from this expansion.

## Automatic session delivery

Configured projects default to `sessionCapture: true` and `compatibilityCapture: true`. New captured prompts/responses enter a stable owner/project-scoped session via the official Redis SDK before compatibility message delivery. Both destinations have separate durable receipts. `sessionId` is a task alias, hashed with owner/project scope; obtain the actual derived session ID from startup context or a captured record before calling session read/resume tools. Imports and older queue entries remain direct-only; do not replay history into extraction automatically.

Service extraction/summarization must be configured separately and may send session content to its model provider. Never infer extraction completed from session acknowledgment. Optional `sessionObservations: true` includes bounded useful tool outcomes as labeled SYSTEM evidence; noisy lifecycle boundaries stay out. Exclusions and privacy apply before both destinations and retries. `sessionCapture: false` or `compatibilityCapture: false` disables that destination for new and pending v2 capture; re-enabling does not backfill entries already completed. Project `enabled: false` retains the whole queue.

If append acceptance is uncertain, normal retries reconcile the stable capture identity in retained session history and do not blindly append. Missing readback, expired history, changed privacy, or conflicting duplicates requires inspection. Explain possible duplicate creation and extraction before using explicit `flush --retry-uncertain`; do not add that flag to automatic hooks. Upstream Iris issues #1842 and #1896 track server/SDK idempotency. `sessionDelivery`, `sessionFailure`, and compatibility `lastDelivery` diagnostics are distinct; extraction remains independently unverified.
