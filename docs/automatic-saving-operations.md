# Automatic saving operations

The capture handler runs locally with Node.js 20.12+ and is enabled by default by `ram-capture install`. It connects to Redis's native MCP endpoint directly; registering the optional stdio bridge is not required.

The owner defaults to a hash of the OS account and hostname, the namespace defaults to the project name, sessions derive from each client conversation, and memory IDs are generated automatically. Set `AGENT_MEMORY_OWNER_ID` in the private `.env` only when the same identity must be shared across computers.

## Reuse Redis settings across worktrees and checkouts

After configuring one project's `.env`, share its Redis settings once:

```sh
npm run capture:share-settings
```

That command is for a source checkout. With the installed desktop plugin, ask:

> Use setup-redis-memory to share this project's Redis settings across worktrees and checkouts.

The command copies only Redis memory settings to `~/.config/redis-agent-memory/shared.json`. It excludes other project secrets, keeps the original `.env`, and uses private file permissions. These defaults apply to configured projects under the same OS account; each project retains its own capture configuration, namespace, and queue.

Both the capture CLI and optional bridge resolve values in this order:

1. Non-empty process environment values.
2. Non-empty values in the current project's `.env`.
3. Shared settings.

Blank installer templates do not hide shared settings. A new worktree can pass `doctor --plugin` with no `.env` when shared credentials are available. The doctor's `environment` section reports the files present and each credential's source, never its value. Project overrides stay local to that checkout.

To replace existing different shared settings intentionally, run `npm run capture:share-settings -- --replace`. Advanced installations can select a different shared file with `AGENT_MEMORY_SHARED_SETTINGS_FILE`. Deleting the shared file removes the fallback; it does not delete Redis memories. Sharing settings does not enable capture in projects without an enabled `.memory-capture.json`.

## Check status and retry delivery

Check delivery or retry pending writes at any time:

```sh
npm run capture:status
# Retry delivery if pending is greater than zero:
npm run capture:flush
```

The status command reports the resolved owner, namespace, and pending queue count. Use those values to inspect Redis records with the `auto-capture` topic, or ask the agent: “Retrieve my recent project memories using the scope supplied by the capture hook.” A zero pending count only describes the queue; verify a saved record to confirm that the client actually invoked a hook.

## Install in another project

Capture is project-scoped. Opening another project does not install hooks there. To record work in another application repository, follow [Use another project](automatic-capture.md#use-another-project), which covers merging hooks, using the installed handler's absolute path, and configuring a separate project namespace.

Cloning or packaging this repository does not activate Codex hooks. Hooks are written into a target project only when `ram-capture install` or `npm run capture:install` runs explicitly.

## Remove automatic saving

Run `ram-capture uninstall` or `npm run capture:uninstall` to remove only the installer-managed hooks. Local configuration, credentials, and queued data are deliberately preserved.

For retry behavior, identity overrides, supported events, and implementation details, see the [automatic capture guide](automatic-capture.md). The handler has been tested live for prompt delivery, final-response capture, retry, and cross-client recall using hook payloads. Records use long-term-memory type `message`, not Redis's ordered session-memory API.

The verified native-tool inventory and direct cross-agent workflow are documented separately in [Native Redis Agent Memory tools](native-tools.md).

Claude Desktop uses a different, best-effort workflow without lifecycle hooks or a local retry queue. See [Claude Desktop setup and limitations](claude-desktop.md).
