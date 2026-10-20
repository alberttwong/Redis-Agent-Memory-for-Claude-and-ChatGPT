# Release and recovery

Date: 2026-10-20. Status: source-based release checklist; no release executed.
Decision owner: unassigned. Remote protection and release automation: unverified.

## Distribution model

This private npm package builds three delivery surfaces: the ChatGPT/Codex plugin,
the Claude marketplace plugin, and the Claude Desktop MCPB extension. A remote
ChatGPT profile is also available. These connect to an external Redis Agent Memory
service; this repository does not define that service's production deployment.

## Prepare reviewable artifacts

1. Link the change's intent/spec/plan and review it against [REVIEW.md](../../REVIEW.md).
2. Build from the locked dependencies. If implementation changed, regenerate both
   plugin runtimes and run the applicable [verification commands](verification.md).
3. Use `npm run plugin:build`, `npm run claude-plugin:build`, and `npm run mcpb:build`
   for the applicable surfaces. Check manifests, archive contents, entry points,
   runtime requirements, and consistent release metadata.
4. For a remote profile, use the documented `plugin:build:remote` flow with the
   intended public MCP URL. Do not put bearer tokens into URLs or package contents.
5. Inspect the deliverable for private `.env`, `.memory-capture/`, transcripts,
   credentials, and local settings. Build outputs are ignored; checked-in plugin
   runtimes must remain synchronized with source.
6. Attach validation, compatibility changes, known limits, and recovery instructions
   to the PR/release record. Record who authorizes and performs distribution.

There is no verified production approval hook, automated publisher, or branch
protection configuration in this extracted baseline. Documented review instructions
do not enforce those controls. Publishing and production changes require their own
actual authorization; no new recurring or deployment jobs are created here.

## Verify the installed result

Restart MCP connections after runtime/configuration changes. Confirm installation,
enabled plugin, project setup, and host hook trust on each claimed local surface.
Use isolated marker tests from [diagnostics](../memory-diagnostics.md) to distinguish
capture, delivery, recall, emitted context, and host acceptance. Desktop Chat remains
tool-directed. Do not claim extraction from an acknowledged session append.

## Recovery

- Restore a known compatible package/runtime and restart the connection for an
  application regression. Preserve project policy, queue files, receipts, and settings.
- Set capture `enabled: false` if automatic delivery must stop. Pending entries are
  retained; re-enabling can resume delivery. This does not remove stored Redis data.
- For connectivity failures, inspect diagnostics and restore the intended destination
  before flushing. Do not switch stores and assume old receipts prove new delivery.
- For uncertain appends, inspect queue and retained session history. Follow the
  [explicit recovery procedure](../session-capture.md#retry-guarantees-and-uncertain-outcomes);
  `--retry-uncertain` can duplicate accepted events and is never a routine hook option.
- Historical backfill, deletion, service settings, and retention changes are separate
  operations. Package rollback does not reverse remote writes or extracted facts.

Record the affected version, observed symptom, recovery action, preserved evidence,
and verification result. Add a regression test and link follow-up work to an incident.
