import { test } from "node:test";
import assert from "node:assert/strict";
import { runDiagnosticsExport } from "./diagnostics.ts";
import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";

// A fake DiagnosticsExport that returns a canned result.
// All tests below use this so assertions are deterministic (Story-specified values).
function makeFakeDiagnosticsExport(): DiagnosticsExport {
  const result = {
    recordCount: 7,
    outPath: "/tmp/test.json",
    preview: [
      { kind: "task.lifecycle" as const, count: 3 },
      { kind: "agent.tool" as const, count: 4 },
    ],
  };
  return {
    execute: async (_input: unknown) => result,
  } as unknown as DiagnosticsExport;
}

test("T3a: runDiagnosticsExport valid flags returns exitCode 0 and preview line in stderr", async () => {
  const de = makeFakeDiagnosticsExport();
  const result = await runDiagnosticsExport(
    { initiative: "INI-1", out: "/tmp/test.json" },
    de,
  );
  assert.strictEqual(
    result.exitCode,
    0,
    "valid --initiative and --out must return exitCode 0",
  );
  assert.ok(
    result.stderr.length > 0,
    "at least one preview line must appear in stderr",
  );
  // The preview line must contain record count or kind info (per Story spec).
  const stderrJoined = result.stderr.join("\n");
  assert.ok(stderrJoined.length > 0, "stderr preview line must be non-empty");
});

test("T3b: runDiagnosticsExport missing --initiative returns exitCode 1 with --initiative in stderr", async () => {
  const de = makeFakeDiagnosticsExport();
  const result = await runDiagnosticsExport({ out: "/tmp/test.json" }, de);
  assert.strictEqual(
    result.exitCode,
    1,
    "missing --initiative must return exitCode 1",
  );
  assert.ok(result.stderr.length > 0, "stderr must contain an error message");
  assert.ok(
    /--initiative/i.test(result.stderr[0]!),
    `stderr[0] must mention '--initiative'; got: ${result.stderr[0]}`,
  );
});

test("T3c: runDiagnosticsExport missing --out returns exitCode 1 with --out in stderr", async () => {
  const de = makeFakeDiagnosticsExport();
  const result = await runDiagnosticsExport({ initiative: "INI-1" }, de);
  assert.strictEqual(
    result.exitCode,
    1,
    "missing --out must return exitCode 1",
  );
  assert.ok(result.stderr.length > 0, "stderr must contain an error message");
  assert.ok(
    /--out/i.test(result.stderr[0]!),
    `stderr[0] must mention '--out'; got: ${result.stderr[0]}`,
  );
});
