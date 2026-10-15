import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";

const configOption = z.strictObject({
  type: z.enum(["string", "number", "boolean", "directory", "file"]),
  title: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  multiple: z.boolean().optional(),
  sensitive: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const serverConfig = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const manifestSchema = z.strictObject({
  $schema: z.string().optional(),
  dxt_version: z.literal("0.3").optional(),
  manifest_version: z.literal("0.3"),
  name: z.string().min(1),
  display_name: z.string().min(1).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  description: z.string().min(1),
  long_description: z.string().optional(),
  author: z.strictObject({
    name: z.string().min(1),
    email: z.email().optional(),
    url: z.url().optional(),
  }),
  homepage: z.url().optional(),
  documentation: z.url().optional(),
  support: z.url().optional(),
  repository: z.strictObject({ type: z.string().min(1), url: z.url() }).optional(),
  icon: z.string().optional(),
  icons: z.array(z.strictObject({
    src: z.string(),
    size: z.string().regex(/^\d+x\d+$/),
    theme: z.string().min(1).optional(),
  })).optional(),
  screenshots: z.array(z.string()).optional(),
  localization: z.strictObject({
    resources: z.string().regex(/\$\{locale}/i),
    default_locale: z.string().regex(/^[A-Za-z0-9]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
  }).optional(),
  server: z.strictObject({
    type: z.enum(["python", "node", "binary"]),
    entry_point: z.string().min(1),
    mcp_config: serverConfig.extend({
      platform_overrides: z.record(z.string(), serverConfig.partial()).optional(),
    }),
  }),
  user_config: z.record(z.string(), configOption).optional(),
  tools: z.array(z.strictObject({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
  })).optional(),
  tools_generated: z.boolean().optional(),
  prompts: z.array(z.strictObject({
    name: z.string(),
    description: z.string().optional(),
    arguments: z.array(z.string()).optional(),
    text: z.string(),
  })).optional(),
  prompts_generated: z.boolean().optional(),
  keywords: z.array(z.string()).optional(),
  license: z.string().optional(),
  privacy_policies: z.array(z.url()).optional(),
  compatibility: z.strictObject({
    claude_desktop: z.string().optional(),
    platforms: z.array(z.enum(["darwin", "win32", "linux"])).optional(),
    runtimes: z.strictObject({
      python: z.string().optional(),
      node: z.string().optional(),
    }).optional(),
  }).optional(),
  _meta: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

export async function loadAndValidateManifest(path) {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const keys = new Set(Object.keys(manifest.user_config ?? {}));
  for (const value of Object.values(manifest.server.mcp_config.env ?? {})) {
    const match = /^\$\{user_config\.([^}]+)}$/.exec(value);
    if (match && !keys.has(match[1])) throw new Error(`Unknown user_config reference: ${match[1]}`);
  }
  if (manifest.server.entry_point.startsWith("/") || manifest.server.entry_point.split(/[\\/]/).includes("..")) {
    throw new Error("MCPB entry point must remain inside the extension archive");
  }
  return manifest;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), "..");
  await loadAndValidateManifest(resolve(process.argv[2] ?? `${root}/mcpb/manifest.json`));
  process.stdout.write("Manifest schema validation passes!\n");
}
