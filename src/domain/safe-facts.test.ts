import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SAFE_FACTS_KINDS,
  SAFE_FACTS_ERROR_CODES,
  SAFE_FACTS_RECORD_KEYS,
  SchemaValidationError,
  validateSafeFactsRecord,
  serializeSafeFactsRecord,
} from "./safe-facts.ts";
import type { SafeFactsRecord } from "./safe-facts.ts";

// A minimal valid record — all required fields, no optional fields:
const VALID_RECORD: SafeFactsRecord = {
  schemaVersion: "007.1",
  sessionRef: "session-opaque-1",
  taskRef: "task-opaque-1",
  seq: 1,
  timestamp: "2026-07-19T00:00:00.000Z",
  kind: "task.lifecycle",
};

// A record with ALL optional fields present:
const FULL_RECORD: SafeFactsRecord = {
  schemaVersion: "007.1",
  sessionRef: "session-opaque-2",
  taskRef: "task-opaque-2",
  seq: 2,
  timestamp: "2026-07-19T00:01:00.000Z",
  kind: "agent.turn",
  outcomeCode: "budget_exceeded",
  reasonCode: "credential_error",
  toolCategory: "read",
  exitClass: "pass",
  durationMs: 123,
  turns: 5,
  tokensIn: 1000,
  tokensOut: 500,
};

test("SAFE_FACTS_KINDS and SAFE_FACTS_ERROR_CODES are frozen", () => {
  assert.ok(
    Object.isFrozen(SAFE_FACTS_KINDS),
    "SAFE_FACTS_KINDS must be frozen",
  );
  assert.ok(
    Object.isFrozen(SAFE_FACTS_ERROR_CODES),
    "SAFE_FACTS_ERROR_CODES must be frozen",
  );
});

test("SAFE_FACTS_KINDS contains all five literal values", () => {
  const expected = [
    "task.lifecycle",
    "agent.turn",
    "agent.tool",
    "task.verification",
    "task.outcome",
  ] as const;
  assert.deepEqual(
    [...SAFE_FACTS_KINDS],
    expected,
    "SAFE_FACTS_KINDS must contain exactly the five expected kinds",
  );
});

test("SAFE_FACTS_RECORD_KEYS covers all fields of SafeFactsRecord", () => {
  // Every key of FULL_RECORD must be in SAFE_FACTS_RECORD_KEYS:
  for (const key of Object.keys(FULL_RECORD) as Array<keyof SafeFactsRecord>) {
    assert.ok(
      SAFE_FACTS_RECORD_KEYS.includes(key),
      `SAFE_FACTS_RECORD_KEYS must include '${key}'`,
    );
  }
  // And SAFE_FACTS_RECORD_KEYS must not have keys beyond SafeFactsRecord:
  for (const key of SAFE_FACTS_RECORD_KEYS) {
    assert.ok(
      key in FULL_RECORD,
      `SAFE_FACTS_RECORD_KEYS has unknown key '${key}' not in SafeFactsRecord`,
    );
  }
});

// ─── validateSafeFactsRecord ───────────────────────────────────────────────

test("validateSafeFactsRecord: returns the record unchanged for a valid minimal record", () => {
  const result = validateSafeFactsRecord(VALID_RECORD);
  assert.deepEqual(
    result,
    VALID_RECORD,
    "valid record must be returned unchanged",
  );
});

test("validateSafeFactsRecord: returns the record unchanged for a fully-populated record", () => {
  const result = validateSafeFactsRecord(FULL_RECORD);
  assert.deepEqual(
    result,
    FULL_RECORD,
    "full record must be returned unchanged",
  );
});

test("validateSafeFactsRecord: throws SchemaValidationError for an unknown key", () => {
  const badRecord = { ...VALID_RECORD, extraKey: "injected" };
  assert.throws(
    () => validateSafeFactsRecord(badRecord),
    (err: unknown) => {
      assert.ok(
        err instanceof SchemaValidationError,
        `expected SchemaValidationError, got ${String(err)}`,
      );
      assert.ok(
        /unknown key|extraKey/i.test((err as Error).message),
        `error message must mention unknown key or 'extraKey': ${(err as Error).message}`,
      );
      return true;
    },
  );
});

test("validateSafeFactsRecord: throws SchemaValidationError when durationMs is a string", () => {
  const badRecord = { ...VALID_RECORD, durationMs: "500" };
  assert.throws(
    () => validateSafeFactsRecord(badRecord as unknown),
    (err: unknown) => {
      assert.ok(
        err instanceof SchemaValidationError,
        `expected SchemaValidationError for string durationMs, got ${String(err)}`,
      );
      return true;
    },
  );
});

test("validateSafeFactsRecord: throws SchemaValidationError when turns is a string", () => {
  const badRecord = { ...VALID_RECORD, turns: "3" };
  assert.throws(
    () => validateSafeFactsRecord(badRecord as unknown),
    (err: unknown) => {
      assert.ok(
        err instanceof SchemaValidationError,
        `expected SchemaValidationError for string turns, got ${String(err)}`,
      );
      return true;
    },
  );
});

test("validateSafeFactsRecord: throws SchemaValidationError for unknown kind", () => {
  const badRecord = { ...VALID_RECORD, kind: "totally.unknown" };
  assert.throws(
    () => validateSafeFactsRecord(badRecord as unknown),
    (err: unknown) => {
      assert.ok(
        err instanceof SchemaValidationError,
        `expected SchemaValidationError for unknown kind, got ${String(err)}`,
      );
      return true;
    },
  );
});

test("SchemaValidationError has name 'SchemaValidationError'", () => {
  const err = new SchemaValidationError("test message");
  assert.equal(err.name, "SchemaValidationError");
});

// ─── serializeSafeFactsRecord ──────────────────────────────────────────────

test("serializeSafeFactsRecord: minimal record produces exactly the required fields — no extras", () => {
  const result = serializeSafeFactsRecord(VALID_RECORD);
  const resultKeys = Object.keys(result).sort();
  const expectedKeys = Object.keys(VALID_RECORD).sort();
  assert.deepEqual(
    resultKeys,
    expectedKeys,
    "serialized output must contain exactly the fields present in the record",
  );
});

test("serializeSafeFactsRecord: full record produces exactly all fields — no extras", () => {
  const result = serializeSafeFactsRecord(FULL_RECORD);
  const resultKeys = Object.keys(result).sort();
  const expectedKeys = Object.keys(FULL_RECORD).sort();
  assert.deepEqual(
    resultKeys,
    expectedKeys,
    "serialized full record must contain exactly all fields",
  );
});

test("serializeSafeFactsRecord: opaque ref appears in output but real task id (canary) does not", () => {
  const REAL_TASK_ID = "TASK-CANARY-SCHEMA-REAL-99";
  const record: SafeFactsRecord = {
    ...VALID_RECORD,
    taskRef: "ref-a-opaque",
    // NOTE: the real task id is NEVER stored in the record; it's replaced at
    // the DiagnosticsExport layer. Here we verify the serializer doesn't
    // introduce external ids on its own.
  };
  const result = serializeSafeFactsRecord(record);
  const json = JSON.stringify(result);
  assert.ok(
    json.includes("ref-a-opaque"),
    "opaque taskRef must appear in serialized output",
  );
  assert.ok(
    !json.includes(REAL_TASK_ID),
    "real task id canary must not appear in serialized output",
  );
});

test("serializeSafeFactsRecord: optional fields absent from record are absent from output", () => {
  // VALID_RECORD has no optional fields at all:
  const result = serializeSafeFactsRecord(VALID_RECORD);
  for (const optional of [
    "outcomeCode",
    "reasonCode",
    "toolCategory",
    "exitClass",
    "durationMs",
    "turns",
    "tokensIn",
    "tokensOut",
  ] as const) {
    assert.ok(
      !(optional in result),
      `optional field '${optional}' must not appear when not in the record`,
    );
  }
});
