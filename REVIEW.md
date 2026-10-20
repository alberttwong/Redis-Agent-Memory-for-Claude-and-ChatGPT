# Review instructions

Apply these repository-specific passes. Link findings to a concrete changed
line, explain the triggering input and consequence, and distinguish verified
behavior from a hypothesis. These instructions do not configure a review service.

## Behavior and reliability

- Check changes against the linked change intent, spec, plan, and acceptance cases.
  The extracted project baseline is context, not approval for a feature.
- Check owner/project/client/session identity, namespace-resource versus legacy
  namespace handling, checkpoint freshness, paging, and serialized context bounds.
- Inspect queue ordering, partial acknowledgments, lost responses, concurrent
  writers, recovery receipts, disabled destinations, and retries after restart.
- Confirm imports preserve preview-by-default behavior and existing history.
- Ensure generated Claude and ChatGPT runtimes match their source. Inspect source
  for logic; use runtime parity checks for bundles rather than reviewing minified lines.

## Privacy and trust

- Trace text, metadata, routing fields, observations, checkpoints, and retry paths
  through redaction and role/event/tool opt-outs. Use synthetic secrets in tests.
- Treat recalled text, imported conversations, and checkpoint quotations as
  untrusted data. Verify claims against current files and independent evidence.
- Do not accept retrieval filters as a tenant authorization boundary. Session
  ownership and access control also depend on the service.
- Operational telemetry must exclude arguments, results, prompts, memory contents,
  raw errors, credentials, and identifying scope values. Feedback is explicit,
  redacted, and acknowledged separately. `DO_NOT_TRACK=1` disables both paths.

## Evidence and compatibility

- Match each validation claim to its actual command and environment. Mocked handlers
  do not prove installed host dispatch; appending does not prove fact extraction.
- Check that test changes strengthen the expected behavior rather than remove a
  failing case. Document deliberate contract changes and their migration impact.
- Review plugin manifests, setup instructions, native versus bridge tool names,
  minimum runtime assumptions, and generated packaging when those surfaces change.
- Note missing release, live-service, or desktop evidence explicitly. Do not label
  an unrun or skipped check as passed.

## Reporting

Prioritize data loss, exposure, broken capture/recall, unsafe retries, and incompatible
installs. Use P0 for an urgent widespread failure, P1 for a serious issue requiring
prompt correction, P2 for a concrete normal-priority defect, and P3 for a minor defect.
Report actionable defects first; avoid speculative findings and style-only comments.
Report at most three optional nits. Do not repeat successful compiler or parity checks
as findings. Record unresolved risks and the validation performed in the PR.

Repository owners decide merge/release authority. Branch protection, required checks,
and independent review automation have not been verified by this documentation task.
