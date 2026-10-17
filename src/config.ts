import { loadProjectGuardrails, type Guardrails } from "./privacy.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultOwnerId } from "./identity.js";

export type AppConfig = {
  contextChars?: number;
  automaticCheckpoints?: boolean;
  guardrails?: Guardrails;
  baseUrl: string;
  storeId: string;
  apiKey: string;
  ownerId: string;
  namespaceId?: string;
  legacyNamespace?: string;
  agentId: string;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const root = env.MEMORY_CAPTURE_PROJECT_ROOT ?? env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let automaticCheckpoints = true;
  try {
    const policy = JSON.parse(readFileSync(join(root, ".memory-capture.json"), "utf8"));
    automaticCheckpoints = policy.enabled !== false && policy.automaticCheckpoints !== false;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return {
    automaticCheckpoints,
    contextChars: contextChars(env.AGENT_MEMORY_CONTEXT_CHARS),
    guardrails: loadProjectGuardrails(env.MEMORY_CAPTURE_PROJECT_ROOT ?? env.CLAUDE_PROJECT_DIR ?? process.cwd()),
    baseUrl: required(env, "AGENT_MEMORY_BASE_URL").replace(/\/+$/, ""),
    storeId: required(env, "AGENT_MEMORY_STORE_ID"),
    apiKey: required(env, "AGENT_MEMORY_API_KEY"),
    ownerId: optional(env, "AGENT_MEMORY_OWNER_ID") ?? defaultOwnerId(),
    namespaceId: optional(env, "AGENT_MEMORY_NAMESPACE_ID"),
    legacyNamespace: optional(env, "AGENT_MEMORY_NAMESPACE"),
    agentId: optional(env, "AGENT_MEMORY_AGENT_ID") ?? "shared-agent",
  };
}

function contextChars(value?: string): number {
  const chars = value === undefined ? 12000 : Number(value);
  if (!Number.isInteger(chars) || chars < 1024 || chars > 100000) throw new Error("AGENT_MEMORY_CONTEXT_CHARS must be an integer from 1024 to 100000");
  return chars;
}
