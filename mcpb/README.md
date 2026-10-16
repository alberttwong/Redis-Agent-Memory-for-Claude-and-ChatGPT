# Redis Agent Memory desktop extension

This MCP Bundle installs the Redis Agent Memory local bridge in compatible desktop clients.

The extension provides tools for memory health checks, ordered session events, semantic recall, durable checkpoints, and cross-agent resume context. Configure the Redis service URL, store ID, and API key during installation. The manifest marks the API key as sensitive; the host client controls how it is stored.

Saving in Claude Desktop is model-directed and best-effort. An MCP extension cannot passively observe every prompt or final response, so it must not be treated as guaranteed transcript capture.

Project source and documentation: https://github.com/alberttwong/redis-agent-memory-mcp
