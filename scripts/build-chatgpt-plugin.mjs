import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
import { validateChatGptPluginSources } from "./validate-chatgpt-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = join(root, "build");
const packageDocument = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const remoteIndex = process.argv.indexOf("--remote-url");
const outputIndex = process.argv.indexOf("--output");
const remoteUrl = remoteIndex >= 0 ? process.argv[remoteIndex + 1] : undefined;
const requestedOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (remoteIndex >= 0 && (!remoteUrl || remoteUrl.startsWith("--"))) throw new Error("--remote-url requires an HTTPS URL");
if (outputIndex >= 0 && (!requestedOutput || requestedOutput.startsWith("--"))) throw new Error("--output requires a path");
if (remoteUrl && new URL(remoteUrl).protocol !== "https:") throw new Error("Remote MCP URL must use HTTPS");

await validateChatGptPluginSources();
const profile = remoteUrl ? "remote" : "local";
const staging = join(buildRoot, "chatgpt-plugin", profile);
const source = join(root, "plugins", remoteUrl ? "redis-agent-memory-remote" : "redis-agent-memory");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(source, staging, { recursive: true });

if (remoteUrl) {
  await writeFile(join(staging, "mcp.json"), `${JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      "redis-agent-memory": {
        type: "streamable-http",
        url: remoteUrl,
      },
    },
  }, null, 2)}\n`);
} else {
  const serverDirectory = join(staging, "server");
  await mkdir(serverDirectory, { recursive: true });
  await Promise.all([
    build({
      entryPoints: [join(root, "src", "index.ts")],
      outfile: join(serverDirectory, "index.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      legalComments: "none",
      logLevel: "info",
    }),
    build({
      entryPoints: [join(root, "src", "capture-cli.ts")],
      outfile: join(serverDirectory, "capture-cli.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      legalComments: "none",
      logLevel: "info",
    }),
  ]);
}

async function archiveFiles(directory) {
  const files = {};
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(directory, path).replaceAll("\\", "/")] = await readFile(path);
    }
  }
  await visit(directory);
  return files;
}

const defaultName = `redis-agent-memory-chatgpt-${profile}-${packageDocument.version}.zip`;
const output = resolve(requestedOutput ?? join(buildRoot, defaultName));
await mkdir(dirname(output), { recursive: true });
const files = await archiveFiles(staging);
await writeFile(output, zipSync(files, {
  level: 9,
  mtime: new Date("2000-01-01T00:00:00Z"),
}));
process.stdout.write(`Packed ${Object.keys(files).length} ${profile} plugin files to ${output}\n`);
