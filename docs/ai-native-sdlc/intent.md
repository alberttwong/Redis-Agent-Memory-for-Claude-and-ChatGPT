# Intent: durable project memory across assistants

Date: 2026-10-20. Status: extracted product baseline; maintainer review pending.
Source: repository `506484c`, especially [README.md](../../README.md).
Author: repository analysis prepared with an AI assistant. Accountable product owner: unassigned.

## Problem and desired outcome

Project knowledge is lost across fresh chats, context compaction, assistant switches,
and usage-limit interruptions. Users repeat earlier decisions and agents can resume
from stale or incomplete summaries. This project supplies shared Redis-backed memory
so a connected assistant can recover relevant history and continue with current evidence.

## Users and existing workflows

- Local Claude Code and ChatGPT/Codex users save permitted prompts, available final
  responses, and bounded lifecycle observations through configured hooks.
- Ordinary Claude Desktop Chat users explicitly save and retrieve through MCP tools.
- Users moving between assistants share store and scope settings, and use a deliberate
  task alias when they want one continuing session.
- Users with older Claude or ChatGPT exports preview and selectively import history.
- Operators inspect capture, delivery, recall, and checkpoint diagnostics independently.

## Success conditions

1. Permitted turns survive an outage in the local queue and reach ordered session
   history, with compatibility long-term records available for recall.
2. Fresh supported local sessions can discover relevant scoped context and saved
   checkpoints without treating quoted assistant reports as established facts.
3. Explicit handoffs carry a goal, decisions, completed work, blockers, and next steps.
4. Redaction, opt-outs, context bounds, and uncertainty reporting remain intact.
5. Distributed packages behave consistently with the source implementation.

These are implementation goals with corresponding checks in [spec.md](spec.md).
No measured adoption, answer-quality, retention, or production reliability target is
inferred from the repository.

## Constraints and exclusions

Use the official Redis Agent Memory SDK and existing service APIs. Keep credentials
outside Git. Hook capture requires an actually supported, configured local host;
ordinary Chat and cloud-orchestrated Work do not acquire passive local capture.
Scope filters do not replace service access controls. Service extraction is asynchronous
and separately configured. Automatic checkpoints are evidence quotations, not semantic
task synthesis. Preserve existing history and uncertain delivery evidence.

Telemetry is optional and excludes conversation contents from operational events.
Feedback is explicitly submitted. Structured log export is not part of the implementation.
This extraction does not authorize changing store settings, migrating history, enabling
telemetry, publishing packages, or introducing unattended agents.

## Open questions

- Who owns product decisions, privacy policy, releases, and operational incidents?
- Which desktop/client versions and lifecycle events must be verified for each release?
- What service-side evidence will establish extraction health and failure causes?
- What latency, retrieval quality, recovery-time, and retention targets are appropriate?
- Should CI, branch protection, agent evaluations, and maintenance triggers be added,
  and what budget and authority would each receive?
