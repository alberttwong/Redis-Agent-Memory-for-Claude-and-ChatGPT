import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
for (const [entry, name] of [["claude-plugin-entry.ts", "index.mjs"], ["claude-capture-entry.ts", "capture-cli.mjs"]]) {
  const output = join(root, "plugins/redis-agent-memory-claude/server", name);
  const result = await build({ entryPoints: [join(root, "src", entry)], outfile: output,
    bundle: true,
    // PostHog probes this optional peer for trace context; tracing is not enabled.
    external: ["@opentelemetry/api"], platform: "node", format: "esm", target: "node20", minify: true,
    sourcemap: false, legalComments: "none", write: false });
  const bytes = result.outputFiles[0].contents;
  if (process.argv.includes("--check")) {
    assert.deepEqual(await readFile(output), Buffer.from(bytes), "Claude runtime is stale. Run npm run claude-plugin:build and commit the generated runtime.");
    process.stdout.write("Checked-in Claude runtime matches its source.\n");
  } else {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    process.stdout.write("Built standalone Claude plugin runtime.\n");
  }
}
