# Claude Desktop setup and limitations

[Back to README](../README.md)

Claude Desktop can use the local Redis Agent Memory bridge for ordered session history, recall, and checkpoints. The installer makes the bridge available automatically, but saving remains **best-effort and model-directed**: ordinary Desktop Chat does not expose lifecycle hooks that let this project passively observe every prompt and response.

## Support matrix

| Surface | Installation | Capture behavior | Local retry queue |
| --- | --- | --- | --- |
| Local Codex project | `ram-capture install` | Guaranteed for supported, trusted hook events | Yes |
| Claude Desktop Chat | `.mcpb` extension; CLI fallback available | Best-effort MCP tool calls selected by the model | No |
| Claude Code | MCP bridge or native connector | Explicit or model-directed MCP tool calls | No |

The Claude Desktop bridge advertises instructions to recall prior work, append substantive turns, and save checkpoints without asking for memory identifiers. Those instructions improve the default workflow but cannot guarantee that the model calls a tool on every turn.

## Marketplace credentials

The marketplace plugin declares Redis connection fields through plugin `userConfig` starting in plugin v0.1.2. Configure them when enabling the plugin in a supported session, then call `memory_health` to verify connectivity. A successful marketplace installation alone does not confirm a Redis connection. See [configuration troubleshooting](quickstart-claude-desktop.md#if-installation-did-not-ask-for-redis-credentials).

## Recommended: MCPB desktop extension

Download the `redis-agent-memory-<version>.mcpb` file from **Assets** on the [latest release](https://github.com/alberttwong/redis-agent-memory-mcp/releases/latest). In Claude Desktop:

1. Open **Settings → Extensions**.
2. Select **Advanced settings → Install Extension…**.
3. Choose the downloaded `.mcpb` file.
4. Enter the Redis Agent Memory URL, store ID, and API key. The manifest marks the API key as sensitive so the Desktop host uses secure storage rather than a tracked file.
5. Optionally configure a stable owner, namespace resource ID, legacy namespace, or agent ID.
6. Enable the extension in a conversation and ask it to call `memory_health`.

The bundle contains a single JavaScript server with its runtime dependencies included. Claude Desktop supplies Node.js, so users installing a prebuilt `.mcpb` do not need this repository, npm, or a separate Node installation.

Privately distributed bundles are not automatically updated. Download and install a new version when a release is published. The generated bundle is unsigned; review its contents before installing it and use MCPB signing for production distribution.

### Build from source

For development or a custom build, install Node.js 20.12 or later, clone the repository, and run:

```sh
git clone https://github.com/alberttwong/redis-agent-memory-mcp.git
cd redis-agent-memory-mcp
npm ci
npm run mcpb:test
```

This creates `build/redis-agent-memory-0.1.1.mcpb`. Select that file during installation instead of a downloaded release asset.

## CLI fallback

The CLI installer is useful while developing the bridge or when testing a local checkout:

```sh
npm run capture:install:claude-desktop
```

The command builds the bridge and merges `redis-agent-memory-bridge` into Claude Desktop's existing `mcpServers` configuration. It preserves unrelated settings and servers, refuses to overwrite an entry with the same name that it does not manage, creates a private `.env` only when missing, and adds `.env` to `.gitignore`.

Fill in the generated `.env`:

```dotenv
AGENT_MEMORY_BASE_URL=https://your-agent-memory-endpoint
AGENT_MEMORY_STORE_ID=your-store-id
AGENT_MEMORY_API_KEY=your-store-api-key
```

Optional bridge defaults in the same file include `AGENT_MEMORY_OWNER_ID`, `AGENT_MEMORY_NAMESPACE_ID`, and `AGENT_MEMORY_AGENT_ID`.

Verify the installation without contacting Redis:

```sh
npm run capture:doctor:claude-desktop
```

Fully quit and reopen Claude Desktop. Enable `redis-agent-memory-bridge` in the conversation's connector menu and ask it to call `memory_health` to verify live connectivity.

The default configuration file is:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

For testing or nonstandard installations, pass `--claude-config /absolute/path/to/config.json`. The configured bridge references this package's compiled server and the selected project's `.env`, so keep them at those paths while using the bridge.

## Status and retry behavior

Inspect the local configuration and credential presence:

```sh
ram-capture status --claude-desktop
ram-capture doctor --claude-desktop
```

Claude Desktop MCP calls are synchronous and do not use the automatic capture queue. If a write tool fails, retry that tool call from Claude Desktop. `ram-capture flush --claude-desktop` exits with an explanation instead of implying that a queue exists.

## Uninstall

Remove only the installer-managed Claude Desktop server:

```sh
npm run capture:uninstall:claude-desktop
```

The command preserves unrelated Claude Desktop configuration, `.env`, and memories already stored in Redis. Fully quit and reopen Claude Desktop after removal.

For the manual local configuration and the bridge's tools, see [Optional bridge setup](bridge-setup.md). For the account-level remote connector, see [Optional native MCP connector setup](native-mcp-setup.md).
