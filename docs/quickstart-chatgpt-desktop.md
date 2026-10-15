# ChatGPT Desktop quickstart

[Back to README](../README.md)

Use the **repository marketplace** as the default installation option. Install Redis Agent Memory to save prompts and available final responses from local Codex chats and recall project context in later chats. This setup works in **Codex → This computer** in ChatGPT Desktop. It requires Node.js 20.12 or later and a Redis Agent Memory service URL, store ID, and API key.

## 1. Install from the repository marketplace (default)

Register the repository as a marketplace source:

```sh
codex plugin marketplace add alberttwong/redis-agent-memory-mcp
```

Restart ChatGPT Desktop, open the **Plugins Directory**, select **Redis Agent Memory local plugins**, and install **Redis Agent Memory**. Review and trust its lifecycle hooks when prompted. The marketplace source must be this repository, not its `plugins/` subfolder.

The repository includes the server and capture CLI, so users do not need to clone, run npm, or build the project. Node.js is still required to run the plugin. After installation, open your own project folder for the configuration steps below.

If you previously registered this source, refresh it after the fix is available:

```sh
codex plugin marketplace upgrade redis-agent-memory-local
```

For an existing source configured with a sparse checkout, include both `.agents/plugins` and `plugins/redis-agent-memory`; the catalog alone cannot supply the runtime. A normal registration without `--sparse` includes both.

### If installation says the plugin path does not exist

Earlier repository catalogs pointed to `build/chatgpt-plugin/local`, a generated folder that was absent from GitHub. That caused “failed to load plugin” or “path does not exist or is not a directory” during installation.

The corrected catalog points to `plugins/redis-agent-memory` and includes both runtime bundles. Refresh the marketplace with the upgrade command above, restart the app, then install or update **Redis Agent Memory** to plugin v0.1.2 or later. Verify your source includes the plugin directory if you configured a sparse checkout.

### Alternative: Install a release ZIP

1. Open the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest) and download **`redis-agent-memory-chatgpt-desktop-<version>.zip`** from **Assets**.
2. Extract it into a permanent folder, preserving the hidden `.agents` folder.
3. In ChatGPT Desktop, select **Codex → This computer**, open the extracted folder, and restart the app with that project open.
4. In the **Plugins Directory**, choose **Redis Agent Memory local plugins** and install **Redis Agent Memory**. Review and trust the lifecycle hooks.
5. Switch to your own project folder for everyday work. Keep the extracted plugin folder available.

## 2. Connect your project to Redis

Open **your project folder** in a new local Codex chat. Confirm **Redis Agent Memory** is enabled, then send:

> Use the Redis Agent Memory plugin's setup-redis-memory skill to configure memory for this project.

The skill creates a `.env` file in your project. Open that file locally and fill in these values:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

Keep the API key in `.env`; do not paste it into chat. Then send:

> Use setup-redis-memory to check this project's configuration with the plugin-aware doctor command.

Resolve any reported setup issues before continuing. Repeat this step for each project you want to remember.

### Reuse credentials in other worktrees

After one checkout is configured, ask:

> Use setup-redis-memory to share this project's Redis settings across worktrees and checkouts.

The plugin saves only Redis settings in a private file outside Git. New configured worktrees and separate checkouts can use them automatically, while a local `.env` can override them. Run the plugin-aware doctor in the new chat; a missing project `.env` is fine when its credential sources are `shared`.

This requires ChatGPT plugin **v0.1.3 or later**. Update the plugin and start a fresh local chat after upgrading. See [shared settings and precedence](automatic-saving-operations.md#reuse-redis-settings-across-worktrees-and-checkouts).

## 3. Start a fresh chat and verify saving

Start a **new local Codex chat in your project** after saving `.env` and trusting the plugin hooks. Send an ordinary prompt, then ask:

> Use setup-redis-memory to check this project's capture status and retry any pending writes.

Check your Redis memory store for the new prompt to confirm delivery. A pending count of zero alone does not prove that a prompt was captured.

Future supported turns in this project save automatically, and new local chats recall recent project context. Cloud-orchestrated Work chats do not run these local plugin hooks. If a plugin update changes its hook definitions, review and trust them again.

## Optional: Import older conversations

Request a ChatGPT export from **Settings → Data controls → Export data**. Once you have the ZIP on your computer, ask the plugin's `setup-redis-memory` skill to **preview** an import of that local file into your configured project. Review the preview, then ask it to import the records if they look correct.

See [Import existing memories](importing-memories.md) for accepted files and filters.

## 4. Uninstall

1. Open the **Plugins Directory** and find **Redis Agent Memory** in your installed plugins.
2. Open its details and select **Uninstall plugin**.
3. Start a new local chat.

Uninstalling stops the plugin's hooks. It preserves memories in Redis, project configuration, `.env`, and queued writes. To pause saving for just one project, set `enabled` to `false` in that project's `.memory-capture.json` instead.

If you also installed project hooks separately, follow [Remove automatic saving](automatic-saving-operations.md#remove-automatic-saving) to remove them.

For manual commands and source builds, see [ChatGPT plugin packaging](chatgpt-plugin.md). For retries and identity settings, see [Automatic saving operations](automatic-saving-operations.md). The installation flow follows OpenAI's [local plugin setup](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually) and [plugin removal](https://learn.chatgpt.com/docs/plugins#remove-a-plugin) documentation.

## Automatic context for each prompt

After project setup and hook activation, each submitted prompt also triggers a search for relevant memories in your owner's project scope before the LLM processes it. Matches are supplied as historical context automatically; you do not need to request a memory search each time. This requires local ChatGPT plugin v0.1.5+ or Claude plugin v0.1.6+, followed by a fresh local session. If Redis is unavailable, the chat continues and pending saves remain queued.

To keep automatic saving while disabling these searches, set `promptRecall: false` in `.memory-capture.json`. See [retrieval limits, relevance threshold, and behavior](automatic-capture.md#relevant-memories-before-each-prompt).
