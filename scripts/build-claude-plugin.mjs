import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "plugins/redis-agent-memory-claude/server/index.mjs");
const result = await build({ entryPoints: [join(root, "src/claude-plugin-entry.ts")], outfile: output,
  bundle: true, platform: "node", format: "esm", target: "node20", minify: true,
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
