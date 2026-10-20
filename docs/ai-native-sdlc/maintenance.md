# Maintenance and incident feedback

Date: 2026-10-20. Status: operational guide and proposed measurement plan.
Incident owner, escalation route, SLOs, and monitoring cadence: unassigned.
No unattended monitoring or remediation is enabled by this file.

## Existing signals

Use [memory diagnostics](../memory-diagnostics.md) and the capture CLI to inspect
local status/doctor output for the relevant client and project. After building:

```sh
node dist/src/capture-cli.js status --client codex --project /path/to/project
node dist/src/capture-cli.js doctor --client codex --project /path/to/project
```

These inspect local evidence; a healthy setup does not prove actual host activation.
The separate `check` command writes a diagnostic marker and flushes pending work;
use it deliberately with the intended destination and follow the marker runbook.

| Symptom | First evidence and response |
| --- | --- |
| Capture absent | Check project/client, saving opt-outs, hook installation/trust, and a fresh actual chat |
| Pending queue grows | Compare delivery/failure timestamps, connectivity, destination, and service permission; preserve receipts |
| Session saved but recall empty | Compare store/owner/namespace and compatibility delivery; allow for indexing delay |
| Checkpoint missing or stale | Inspect pending jobs and retained history; use resume freshness resolution |
| Append outcome uncertain | Reconcile against retained history; do not blindly resend |
| Extraction not observed | Inspect service configuration, asynchronous job/provider health, and scoped results independently |
| Telemetry absent | Check opt-in and `DO_NOT_TRACK`; exports are best effort without disk retries |

Historical failures can coexist with a newer success. Missing diagnostics are unknown,
not success. Diagnostics exclude conversation contents; queue files contain redacted
content and need private handling. See [release recovery](release.md).

## Feedback and telemetry

Optional PostHog records operation name/surface, duration, success, sanitized exceptions,
and explicitly submitted feedback. Per-process random IDs are the default, so unique
IDs are not user counts. Feedback categories are bug, feature, or general, with an
optional 1–5 rating. Do not infer consent from dissatisfaction or forward conversations.
See [PostHog operations](../posthog.md). Structured log export is absent.

## Proposed measurements

| Question | Candidate measure | Evidence still needed |
| --- | --- | --- |
| Does delivery recover? | Pending count, delivery age, unresolved intents | Agreed polling cadence and acceptable delay |
| Is recall useful? | Expected scoped decisions recovered in representative tasks | Labeled synthetic/consented cases and quality threshold |
| Are packages reliable? | Local/package check failures and installed-client regressions | CI history and maintained client matrix |
| Does review catch errors? | Defects caught before release versus escaped defects | Linked PR and incident records |
| Is operation performance acceptable? | Per-operation latency and error rate when telemetry is enabled | Stable baseline, sample size, and service targets |

These are proposed measures, not existing dashboards or established thresholds.
Before automatic triage, assign owners, collect a baseline, test deterministic
detection, limit tool authority, and rehearse recovery. Start with read-only diagnosis
or a proposed patch; any rollout needs a separately agreed design and authority.

## Incident record and return to development

For an actual incident, create `docs/incidents/<date>-<slug>.md` with status, affected
versions/surfaces, sanitized evidence, impact, UTC timeline, confirmed cause versus
hypotheses, actions taken, recovery evidence, and unresolved questions. Do not invent
an incident to fill this directory.

Create a linked `intent/<change-name>/intent.md` for follow-up work. Carry measurable
acceptance cases through its spec and plan, add a regression test or evaluation,
record the release, and update the relevant operations guide. Update `CLAUDE.md`
when a repeated mistake reveals missing startup context. Memory checkpoints may
link this evidence, but their quotations do not replace it.
