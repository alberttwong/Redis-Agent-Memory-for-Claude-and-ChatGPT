# Claude Desktop quickstart

[Back to README](../README.md)

Use **Add marketplace** as the default installation option in Claude Desktop. The Redis Agent Memory plugin helps Claude recall project context, record important progress, and save handoff checkpoints. Configured local Claude Code projects automatically save submitted prompts and available final responses. Ordinary Desktop Chat uses model-directed saving. The plugin's local memory server runs in Cowork and Claude Code; for ordinary Desktop Chat, use the [MCPB extension option](#alternative-mcpb-extension-for-desktop-chat).

## 1. Install through Add marketplace (default)

Start in Claude Desktop and add this repository as a plugin marketplace:

1. In Claude Desktop, open **Customize → Plugins → Add marketplace**.
2. Enter `https://github.com/alberttwong/redis-agent-memory-mcp` and select **Sync**.
3. Install **Redis Agent Memory** from the marketplace.
4. Start a new local **Claude Code → This computer** session with **Redis Agent Memory** enabled. The plugin requires Node.js 20.12 or later on that computer.
5. Run `/redis-agent-memory:setup-redis-memory`, or ask: “Use Redis Agent Memory's setup tool.”
6. Open the local browser link returned by `memory_setup`. Enter your Redis URL, store ID, and API key in the form, then select **Save connection**. Keep credentials out of chat.
7. Return to Claude and ask it to call `memory_health`. A successful response confirms the live connection.
8. Let the setup skill configure automatic saving for your current project and run its plugin-aware doctor. It creates a missing `.memory-capture.json` with capture enabled, preserves existing settings, and reuses the browser connection. No `.env` edits are required.
9. Start a fresh local Claude Code session in that project. Check `/hooks` for the plugin's `SessionStart`, `UserPromptSubmit`, and `Stop` hooks and allow them as required. Send an ordinary test prompt, then ask Claude to retrieve it from Redis to confirm capture and delivery.

Automatic saving requires Claude plugin **v0.1.5 or later**. Refresh the marketplace and update an existing installation before running setup again. A successful doctor checks configuration; retrieving the test prompt verifies delivery. Hook events do not capture intermediate messages, tool output, or hidden reasoning. Turn capture off with `enabled: false` in `.memory-capture.json`; queued entries remain local. Re-enabling capture resumes automatic retries; an explicit CLI `flush` can still deliver them while capture is disabled. See [automatic capture](automatic-capture.md#claude-code-marketplace-default).

The plugin bundles its server and runtime dependencies, so installation does not require npm or a source build. The setup form runs on the same computer as the local server. A cloud or isolated Cowork VM may not expose its loopback address to your browser; use a local Claude Code session for this setup flow.

For Claude Code v2.1.275 or later, you can also add the marketplace and open the plugin installation in one command ([official installation guide](https://code.claude.com/docs/en/discover-plugins#add-a-marketplace-and-install-in-one-command)):

```text
/plugin install redis-agent-memory --marketplace alberttwong/redis-agent-memory-mcp
```

A plugin's local MCP server runs in **Cowork and Claude Code**. For ordinary **Claude Desktop Chat**, install the desktop extension using the steps below. See [Claude's explanation of plugin and connector availability](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors).

If **Add marketplace** reports “no manifest found at .claude-plugin/marketplace.json”, the selected repository revision does not contain the Claude marketplace catalog. Refresh the marketplace after updating to a revision that includes it. The ChatGPT marketplace at `.agents/plugins/marketplace.json` is a separate format.

## Automatic context for each prompt

After project setup and hook activation, each submitted prompt also triggers a search for relevant memories in your owner's project scope before the LLM processes it. Matches are supplied as historical context automatically; you do not need to request a memory search each time. This requires Claude plugin v0.1.6+, followed by a fresh local session. If Redis is unavailable, the chat continues and pending saves remain queued.

To keep automatic saving while disabling these searches, set `promptRecall: false` in `.memory-capture.json`. See [retrieval limits, relevance threshold, and behavior](automatic-capture.md#relevant-memories-before-each-prompt).

## If installation did not ask for Redis credentials

The connector's **Environment variables** panel is read-only. Installing the marketplace plugin does not mean the Redis connection is configured. This is a known upstream limitation: [Claude issue #95683](https://github.com/anthropics/claude-code/issues/95683) reports that marketplace MCPB credentials are not prompted for and that plugin `userConfig` and bundle `user_config` use separate configuration storage. [Claude issue #89749](https://github.com/anthropics/claude-code/issues/89749) covers the missing Desktop configuration UI.

Plugin v0.1.3 provides a browser setup form as the current workaround. Use that form rather than trying to edit the connector's environment variables. We track replacing the workaround with native Desktop configuration in [project issue #31](https://github.com/alberttwong/redis-agent-memory-mcp/issues/31).

Refresh the marketplace, update **Redis Agent Memory** to v0.1.3 or later, enable it, and start a new local session. Run `/redis-agent-memory:setup-redis-memory`. If `memory_setup` is absent, check that the updated plugin is enabled in that session before entering any credentials.

Settings are saved in `connection.json` under `CLAUDE_PLUGIN_DATA` when the host supplies it, otherwise under `~/.config/redis-agent-memory/`. The API key is stored in that local file, with owner-only permissions on systems that support Unix file modes. It is not stored in the plugin package or returned by a tool. Run setup again to replace connection settings. Setup links expire after ten minutes and close after saving.

The form saves settings locally; `memory_health` separately verifies Redis connectivity. Removing the plugin may delete its host-managed data directory. The fallback settings directory is preserved until you remove it yourself.

## Alternative: MCPB extension for Desktop Chat

Use this option when you want the memory tools in ordinary Claude Desktop Chat. The marketplace installation above is the default for Cowork and Claude Code.

### Download the extension

Open the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest) and download the `redis-agent-memory-<version>.mcpb` file under **Assets**.

Claude Desktop supplies Node.js, so installing the extension does not require cloning this repository, npm, or a separate Node.js installation. For a development build, see [Build from source](claude-desktop.md#build-from-source).

### Install the extension

1. Open **Settings → Extensions**.
2. Select **Advanced settings → Install Extension…**.
3. Choose the downloaded `.mcpb` file.
4. Enter the Redis Agent Memory URL, store ID, and API key.
5. Enable the extension in a conversation.

Ask Claude to call `memory_health`. A successful response confirms the live Redis connection.

## Optional: Import existing Claude memory or conversations

Importing history is optional and uses the repository's CLI. Install Node.js 20.12 or later and prepare a local checkout:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
```

Copy [`.env.example`](../.env.example) to `.env` and fill in the same Redis URL, store ID, and API key used by your plugin or extension. Match the owner and use `--namespace` for the capture/import label. Setting `AGENT_MEMORY_NAMESPACE_ID` in `.env` does not select the import namespace. If you want the bridge to search these records, follow [scope compatibility](handoff-workflow.md#scope-compatibility).

Open Claude's memory settings and copy the editable memory into a Markdown or text file, or request a Claude data-export ZIP for conversation history. Preview the import first:

```sh
npm run capture:import:claude -- --input /path/to/claude-export.zip
```

For copied memory, replace the ZIP path with the `.md` or `.txt` file.

Review the owner, namespace, record count, and sample records. Queue and deliver the same import only after review:

```sh
npm run capture:import:claude -- --input /path/to/claude-export.zip --write
```

The write uses deterministic IDs and the local retry queue, so rerunning the same import does not duplicate records that are still pending. Add `--conversation`, `--after`, `--before`, or `--limit` to narrow a large export.

## Uninstall

For the marketplace plugin, open **Customize → Plugins**, select **Redis Agent Memory**, and remove it.

For the MCPB extension:

1. Open Claude Desktop **Settings → Extensions**.
2. Select **Redis Agent Memory** and uninstall the extension.
3. Fully quit and reopen Claude Desktop.

Uninstalling the plugin or extension does not delete memories stored in Redis or any local checkout and import queue you created. If you used the CLI fallback, follow the separate [CLI uninstall instructions](claude-desktop.md#uninstall).

## Important limitation

The MCPB extension cannot silently observe every Claude Desktop prompt and response. Ask Claude to save substantive work and checkpoints, or use a client with lifecycle hooks when every supported turn must be captured automatically.

For status, CLI fallback, removal, and packaging details, see [Claude Desktop setup and limitations](claude-desktop.md). For all import flags and security behavior, see [Import existing memories](importing-memories.md).
