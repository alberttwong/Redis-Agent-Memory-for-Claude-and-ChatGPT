---
name: setup-redis-memory
description: Configure, diagnose, retry, or import Redis Agent Memory for the current local ChatGPT or Codex project after the Redis Agent Memory plugin is installed.
---

# Set up Redis Agent Memory

Use this workflow only in a local desktop chat. The plugin hook is global, but it is intentionally a no-op until the current project contains `.memory-capture.json`.

## Locate the packaged CLI

Resolve the plugin root as the directory two levels above this `SKILL.md`. The CLI is `<plugin-root>/server/capture-cli.js`. Always pass the repository root explicitly with `--project`.

## Configure a project

Run:

```sh
node <plugin-root>/server/capture-cli.js configure --project <repository-root>
```

This creates a default-enabled `.memory-capture.json`, a private `.env` template, and safe `.gitignore` entries. It does not add project-level hooks because the installed plugin already supplies them.

Check `doctor --plugin` before requesting credentials. A missing project `.env` is valid when the doctor resolves credentials from shared settings.

If credentials are missing, ask the user to fill in these values locally; never request, display, or copy the API key into chat:

- `AGENT_MEMORY_BASE_URL`
- `AGENT_MEMORY_STORE_ID`
- `AGENT_MEMORY_API_KEY`

Then run `doctor --project <repository-root> --plugin`. Start a new local chat after the plugin hook has been reviewed and trusted.

## Operate capture

- Inspect identity and queued writes with `status --project <repository-root>`.
- Retry queued writes with `flush --project <repository-root>`.
- Preview imports with `import-claude` or `import-chatgpt` plus `--input`; add `--write` only after the user approves the preview.
- Disable capture by setting `enabled` to `false` in `.memory-capture.json`.

## Share settings across worktrees and checkouts

When the user wants to reuse this project's Redis connection, run:

```sh
node <plugin-root>/server/capture-cli.js share-settings --project <repository-root>
```

This copies only Redis memory settings from the project's `.env` into `~/.config/redis-agent-memory/shared.json`, with private file permissions. It does not copy unrelated project secrets. Existing different shared settings require an intentional `--replace`; do not overwrite them without the user's authorization.

Process environment values take precedence, followed by non-empty project `.env` values, then shared settings. Blank template values do not shadow shared settings. Doctor reports the credential sources without their values. Run doctor against another worktree to verify fallback; do not copy the API key into chat.

Both the capture CLI and bridge use this resolution. Keep `.memory-capture.json` enabled in each project that should capture turns. Shared credentials do not enable capture in unconfigured projects.
Configured local projects automatically retrieve owner- and namespace-scoped relevant memories at each submitted prompt as well as saving supported turns. Defaults are `promptRecall: true`, `promptRecallLimit: 5`, and `promptRecallThreshold: 0.7` in `.memory-capture.json`; existing files use these defaults without being rewritten. To disable per-prompt retrieval while keeping saving, set `promptRecall: false`, preserving other settings. Retrieval requires active plugin hooks and a working Redis connection; doctor alone does not prove it ran. Startup recent-memory recall uses the separate `recallLimit` setting.

## Memory privacy guardrails

Follow the configured memory guardrails supplied by the server and local hooks. Local projects can set `guardrails` in `.memory-capture.json`; keep existing settings unless the user requests a change. By default, omit passwords, credentials, and sensitive personal information from memory text, metadata, checkpoints, imports, and identifiers. Respect disabled message roles and omitted context fields. Never store the configured Redis API key, even when credential redaction is disabled. Without a configured policy, use the default protections. Automatic redaction is a fallback and cannot detect all sensitive information.
