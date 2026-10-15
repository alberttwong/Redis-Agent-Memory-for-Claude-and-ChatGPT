/** Defense in depth: agents must still omit sensitive information before writing. */
const sensitiveKey = /^(?:password|passwd|pwd|passphrase|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|ssn|social[_ -]?security(?:[_ -]?number)?|credit[_ -]?card|card[_ -]?number|bank[_ -]?account|date[_ -]?of[_ -]?birth|dob|passport|medical[_ -]?record|address|full[_ -]?name|email|phone)$/i;

export function redactSensitiveText(value: string, secrets: string[] = []): string {
  let result = value;
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, "[REDACTED]");
  return result
    .replace(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----/g, "[REDACTED]")
    .replace(/mem1_[A-Za-z0-9_=-]+|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    // Labelled values consume the rest of the line when unquoted, deliberately
    // favoring privacy over retaining surrounding prose.
    .replace(/\b(?:password|passwd|pwd|passphrase|secret|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|cookie|ssn|social security number|credit card|card number|bank account|date of birth|dob|passport|medical record|address|full name|email|phone)\b["']?\s*(?::|=|\bis\b)\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi, "[REDACTED]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED]")
    .replace(/(?<!\w)(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?!\w)/g, "[REDACTED]")
    .replace(/\b(?:\d[ -]?){12,18}\d\b/g, "[REDACTED]");
}

/** Traverse structured metadata before serialization so JSON escapes cannot hide values. */
export function sanitizeMemory<T>(value: T, secrets: string[] = []): T {
  if (typeof value === "string") return redactSensitiveText(value, secrets) as T;
  if (Array.isArray(value)) return value.map(item => sanitizeMemory(item, secrets)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      redactSensitiveText(key, secrets),
      sensitiveKey.test(key) ? "[REDACTED]" : sanitizeMemory(item, secrets),
    ])) as T;
  }
  return value;
}

/** Capture text is a JSON envelope; sanitize fields without damaging its encoding. */
export function sanitizeCapturedText(text: string): string {
  try { return JSON.stringify(sanitizeMemory(JSON.parse(text))); }
  catch { return redactSensitiveText(text); }
}
