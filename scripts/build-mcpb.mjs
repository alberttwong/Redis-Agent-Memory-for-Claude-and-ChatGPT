import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = join(root, "build");
const staging = join(buildRoot, "mcpb");
const serverDirectory = join(staging, "server");
const packageDocument = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(root, "mcpb", "manifest.json"), "utf8"));

if (manifest.version !== packageDocument.version) {
  throw new Error(`MCPB version ${manifest.version} must match package version ${packageDocument.version}`);
}

await rm(staging, { recursive: true, force: true });
await mkdir(serverDirectory, { recursive: true });

await build({
  entryPoints: [join(root, "src", "index.ts")],
  outfile: join(serverDirectory, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});

await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(root, "mcpb", "README.md"), join(staging, "README.md"));
await writeFile(join(staging, ".mcpbignore"), "*.map\n");

const cli = join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
const output = join(buildRoot, `redis-agent-memory-${packageDocument.version}.mcpb`);
const packed = spawnSync(process.execPath, [cli, "pack", staging, output], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
process.stdout.write(packed.stdout);
process.stderr.write(packed.stderr);
if (packed.status !== 0) process.exit(packed.status ?? 1);
process.stdout.write(`${output}\n`);
