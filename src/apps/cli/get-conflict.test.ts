/**
 * S2 CLI — `get conflict --id <task>` handler tests (honest labels, version-bound).
 * Tests `runGetConflict` in task.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runGetConflict } from "./task.ts";

// ---------------------------------------------------------------------------
// Fixed test IDs
// ---------------------------------------------------------------------------
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZCLITSK";
const TARGET_OID = "aaabbbcccdddeee0000000000000000000000099";
const CANDIDATE_OID = "fff111222333444555666777888999aaabbbccc9";

// ---------------------------------------------------------------------------
// Minimal mock for GetConflict use case interface
// ---------------------------------------------------------------------------

function makeGetConflictUc(output: {
  taskId: string;
  branch: string;
  targetOID: string;
  candidateOID: string;
  files: { path: string; hunks: string }[];
}) {
  return {
    execute: async (_args: { taskId: string }) => output,
  } as unknown as Parameters<typeof runGetConflict>[1];
}

function makeGetConflictUcError(err: Error) {
  return {
    execute: async (_args: { taskId: string }) => {
      throw err;
    },
  } as unknown as Parameters<typeof runGetConflict>[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("(S2-cli-get-conflict) get conflict --id: exit 0; stdout contains file path, <<<<<<< marker, honest labels, targetOID", async () => {
  const uc = makeGetConflictUc({
    taskId: TASK_ID,
    branch: "main",
    targetOID: TARGET_OID,
    candidateOID: CANDIDATE_OID,
    files: [
      {
        path: "src/todo.mjs",
        hunks:
          "<<<<<<< target\napp.get('/tasks', ...)\n=======\napp.delete('/tasks/:id', ...)\n>>>>>>> candidate",
      },
    ],
  });

  const result = await runGetConflict({ id: TASK_ID }, uc);

  assert.equal(
    result.exitCode,
    0,
    "get conflict must exit 0 (it is a read-only query)",
  );
  assert.equal(
    result.stderr.length,
    0,
    "get conflict must write nothing to stderr on success",
  );

  const out = result.stdout.join("\n");
  assert.ok(
    out.includes("src/todo.mjs"),
    `stdout must contain the conflicting file path; got:\n${out}`,
  );
  assert.ok(
    out.includes("<<<<<<<"),
    `stdout must contain <<<<<<< marker; got:\n${out}`,
  );
  assert.ok(
    out.includes(`target main@`),
    `stdout must contain honest label 'target main@'; got:\n${out}`,
  );
  assert.ok(
    out.includes(`candidate ${TASK_ID}@`),
    `stdout must contain honest label 'candidate ${TASK_ID}@'; got:\n${out}`,
  );
  assert.ok(
    out.includes(TARGET_OID),
    `stdout must contain the targetOID it was computed against; got:\n${out}`,
  );
});

test("(S2-cli-get-conflict-missing-id) get conflict with no --id: exit 1 with actionable error", async () => {
  const uc = makeGetConflictUc({
    taskId: TASK_ID,
    branch: "main",
    targetOID: TARGET_OID,
    candidateOID: CANDIDATE_OID,
    files: [],
  });

  const result = await runGetConflict({}, uc);

  assert.equal(result.exitCode, 1, "missing --id must exit non-zero");
  assert.equal(
    result.stderr.length,
    1,
    "missing --id must emit one error line",
  );
  assert.ok(
    result.stderr[0]!.startsWith("error:"),
    `missing --id error must start with 'error:'; got: ${result.stderr[0]}`,
  );
});
