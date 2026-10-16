import * as z from "zod/v4";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pattern = z.string().min(1).max(256).refine(value => {
  try { new RegExp(value, "gi"); return true; } catch { return false; }
}, "Invalid custom redaction pattern");

export const guardrailsSchema = z.object({
  redact: z.object({
    credentials: z.boolean().default(true),
    email: z.boolean().default(true),
    phone: z.boolean().default(true),
    governmentIds: z.boolean().default(true),
    financial: z.boolean().default(true),
    personal: z.boolean().default(true),
  }).strict().prefault({}),
  sensitiveFields: z.array(z.string().min(1).max(100)).max(100).default([]),
  customPatterns: z.array(pattern).max(50).default([]),
  capturePrompts: z.boolean().default(true),
  captureResponses: z.boolean().default(true),
  omitFields: z.array(z.enum([
    "sourceSessionId", "turnId", "capturedAt", "sourceFile", "sourceConversationId",
    "conversationTitle", "sourceMessageId", "repoPath", "branch", "commit", "changedFiles",
  ])).default([]),
}).strict();
export type Guardrails = z.input<typeof guardrailsSchema>;

export function loadProjectGuardrails(root: string): Guardrails {
  let document;
  try { document = JSON.parse(readFileSync(join(root, ".memory-capture.json"), "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return guardrailsSchema.parse({});
    throw new Error("Invalid .memory-capture.json; memory guardrails were not loaded");
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("Invalid .memory-capture.json");
  const parsed = guardrailsSchema.safeParse(document.guardrails === undefined ? {} : document.guardrails);
  if (!parsed.success) throw new Error("Invalid guardrails in .memory-capture.json");
  return parsed.data;
}

const labels = {
  credentials: "password|passwd|pwd|passphrase|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie",
  email: "email", phone: "phone",
  governmentIds: "ssn|social[_ -]?security(?:[_ -]?number)?|passport",
  financial: "credit[_ -]?card|card[_ -]?number|bank[_ -]?account",
  personal: "date[_ -]?of[_ -]?birth|dob|medical[_ -]?record|address|full[_ -]?name",
};
function enabledLabels(policy: ReturnType<typeof guardrailsSchema.parse>): string {
  return Object.entries(labels).filter(([key]) => policy.redact[key as keyof typeof labels])
    .map(([, value]) => value).join("|");
}

export function roleAllowed(role: string, guardrails: Guardrails = {}): boolean {
  return !(role === "USER" && guardrails.capturePrompts === false
    || role === "ASSISTANT" && guardrails.captureResponses === false);
}

export function guardrailInstructions(guardrails: Guardrails = {}): string {
  const policy = guardrailsSchema.parse(guardrails);
  return "Follow the configured memory guardrails: omit values in enabled redaction categories "
    + JSON.stringify(policy.redact) + "; redact additional sensitive fields " + JSON.stringify(policy.sensitiveFields)
    + "; apply configured custom redaction patterns. Never store the configured Redis API key. "
    + "Omit these optional context fields: " + JSON.stringify(policy.omitFields) + ". "
    + `Saving USER messages is ${policy.capturePrompts ? "enabled" : "disabled"}; saving ASSISTANT messages is ${policy.captureResponses ? "enabled" : "disabled"}. `
    + "Apply this policy to text, metadata, and checkpoints; when unsure about a protected detail, omit it.";
}

export function redactSensitiveText(value: string, secrets: string[] = [], guardrails: Guardrails = {}): string {
  const policy = guardrailsSchema.parse(guardrails);
  let result = value;
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, "[REDACTED]");
  if (policy.redact.credentials) result = result
    .replace(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g, "[REDACTED]")
    .replace(/mem1_[A-Za-z0-9_=-]+|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
  const enabled = enabledLabels(policy);
  if (enabled) result = result.replace(new RegExp(
    "\\b(?:" + enabled + ")[\"']?\\s*(?::|=|\\bis\\b)\\s*(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[^\\r\\n]+)", "gi"), "[REDACTED]");
  if (policy.redact.email) result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]");
  if (policy.redact.governmentIds) result = result.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]");
  if (policy.redact.phone) result = result.replace(/(?<!\w)(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\w)/g, "[REDACTED]");
  if (policy.redact.financial) result = result.replace(/\b(?:\d[ -]?){12,18}\d\b/g, "[REDACTED]");
  for (const custom of policy.customPatterns) result = result.replace(new RegExp(custom, "gi"), "[REDACTED]");
  // Mandatory even when configurable rules are disabled or substitutions join text.
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, "[REDACTED]");
  return result;
}

/** Traverse structured metadata before serialization so JSON escapes cannot hide values. */
export function sanitizeMemory<T>(value: T, secrets: string[] = [], guardrails: Guardrails = {}): T {
  const policy = guardrailsSchema.parse(guardrails);
  const enabled = enabledLabels(policy);
  const sensitiveKey = enabled ? new RegExp("^(?:" + enabled + ")$", "i") : /(?!)/;
  if (typeof value === "string") return redactSensitiveText(value, secrets, guardrails) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeMemory(item, secrets, guardrails)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !policy.omitFields.includes(key as typeof policy.omitFields[number])).map(([key, item]) => [
      redactSensitiveText(key, secrets, guardrails),
      sensitiveKey.test(key) || policy.sensitiveFields.some(field => field.toLowerCase() === key.toLowerCase()) ? "[REDACTED]" : sanitizeMemory(item, secrets, guardrails),
    ])) as T;
  }
  return value;
}

/** Capture text is a JSON envelope; sanitize fields without damaging its encoding. */
export function sanitizeCapturedText(text: string, secrets: string[] = [], guardrails: Guardrails = {}): string {
  try { return JSON.stringify(sanitizeMemory(JSON.parse(text), secrets, guardrails)); }
  catch { return redactSensitiveText(text, secrets, guardrails); }
}
