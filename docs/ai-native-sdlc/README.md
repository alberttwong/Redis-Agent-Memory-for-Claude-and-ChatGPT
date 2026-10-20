# Project SDLC artifacts

Extracted on 2026-10-20 from repository baseline `506484c` (package version `0.1.7`).
These documents describe the existing project and a proposed adoption path. They
do not claim historical requirements approval, a completed rollout, or new automation.

The artifact names and lifecycle organization follow Anthropic's
[AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook).
Project behavior and validation details come from the local sources linked below.

## Read by purpose

| Stage | Artifact | Project-specific purpose |
| --- | --- | --- |
| Plan | [intent.md](intent.md) | Product problem, users, constraints, and unresolved outcomes |
| Design | [spec.md](spec.md) | Architecture, supported clients, contracts, source map, acceptance cases |
| Build | [plan.md](plan.md) | Documentation adoption work and sequenced engineering follow-ups |
| Build | [CLAUDE.md](../../CLAUDE.md) | Short startup context and real development commands |
| Test | [verification.md](verification.md) | Local checks, opt-in integration checks, and evidence limits |
| Deploy | [REVIEW.md](../../REVIEW.md), [release.md](release.md) | Review criteria, packaging, release evidence, and recovery |
| Maintain | [maintenance.md](maintenance.md) | Diagnostics, incident records, feedback, and follow-up work |

## Evidence and ownership

Code, schemas, manifests, tests, and package scripts establish the current implementation.
These Markdown files provide a dated interpretation; update them when behavior changes.
Existing focused operational guides remain authoritative for their procedures.
Git commits and PRs can link decisions, implementation, and validation. Redis memory
provides continuity, but retrieved reports alone do not establish a release or approval.

No committed GitHub Actions workflows were found in the inspected baseline. Remote
branch protections, repository settings, installed review apps, production dashboards,
and operational baselines were not inspected. Role assignments and service targets
remain unresolved rather than inferred from commit authorship.

## Use for the next change

Create `intent/<change-name>/intent.md`, `spec.md`, and `plan.md` for a substantial
change, linking back to this baseline. The current files are a project-wide extraction,
not a feature request to rebuild the system. A change intent should identify the
problem evidence, desired result, affected users, constraints, exclusions, success
conditions, and open questions. Its spec should name contracts, failure behavior,
alternatives, privacy implications, and acceptance cases. Its plan should name files,
work order, tests, recovery, and unresolved dependencies.

Record each artifact's author, date, status, related issue/PR, and decision evidence.
Leave approval pending until an actual decision exists. Keep implementation and plan
changes together; attach command results and remaining limits to the PR. New incident
work should link its evidence to a new change intent and regression case.
