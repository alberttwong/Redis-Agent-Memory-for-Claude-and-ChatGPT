# Redis Agent Memory desktop plugin

This is the manually installed ChatGPT/Codex desktop profile. It bundles a local stdio MCP server, a setup skill, and trusted lifecycle hooks for default-enabled automatic saving in configured projects.

The hook does nothing in projects without `.memory-capture.json`. Run the `setup-redis-memory` skill after installation to create the project configuration and private `.env` template.

This package targets local or repository marketplaces. Its command hooks require local execution and trust; they do not run in cloud-orchestrated Work. Public-directory acceptance has not been validated.

The Git marketplace points directly to this directory and includes both bundled runtime files. Installation does not require npm or a build. Maintainers should regenerate them with `npm run plugin:runtime` after source changes.

From the repository root, run `npm run plugin:test` to validate both plugin profiles and smoke-test the bundled local runtime. Run `npm run plugin:build` to create the distributable local ZIP under `build/`.
