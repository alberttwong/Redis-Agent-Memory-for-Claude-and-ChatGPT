# PostHog analytics, errors, and feedback

Telemetry is optional and disabled by default. Set these values in the project's ignored `.env` or the environment used to launch the bridge and capture hooks:

```dotenv
POSTHOG_ENABLED=true
POSTHOG_API_KEY=your-posthog-project-token
POSTHOG_HOST=https://us.i.posthog.com
```

Use `https://eu.i.posthog.com` for EU projects. Use a project token, not a personal API key. Tokens are never embedded in the distributed plugins. Project IDs are used in dashboard URLs and are not required for ingestion. `DO_NOT_TRACK=1` disables all PostHog traffic, including feedback. Restart existing MCP connections after changing configuration.

For Claude Code, the project `.env` is loaded from `MEMORY_CAPTURE_PROJECT_ROOT`, `CLAUDE_PROJECT_DIR`, or the current directory. The MCP bridge and capture CLI also load the project `.env`. Telemetry settings are not copied into the shared Redis credential file. For Desktop extensions launched outside the project, supply the variables in the MCP server's launch environment.

## What is collected

| Destination | Data |
| --- | --- |
| Product Analytics | `memory operation completed` events: operation name, surface (`mcp`, `claude-plugin`, or `capture`), success, duration in milliseconds, service name |
| Error Tracking | `$exception` events for tool, command, startup, uncaught runtime exceptions/rejections, and handled recall/delivery failures; fixed operation message, standard error type, and stack file basenames with line/column locations |
| Product Analytics feedback | `feedback submitted`: explicitly submitted message, category, and optional rating |

Operational telemetry never receives tool arguments, results, conversation text, memory contents, owner/namespace/store/session IDs, raw error messages, full filesystem paths, or credentials. Console output is not forwarded to PostHog. Errors caught internally by third-party dependencies are only visible when they reach an instrumented boundary. Minified plugin runtimes report bundle locations; source-map upload is not configured.

By default, each process uses a random anonymous ID, so counts of unique IDs represent processes. Set `POSTHOG_DISTINCT_ID` to a stable random installation ID to measure repeated usage and correlate events, errors, and feedback across process invocations. Avoid names or email addresses. Person profile processing and GeoIP are disabled.

Exports are batched with bounded queues and short request timeouts. Application operations continue when telemetry fails. Short-lived capture commands flush at completion; MCP connections flush on close and process shutdown. Uncaught runtime failures flush sanitized diagnostics before exiting with status 1; the import watcher retains its own graceful signal handling. Export failure can lose telemetry; there is no telemetry retry queue on disk.

## Submit feedback

Ask the connected agent to submit feedback, for example:

> Send product feedback: memory search is slow. Category bug, rating 2 out of 5.

The `feedback_submit` MCP tool accepts:

```json
{"message":"Memory search is slow","category":"bug","rating":2}
```

Categories are `bug`, `feature`, and `general` (default). Rating is optional and ranges from 1 to 5. Messages must contain 1–4000 characters after trimming. The tool is intended only for explicit feedback requests, never inferred sentiment or automatic conversation uploads. Feedback works independently of Redis credentials.

To submit through the CLI, pipe the message on stdin:

```sh
printf '%s' 'Memory search is slow' | node dist/src/capture-cli.js feedback --category bug --rating 2
```

Feedback is sent immediately and returns `submitted: true` only after the ingestion request succeeds. Disabled telemetry or an export failure returns an error instead. Recognized credentials, configured API keys, and common personal-data patterns are redacted from the message using the same privacy guardrails as memory capture. Redaction is best effort; omit sensitive details before submitting. Free-text feedback is never copied into usage events or exception messages.

Feedback is stored as a custom event in Product Analytics. Filter `feedback submitted` and inspect `message`, `category`, and `rating`; no PostHog Survey object is required.

## Verify in PostHog

1. Restart the bridge or invoke a capture command with telemetry enabled.
2. In Product Analytics, find `memory operation completed` and filter by operation and surface.
3. In Error Tracking, inspect a genuine failed operation. Error messages are intentionally generic; use the operation, error type, and stack locations to diagnose it locally.
4. Submit intentional feedback and find `feedback submitted` in Product Analytics.

Project ingestion uses the [PostHog Node SDK](https://posthog.com/docs/libraries/node), [manual exception capture](https://posthog.com/docs/error-tracking/installation/node) and the [event capture API](https://posthog.com/docs/api/capture).
