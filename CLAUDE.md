# Redis Agent Memory bridge

Persistent project memory for Claude and ChatGPT/Codex. Node >=20.12, ESM,
strict TypeScript, NodeNext resolution. Start with [README.md](README.md) and
[the project context](docs/ai-native-sdlc/spec.md).

## Commands

- `npm ci`: install the locked dependencies; prepare configures `.githooks`.
- `npm run check`: type checking; success exits 0 without diagnostics.
- `npm test`: compiled unit tests and packaged mock smoke tests; all must pass.
- `npm run eval:recall`: five deterministic recall fixtures; exits 0 and prints JSON.
- `npm run plugin:test`, `npm run claude-plugin:test`, `npm run mcpb:test`:
  validate and exercise the distribution surfaces; all must exit 0.
- Live checks are separate: see [verification.md](docs/ai-native-sdlc/verification.md).
  They can write test records or make billed model requests.

## Architecture and conventions

- `src/server.ts` exposes bridge tools; `src/memory.ts` adapts the official
  `@redis-iris/agent-memory` SDK. This is not a Redis server implementation.
- Capture flows through `capture-cli.ts`, `capture.ts`, `session-capture.ts`,
  `automatic-checkpoint.ts`; privacy rules live in `privacy.ts`.
- Use `.js` extensions for local TypeScript imports. Keep stdout valid for MCP
  or hook protocol responses; operational diagnostics belong on stderr.
- Edit `src/`, then regenerate checked-in plugin runtimes with
  `npm run plugin:runtime` and `npm run claude-plugin:build`; do not hand-edit bundles.
- Keep credentials, queue payloads, local transcripts, and private settings out
  of Git and documentation. Use synthetic fixtures and preserve privacy opt-outs.

## Verification and recurring pitfalls

- For a behavior fix, reproduce it with a focused regression test and preserve
  its assertion through the fix. Run relevant package checks when source affects bundles.
- Scope filters organize retrieval; they do not establish service authorization.
- Session delivery, compatibility recall, extraction, host dispatch, and model
  use are separate claims. Report only the layer actually tested.
- Retain uncertain queue entries and receipts. Never automate `--retry-uncertain`
  or claim exactly-once session delivery.
- Automatic checkpoints quote unverified history; they do not prove task completion.
- PostHog is opt-in; operational events exclude memory/conversation contents.
  Feedback requires an explicit request. Structured log forwarding is absent.
- Read [REVIEW.md](REVIEW.md) for review criteria. For substantial changes, use
  the [intent/spec/plan workflow](docs/ai-native-sdlc/README.md), keeping status honest.
