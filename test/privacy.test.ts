import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveText, sanitizeMemory } from "../src/privacy.js";

test("redacts recognized credentials and PII while preserving useful context", () => {
  const examples = [
    'password: "two words!"', 'API_KEY=arbitrary-value', 'my password is two words',
    'Bearer eyJhbGciOi.test.signature', 'redis://alice:hunter2@host:6379',
    'person@example.com', '123-45-6789', '+1 415-555-0123', '4111 1111 1111 1111',
    '-----BEGIN PRIVATE KEY-----\nprivate material\n-----END PRIVATE KEY-----',
    'sk-proj-abcdefghijklmnop', 'mem1_abc123',
  ];
  for (const value of examples) {
    assert.notEqual(redactSensitiveText(value), value, value);
  }
  assert.equal(redactSensitiveText("Use backoff; 31 tests passed"), "Use backoff; 31 tests passed");
});

test("nested metadata strips sensitive values, including escaped and non-string values", () => {
  const safe = sanitizeMemory({ nested: [{ password: 'line1\nline2', email: 'test@example.com', ssn: 123456789 }], notes: "configured-value" }, ["configured-value"]);
  assert.deepEqual(safe, { nested: [{ password: "[REDACTED]", email: "[REDACTED]", ssn: "[REDACTED]" }], notes: "[REDACTED]" });
});

test("category overrides preserve selected PII while retaining mandatory configured secrets", () => {
  const policy = { redact: { email: false, credentials: false } };
  assert.equal(redactSensitiveText("person@example.com", [], policy), "person@example.com");
  assert.equal(redactSensitiveText("password: example", [], policy), "password: example");
  assert.equal(redactSensitiveText("redis-secret", ["redis-secret"], policy), "[REDACTED]");
  assert.equal(redactSensitiveText("415-555-0123", [], policy), "[REDACTED]");
  assert.deepEqual(sanitizeMemory({email: "person@example.com", phone: "415-555-0123"}, [], policy),
    {email: "person@example.com", phone: "[REDACTED]"});
});

test("custom fields, custom patterns, and optional context filtering apply recursively", () => {
  const safe = sanitizeMemory({ nested: { employeeCode: 123, branch: "main", note: "CLIENT-4821" } }, [], {
    sensitiveFields: ["employeeCode"], customPatterns: ["CLIENT-[0-9]+"], omitFields: ["branch"],
  });
  assert.deepEqual(safe, {nested: {employeeCode: "[REDACTED]", note: "[REDACTED]"}});
});

test("invalid project policies fail closed without exposing configuration values", async () => {
  const { guardrailsSchema, loadProjectGuardrails } = await import("../src/privacy.js");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  assert.equal(guardrailsSchema.safeParse({customPatterns: ["["]}).success, false);
  assert.equal(guardrailsSchema.safeParse({redact: {emali: false}}).success, false);
  const root = await mkdtemp(join(tmpdir(), "ram-policy-"));
  try {
    assert.equal(loadProjectGuardrails(root).redact?.email, true);
    for (const value of ["null", "[]", '{"guardrails":null}', '{"guardrails":{"unknown":"private-value"}}']) {
      await writeFile(join(root, ".memory-capture.json"), value);
      assert.throws(() => loadProjectGuardrails(root), /^Error: Invalid/);
    }
    await writeFile(join(root, ".memory-capture.json"), JSON.stringify({guardrails: {redact: {email: false}}}));
    assert.equal(loadProjectGuardrails(root).redact?.email, false);
    const { loadConfig } = await import("../src/config.js");
    assert.equal(loadConfig({MEMORY_CAPTURE_PROJECT_ROOT: root, AGENT_MEMORY_BASE_URL: "https://example.test",
      AGENT_MEMORY_STORE_ID: "test", AGENT_MEMORY_API_KEY: "private-key"}).guardrails?.redact?.email, false);
  } finally { await rm(root, {recursive: true, force: true}); }
});
