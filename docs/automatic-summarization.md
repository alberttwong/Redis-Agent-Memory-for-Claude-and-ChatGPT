# Configure automatic summarization

[Back to README](../README.md)

Run this from the project directory to enable automatic session summarization on the managed Redis Agent Memory store:

```sh
npm run memory:configure-summarization -- --summarize-after 20 --keep-most-recent 10
```

Configure `AGENT_MEMORY_STORE_ID`, `REDIS_CLOUD_API_KEY` (Cloud account API key), and `REDIS_CLOUD_API_SECRET_KEY` (Cloud user API key) in your local environment or untracked `.env`. These management credentials are separate from `AGENT_MEMORY_API_KEY`, the bearer token used for ordinary memory operations. The command reads the project's `.env` and existing shared memory settings; management credentials are not copied by `capture:share-settings`.

Both counts are configurable. CLI flags override `AGENT_MEMORY_SUMMARIZE_AFTER` and `AGENT_MEMORY_KEEP_MOST_RECENT`; when omitted, they default to **20** and **10**. Values must be integers from 0 to 10000, and “Summarize after” must exceed “Keep most recent”. Changing the environment variables alone does not apply the settings: run the setup command explicitly. Normal capture and MCP startup do not change service configuration.

This changes the **entire store**, including sessions written by other projects and clients using that store. The command updates only summarization, polls the asynchronous task for up to two minutes, and reads the store back to verify the saved counts. If it times out, check the task or store in Redis Cloud before retrying; the accepted update may still complete. Account feature availability and API permissions can prevent updates.

See the [Redis Cloud Iris management API](https://api.redislabs.com/v1/swagger-ui/index.html?urls.primaryName=Iris#/Agent%20Memory%20-%20Stores/updateMemoryStore) for the store update contract. For usage, run `npm run memory:configure-summarization -- --help`.

