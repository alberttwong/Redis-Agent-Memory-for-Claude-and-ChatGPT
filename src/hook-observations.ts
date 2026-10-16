import * as z from "zod/v4";
import { sanitizeMemory, type Guardrails } from "./privacy.js";

export const codexCaptureEvents = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PreCompact", "Stop"] as const;
export const claudeCaptureEvents = [...codexCaptureEvents, "PostToolUseFailure", "SubagentStart", "SubagentStop", "Notification", "TaskCompleted", "SessionEnd"] as const;

export const observationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  excludedEvents: z.array(z.enum(claudeCaptureEvents)).max(12).default([]),
  // Exact names or globs, not regular expressions executed on untrusted inputs.
  excludedTools: z.array(z.string().min(1).max(200)).max(100).default([]),
  inputChars: z.number().int().min(0).max(6000).default(2000),
  outputChars: z.number().int().min(0).max(6000).default(4000),
}).prefault({});
export type ObservationConfig = z.infer<typeof observationConfigSchema>;

export type HookInput = {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  turn_id?: string;
  event_id?: string;
  timestamp?: string;
  prompt?: string;
  last_assistant_message?: string | null;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  error?: string;
  is_interrupt?: boolean;
  duration_ms?: number;
  agent_id?: string;
  agent_type?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  notification_type?: string;
  message?: string;
  title?: string;
  trigger?: string;
  custom_instructions?: string | null;
  reason?: string;
};

function matchesGlob(name: string, glob: string): boolean {
  const pattern = glob.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`, "i").test(name);
}

export function observationAllowed(event: string, tool: string | undefined, policy: ObservationConfig): boolean {
  if (!policy.enabled || policy.excludedEvents.includes(event as typeof claudeCaptureEvents[number])) return false;
  if (tool) {
    // Match both namespaced MCP names and unqualified bridge/native memory tools.
    if (/(?:^|__)(?:memory_|checkpoint_|resume_context$|create_long_term_memories$|search_long_term_memory$|get_long_term_memor|delete_long_term_memor|update_long_term_memor)/i.test(tool)
      || /(?:redis[-_]agent[-_]memory|agentmemory|ram[-_]capture)/i.test(tool)) return false;
    if (policy.excludedTools.some(glob => matchesGlob(tool, glob))) return false;
  }
  return true;
}

/** Keep paths and intent, without duplicating entire files/patches in the queue. */
function omitFileContents(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitFileContents);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(?:content|contents|old_string|new_string|patch|diff)$/i.test(key) ? "[file content omitted]" : omitFileContents(item)]));
  return value;
}

function excerpt(value: unknown, limit: number): { text: string; truncated: boolean } | undefined {
  if (value === undefined || limit === 0) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { text: text.slice(0, limit), truncated: text.length > limit };
}

/** Only allowlisted host fields enter an observation. Never follow transcript paths. */
export function observation(input: HookInput, policy: ObservationConfig, secrets: string[], guardrails: Guardrails) {
  const event = input.hook_event_name;
  if (!(claudeCaptureEvents as readonly string[]).includes(event)
    || ["SessionStart", "UserPromptSubmit", "Stop"].includes(event)
    || !observationAllowed(event, input.tool_name, policy)
    || guardrails.captureObservations === false) return null;
  const toolEvent = /^(?:PreToolUse|PostToolUse|PostToolUseFailure)$/.test(event);
  if (toolEvent && !input.tool_name) return null;
  // Shell hooks do not normally dispatch hooks themselves. Also exclude commands
  // that explicitly invoke our handler, preventing capture of hook-generated work.
  if (toolEvent && /(?:ram-capture|capture-cli\.[cm]?js|scripts\/capture\.sh)/i.test(JSON.stringify(input.tool_input ?? ""))) return null;
  const safe = sanitizeMemory({
    toolName: input.tool_name, toolCallId: input.tool_use_id,
    agentId: input.agent_id, agentType: input.agent_type, taskId: input.task_id,
    // Pre captures input once; completion carries only result/error + correlation.
    toolInput: event === "PreToolUse" ? omitFileContents(input.tool_input) : undefined,
    toolOutput: event === "PostToolUse" ? (/^(?:Read|read_file)$/i.test(input.tool_name ?? "") ? "[file content omitted]" : input.tool_response)
      : event === "SubagentStop" ? input.last_assistant_message : undefined,
    error: input.error, interrupted: input.is_interrupt, durationMs: input.duration_ms,
    taskSubject: input.task_subject, taskDescription: input.task_description,
    notificationType: input.notification_type, message: input.message, title: input.title,
    trigger: input.trigger, customInstructions: input.custom_instructions, reason: input.reason,
  }, secrets, guardrails);
  return {
    toolName: excerpt(safe.toolName, 200)?.text,
    toolCallId: excerpt(safe.toolCallId, 200)?.text,
    agentId: excerpt(safe.agentId, 200)?.text, agentType: excerpt(safe.agentType, 200)?.text,
    taskId: excerpt(safe.taskId, 200)?.text,
    details: excerpt({ toolInput: safe.toolInput, taskSubject: safe.taskSubject, taskDescription: safe.taskDescription,
      notificationType: safe.notificationType, message: safe.message, title: safe.title,
      trigger: safe.trigger, customInstructions: safe.customInstructions, reason: safe.reason }, policy.inputChars),
    outcome: excerpt({ toolOutput: safe.toolOutput, error: safe.error, interrupted: safe.interrupted,
      durationMs: safe.durationMs }, policy.outputChars),
  };
}
