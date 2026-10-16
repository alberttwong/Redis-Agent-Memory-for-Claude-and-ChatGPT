# Automatic saving operations

[Back to README](../README.md)

For capture/delivery timestamps, scoped recall evidence, troubleshooting, and a cross-client marker check, see [Memory diagnostics](memory-diagnostics.md).

The capture handler runs locally with Node.js 20.12+ and is enabled by default by `ram-capture install`. It connects to Redis's native MCP endpoint directly; registering the optional stdio bridge is not required.

The owner defaults to a hash of the OS account and hostname, the namespace defaults to a hash of the canonical Git remote identity (with local fallbacks; see [identity and migration rules](automatic-capture.md#automatic-repository-identity-and-compatibility)), sessions derive from each client conversation, and memory IDs are generated automatically. Set `AGENT_MEMORY_OWNER_ID` in the private `.env` only when the same identity must be shared across computers.

## Reuse Redis settings across worktrees and checkouts

After configuring one project's `.env`, share its Redis settings once:

```sh
npm run capture:share-settings
```

That command is for a source checkout. With the installed desktop plugin, ask:

> Use setup-redis-memory to share this project's Redis settings across worktrees and checkouts.

The command copies only Redis memory settings to `~/.config/redis-agent-memory/shared.json`. It excludes other project secrets, keeps the original `.env`, and uses private file permissions. These defaults apply to configured projects under the same OS account; each project retains its own capture configuration, namespace, and queue.

The standalone capture CLI and ChatGPT/local bridge resolve values in this order:

1. Non-empty process environment values.
2. Non-empty values in the current project's `.env`.
3. Shared settings.

Blank installer templates do not hide shared settings. A new worktree can pass `doctor --plugin` with no `.env` when shared credentials are available. The doctor's `environment` section reports the files present and each credential's source, never its value. Project overrides stay local to that checkout.

To replace existing different shared settings intentionally, run `npm run capture:share-settings -- --replace`. Advanced installations can select a different shared file with `AGENT_MEMORY_SHARED_SETTINGS_FILE`. Deleting the shared file removes the fallback; it does not delete Redis memories. Sharing settings does not enable capture in projects without an enabled `.memory-capture.json`.

The Claude marketplace integration has an additional distinction: capture hooks use non-empty environment, project, and shared values first, then fill missing values from the browser form's `connection.json`. Its MCP tools load the saved browser settings over the process environment. If those sources disagree, a health check can reach a different store from capture. Use one consistent connection and run the packaged capture doctor's `--settings` option against the same file used by the hooks.

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

Cloning or packaging this repository does not activate Codex hooks. For manual installation, `ram-capture install` writes project hooks. For marketplace installation, the plugin supplies the hooks and `configure` creates only project configuration. Use one route per project to avoid duplicate capture.

## Troubleshooting

| Symptom | Check | Next step |
| --- | --- | --- |
| Doctor passes but nothing is saved | Doctor checks local files and credential presence, not hook execution or connectivity | Start a fresh local session, inspect and trust hooks, submit a test prompt, then retrieve its record |
| Pending count stays above zero | Endpoint, store, key, network access, and queue permissions | Fix the connection and run `flush`; keep the queue until delivery succeeds |
| Pending count is zero but search finds nothing | Hook activation, owner, namespace field, search threshold, and indexing delay | Verify the actual scope and test a native scoped search; zero pending alone proves no capture |
| A new checkout recalls different context | Owner, selected remote, explicit namespace, or store differs; older records may use path-based scopes | Compare `status` output and follow the [identity and migration rules](automatic-capture.md#automatic-repository-identity-and-compatibility) |
| The same turn appears twice | Both plugin hooks and manually installed hooks may be active | Remove the redundant capture handlers and keep one installation route |
| Startup recall omits imported chats | Startup recall filters to the `auto-capture` topic | Use per-prompt recall or an explicit scoped search for imports |

`enabled: false` pauses capture hooks and their automatic searches/retries. It does not erase data or block an explicit `flush` or an import with `--write`. To stop delivery altogether, also stop any running import watcher and avoid manual flushes.

For recovery, retain `.memory-capture/queue/` and the watcher's `.memory-capture/imports/` ledger. Queue entries contain conversation text after best-effort redaction; protect them as local data. Replaying the queue preserves record IDs. Removing the queue before delivery loses pending records; removing the import ledger can cause files to be processed again. Capture is not a backup of files or a complete transcript.

## Remove automatic saving

Run `ram-capture uninstall` or `npm run capture:uninstall` to remove only the installer-managed hooks. Local configuration, credentials, and queued data are deliberately preserved.

For retry behavior, identity overrides, supported events, and implementation details, see the [automatic capture guide](automatic-capture.md). Earlier project validation covered prompt delivery, final-response capture, retry, and cross-client recall using hook payloads; it does not certify hook activation in your app. New automatic capture writes ordered sessions and compatibility long-term `message` records. Imports and older queues remain direct-only; see [session capture and recovery](session-capture.md).

The recorded native-tool inventory and direct cross-agent workflow are documented separately in [Native Redis Agent Memory tools](native-tools.md).

Ordinary Claude Desktop Chat uses a different, best-effort workflow without lifecycle hooks or a local retry queue. Local Claude Code sessions in Desktop can use the marketplace capture hooks. See [Claude Desktop setup and limitations](claude-desktop.md).
