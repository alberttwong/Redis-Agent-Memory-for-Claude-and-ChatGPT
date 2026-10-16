# ChatGPT plugin packaging

[Back to README](../README.md)

The repository ships two OpenAI plugin profiles to separate local automatic saving from a hosted, model-directed integration.

## Local desktop plugin

The local profile bundles the stdio MCP server, project setup skill, and lifecycle hooks. It supports automatic saving and retry in configured projects running as local ChatGPT/Codex desktop chats.

For installation, download `redis-agent-memory-chatgpt-desktop-<version>.zip` from the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest) and follow the [ChatGPT Desktop quickstart](quickstart-chatgpt-desktop.md). The desktop ZIP includes a local marketplace at `.agents/plugins/marketplace.json` and the bundled plugin under `plugins/redis-agent-memory/`. The plugin contains the server and capture CLI with their JavaScript dependencies bundled. Node.js 20.12 or later is required at runtime; npm and compilation are not required for release installation.

### Manual commands for the release package

The quickstart uses the plugin's `setup-redis-memory` skill. If you prefer terminal commands, replace `/path/to/plugin-folder` with the extracted desktop ZIP folder and `/path/to/your-project` with the project you want to remember. Quote paths, especially when they contain spaces.

Create the project's configuration, then fill in its `.env` locally:

```sh
node "/path/to/plugin-folder/plugins/redis-agent-memory/server/capture-cli.js" configure --project "/path/to/your-project"
```

Check configuration, inspect capture status, or retry pending writes:

```sh
node "/path/to/plugin-folder/plugins/redis-agent-memory/server/capture-cli.js" doctor --plugin --project "/path/to/your-project"
node "/path/to/plugin-folder/plugins/redis-agent-memory/server/capture-cli.js" status --project "/path/to/your-project"
node "/path/to/plugin-folder/plugins/redis-agent-memory/server/capture-cli.js" flush --project "/path/to/your-project"
```

Preview a ChatGPT history import. Review the output before rerunning with `--write`:

```sh
node "/path/to/plugin-folder/plugins/redis-agent-memory/server/capture-cli.js" import-chatgpt --project "/path/to/your-project" --input "/path/to/chatgpt-export.zip"
```

See [Import existing memories](importing-memories.md) for accepted files and filters.

### Build from source

For development, clone this repository, install Node.js 20.12 or later, and run from the repository root:

```sh
npm ci
npm run plugin:runtime
npm run plugin:test
```

The build also produces `build/redis-agent-memory-chatgpt-desktop-<version>.zip`, which can be extracted and installed without a source checkout, and `build/redis-agent-memory-chatgpt-local-<version>.zip`, which contains only the plugin for existing marketplaces.

The repository marketplace points to the tracked `plugins/redis-agent-memory` directory, which includes the server and capture CLI bundles. Installing from Git does not run a build step. To refresh those generated runtime files after changing their source, run `npm run plugin:runtime` and commit the resulting files; `npm run plugin:test` rejects stale bundles.

Register the repository with `codex plugin marketplace add alberttwong/redis-agent-memory-mcp`. Restart ChatGPT Desktop, open the Plugins Directory, choose **Redis Agent Memory local plugins**, and install **Redis Agent Memory**. Review and trust the plugin hooks when prompted.

In a local chat, ask to run the `setup-redis-memory` skill for the current repository. The skill creates a default-enabled `.memory-capture.json`, a private `.env` template, and `.gitignore` entries without adding duplicate project hooks. Fill in the Redis values locally, then start a new chat:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

Projects without `.memory-capture.json` are ignored by the plugin hook. Set `enabled` to `false` in that file to pause capture. Removing the plugin disables its hooks without deleting project configuration, queued writes, or Redis memories.

The capture CLI and bundled bridge resolve Redis settings from the process environment, then the project `.env`, then shared defaults outside Git. The bridge inherits the session working directory; `MEMORY_CAPTURE_PROJECT_ROOT` can explicitly select a project. Credentials are not copied into the plugin or exposed to the model. See [sharing settings across worktrees](automatic-saving-operations.md#reuse-redis-settings-across-worktrees-and-checkouts).

## Public remote profile

This repository keeps a separate hook-free remote profile whose writes are model-directed. Local command hooks require an available execution environment and are not supported in cloud-orchestrated Work; see the [official plugin documentation](https://learn.chatgpt.com/docs/plugins). This profile has not been validated for public-directory acceptance. Build it only after deploying a stable public HTTPS MCP endpoint:

```sh
npm run plugin:build:remote -- https://memory.example.com/mcp
```

The result is `build/redis-agent-memory-chatgpt-remote-0.1.6.zip`. It contains the remote URL, plugin metadata, and memory workflow skill, but no local server, hook, or credentials. Configure supported authentication and complete domain verification in the OpenAI submission portal before publishing.

Use the local profile for supported automatic saving. The remote profile provides explicit tools through a hosted endpoint; it cannot passively capture every conversation turn. The endpoint must expose this bridge's tools (`memory_append`, `checkpoint_save`, and `resume_context`). Pointing it at the native Redis MCP endpoint does not supply those tool names. Hosting an authenticated HTTP bridge is a separate deployment task; this repository's bridge starts over stdio.
