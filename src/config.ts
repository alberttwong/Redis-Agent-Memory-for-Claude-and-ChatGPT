export type AppConfig = {
  baseUrl: string;
  storeId: string;
  apiKey: string;
  ownerId: string;
  namespaceId?: string;
  legacyNamespace?: string;
  agentId: string;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function loadConfig(): AppConfig {
  return {
    baseUrl: required("AGENT_MEMORY_BASE_URL").replace(/\/+$/, ""),
    storeId: required("AGENT_MEMORY_STORE_ID"),
    apiKey: required("AGENT_MEMORY_API_KEY"),
    ownerId: optional("AGENT_MEMORY_OWNER_ID") ?? "default-user",
    namespaceId: optional("AGENT_MEMORY_NAMESPACE_ID"),
    legacyNamespace: optional("AGENT_MEMORY_NAMESPACE"),
    agentId: optional("AGENT_MEMORY_AGENT_ID") ?? "shared-agent",
  };
}
