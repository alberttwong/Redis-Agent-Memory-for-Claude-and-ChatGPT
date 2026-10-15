# Redis Agent Memory public profile

This hook-free profile is suitable for a public ChatGPT plugin once a stable public HTTPS MCP endpoint exists. The build command injects that endpoint into `mcp.json`; no credentials or endpoint placeholders are committed to the package.

Public plugins cannot use the local automatic-capture hooks. Saving is therefore model-directed in this profile.
