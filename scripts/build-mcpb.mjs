import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { loadAndValidateManifest } from "./validate-mcpb.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = join(root, "build");
const staging = join(buildRoot, "mcpb");
const serverDirectory = join(staging, "server");
const packageDocument = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = await loadAndValidateManifest(join(root, "mcpb", "manifest.json"));

if (manifest.version !== packageDocument.version) {
  throw new Error(`MCPB version ${manifest.version} must match package version ${packageDocument.version}`);
}

await rm(staging, { recursive: true, force: true });
await mkdir(serverDirectory, { recursive: true });

await build({
  entryPoints: [join(root, "src", "index.ts")],
  outfile: join(serverDirectory, "index.js"),
  bundle: true,
    // PostHog probes this optional peer for trace context; tracing is not enabled.
    external: ["@opentelemetry/api"],
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});

await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(root, "mcpb", "README.md"), join(staging, "README.md"));
const output = join(buildRoot, `redis-agent-memory-${packageDocument.version}.mcpb`);
const archive = zipSync({
  "manifest.json": await readFile(join(staging, "manifest.json")),
  "README.md": await readFile(join(staging, "README.md")),
  "server/index.js": await readFile(join(serverDirectory, "index.js")),
}, {
  level: 9,
  mtime: new Date("2000-01-01T00:00:00Z"),
});
await writeFile(output, archive);
process.stdout.write(`Packed 3 files to ${output}\n`);
