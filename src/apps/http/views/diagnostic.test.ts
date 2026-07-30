// src/apps/http/views/diagnostic.test.ts — Story S8 §4
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnosticView } from "./diagnostic.ts";
import type { DiagnosticResult } from "./diagnostic.ts";

test("diagnosticView leak test: top-level key set is exactly the declared four, no outPath even when the fixture carries one", () => {
  const fixture = {
    schemaVersion: "007.1",
    exportedAt: "2026-07-30T00:00:00.000Z",
    initiativeRef: "opaque-init-1",
    records: [],
    outPath: "/etc/passwd",
    secret: "shh",
    nested: { stray: true },
  } as unknown as DiagnosticResult;
  const view = diagnosticView(fixture);
  assert.deepEqual(Object.keys(view).sort(), [
    "exportedAt",
    "initiativeRef",
    "records",
    "schemaVersion",
  ]);
  assert.equal("outPath" in view, false);
});

test("diagnosticView record with only the six required fields gives exactly the six keys", () => {
  const fixture: DiagnosticResult = {
    schemaVersion: "007.1",
    exportedAt: "2026-07-30T00:00:00.000Z",
    initiativeRef: "opaque-init-1",
    records: [
      {
        schemaVersion: "007.1",
        sessionRef: "sess-1",
        taskRef: "task-1",
        seq: 1,
        timestamp: "2026-07-30T00:00:01.000Z",
        kind: "tool_result",
      },
    ],
  };
  const view = diagnosticView(fixture);
  const records = view.records as unknown as Array<Record<string, unknown>>;
  const first = records[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(first).sort(), [
    "kind",
    "schemaVersion",
    "seq",
    "sessionRef",
    "taskRef",
    "timestamp",
  ]);
});

test("diagnosticView record with all eight optionals gives the full 14-key set", () => {
  const fixture: DiagnosticResult = {
    schemaVersion: "007.1",
    exportedAt: "2026-07-30T00:00:00.000Z",
    initiativeRef: "opaque-init-1",
    records: [
      {
        schemaVersion: "007.1",
        sessionRef: "sess-1",
        taskRef: "task-1",
        seq: 1,
        timestamp: "2026-07-30T00:00:01.000Z",
        kind: "tool_result",
        outcomeCode: "ok",
        reasonCode: "none",
        toolCategory: "read",
        exitClass: "pass",
        durationMs: 5,
        turns: 1,
        tokensIn: 10,
        tokensOut: 20,
      },
    ],
  };
  const view = diagnosticView(fixture);
  const records = view.records as unknown as Array<Record<string, unknown>>;
  const first = records[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(first).sort(), [
    "durationMs",
    "exitClass",
    "kind",
    "outcomeCode",
    "reasonCode",
    "schemaVersion",
    "seq",
    "sessionRef",
    "taskRef",
    "timestamp",
    "tokensIn",
    "tokensOut",
    "toolCategory",
    "turns",
  ]);
});
