# Plan: adopt project SDLC documentation

Date: 2026-10-20. Status: documentation extraction prepared; engineering follow-ups proposed.
Inputs: [intent.md](intent.md), [spec.md](spec.md). Baseline: `506484c`.

## This change

1. Extract product scope and source-backed contracts into `intent.md` and `spec.md`.
2. Add root `CLAUDE.md` for startup context and `REVIEW.md` for review criteria.
3. Capture existing test commands and evidence boundaries in `verification.md`.
4. Document package release/recovery and diagnostic incident procedures in
   `release.md` and `maintenance.md`.
5. Link the artifacts from this folder's `README.md` and the main README.
6. Validate local Markdown targets, package-script references, baseline facts,
   and the diff. No application behavior or host configuration change is intended.

## Proposed follow-ups, in dependency order

| Work | Likely files | Completion evidence |
| --- | --- | --- |
| Assign decision/release/incident owners and supported-client matrix | These artifacts and quickstarts | Maintainer records actual decisions and unresolved exceptions |
| Establish deterministic CI | New `.github/workflows/ci.yml`, `package.json` only if needed | Clean runner executes check, local tests, recall eval, and package checks with no production credentials |
| Establish merge/release controls | Repository settings plus documented policy | Verified required checks and approval rules; settings evidence linked in PR |
| Add agent behavior evaluation cases | New `evals/`, optional runner/workflow | Synthetic prompts, expected outcomes, versioned model/skill configuration, defined budget and pass criteria |
| Close live-service and host evidence gaps | `integration/`, focused operations docs | Isolated live-store results, separate extraction evidence, current-client activation traces |
| Define maintenance signals and response authority | Diagnostic docs; future detector/config only after design | Measured baseline, tested detection, explicit actions, rollback rehearsal |

The existing recall evaluation is deterministic formatter/gateway coverage, not a
model behavior benchmark. No follow-up above is implemented merely by documenting it.

## Risks and alternatives

The main documentation risk is overstating confidence: older operation reports may
be stale, and mocked checks cannot establish live host or extraction behavior. Keep
dated evidence and link focused guides instead of copying their full procedures.
Do not add empty automation or approval hooks without agreed requirements. Existing
capture hooks record lifecycle data; they are not general production approval gates.

Keep the existing package and operations documentation in place. Replacing it with
one long playbook would obscure client-specific setup and failure recovery. A shared
project baseline plus separate change artifacts keeps future work attributable.

## Validation and rollback

For this documentation change, check relative links, real source/test paths, command
names, and source defaults. Record the actual checks in the delivery report. Application
tests are unnecessary unless code, manifests, generated runtimes, or behavior changes.
Rollback removes these new documents and the README link; it requires no data migration.
