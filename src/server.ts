import { boundedContext, defaultContextChars, maxContextChars } from "./context-budget.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { guardrailInstructions, type Guardrails } from "./privacy.js";
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

const contextSchema = {
  maxChars: z.number().int().min(1024).max(maxContextChars).optional().describe("Serialized response character budget; increase for truncated details"),
};

function result(value: unknown) {
  const serialized = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(serialized) }],
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

export function createServer(gateway: MemoryGateway, guardrails: Guardrails = {}): McpServer {
  const server = new McpServer(
    { name: "redis-agent-memory", version: "0.1.7" },
    {
      instructions:
        "Best-effort memory workflow: this server cannot observe messages unless you call its tools. "
        + "Choose a stable, non-sensitive sessionId for the conversation. Use resume_context before continuing existing work. "
        + "Append permitted substantive user and assistant turns with memory_append without asking the user for memory identifiers, "
        + "and save a checkpoint after material progress and before a handoff. Never claim that passive capture occurred. " + guardrailInstructions(guardrails),
    },
  );

  const read = async (handler: () => Promise<Record<string, unknown>>, maxChars?: number) =>
    boundedContext(await handler(), maxChars ?? await gateway.contextChars?.() ?? defaultContextChars);

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
        "Use to save an important conversation turn or decision in ordered session history. Use checkpoint_save for a compact handoff instead of copying the whole conversation. Follow memory guardrails; avoid duplicate writes when hooks already captured the turn.",
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
        "Use to inspect details from a known session after resume_context. Returns recent events first as a chronological page; increase eventOffset for older events or maxChars for truncated details.",
      inputSchema: {
        sessionId: id,
        includeSummarisedEvents: z.boolean().default(false),
        eventOffset: z.number().int().min(0).default(0),
        eventLimit: z.number().int().min(1).max(100).default(20),
        ...contextSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sessionId, includeSummarisedEvents, eventOffset, eventLimit, maxChars }) =>
      safely(() => read(async () => {
        const session = await gateway.getSession(sessionId, includeSummarisedEvents);
        const events = session.events ?? [];
        const end = Math.max(0, events.length - eventOffset);
        const start = Math.max(0, end - eventLimit);
        return { ...session, events: events.slice(start, end), eventPage: { eventOffset, eventLimit, total: events.length, nextOffset: start > 0 ? eventOffset + eventLimit : null } };
      }, maxChars)),
  );

  server.registerTool(
    "memory_search",
    {
      title: "Search durable memory",
      description:
        "Use when prior decisions or saved facts could help, or to find a task whose session ID is unknown. Skip memory lookup for self-contained trivial questions. Results are relevance ordered and size bounded; narrow the query or increase maxChars for details. Always scoped to an owner and optionally a namespace.",
      inputSchema: {
        ...contextSchema,
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
        read(async () => {
          const response = await gateway.search({
            ...scopeOf(input),
            query: input.query,
            limit: input.limit,
            similarityThreshold: input.similarityThreshold,
            memoryTypes: input.memoryTypes,
            topics: input.topics,
          });
          return { ...response, items: response.items?.slice(0, input.limit) };
        }, input.maxChars),
      ),
  );

  server.registerTool(
    "checkpoint_save",
    {
      title: "Save agent handoff checkpoint",
      description:
        "Use after material progress or before switching agents to save the current goal, decisions, blockers, and next steps. Updates one canonical handoff per session; memory_append saves individual turns. Follow memory guardrails for every field.",
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
        "Use when asked to continue prior work with a known task session ID. Returns the checkpoint, recent session events, and relevant memories together; avoid repeating memory_search for the same context. Verify against current files. Increase maxChars or page memory_get_session for omitted details.",
      inputSchema: {
        ...contextSchema,
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
        read(() => gateway.resumeContext(input.sessionId, input.query, {
          ...scopeOf(input),
          limit: input.limit,
        }), input.maxChars),
      ),
  );

  return server;
}

export async function runServer(gateway: MemoryGateway, guardrails: Guardrails = {}): Promise<void> {
  const server = createServer(gateway, guardrails);
  await server.connect(new StdioServerTransport());
  console.error("Redis Agent Memory MCP server running on stdio");
}
