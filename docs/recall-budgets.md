# Recall budgets and evaluation

[Back to README](../README.md)

The bridge retains six core tools. Use `memory_append` for important individual turns and decisions in ordered history; use `checkpoint_save` for the current compact goal, decisions, blockers, and next steps after progress or before a handoff. Use `memory_search` for relevant prior facts or to identify an unknown task; use `resume_context` to continue a known session. Resume already searches, so reuse its results. Use `memory_get_session` for more ordered-history details and `memory_health` for connection diagnosis. Self-contained trivial questions do not need memory tools.

## Limits audited

| Path | Result count | Full returned context budget | Configuration |
| --- | --- | --- | --- |
| Startup recent recall | 6 by default, 0–20 | 18000 characters | `.memory-capture.json`: `recallLimit`, `startupContextChars` |
| Per-prompt semantic recall | 5 by default, 0–20; similarity threshold 0.7 | 5400 characters | `.memory-capture.json`: `promptRecallLimit`, `promptRecallThreshold`, `promptContextChars` |
| Bridge search | 8 by default, 1–100 | 12000 characters | `AGENT_MEMORY_CONTEXT_CHARS`, per-call `maxChars` |
| Bridge resume | 8 semantic matches, latest 20 ordered events, canonical checkpoint | 12000 characters shared across all sections | Same bridge settings |
| Bridge session read | Latest 20 events by default, 1–100 per page | 12000 characters | Same bridge settings; `eventLimit`, `eventOffset` |

All configurable character budgets accept integers 1024–100000. The budget counts serialized JavaScript UTF-16 code units, including JSON escaping, guidance, and truncation notices. Tokens are **not measured or estimated**; character limits provide a tokenizer-independent bound. MCP text and structured content contain the same bounded packet for compatibility; a client rendering both may consume roughly twice the packet size plus protocol overhead. Transport/network payloads from Redis and backend processing are not bounded by this output limit. Write acknowledgments are outside the recall budget.

Previously startup trimmed only the last 18000 raw memory characters, excluding instructions and without a truncation notice; prompt recall capped its serialized memory block at 5400 but repeated scope/policy outside that cap. Bridge search used only a result count, and session/resume had no content cap. The new caps cover each entire context packet, and compact JSON avoids pretty-printing overhead.

## Keeping and recovering useful context

Search preserves the backend's relevance order. Startup keeps the backend's newest-first order. Resume includes the canonical checkpoint, semantic matches, and recent session events; duplicate checkpoint/search text is removed. Trimming divides space between sections and preserves normal record identifiers before large payloads. Session trimming favors newest events while retaining chronological output. Truncated strings end with `…[truncated]`; `contextBudget.truncated` also signals removed fields or records. `eventPage` separately reports intentional paging even when no character trimming occurs.

For missing details, narrow the semantic query, reduce `limit` so each result has more space, or increase `maxChars`. Read older events with `memory_get_session`, following `eventPage.nextOffset` as `eventOffset`. Reducing `eventLimit` gives a large event more room. These are bounded views: a single record larger than the maximum budget cannot be completely retrieved through this bridge; use the store's native record retrieval/export for that case. Capture normally splits messages into 6000-character parts.

## Injection and caching

Exact duplicate matches within one hook response and duplicate canonical checkpoint recall are suppressed. Greeting/acknowledgment-only prompts (`hi`, `hello`, `hey`, `thanks`, `thank you`, `ok`, `okay`, with punctuation) skip automatic lookup; other prompts retain relevance search, including short task-resumption requests. This conservative rule does not classify every self-contained question. Empty results inject no per-turn context. Search runs before flushing the current prompt, preventing a self-match.

SessionStart supplies policy once. Per-prompt hooks add only useful historical context and its owner/namespace, without repeating policy or changing server instructions. Cross-turn deduplication is deliberately limited: hooks cannot tell whether the client compacted or removed previously injected context. Skills ask the model to reuse available results.

The hook/MCP protocol exposes no prompt-cache counters or actual assembled model prompt. Actual client cache hit rates are therefore **not observable here**, and no cache improvement is claimed. With a client that exposes cache telemetry, compare equivalent sessions with recall enabled/disabled; record cached/uncached input tokens, client/model version, latency, and compaction events. Keep server instructions fixed and inspect where hook context lands in the assembled prompt. No client telemetry was available for this change.

## Reproducible local evaluation

Run `npm run eval:recall`. Deterministic fixtures exercise the production recall formatter and gateway resume composition with mocked Redis responses, 25 repetitions each. They assert expected decision/next-step retention, empty irrelevant output, no greeting lookup, recent-event retention, and output bounds. They do not evaluate real Redis ranking, model tool selection, network latency, or answer quality.

Observed locally on 2026-10-16 (milliseconds; repeat runs vary):

| Scenario | Expected context retained / irrelevant context suppressed | Backend calls | Output characters | p50 | p95 |
| --- | --- | --- | --- | --- | --- |
| Prior decision | Yes: exponential backoff | 1 | 458 | 0.016 | 0.277 |
| Task resumption, 1024-character cap | Yes: next validation step and newest event | 3, concurrent | 952 | 0.030 | 0.053 |
| Irrelevant query | Yes: empty output | 1 | 0 | 0.003 | 0.008 |
| Trivial greeting | Yes: no retrieval/injection | 0 | 0 | 0.002 | 0.007 |
| Oversized escaped memories | Yes: decision retained under 5400 cap | 1 | 2921 | 3.351 | 3.611 |

MCP integration tests separately exercise configured/per-call limits, matching text/structured packets, paging, and invalid budgets. Budget tests include escaped control characters, Unicode, large metadata, all supported budget extremes, and newest-event retention. Packaged hook smoke tests cover both clients, scoped search-before-save, privacy, opt-out, and independent read/write failures. Live relevance and cache measurements remain future client/backend evaluations, rather than grounds to expand the tool surface now.
