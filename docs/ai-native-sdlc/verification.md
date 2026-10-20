# Verification and evidence

Date: 2026-10-20. Status: current test inventory; this file is not an execution report.
Sources: [package scripts](../../package.json), [tests](../../test),
[integration checks](../../integration), [recall evaluation](../../scripts/eval-recall.mjs).

## Local feedback loop

Install with `npm ci` using the locked dependency graph. From the repository root:

| Command | Expected result | Scope |
| --- | --- | --- |
| `npm run check` | Exit 0, no type errors | Strict TypeScript contracts |
| `npm test` | Unit tests and four smoke scripts pass | Build, source behavior, mocked packaged capture/recall/check paths |
| `npm run eval:recall` | Exit 0, JSON for five successful fixtures | Useful text retention, empty/greeting suppression, recent events, bounds |
| `npm run plugin:test` | Parity, manifests, archives, smoke pass | ChatGPT/Codex local and remote packaging |
| `npm run claude-plugin:test` | Parity, marketplace, setup, smoke pass | Claude plugin |
| `npm run mcpb:test` | Validation, build, smoke pass | Claude Desktop extension |

Use focused tests for the behavior being changed, then relevant distribution checks
when source affects generated runtimes. Regenerate with `npm run plugin:runtime` and
`npm run claude-plugin:build` before parity checks when needed. The installed pre-commit
hook runs `test:unit`; it does not establish full smoke, evaluation, or package coverage.

Recall fixture timing is local formatter/gateway timing with mocked responses, not
network latency, semantic-ranking quality, model answer quality, or cache efficiency.
Counts vary as tests evolve; attach current output instead of copying an old count.

## Opt-in environment checks

| Command | Prerequisites and side effects | What it establishes |
| --- | --- | --- |
| `npm run test:e2e:handoff` | Configured test Redis service; creates isolated fixtures and cleans them up | MCPB-to-ChatGPT-plugin storage/recall through live Redis |
| `npm run test:e2e:lifecycle` | Configured test Redis service; isolated observation records | Packaged observation handlers round-trip through Redis |
| `npm run test:e2e:sessions` | Configured test Redis service; isolated sessions/records; extraction polling up to eight minutes | Ordered delivery, compatibility, checkpoint/resume, packaged startup, separate extraction assertion |
| `RAM_RUN_HOST_HOOKS=1 npm run test:e2e:codex-host` | Authenticated Codex CLI, Node, Python, supported PTY; real model requests | Actual synthetic CLI dispatch and manual compaction; offline memory queue |

Use test credentials supplied privately. Read each harness before running it against
a shared store. Handler invocation does not prove actual host dispatch. The Codex
host harness does not establish desktop activation or live Redis delivery.
`RAM_CAPTURE_SKIP_EXTRACTION=1` explicitly skips extraction and must be reported as a skip.

## Known evidence limits

The existing [session guide](../session-capture.md) records a 2026-10-17 live run with
successful delivery/checkpoints but no scoped extracted fact within the polling window.
That report is historical; it neither diagnoses the service nor proves current failure.
The [checkpoint guide](../automatic-checkpoints.md) records tested CLI dispatch and
manual compaction versions, while desktop activation and other paths remain separate.
Neither historical result was rerun to create this documentation.

For installed-client claims, use a fresh supported local chat and inspect actual
hook dispatch plus [scoped diagnostic evidence](../memory-diagnostics.md). Model use
remains unknown unless the host supplies evidence. Store readiness and a zero queue
count alone are insufficient.

## Evidence to attach to a change

Record commit, runtime/client versions, exact commands, exit results, skips, mock
versus live dependencies, fixture cleanup, and unresolved risks. Avoid credentials
and conversation contents in attached output. Connect each changed acceptance case
from [spec.md](spec.md) to the check that covers it. For a bug fix, demonstrate the
failure before the fix and preserve that regression assertion.
