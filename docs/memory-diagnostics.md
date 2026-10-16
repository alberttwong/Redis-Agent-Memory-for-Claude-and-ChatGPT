# Capture, delivery, and recall diagnostics

[Back to README](../README.md) · [Automatic capture](automatic-capture.md)

A connection, an acknowledged write, or a zero queue count does not prove that a later chat received memory. Use these commands from a source checkout (or the installed plugin's bundled capture CLI with the same project and settings paths):

```sh
node dist/src/capture-cli.js status --client codex --project /path/to/project
node dist/src/capture-cli.js doctor --client codex --project /path/to/project
node dist/src/capture-cli.js check --client codex --project /path/to/project
```

`doctor --plugin` checks local configuration and assumes plugin hook definitions exist. `ok` means local setup passed; `checkType: local-setup-only`, `connection: not-tested`, and `hookActivation: unknown` make its limits explicit. Inspect `/hooks` and start a fresh supported local chat to confirm execution. Ordinary Claude Desktop Chat, Cowork, and cloud-orchestrated Work chats do not provide this project's verified command-hook lifecycle. `--claude-desktop` reports unavailable lifecycle diagnostics and has no local retry queue; use explicit MCP save/recall there.

## Read the evidence

`status` and `doctor` include `diagnostics` for the effective owner, namespace, and selected source (`codex` or `claude`). The source defaults to `codex`; the existing positional `status claude` syntax also works. Source selects local observations, not a remote identity or proof that the app is running. Scope follows the same owner precedence and namespace rules as capture. Compare the configured store as well as owner/namespace across clients; credentials and endpoint values are excluded from these observations.

| Field | What it proves |
| --- | --- |
| `lastCapture` | Timestamp and chunk count for the last successful local enqueue in this source/scope; not a remote write |
| `lastDelivery` | Timestamp and count of the last batch acknowledged by Redis for this source/scope; later failures do not erase that timestamp |
| `pending` | Number of queue files awaiting delivery, across **all** clients and scopes in this project; not a memory count |
| `promptRecall`, `startupRecall` | Latest observation for each hook, including timestamp, scope, and source |
| `recall.attempted` | Whether the search was invoked; a configuration or connection failure can be unavailable without an attempt |
| `recall.outcome` | `disabled`, `empty`, `returned`, or `unavailable`; empty is an executed search with zero returned records |
| `recall.count`, `recall.ids` | Returned result count and available safe IDs; IDs may be absent or omitted if unsafe. Counts can exceed IDs |
| `recall.context` | `none`, `prepared`, or `emitted-to-host`; the latter means additional context was written in hook output |
| `queryTruncated`, `contextTruncated` | Whether the query or returned memory text exceeded its configured context budget |

`state: unknown` means no observation exists for that client/scope, including installations predating diagnostics. `unavailable` means the observation cannot be read or validated. Neither means success. Timestamps are historical evidence, not a continuous health probe. A failed attempt replaces the latest recall observation; capture/delivery timestamps remain the last successes. Missing or unreadable queue state is `null`, never a successful zero count.

IDs describe returned results, including records omitted by the context budget; they do not establish that every record was emitted. The CLI cannot observe host acceptance of hook output, and **does not claim actual model use**. `modelUse` remains `unknown`. Inspect the host's hook/context trace where supported for evidence of acceptance; an assistant repeating the marker is only an additional observation, not proof that every future answer uses saved memory.

Diagnostics keep only the latest record per event type, source, and scope under private, ignored `.memory-capture/diagnostics/`. They contain no conversation text, search queries, returned memory text, raw errors, or authorization headers. Owner/namespace and safe memory IDs are operational metadata; do not put secrets into identifiers. Queue files separately contain redacted conversation text and retain their existing privacy policy. If diagnostic persistence fails, a warning says observations may be stale or unknown.

## Repeatable marker check

`check` deliberately writes one non-sensitive `ram-diagnostic-<UUID>` marker as a normal USER capture record. It respects `enabled`, prompt-saving policy, redaction, owner, namespace, session rules, the normal retry queue, and the native memory tools. It also flushes existing pending entries under current policy. It does not alter configuration, disable hooks, or delete Redis data. Markers remain ordinary stored messages subject to service retention.

1. Run `check --client codex --project /path/to/project`. Save its printed marker. The first JSON line reports the marker **before** network access. The final line reports delivery, pending count, exact marker retrieval, and diagnostic context preparation. Exit zero requires acknowledged delivery and scoped retrieval; a service/indexing delay can require a later retry.
2. For an outage rehearsal, run the check in an isolated test project against an intentionally unreachable HTTPS endpoint. Keep the marker and inspect `status`: capture is observed, delivery is unknown or has its prior timestamp, and pending is nonzero. Restore that project's endpoint and run `flush` using the same project and credentials. Do not change production settings for this rehearsal.
3. In the other supported local client, run its bundled CLI with the same store, owner, namespace, and project settings:

   ```sh
   node /path/to/capture-cli.js check --client claude --verify ram-diagnostic-REPLACE-WITH-PRINTED-UUID --project /path/to/project
   ```

   The Claude plugin's entry point is `server/capture-cli.mjs`; pass its normal `--settings /path/to/connection.json` if needed. `--verify` searches without writing another marker or flushing. It uses an exact match of the captured envelope's marker after a scoped semantic search with threshold zero, so derived summaries or fuzzy matches cannot pass. It reports `delivery: not-tested`, `injection: not-tested`, and `modelUse: unknown`. A full-text scan is not performed; retry if indexing has not completed.
4. Start a fresh supported local chat with the hooks enabled and trusted. Submit a prompt containing the marker. Run `status --client claude` (or `codex`) from that same project. Check the new timestamp, `recall.attempted`, returned count/IDs, `context: emitted-to-host`, and truncation flags. This observes the consumption path through hook output. Host acceptance and actual model use require separate evidence.

For a deterministic rehearsal without credentials or real writes, `npm test` includes a mock native-MCP test of both checked-in plugin runtimes: outage, queued marker, flush recovery, cross-client retrieval, scope mismatch, hook output, and missing-credential diagnostics. This verifies the code path, not activation in a particular installed desktop app or a live Redis deployment.

## Recover from common outcomes

| Observation | Recovery |
| --- | --- |
| Capture unknown | Check `enabled`, `guardrails.capturePrompts`/`captureResponses`, source selection, and project path. Inspect `/hooks`, trust the definitions where required, and start a fresh supported local chat. Installation alone cannot prove hook activation |
| Delivery unknown or stale with pending files | Run `flush`. Confirm credentials, HTTPS endpoint, store, network access, and service permissions. Retain the queue for retry; a busy flush means another process holds the delivery lock |
| Returned zero or marker absent | Compare effective owner **and** namespace plus store in both clients. Different hosts derive different default owners; Git clones and worktrees now use a stable repository namespace by default; projects without a usable Git identity can still derive path-based fallback namespaces. Status lists legacy namespaces used for compatibility reads. Configure stable scope explicitly when sharing. Retry after indexing, inspect filters and retention, and use the marker check to distinguish missing data from relevance/ranking |
| Scope differs from bridge tools | Capture uses config `namespace`, not `AGENT_MEMORY_NAMESPACE_ID` or `AGENT_MEMORY_NAMESPACE`. See [scope compatibility](handoff-workflow.md#scope-compatibility) |
| Recall unavailable | Fix credentials/connectivity or service/tool access, then submit another prompt. Raw errors are intentionally omitted; a configured endpoint is not a successful search |
| Recall disabled | Review `promptRecall`, `promptRecallLimit`, and startup `recallLimit`. Per-prompt and startup recall are separate; zero limits suppress search |
| Results returned, context none/prepared | No usable text fit or hook output was not emitted. Inspect truncation and host hook logs; retry with shorter memories and check the supported environment |
| Context emitted, answer omits memory | Inspect host context acceptance where available. Prompt relevance, context limits, and model behavior can affect use. Do not infer successful model consumption from a write or returned result |

## Expanded lifecycle dispatch

`diagnostics.hookDispatch` reports the last observed invocation for each registered event, separately from `lastCapture` and `lastDelivery`. An observed hook with no acknowledged delivery suggests a queue/credential/network issue. Unknown dispatch is not proof of an unsupported host: check the event in `/hooks`, trust, project selection, policy, and host version. A zero count means that invocation queued no records (for example, a memory tool was excluded). Synthetic handler tests also create these diagnostics; only a real host-triggered invocation establishes host dispatch. Test actual compaction separately from tool activity. See [expanded lifecycle verification](automatic-capture.md#verification-and-host-support).

## Session delivery and extraction

`sessionDelivery` records the last acknowledged/reconciled session write; `sessionFailure` records an incomplete attempt. Compare their timestamps because a historical failure remains visible after recovery. `lastDelivery` refers to compatibility long-term writes, which can still be pending after session delivery succeeds. Pending queue files include partial dual-destination work. `extraction: "not-verified"` is deliberate: an append acknowledgment cannot prove extraction completed. See [reconciliation and extraction verification](session-capture.md).
