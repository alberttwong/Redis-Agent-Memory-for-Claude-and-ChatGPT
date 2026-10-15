# Optional native MCP connector setup

[Back to README](../README.md)

Automatic saving does not require an agent-facing native MCP connection; the capture handler talks to the Redis Agent Memory endpoint itself. Configure a native connector when agents should also perform explicit memory searches, writes, or document operations.

The generic connection shape is:

```json
{
  "mcpServers": {
    "redis-agent-memory": {
      "url": "<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer <MEMORY_KEY>"
      }
    }
  }
}
```

This illustrates the endpoint and authentication; use each client's supported configuration format and secret storage. `<MEMORY_URL>` is the HTTPS service endpoint, `<MEMORY_STORE_ID>` identifies the store, and `<MEMORY_KEY>` is its API key. A placeholder template is available in [`.mcp.native.json.example`](../.mcp.native.json.example). No local Node process or bridge installation is required for a direct connection. Keep populated configuration containing the key outside source control.

## Claude Desktop

Add the remote connector through Claude's account settings; the generic JSON example above is not a Claude Desktop local-server configuration.

1. Open **Customize → Connectors → + Add → Add custom connector**. On Team/Enterprise, an authorized owner may need to add it under **Organization settings → Connectors** first.
2. Name it `Redis Agent Memory` and enter `<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp` as the remote server URL. Click **Continue**.
3. For the Redis API-key endpoint tested here, choose **No sign in** for OAuth authentication. Under **Request headers**, add `Authorization` with value `Bearer <MEMORY_KEY>`. Enter the actual key privately in that field, not in chat or the URL.
4. Click **Add**, then connect if prompted. In a conversation, open **+ → Connectors** and enable Redis Agent Memory.
5. Ask: “Use `search_long_term_memory` with `owner_id` `desktop-test`, `namespace` `desktop-test`, and `limit` 1. Do not create or delete memories.” An empty successful result is sufficient.

Remote connectors run from Anthropic's infrastructure. The SDK test verified the Redis endpoint, not this Desktop setup end to end. See [Anthropic's remote connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Codex Desktop

Codex Desktop shares MCP configuration with the CLI and IDE extension on the same host. This connection adds agent-callable memory tools; [automatic saving](../README.md#quick-start) remains active independently through the project hooks.

Codex Desktop provides **Settings → MCP servers → Add server** for supported server and authentication flows. The Redis deployment verified by this project uses a static API-key `Authorization` header, so the explicit `config.toml` route below remains the clearest setup and does not depend on that UI exposing a custom-header field.

1. Open your private `~/.codex/config.toml` in a text editor (create the file if needed).
2. Merge this table, replacing any existing table with the same server name rather than duplicating it. Preserve unrelated configuration:

```toml
[mcp_servers.redis-agent-memory]
url = "<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp"
http_headers = { Authorization = "Bearer <MEMORY_KEY>" }
```

3. Replace the placeholders privately. This configuration contains a credential; keep it out of Git. Alternatively, replace `http_headers` with `bearer_token_env_var = "AGENT_MEMORY_API_KEY"` and ensure that variable is present in the Desktop app's launch environment. The project's `.env` is not automatically loaded by a native HTTP connection.
4. Save the file, fully quit and reopen Codex Desktop, and start a fresh local chat. If the Codex CLI is installed, run `codex mcp list` to confirm the server is configured; listing alone does not verify live connectivity.
5. Ask Codex to call `search_long_term_memory` with `owner_id` `desktop-test`, `namespace` `desktop-test`, and `limit` 1, without writing or deleting memories.

For an environment-based configuration, the CLI can also register the server:

```sh
codex mcp add redis-agent-memory \
  --url "<MEMORY_URL>/v1/stores/<MEMORY_STORE_ID>/mcp" \
  --bearer-token-env-var AGENT_MEMORY_API_KEY
```

The Desktop process must still receive that environment variable. See the [official OpenAI MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=app#configure-with-configtoml). The endpoint was tested with an SDK client; Desktop setup has not been verified end to end.

For the tools observed on the tested endpoint and the direct handoff workflow, see [Native Redis Agent Memory tools](native-tools.md).
