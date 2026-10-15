import { redactSensitiveText, sanitizeMemory } from "./privacy.js";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { unzipSync } from "fflate";
import { enqueue, type CapturedMemory, type QueueEntry } from "./capture.js";

const maximumInputBytes = 250 * 1024 * 1024;
const maximumExtractedBytes = 500 * 1024 * 1024;
const maximumFileBytes = 100 * 1024 * 1024;

type JsonObject = Record<string, unknown>;
type ParsedItem = {
  sourceFile: string;
  conversationId: string;
  conversationTitle: string;
  messageId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt?: string;
  kind: "conversation" | "memory";
};

export type ImportProvider = "claude" | "chatgpt";

export type ClaudeImportOptions = {
  ownerId: string;
  namespace: string;
  after?: Date;
  before?: Date;
  conversation?: string;
  limit?: number;
  secrets?: string[];
};

export type ClaudeImportPlan = {
  inputPath: string;
  sourceFiles: string[];
  conversations: number;
  records: CapturedMemory[];
  skipped: number;
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timestamp(value: unknown): string | undefined {
  const raw = string(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function chatGptTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000);
    return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
  }
  return timestamp(value);
}

function messageText(message: JsonObject): string | undefined {
  const direct = string(message.text) ?? string(message.message);
  if (direct) return direct;
  if (typeof message.content === "string") return string(message.content);
  if (!Array.isArray(message.content)) return undefined;
  const parts = message.content.flatMap((part) => {
    if (typeof part === "string") return [part];
    const item = object(part);
    const text = item && (string(item.text) ?? string(item.content));
    return text ? [text] : [];
  });
  return parts.length ? parts.join("\n") : undefined;
}

function messageRole(value: unknown): "USER" | "ASSISTANT" | "SYSTEM" {
  const role = String(value ?? "").toLowerCase();
  if (["human", "user"].includes(role)) return "USER";
  if (["assistant", "claude", "bot"].includes(role)) return "ASSISTANT";
  return "SYSTEM";
}

function conversationArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const root = object(value);
  return Array.isArray(root?.conversations) ? root.conversations : [];
}

function parseConversations(value: unknown, sourceFile: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const [conversationIndex, rawConversation] of conversationArray(value).entries()) {
    const conversation = object(rawConversation);
    if (!conversation) continue;
    const messages = Array.isArray(conversation.chat_messages)
      ? conversation.chat_messages
      : Array.isArray(conversation.messages)
        ? conversation.messages
        : undefined;
    if (!messages) continue;
    const title = string(conversation.name) ?? string(conversation.title) ?? `Conversation ${conversationIndex + 1}`;
    const conversationId = string(conversation.uuid) ?? string(conversation.id)
      ?? `conversation-${digest(`${sourceFile}:${title}:${conversationIndex}`)}`;
    for (const [messageIndex, rawMessage] of messages.entries()) {
      const message = object(rawMessage);
      if (!message) continue;
      const content = messageText(message);
      if (!content) continue;
      items.push({
        sourceFile,
        conversationId,
        conversationTitle: title,
        messageId: string(message.uuid) ?? string(message.id) ?? `message-${messageIndex + 1}`,
        role: messageRole(message.sender ?? message.role ?? message.author),
        content,
        createdAt: timestamp(message.created_at ?? message.createdAt ?? message.timestamp),
        kind: "conversation",
      });
    }
  }
  return items;
}

function chatGptMessageText(message: JsonObject): string | undefined {
  const content = object(message.content);
  if (!content) return messageText(message);
  if (typeof content.text === "string") return string(content.text);
  if (!Array.isArray(content.parts)) return undefined;
  const parts = content.parts.flatMap((part) => {
    if (typeof part === "string") return part.trim() ? [part] : [];
    const item = object(part);
    const text = item && (string(item.text) ?? string(item.content));
    return text ? [text] : [];
  });
  return parts.length ? parts.join("\n") : undefined;
}

function parseChatGptConversations(value: unknown, sourceFile: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const [conversationIndex, rawConversation] of conversationArray(value).entries()) {
    const conversation = object(rawConversation);
    const mapping = object(conversation?.mapping);
    if (!conversation || !mapping) continue;
    const title = string(conversation.title) ?? `Conversation ${conversationIndex + 1}`;
    const conversationId = string(conversation.id) ?? string(conversation.conversation_id)
      ?? `conversation-${digest(`${sourceFile}:${title}:${conversationIndex}`)}`;
    const messages = Object.values(mapping).flatMap((rawNode, nodeIndex) => {
      const node = object(rawNode);
      const message = object(node?.message);
      const metadata = object(message?.metadata);
      if (!message || metadata?.is_visually_hidden_from_conversation === true) return [];
      const content = chatGptMessageText(message);
      if (!content) return [];
      const author = object(message.author);
      return [{
        sourceFile,
        conversationId,
        conversationTitle: title,
        messageId: string(message.id) ?? string(node?.id) ?? `message-${nodeIndex + 1}`,
        role: messageRole(author?.role ?? message.role),
        content,
        createdAt: chatGptTimestamp(message.create_time ?? message.created_at ?? conversation.create_time),
        kind: "conversation" as const,
      }];
    });
    messages.sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""));
    items.push(...messages);
  }
  return items;
}

function parseJsonMemories(value: unknown, sourceFile: string, provider: ImportProvider): ParsedItem[] {
  const root = object(value);
  const memories = Array.isArray(root?.memories)
    ? root.memories
    : /memor/i.test(basename(sourceFile)) && Array.isArray(value)
      ? value
      : [];
  return memories.flatMap((raw, index) => {
    const memory = object(raw);
    const content = typeof raw === "string"
      ? string(raw)
      : memory && (string(memory.content) ?? string(memory.text) ?? string(memory.memory));
    if (!content) return [];
    return [{
      sourceFile,
      conversationId: `memory-${digest(sourceFile)}`,
      conversationTitle: `${provider === "claude" ? "Claude" : "ChatGPT"} memory`,
      messageId: (memory ? string(memory.uuid) ?? string(memory.id) : undefined) ?? `memory-${index + 1}`,
      role: "SYSTEM" as const,
      content,
      createdAt: memory && timestamp(memory.created_at ?? memory.createdAt ?? memory.date),
      kind: "memory" as const,
    }];
  });
}

function parseTextMemories(text: string, sourceFile: string, provider: ImportProvider): ParsedItem[] {
  const fenced = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  const source = fenced.length ? fenced.join("\n") : text;
  const lines = source.split(/\r?\n/);
  const entries: Array<{ content: string; createdAt?: string }> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "```") continue;
    const dated = line.match(/^(?:[-*]\s*)?\[([^\]]+)]\s*-\s*(.+)$/);
    if (dated) {
      entries.push({ content: dated[2].trim(), createdAt: timestamp(dated[1]) });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) entries.push({ content: bullet[1].trim() });
    else entries.push({ content: line });
  }
  return entries.filter((entry) => entry.content).map((entry, index) => ({
    sourceFile,
    conversationId: `memory-${digest(sourceFile)}`,
    conversationTitle: `${provider === "claude" ? "Claude" : "ChatGPT"} memory`,
    messageId: `memory-${index + 1}`,
    role: "SYSTEM",
    content: entry.content,
    createdAt: entry.createdAt,
    kind: "memory",
  }));
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function candidate(name: string): boolean {
  return /(?:^|\/)(?:conversations?|memories?|memory)[^/]*\.(?:json|md|txt)$/i.test(name);
}

async function sourceDocuments(inputPath: string): Promise<Array<{ name: string; text: string }>> {
  const details = await stat(inputPath);
  if (!details.isFile()) throw new Error("Import input must be a file");
  if (details.size > maximumInputBytes) throw new Error("Import input exceeds the 250 MiB safety limit");
  const bytes = await readFile(inputPath);
  if (extname(inputPath).toLowerCase() !== ".zip") {
    return [{ name: basename(inputPath), text: decode(bytes) }];
  }

  let extractedBytes = 0;
  const archive = unzipSync(bytes, {
    filter(file) {
      if (!candidate(file.name)) return false;
      if (file.originalSize > maximumFileBytes) {
        throw new Error(`Export member ${file.name} exceeds the 100 MiB safety limit`);
      }
      extractedBytes += file.originalSize;
      if (extractedBytes > maximumExtractedBytes) {
        throw new Error("Export exceeds the 500 MiB extracted-data safety limit");
      }
      return true;
    },
  });
  const documents = Object.entries(archive).map(([name, data]) => ({ name, text: decode(data) }));
  if (!documents.length) {
    throw new Error("Export ZIP contains no recognized conversation or memory files");
  }
  return documents;
}


function included(item: ParsedItem, options: ClaudeImportOptions): boolean {
  if (options.conversation && !item.conversationTitle.toLowerCase().includes(options.conversation.toLowerCase())) {
    return false;
  }
  if (options.after || options.before) {
    if (!item.createdAt) return false;
    const date = new Date(item.createdAt);
    if (options.after && date < options.after) return false;
    if (options.before && date > options.before) return false;
  }
  return true;
}

function records(items: ParsedItem[], options: ClaudeImportOptions, provider: ImportProvider): {
  records: CapturedMemory[];
  selected: number;
} {
  const selected = items.filter((item) => included(item, options)).slice(0, options.limit);
  return { selected: selected.length, records: selected.flatMap((item) => {
    const content = redactSensitiveText(item.content, options.secrets ?? []);
    const chunks = content.match(/[\s\S]{1,6000}/g) ?? [];
    const sessionId = `${provider}-${digest(item.conversationId)}`;
    return chunks.map((chunk, part) => ({
      id: `${provider}-${digest(JSON.stringify([options.ownerId, options.namespace, item.sourceFile, item.conversationId, item.messageId, part, chunk]))}`,
      text: JSON.stringify(sanitizeMemory({
        role: item.role,
        source: `${provider}-import`,
        sourceFile: item.sourceFile,
        sourceConversationId: item.conversationId,
        conversationTitle: item.conversationTitle,
        sourceMessageId: item.messageId,
        capturedAt: item.createdAt,
        part: part + 1,
        parts: chunks.length,
        content: chunk,
      }, options.secrets ?? [])),
      memory_type: "message" as const,
      owner_id: options.ownerId,
      namespace: options.namespace,
      session_id: sessionId,
      topics: [`${provider}-import`, item.kind, item.role.toLowerCase()],
    }));
  }) };
}

async function planImport(
  provider: ImportProvider,
  inputPath: string,
  options: ClaudeImportOptions,
): Promise<ClaudeImportPlan> {
  const documents = await sourceDocuments(inputPath);
  const items: ParsedItem[] = [];
  for (const document of documents) {
    if (extname(document.name).toLowerCase() === ".json") {
      const parsed: unknown = JSON.parse(document.text);
      if (provider === "chatgpt") {
        items.push(...parseChatGptConversations(parsed, document.name), ...parseJsonMemories(parsed, document.name, provider));
      }
      else items.push(...parseConversations(parsed, document.name), ...parseJsonMemories(parsed, document.name, provider));
    } else {
      items.push(...parseTextMemories(document.text, document.name, provider));
    }
  }
  if (!items.length) throw new Error(`No supported ${provider === "claude" ? "Claude" : "ChatGPT"} records found`);
  const planned = records(items, options, provider);
  return {
    inputPath,
    sourceFiles: documents.map((document) => document.name),
    conversations: new Set(items.map((item) => item.conversationId)).size,
    records: planned.records,
    skipped: items.length - planned.selected,
  };
}

export async function planClaudeImport(
  inputPath: string,
  options: ClaudeImportOptions,
): Promise<ClaudeImportPlan> {
  return planImport("claude", inputPath, options);
}

export async function planChatGptImport(
  inputPath: string,
  options: ClaudeImportOptions,
): Promise<ClaudeImportPlan> {
  return planImport("chatgpt", inputPath, options);
}

export async function enqueueImport(
  directory: string,
  records: CapturedMemory[],
): Promise<{ enqueued: number; alreadyPending: number }> {
  const pendingIds = new Set<string>();
  for (const name of await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (!name.endsWith(".json")) continue;
    const entry = JSON.parse(await readFile(join(directory, name), "utf8")) as QueueEntry;
    for (const memory of entry.memories ?? []) pendingIds.add(memory.id);
  }
  const fresh = records.filter((memory) => !pendingIds.has(memory.id));
  for (let start = 0; start < fresh.length; start += 100) {
    await enqueue(directory, { version: 1, memories: fresh.slice(start, start + 100) });
  }
  return { enqueued: fresh.length, alreadyPending: records.length - fresh.length };
}

export const enqueueClaudeImport = enqueueImport;
