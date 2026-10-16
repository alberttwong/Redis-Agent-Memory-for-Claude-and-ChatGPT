import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import type { Checkpoint, MemoryGateway, MemoryScope } from "./memory.js";

const id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9-]+$/, "Use only letters, numbers, and dashes");
const namespaceId = z.string().min(1).max(255);

const scopeSchema = {
  ownerId: id.optional().describe("Stable owner ID; defaults to server config"),
  namespaceId: namespaceId
    .optional()
    .describe("Redis namespace resource ID; preferred over namespace"),
  namespace: id
    .optional()
    .describe("Legacy namespace label; ignored when namespaceId is set"),
};

function scopeOf(input: {
  ownerId?: string;
  namespaceId?: string;
  namespace?: string;
}): MemoryScope {
  return {
    ownerId: input.ownerId,
    namespaceId: input.namespaceId,
    namespace: input.namespace,
  };
}

function result(value: unknown) {
  const serialized = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(serialized, null, 2) }],
    structuredContent: serialized,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function safely<T extends Record<string, unknown>>(
  handler: () => Promise<T>,
) {
  return handler().then(result).catch(errorResult);
}

export function createServer(gateway: MemoryGateway): McpServer {
  const server = new McpServer(
    { name: "redis-agent-memory", version: "0.1.5" },
    {
      instructions:
        "Best-effort memory workflow: this server cannot observe messages unless you call its tools. "
        + "Choose a stable, non-sensitive sessionId for the conversation. Use resume_context before continuing existing work. "
        + "Append substantive user and assistant turns with memory_append without asking the user for memory identifiers, "
        + "and save a checkpoint after material progress and before a handoff. Never store passwords, API keys, tokens, private keys, raw environment files, or sensitive personal information (PII), including contact details, government IDs, financial or medical information. Omit sensitive details or use placeholders in text, metadata, checkpoints, and identifiers; when unsure, do not store the detail. Never claim that passive capture occurred.",
    },
  );

  server.registerTool(
    "memory_health",
    {
      title: "Check Redis Agent Memory",
      description: "Check whether the configured Redis Agent Memory store is ready.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => safely(() => gateway.health()),
  );

  server.registerTool(
    "memory_append",
    {
      title: "Append conversation memory",
      description:
        "Append a sanitized user, assistant, or system event to ordered session memory. Omit credentials and sensitive personal information.",
      inputSchema: {
        sessionId: id.describe("Durable task/session ID shared by all agents"),
        role: z.enum(["USER", "ASSISTANT", "SYSTEM"]),
        text: z.string().min(1).max(50_000),
        actorId: z.string().min(1).max(255).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        ...scopeSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) =>
      safely(() =>
        gateway.append({
          ...scopeOf(input),
          sessionId: input.sessionId,
          role: input.role,
          text: input.text,
          actorId: input.actorId,
          metadata: input.metadata,
        }),
      ),
  );

  server.registerTool(
    "memory_get_session",
    {
      title: "Read session memory",
      description:
        "Retrieve the ordered events and optional compacted summary for a session.",
      inputSchema: {
        sessionId: id,
        includeSummarisedEvents: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sessionId, includeSummarisedEvents }) =>
      safely(() => gateway.getSession(sessionId, includeSummarisedEvents)),
  );

  server.registerTool(
    "memory_search",
    {
      title: "Search durable memory",
      description:
        "Semantically search long-term memories, always scoped to an owner and optionally a namespace.",
      inputSchema: {
        query: z.string().min(1).max(10_000),
        limit: z.number().int().min(1).max(100).default(8),
        similarityThreshold: z.number().min(0).max(1).default(0.65),
        memoryTypes: z.array(z.string().min(1)).max(20).optional(),
        topics: z.array(z.string().min(1).max(100)).max(50).optional(),
        ...scopeSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      safely(() =>
        gateway.search({
          ...scopeOf(input),
          query: input.query,
          limit: input.limit,
          similarityThreshold: input.similarityThreshold,
          memoryTypes: input.memoryTypes,
          topics: input.topics,
        }),
      ),
  );

  server.registerTool(
    "checkpoint_save",
    {
      title: "Save agent handoff checkpoint",
      description:
        "Create or update the canonical durable checkpoint for a task session. Omit credentials and sensitive personal information from every field.",
      inputSchema: {
        sessionId: id,
        summary: z.string().min(1).max(20_000),
        currentGoal: z.string().max(5_000).optional(),
        completed: z.array(z.string().max(2_000)).max(100).optional(),
        nextSteps: z.array(z.string().max(2_000)).max(100).optional(),
        blockers: z.array(z.string().max(2_000)).max(100).optional(),
        repoPath: z.string().max(4_096).optional(),
        branch: z.string().max(255).optional(),
        commit: z.string().max(255).optional(),
        changedFiles: z.array(z.string().max(4_096)).max(500).optional(),
        notes: z.array(z.string().max(5_000)).max(100).optional(),
        ...scopeSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      const checkpoint: Checkpoint = {
        summary: input.summary,
        currentGoal: input.currentGoal,
        completed: input.completed,
        nextSteps: input.nextSteps,
        blockers: input.blockers,
        repoPath: input.repoPath,
        branch: input.branch,
        commit: input.commit,
        changedFiles: input.changedFiles,
        notes: input.notes,
      };
      return safely(() =>
        gateway.saveCheckpoint(input.sessionId, checkpoint, scopeOf(input)),
      );
    },
  );

  server.registerTool(
    "resume_context",
    {
      title: "Build cross-agent resume context",
      description:
        "Return the canonical checkpoint, current ordered session, and relevant durable memories in one call.",
      inputSchema: {
        sessionId: id,
        query: z
          .string()
          .min(1)
          .max(10_000)
          .default("current goal decisions blockers completed work and next steps"),
        limit: z.number().int().min(1).max(100).default(8),
        ...scopeSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      safely(() =>
        gateway.resumeContext(input.sessionId, input.query, {
          ...scopeOf(input),
          limit: input.limit,
        }),
      ),
  );

  return server;
}

export async function runServer(gateway: MemoryGateway): Promise<void> {
  const server = createServer(gateway);
  await server.connect(new StdioServerTransport());
  console.error("Redis Agent Memory MCP server running on stdio");
}
