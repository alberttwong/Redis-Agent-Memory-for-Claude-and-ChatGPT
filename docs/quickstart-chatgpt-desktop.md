# ChatGPT Desktop quickstart

[Back to README](../README.md)

Install Redis Agent Memory to save prompts and available final responses from local Codex chats and recall project context in later chats. This setup works in **Codex → This computer** in ChatGPT Desktop. It requires Node.js 20.12 or later and a Redis Agent Memory service URL, store ID, and API key.

You will use two folders:

| Folder | Purpose |
| --- | --- |
| Plugin folder | The extracted download. Open it once to install the plugin. |
| Your project folder | The project whose chats you want to remember. Configure memory here and use it for everyday work. |

## 1. Install the plugin

1. Open the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest) and download **`redis-agent-memory-chatgpt-desktop-<version>.zip`** from **Assets**.
2. Extract the ZIP into a permanent folder. Keep all its contents, including the hidden `.agents` folder.
3. In ChatGPT Desktop, select **Codex** and open the extracted folder using **This computer**. Restart the app with that project open.
4. Open the **Plugins Directory**, choose **Redis Agent Memory local plugins**, and install **Redis Agent Memory**. Review and trust its lifecycle hooks when prompted.

After installation, switch to your own project. You do not need to work inside the plugin folder.

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
