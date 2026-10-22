# Specification: current memory bridge

Date: 2026-10-20. Status: extracted implementation baseline, not a newly approved design.
Baseline: `506484c`, version `0.1.7`. Related [intent](intent.md), [plan](plan.md).

## Runtime and component map

Node >=20.12 runs strict TypeScript compiled as ESM with NodeNext module resolution.
Pinned runtime dependencies include MCP SDK `1.32.1`, Redis Agent Memory SDK `0.3.1`,
Zod `4.6.7`, PostHog Node `5.56.4`, and fflate `0.8.3`.

| Responsibility | Implementation evidence |
| --- | --- |
| MCP bridge and contracts | [index.ts](../../src/index.ts), [server.ts](../../src/server.ts), [memory.ts](../../src/memory.ts) |
| Claude setup surface | [claude-plugin.ts](../../src/claude-plugin.ts), [memory-setup.ts](../../src/memory-setup.ts) |
| Local event pipeline | [capture-cli.ts](../../src/capture-cli.ts), [capture.ts](../../src/capture.ts), [session-capture.ts](../../src/session-capture.ts) |
| Identity and private settings | [identity.ts](../../src/identity.ts), [project-identity.ts](../../src/project-identity.ts), [shared-settings.ts](../../src/shared-settings.ts) |
| Privacy and observations | [privacy.ts](../../src/privacy.ts), [hook-observations.ts](../../src/hook-observations.ts) |
| Recall and handoff | [prompt-recall.ts](../../src/prompt-recall.ts), [context-budget.ts](../../src/context-budget.ts), [automatic-checkpoint.ts](../../src/automatic-checkpoint.ts) |
| Import and operations | [claude-import.ts](../../src/claude-import.ts), [import-watch.ts](../../src/import-watch.ts), [diagnostics.ts](../../src/diagnostics.ts), [memory-check.ts](../../src/memory-check.ts) |
| Telemetry and feedback | [telemetry.ts](../../src/telemetry.ts), [feedback.ts](../../src/feedback.ts) |
| Distribution and checks | [package.json](../../package.json), [scripts](../../scripts), [plugins](../../plugins), [mcpb](../../mcpb) |

## Interfaces and supported surfaces

The bridge exposes six memory tools: `memory_health`, `memory_append`,
`memory_get_session`, `memory_search`, `checkpoint_save`, and `resume_context`.
It also exposes `feedback_submit`; the Claude plugin adds `memory_setup`.
The native remote service has a separate tool contract; do not assume bridge names
exist on it. See [native tools](../native-tools.md).

Configured local Codex and Claude Code hooks support queued capture and recall.
The Claude Desktop MCPB extension uses model-selected tools without a local hook queue.
Remote profiles and cloud workflows do not imply local lifecycle support. Packaging
and mock handler tests do not prove activation inside an installed desktop client.

## Data flow and durability

Hook payload → policy filtering/redaction → private durable local queue → ordered
session append → compatibility long-term message delivery → queued checkpoint work.
Recall reads scoped compatibility records; explicit resume combines checkpoint,
semantic matches, and ordered history. Imports preview by default and retain the
direct long-term write path when explicitly written.

New capture defaults enable session capture, compatibility capture, and automatic
checkpoints; session observations are disabled by default. Default session identity
includes owner, project, client, and source conversation. A configured task alias
shares a derived session only within matching owner/project scope. Bridge tool session
IDs are literal IDs. Namespace resources take precedence over legacy labels in the bridge.

Delivery keeps destination-scoped intent fingerprints and acknowledgments. A lost
append response requires readback reconciliation. Missing readback does not establish
that a write failed, so uncertain entries remain pending. There is no exactly-once
guarantee or cross-machine queue ordering. Keep queue receipts for recovery. See
[session delivery](../session-capture.md).

Automatic checkpoint revisions derive from retained session history and privacy policy.
Resume resolves freshness against that history; a fresh explicit checkpoint takes
precedence. `derived-not-persisted` is a read result, not an acknowledged save.
Generation quotes evidence without another model provider; service extraction and
summarization remain separate. See [checkpoints](../automatic-checkpoints.md).

## Privacy, configuration, and bounded context

Required bridge settings are `AGENT_MEMORY_BASE_URL`, `AGENT_MEMORY_STORE_ID`, and
`AGENT_MEMORY_API_KEY`. Document variable names, never real values. Project policy
lives in `.memory-capture.json`; private shared connection settings are outside Git.
Default guardrails enable credential, email, phone, government-ID, financial, and
personal-data redaction, with configurable additional fields and patterns. Redaction
is best effort, not a guarantee that arbitrary sensitive text is recognized.

| Context path | Default count | Default serialized character budget |
| --- | --- | --- |
| Startup recall | 6 | 18000 |
| Per-prompt recall | 5, similarity threshold 0.7 | 5400 |
| Bridge search | 8 | 12000 |
| Bridge session read | 20 events, paged | 12000 |
| Bridge resume | 8 matches plus 20 events and checkpoint | 12000 shared |

Character budgets allow 1024–100000 and count serialized UTF-16 code units, not tokens.
Truncation and pagination are explicit. Output limits do not bound backend transfer.
Client prompt-cache usage is not observable through these hooks. See
[recall budgets](../recall-budgets.md).

PostHog requires explicit enablement and a project token. `DO_NOT_TRACK=1` disables
traffic including feedback. Usage/error events use bounded operational fields and
sanitized exceptions; explicit feedback has a redacted message, category, and optional
rating. There is no structured log forwarding or disk telemetry retry queue. See
[PostHog](../posthog.md).

## Acceptance trace

| ID | Required behavior | Existing evidence to run or inspect |
| --- | --- | --- |
| A1 | Preserve scope and session/task identity | `test/project-identity.test.ts`, `test/session-capture.test.ts`, `test/memory.test.ts` |
| A2 | Preserve queue order and acknowledged progress across failures | `test/capture.test.ts`, `test/session-capture.test.ts` |
| A3 | Respect redaction and saving exclusions on writes and retries | `test/privacy.test.ts`, `test/capture.test.ts`, `test/hook-observations.test.ts` |
| A4 | Return fresh evidence without asserting inferred completion | `test/automatic-checkpoint.test.ts`, `test/memory.test.ts` |
| A5 | Bound context and preserve useful recent information | `test/context-budget.test.ts`, `test/server.test.ts`, `npm run eval:recall` |
| A6 | Keep package runtimes in sync and contracts usable | `plugin:test`, `claude-plugin:test`, `mcpb:test` scripts |
| A7 | Keep telemetry optional and feedback explicit | `test/telemetry.test.ts`, `test/server.test.ts` |
| A8 | Demonstrate actual storage, extraction, and host behavior separately | Opt-in checks and limitations in [verification.md](verification.md) |

These references identify coverage, not results from this documentation task.
Production service behavior, remote access policy, installed desktop activation,
and real retrieval quality need environment-specific evidence.
