import { defaultOwnerId } from "./identity.js";

export type AppConfig = {
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
  return {
    baseUrl: required(env, "AGENT_MEMORY_BASE_URL").replace(/\/+$/, ""),
    storeId: required(env, "AGENT_MEMORY_STORE_ID"),
    apiKey: required(env, "AGENT_MEMORY_API_KEY"),
    ownerId: optional(env, "AGENT_MEMORY_OWNER_ID") ?? defaultOwnerId(),
    namespaceId: optional(env, "AGENT_MEMORY_NAMESPACE_ID"),
    legacyNamespace: optional(env, "AGENT_MEMORY_NAMESPACE"),
    agentId: optional(env, "AGENT_MEMORY_AGENT_ID") ?? "shared-agent",
  };
}
