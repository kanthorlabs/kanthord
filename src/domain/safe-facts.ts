export const SCHEMA_VERSION = "007.1";

export const SAFE_FACTS_KINDS = Object.freeze([
  "task.lifecycle",
  "agent.turn",
  "agent.tool",
  "task.verification",
  "task.outcome",
] as const);
export type SafeFactsKind = (typeof SAFE_FACTS_KINDS)[number];

export const SAFE_FACTS_ERROR_CODES = Object.freeze([
  "budget_exceeded",
  "credential_error",
  "workspace_error",
  "verification_failed",
  "agent_error",
  "result_capture_error",
  "internal_unclassified",
] as const);
export type SafeFactsErrorCode = (typeof SAFE_FACTS_ERROR_CODES)[number];

export interface SafeFactsRecord {
  schemaVersion: string;
  sessionRef: string;
  taskRef: string;
  seq: number;
  timestamp: string;
  kind: SafeFactsKind;
  outcomeCode?: SafeFactsErrorCode;
  reasonCode?: SafeFactsErrorCode;
  toolCategory?: "read" | "write" | "exec" | "search" | "other";
  exitClass?: "pass" | "fail" | "timeout";
  durationMs?: number;
  turns?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface SafeFactsExport {
  schemaVersion: string;
  exportedAt: string;
  initiativeRef: string;
  records: SafeFactsRecord[];
}

export const SAFE_FACTS_RECORD_KEYS: ReadonlyArray<keyof SafeFactsRecord> =
  Object.freeze([
    "schemaVersion",
    "sessionRef",
    "taskRef",
    "seq",
    "timestamp",
    "kind",
    "outcomeCode",
    "reasonCode",
    "toolCategory",
    "exitClass",
    "durationMs",
    "turns",
    "tokensIn",
    "tokensOut",
  ] as Array<keyof SafeFactsRecord>);

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

const NUMERIC_FIELDS: ReadonlyArray<keyof SafeFactsRecord> = [
  "durationMs",
  "turns",
  "tokensIn",
  "tokensOut",
];

export function validateSafeFactsRecord(record: unknown): SafeFactsRecord {
  if (typeof record !== "object" || record === null) {
    throw new SchemaValidationError("record must be a non-null object");
  }
  const obj = record as Record<string, unknown>;

  // (i) Reject unknown keys — must check before kind so extra-key tests pass first
  const allowedKeys: ReadonlyArray<string> = SAFE_FACTS_RECORD_KEYS;
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      throw new SchemaValidationError(
        `unknown key '${key}' in safe-facts record`,
      );
    }
  }

  // (ii) Validate kind is a known SafeFactsKind
  const kinds: ReadonlyArray<string> = SAFE_FACTS_KINDS;
  const kind = obj["kind"];
  if (!kinds.includes(String(kind))) {
    throw new SchemaValidationError(
      `unknown kind '${String(kind)}' — must be one of: ${kinds.join(", ")}`,
    );
  }

  // (iii) Validate numeric fields — reject string values in place of numbers
  const numericFields: ReadonlyArray<string> = NUMERIC_FIELDS;
  for (const field of numericFields) {
    const val = obj[field];
    if (val !== undefined && typeof val !== "number") {
      throw new SchemaValidationError(
        `field '${field}' must be a number, got ${typeof val}`,
      );
    }
  }

  return record as SafeFactsRecord;
}

// Explicit field-by-field serialization — NEVER spread, Object.assign, or JSON roundtrip.
export function serializeSafeFactsRecord(
  r: SafeFactsRecord,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.schemaVersion = r.schemaVersion;
  out.sessionRef = r.sessionRef;
  out.taskRef = r.taskRef;
  out.seq = r.seq;
  out.timestamp = r.timestamp;
  out.kind = r.kind;
  if (r.outcomeCode !== undefined) out.outcomeCode = r.outcomeCode;
  if (r.reasonCode !== undefined) out.reasonCode = r.reasonCode;
  if (r.toolCategory !== undefined) out.toolCategory = r.toolCategory;
  if (r.exitClass !== undefined) out.exitClass = r.exitClass;
  if (r.durationMs !== undefined) out.durationMs = r.durationMs;
  if (r.turns !== undefined) out.turns = r.turns;
  if (r.tokensIn !== undefined) out.tokensIn = r.tokensIn;
  if (r.tokensOut !== undefined) out.tokensOut = r.tokensOut;
  return out;
}
