# Native Redis Agent Memory tools

This document records the native MCP tools verified against the configured Redis Agent Memory endpoint and the handoff workflow that uses them directly. These tools are separate from the optional local bridge's camelCase tools.

## Verified native tools

A live test on October 15, 2026 successfully authenticated, initialized an MCP client, discovered nine tools, and executed a read-only `search_long_term_memory` call scoped to a synthetic test owner and namespace. It returned an empty result without errors. No memories were written or deleted during testing.

The tested endpoint exposed:

- `create_long_term_memories`
- `search_long_term_memory`
- `edit_long_term_memory`
- `delete_long_term_memories`
- `create_document_ingestion`
- `get_document_ingestion`
- `list_document_ingestion_outputs`
- `list_memory_sources`
- `list_source_memories`

Session-history, health, and combined resume tools were not present in that endpoint's discovered tool list. Availability can differ by deployment; discover the tools on your own service before relying on them. Write operations, embeddings, and document extraction were not verified by this read-only test.

## Handoff using native tools

In Claude Code, use `create_long_term_memories` to save progress under a stable memory ID such as `checkout-retry-123-handoff`, with the same `owner_id`, `namespace`, and `session_id` throughout the task. Include the current goal, decisions, completed work, next steps, blockers, branch, and test results in the memory text. Use `edit_long_term_memory` to update the existing handoff record as work progresses.

In Codex, use `search_long_term_memory` with the matching `owner_id`, `namespace`, and `session_id` to retrieve the saved handoff. Filter-only searches can use `sort_by: "updatedAt"` and `sort_order: "desc"`. Inspect the shared repository before continuing. Save regularly so a sudden credit limit leaves a recent checkpoint available.

The native tools use snake_case arguments; the optional bridge tools use camelCase. The snippets in `integration/` are specifically for the bridge and reference its tool names.
