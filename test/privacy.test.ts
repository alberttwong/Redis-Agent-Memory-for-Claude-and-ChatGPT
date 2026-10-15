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
