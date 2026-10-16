import { redactSensitiveText, sanitizeMemory, roleAllowed } from "./privacy.js";
import { createHash } from "node:crypto";
import type {
  AddSessionEventRequestContent,
  AddSessionEventResponseContent,
  BulkCreateLongTermMemoriesRequestContent,
  BulkCreateLongTermMemoriesResponseContent,
  GetLongTermMemoryResponseContent,
  GetSessionMemoryResponseContent,
  LongTermMemoryFilter,
  SearchLongTermMemoryRequestContent,
  SearchLongTermMemoryResponseContent,
  StoreHealthResponseContent,
  UpdateLongTermMemoryRequestContent,
  UpdateLongTermMemoryResponseContent,
} from "@redis-iris/agent-memory/models";
import { FilterConjunction, MessageRole } from "@redis-iris/agent-memory/models";
import type { AppConfig } from "./config.js";

export interface MemoryClient {
  storeHealth(): Promise<StoreHealthResponseContent>;
  addSessionEvent(
    request: AddSessionEventRequestContent,
  ): Promise<AddSessionEventResponseContent>;
  getSessionMemory(
    sessionId: string,
    includeSummarisedEvents?: boolean,
  ): Promise<GetSessionMemoryResponseContent>;
  searchLongTermMemory(
    request?: SearchLongTermMemoryRequestContent,
  ): Promise<SearchLongTermMemoryResponseContent>;
  bulkCreateLongTermMemories(
    request: BulkCreateLongTermMemoriesRequestContent,
  ): Promise<BulkCreateLongTermMemoriesResponseContent>;
  getLongTermMemory(memoryId: string): Promise<GetLongTermMemoryResponseContent>;
  updateLongTermMemory(
    memoryId: string,
    body?: UpdateLongTermMemoryRequestContent,
  ): Promise<UpdateLongTermMemoryResponseContent>;
}

export type MemoryScope = {
  ownerId?: string;
  namespaceId?: string;
  namespace?: string;
};

export type Checkpoint = {
  summary: string;
  currentGoal?: string;
  completed?: string[];
  nextSteps?: string[];
  blockers?: string[];
  repoPath?: string;
  branch?: string;
  commit?: string;
  changedFiles?: string[];
  notes?: string[];
};

export type SearchInput = MemoryScope & {
  query: string;
  limit?: number;
  similarityThreshold?: number;
  memoryTypes?: string[];
  topics?: string[];
};

export type AppendInput = MemoryScope & {
  sessionId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  text: string;
  actorId?: string;
  metadata?: unknown;
  createdAt?: Date;
};

function statusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) {
    return undefined;
  }
  return typeof error.statusCode === "number" ? error.statusCode : undefined;
}

function checkpointText(sessionId: string, checkpoint: Checkpoint): string {
  return [
    `Agent handoff checkpoint for session ${sessionId}.`,
    JSON.stringify(checkpoint, null, 2),
  ].join("\n");
}

export class MemoryGateway {
  constructor(
    private readonly client: MemoryClient,
    private readonly config: AppConfig,
  ) {}

  health() {
    return this.client.storeHealth();
  }

  private scope(input: MemoryScope): {
    ownerId: string;
    namespaceId?: string;
    namespace?: string;
  } {
    const namespaceId = input.namespaceId ?? this.config.namespaceId;
    return {
      ownerId: input.ownerId ?? this.config.ownerId,
      namespaceId,
      namespace: namespaceId
        ? undefined
        : input.namespace ?? this.config.legacyNamespace,
    };
  }

  async append(input: AppendInput) {
    if (!roleAllowed(input.role, this.config.guardrails)) return { skipped: true, reason: "Disabled by memory guardrails" };
    const scope = this.scope(input);
    const role = {
      USER: MessageRole.User,
      ASSISTANT: MessageRole.Assistant,
      SYSTEM: MessageRole.System,
    }[input.role];

    return this.client.addSessionEvent({
      sessionId: input.sessionId,
      actorId:
        input.actorId ??
        (input.role === "USER" ? scope.ownerId : this.config.agentId),
      role,
      content: [{ text: redactSensitiveText(input.text, [this.config.apiKey], this.config.guardrails) }],
      createdAt: input.createdAt ?? new Date(),
      metadata: sanitizeMemory(input.metadata, [this.config.apiKey], this.config.guardrails),
      ...(scope.namespaceId
        ? { namespaceRef: { namespaceId: scope.namespaceId } }
        : scope.namespace
          ? { namespace: scope.namespace }
          : {}),
    });
  }

  getSession(sessionId: string, includeSummarisedEvents = false) {
    return this.client.getSessionMemory(sessionId, includeSummarisedEvents);
  }

  search(input: SearchInput) {
    const scope = this.scope(input);
    const filter: LongTermMemoryFilter = {
      ownerId: { eq: scope.ownerId },
    };
    if (scope.namespaceId) filter.namespaceRef = { eq: scope.namespaceId };
    else if (scope.namespace) filter.namespace = { eq: scope.namespace };
    if (input.memoryTypes?.length) {
      filter.memoryType = { in: input.memoryTypes };
    }
    if (input.topics?.length) filter.topics = { all: input.topics };

    return this.client.searchLongTermMemory({
      text: input.query,
      filter,
      filterOp: FilterConjunction.All,
      limit: input.limit ?? 8,
      similarityThreshold: input.similarityThreshold ?? 0.65,
    });
  }

  checkpointId(sessionId: string, scope: MemoryScope = {}): string {
    const resolved = this.scope(scope);
    const namespaceKey = resolved.namespaceId ?? resolved.namespace ?? "global";
    const digest = createHash("sha256")
      .update(`${resolved.ownerId}:${namespaceKey}:${sessionId}`)
      .digest("hex")
      .slice(0, 32);
    return `checkpoint-${digest}`;
  }

  async saveCheckpoint(
    sessionId: string,
    checkpoint: Checkpoint,
    inputScope: MemoryScope = {},
  ) {
    const scope = this.scope(inputScope);
    const id = this.checkpointId(sessionId, inputScope);
    const text = checkpointText(sessionId, sanitizeMemory(checkpoint, [this.config.apiKey], this.config.guardrails));
    const common = {
      text,
      ownerId: scope.ownerId,
      sessionId,
      memoryType: "episodic",
      topics: ["agent-handoff", "checkpoint"],
      ...(scope.namespaceId
        ? { namespaceRef: { namespaceId: scope.namespaceId } }
        : scope.namespace
          ? { namespace: scope.namespace }
          : {}),
    };

    try {
      await this.client.getLongTermMemory(id);
      const updated = await this.client.updateLongTermMemory(id, common);
      return { operation: "updated" as const, memory: updated };
    } catch (error) {
      if (statusCode(error) !== 404) throw error;
      const created = await this.client.bulkCreateLongTermMemories({
        memories: [{ id, ...common }],
      });
      if (created.errors?.length) {
        throw new Error(
          `Redis rejected checkpoint ${id}: ${JSON.stringify(created.errors)}`,
        );
      }
      return { operation: "created" as const, id, result: created };
    }
  }

  async resumeContext(
    sessionId: string,
    query: string,
    inputScope: MemoryScope & { limit?: number } = {},
  ) {
    const checkpointId = this.checkpointId(sessionId, inputScope);
    const [session, recalled, checkpoint] = await Promise.all([
      this.getSession(sessionId),
      this.search({
        ...inputScope,
        query,
        limit: inputScope.limit ?? 8,
      }),
      this.client.getLongTermMemory(checkpointId).catch((error: unknown) => {
        if (statusCode(error) === 404) return null;
        throw error;
      }),
    ]);

    return { checkpoint, session, recalled };
  }
}
