import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClaudePlugin } from "./claude-plugin.js";

createClaudePlugin().connect(new StdioServerTransport()).catch(() => {
  console.error("Could not start the Redis Agent Memory plugin.");
  process.exitCode = 1;
});
