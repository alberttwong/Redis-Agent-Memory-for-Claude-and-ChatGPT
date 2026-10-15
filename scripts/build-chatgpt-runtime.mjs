import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const directory = join(root, "plugins/redis-agent-memory/server");
for (const [entry, name] of [["index.ts", "index.js"], ["capture-cli.ts", "capture-cli.js"]]) {
  const output = join(directory, name);
  const result = await build({ entryPoints: [join(root, "src", entry)], outfile: output,
    bundle: true, platform: "node", format: "esm", target: "node20", minify: true,
    sourcemap: false, legalComments: "none", write: false });
  const bytes = Buffer.from(result.outputFiles[0].contents);
  if (process.argv.includes("--check")) {
    assert.deepEqual(await readFile(output), bytes,
      `ChatGPT runtime ${name} is stale. Run npm run plugin:runtime and commit the generated files.`);
  } else {
    await mkdir(directory, { recursive: true });
    await writeFile(output, bytes);
  }
}
process.stdout.write(process.argv.includes("--check") ? "Checked-in ChatGPT runtime matches source.\n" : "Built standalone ChatGPT plugin runtime.\n");
