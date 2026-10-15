# ChatGPT Desktop quickstart

[Back to README](../README.md)

Use a local Codex chat inside the ChatGPT desktop app for default-enabled automatic saving. Project hooks queue submitted prompts and available final responses before sending them to Redis, then recall recent project context when a new local session starts.

## 1. Download and install the desktop plugin

You need Node.js 20.12 or later to run the plugin.

1. Download `redis-agent-memory-chatgpt-desktop-<version>.zip` from the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest).
2. Extract it into a permanent folder, such as `redis-agent-memory`. Keep the entire extracted folder, including the hidden `.agents` directory.
3. Open that folder as a local Codex project in ChatGPT Desktop, then restart the app.
4. In the **Plugins Directory**, select **Redis Agent Memory local plugins** and install **Redis Agent Memory**.
5. Review and trust its lifecycle hooks.

The ZIP includes the plugin and its marketplace configuration. No Git clone, npm install, or source build is required. For development, see [Build from source](chatgpt-plugin.md#build-from-source).

## 2. Configure automatic saving in the project

Open the project you want to remember as a local Codex chat. Ask it to use the plugin's `setup-redis-memory` skill for that project. The skill creates the capture configuration and private `.env` template without installing duplicate project hooks. For manual setup, replace `/path/to/redis-agent-memory` with the extracted folder and `/path/to/your-project` with your project folder:

```sh
node /path/to/redis-agent-memory/plugins/redis-agent-memory/server/capture-cli.js configure --project /path/to/your-project
```

Add the Redis connection values to the generated `.env`:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

Confirm the local files and credentials are configured by asking the skill to run its plugin-aware doctor command, or run:

```sh
node /path/to/redis-agent-memory/plugins/redis-agent-memory/server/capture-cli.js doctor --plugin --project /path/to/your-project
```

## 3. Open the local Codex project

1. Open the ChatGPT desktop app and select **Codex** from the ChatGPT dropdown.
2. Open the project you configured and choose **This computer** for a local chat.
3. Confirm the Redis Agent Memory plugin is enabled and its hook is trusted.
4. Start a new local chat.

Automatic saving and startup recall are now active for ordinary supported turns. Plugin hooks must be trusted again if their exact definition changes. Cloud-orchestrated Work chats do not load this local hook configuration, even if they can access your computer.

These steps follow the current [Codex environment](https://learn.chatgpt.com/docs/environments/modes) and [hooks](https://learn.chatgpt.com/docs/hooks) behavior documented by OpenAI.

## 4. Import existing ChatGPT conversations

In ChatGPT, request a data export from **Settings → Data controls → Export data**. When the ZIP arrives, preview it with the bundled CLI, using the same folder paths as step 2:

```sh
node /path/to/redis-agent-memory/plugins/redis-agent-memory/server/capture-cli.js import-chatgpt --project /path/to/your-project --input /path/to/chatgpt-export.zip
```

Review the owner, namespace, record count, and sample records. Then queue and deliver it:

```sh
node /path/to/redis-agent-memory/plugins/redis-agent-memory/server/capture-cli.js import-chatgpt --project /path/to/your-project --input /path/to/chatgpt-export.zip --write
```

The importer reads `conversations.json` and numbered conversation JSON files, preserves roles and timestamps, and uses deterministic IDs for safe retries. Add `--conversation`, `--after`, `--before`, or `--limit` to narrow a large export.

For account-level saved memory, copy the editable memory into a Markdown or text file and pass that file to the same command. The provider's export format is not guaranteed to include saved memory as a separate stable file, so preview the parsed records before using `--write`.

## 5. Uninstall the plugin

1. Open the ChatGPT Desktop **Plugins Directory** and find **Redis Agent Memory** in the installed plugins.
2. Open its details and select **Uninstall plugin**.
3. Start a new local chat.

Removing the plugin disables its lifecycle hooks. Project configuration, `.env` credentials, queued writes, and memories already stored in Redis are preserved. To pause automatic saving for one project while keeping the plugin installed, set `enabled` to `false` in that project's `.memory-capture.json`.

If you previously installed separate project hooks with `npm run capture:install`, remove those hooks from the affected project using the [project-hook uninstall instructions](automatic-saving-operations.md#remove-automatic-saving). Plugin removal does not remove separately installed project hooks. See OpenAI's [plugin removal documentation](https://learn.chatgpt.com/docs/plugins#remove-a-plugin) for the desktop removal flow.

For status, retries, identity, and removal, see [Automatic saving operations](automatic-saving-operations.md). For all import flags and security behavior, see [Import existing memories](importing-memories.md).

For package contents, the public hook-free profile, and removal semantics, see [ChatGPT plugin packaging](chatgpt-plugin.md).
