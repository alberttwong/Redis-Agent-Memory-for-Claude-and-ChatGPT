---
name: setup-redis-memory
description: Open the Redis Agent Memory credential setup form in a local Claude Code desktop session, or update its saved connection.
---

# Set up Redis Memory

Call the plugin's `memory_setup` tool. Give the user the returned local browser link so they can enter their Redis URL, store ID, and API key in the form. Do not ask them to put credentials in chat or edit the read-only connector details.

After the user saves the form, call `memory_health` to check the connection. If it fails, describe the error without exposing credentials. Do not claim a successful connection based on installing the plugin or discovering its tools.

The form runs on the same computer as the local MCP server. Use a local Claude Code session on This computer. A cloud or isolated VM session may not expose its loopback address to the user's browser.
