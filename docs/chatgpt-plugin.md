# ChatGPT plugin packaging

[Back to README](../README.md)

The repository ships two OpenAI plugin profiles because automatic saving and public-directory distribution have different platform requirements.

## Local desktop plugin

The local profile bundles the stdio MCP server, project setup skill, and lifecycle hooks. It supports automatic saving and retry in configured projects running as local ChatGPT/Codex desktop chats.

For installation, download `redis-agent-memory-chatgpt-desktop-<version>.zip` from the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest) and follow the [ChatGPT Desktop quickstart](quickstart-chatgpt-desktop.md). The desktop ZIP includes a local marketplace at `.agents/plugins/marketplace.json` and the bundled plugin under `plugins/redis-agent-memory/`. The plugin contains the server and capture CLI with their JavaScript dependencies bundled. Node.js 20.12 or later is required at runtime; npm and compilation are not required for release installation.

### Build from source

For development, clone this repository, install Node.js 20.12 or later, and run from the repository root:

```sh
npm ci
npm run plugin:test
```

The build also produces `build/redis-agent-memory-chatgpt-desktop-<version>.zip`, which can be extracted and installed without a source checkout, and `build/redis-agent-memory-chatgpt-local-<version>.zip`, which contains only the plugin for existing marketplaces.

The repository marketplace points to `build/chatgpt-plugin/local`. Restart ChatGPT Desktop, open the Plugins Directory, choose **Redis Agent Memory local plugins**, and install **Redis Agent Memory**. Review and trust the plugin hooks when prompted.

In a local chat, ask to run the `setup-redis-memory` skill for the current repository. The skill creates a default-enabled `.memory-capture.json`, a private `.env` template, and `.gitignore` entries without adding duplicate project hooks. Fill in the Redis values locally, then start a new chat:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

Projects without `.memory-capture.json` are ignored by the plugin hook. Set `enabled` to `false` in that file to pause capture. Removing the plugin disables its hooks without deleting project configuration, queued writes, or Redis memories.

The bundled agent-facing MCP tools receive only environment variables already present in the desktop execution session. The project `.env` is loaded by automatic capture, but is not copied into the plugin or exposed to the model.

## Public remote profile

Public-directory plugins cannot contain lifecycle hooks. This repository therefore keeps a separate hook-free profile whose writes are model-directed. Build it only after deploying a stable public HTTPS MCP endpoint:

```sh
npm run plugin:build:remote -- https://memory.example.com/mcp
```

The result is `build/redis-agent-memory-chatgpt-remote-0.1.0.zip`. It contains the remote URL, plugin metadata, and memory workflow skill, but no local server, hook, or credentials. Configure supported authentication and complete domain verification in the OpenAI submission portal before publishing.

The local profile is the right choice when automatic saving matters. The remote profile is the right foundation for broad ChatGPT distribution, but cannot passively capture every conversation turn.
