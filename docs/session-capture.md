# Automatic session delivery

Configured local Claude Code and local ChatGPT/Codex projects now deliver new captured prompts and available final responses through the official Redis Agent Memory SDK's session API. They retain the compatibility long-term `message` path for startup and per-prompt recall. This does not depend on native MCP advertising an append tool. Ordinary Chat, hook-free remote profiles, and unsupported hosts gain no passive capture. Actual host dispatch remains a separate verification requirement.

The pipeline is privacy filtering → one durable local queue → ordered session append → compatibility long-term message delivery. A failed session append stays queued rather than falling back to long-term-only delivery. A compatibility failure after session acceptance retries without appending that session event again. Neither path creates a handoff checkpoint; #68 tracks that work.

## Configuration and identity

These defaults apply without rewriting existing `.memory-capture.json` files:

```json
{
  "sessionCapture": true,
  "compatibilityCapture": true,
  "sessionObservations": false
}
```

`enabled: false` preserves pending queue files and prevents automatic delivery and explicit flush. Destination controls disable that destination for new and pending v2 entries; other enabled destinations can complete. Re-enabling a destination does not replay already completed history. Existing role/event/tool opt-outs and privacy rules apply before both destinations and again on retry.

Default Redis session identity hashes owner, project namespace, client, and source conversation ID. A configured `sessionId` is now a **task alias**, hashed with owner and namespace so two clients can deliberately continue the same task without merging other owners/projects. It is not the literal Redis session ID. Obtain the derived ID from startup context or a captured record's `session_id` and pass that ID to `memory_get_session` or `resume_context`. Explicit bridge calls continue to take literal session IDs.

The service initializes immutable ownership and namespace from the first event. Capture sends the resolved owner as `actorId` on every event, including an assistant-first conversation. Actual speaker role remains USER or ASSISTANT; source client and other available provenance remain in metadata. Capture uses its existing namespace label, not the bridge's independently configured namespace resource. Matching owner/project filters are organizational scope, not service authorization.

Each chunk is one session event, with the original capture timestamp, a stable `captureId`, a shared `captureGroup`, and explicit part/parts metadata. Concatenate content in part order within a group to reconstruct a logical turn. A durable enqueue sequence preserves local commit order, including concurrent/same-millisecond hooks; chunk metadata includes this sequence. Tied service timestamps can be reconstructed using sequence and part. A failed earlier entry stops the drain, preventing later queued events from overtaking it. Multiple machines have independent queues and locks; there is no distributed ordering guarantee for simultaneous writers to a shared task alias.

With `sessionObservations: true`, bounded PostToolUse, PostToolUseFailure, SubagentStop and TaskCompleted observations also enter sessions as SYSTEM evidence explicitly labeled untrusted, rather than user speech. Other lifecycle boundaries remain direct-only to avoid feeding noisy metadata to extraction. Existing observation exclusions and bounds still apply.

## Retry guarantees and uncertain outcomes

The installed `@redis-iris/agent-memory@0.3.1` append request does not expose a client event ID or typed idempotency key. Backend ingestion-hook support is a separate capability; see [Iris #1842](https://github.com/redislabsdev/iris/issues/1842) and [TypeScript SDK #1896](https://github.com/redislabsdev/iris/issues/1896). Capture disables SDK append retries.

Before POST, capture atomically saves an intent fingerprint; after acceptance, it atomically saves the returned event acknowledgment. Both session and compatibility receipts are scoped to the destination endpoint/store. After a lost response or restart, an unresolved intent triggers a session read with summarized events included. Exactly one matching capture ID, scope, timestamp, actor, role, and content reconciles the write without resending. Definitive validation/rejection responses remain normally retryable. Native compatibility creates keep their stable service record IDs.

Missing readback is not proof that the server never accepted the event. Normal retries retain the uncertain entry and do not append again. Expired/deleted history, delayed visibility, conflicting duplicates, or changed privacy rules can require manual inspection. After inspecting the queue and session, an operator may deliberately run:

```sh
ram-capture flush --project /path/to/project --retry-uncertain
```

This flag permits resubmission only after reconciliation finds no retained matching event. It can create duplicate events and downstream extraction work if the original accepted event becomes visible later. Do not add it to automatic hooks. Changed request fingerprints or conflicting readback remain blocked for explicit recovery even with the flag. There is no exactly-once delivery claim. Keep the queue and private `.receipts` files for recovery; removing them removes local deduplication evidence.

## Extraction, retention, and migration

Successful append means the input reached Redis. Summarization and long-term extraction are asynchronous service behavior that must be enabled/configured on the service, and session content may be processed by its extraction model provider. Capture does not change store-wide settings or enable providers. See the [Redis lifecycle documentation](https://redis.io/docs/latest/develop/ai/context-engine/agent-memory/overview/) and [summarization setup](automatic-summarization.md).

Sessions follow service session retention. Extracted facts and compatibility messages follow long-term retention and can incur separate embedding/storage/model costs. Extracted facts need not preserve transcripts or the `auto-capture` topic; compatibility delivery therefore remains enabled by default. Startup recall continues to select compatibility conversation messages, and per-prompt recall deduplicates exact matching text. Semantic paraphrases may still appear as separate facts; no broad semantic duplicate suppression is claimed.

New automatic entries use queue version 2. Existing version-1 queues, delivered historical records, and imports keep their direct-write behavior. Old derived session IDs were not sufficiently scoped for session reads and are not reused as session identities. Compatibility record IDs remain stable across the routing change so replay does not create a second long-term record. Existing long-term history remains searchable under its original owner/namespace. No automatic backfill, copying, or deletion occurs. An extraction backfill requires a separate previewed migration with scope, deduplication, retention and cost review; this release does not provide that command.

`status` distinguishes `sessionDelivery`, `sessionFailure`, compatibility `lastDelivery`, and pending queue files. A historical failure can remain visible after a newer successful delivery, so compare timestamps. `extraction: "not-verified"` remains explicit rather than claiming successful extraction from append acknowledgment. Run `npm run test:e2e:sessions` with a configured test service to verify scoped ordered turns, compatibility recall, and an asynchronously extracted fact with polling for up to eight minutes. This invokes packaged handlers and does not establish actual host dispatch or create a checkpoint.

Current validation: packaged live handlers delivered four ordered turns with the expected owner/namespace and four compatibility records. The configured service produced no scoped semantic/episodic retry fact within eight minutes, so extraction is not verified. This is not proof extraction is disabled or unsupported. For delivery-only diagnostics, `RAM_CAPTURE_SKIP_EXTRACTION=1 npm run test:e2e:sessions` explicitly skips that subtest; it must not be cited as an extraction pass. Fixture cleanup removes this run's session and records under its isolated owner.
