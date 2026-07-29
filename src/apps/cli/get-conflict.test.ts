/**
 * S2 CLI — `get conflict --id <task>` handler tests (honest labels, version-bound).
 * Tests `runGetConflict` in task.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runGetConflict } from "./task.ts";
import type { GetObjectiveConflict } from "../../app/objective/get-objective-conflict.ts";
import {
  ObjectiveNotInConflictError,
  type ObjectiveConflictOutput,
} from "../../app/objective/get-objective-conflict.ts";

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
// Fakes for the objective-conflict path (017 S7 C)
// ---------------------------------------------------------------------------

const SAMPLE_OBJECTIVE_OUTPUT: ObjectiveConflictOutput = {
  objectiveId: "obj-1",
  initiativeId: "init-1",
  status: "conflict",
  conflictCause: "non-single-commit",
  parentOid: "aaaaaaa",
  commitOid: "bbbbbbb",
  observedTipOid: null,
  currentTip: "ccccccc",
  tipMovedSinceAnchor: true,
  conflictReason: null,
  note: null,
  evidence: {
    basis: "verification-and-summary",
    diffAvailable: false,
    inspect: null,
  },
};

function makeGetObjectiveConflictUc(output: ObjectiveConflictOutput) {
  return {
    execute: async (_args: { objectiveId: string }) => output,
  } as unknown as GetObjectiveConflict;
}

/** A poisoned fake: calling it is itself a test failure (the --id path must never reach it). */
function poisonedGetObjectiveConflict() {
  return {
    execute: async (_args: { objectiveId: string }) => {
      throw new Error(
        "getObjectiveConflict.execute must never be called on the --id path",
      );
    },
  } as unknown as GetObjectiveConflict;
}

/** A poisoned fake: calling it is itself a test failure (the --objective path must never reach it). */
function poisonedGetConflict() {
  return {
    execute: async (_args: { taskId: string }) => {
      throw new Error(
        "getConflict.execute must never be called on the --objective path",
      );
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

  const result = await runGetConflict(
    { id: TASK_ID },
    uc,
    poisonedGetObjectiveConflict(),
  );

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

  const result = await runGetConflict({}, uc, poisonedGetObjectiveConflict());

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

// ---------------------------------------------------------------------------
// 017 Story 7 §C — mutual exclusion + --objective routing
// ---------------------------------------------------------------------------

test("(017-S7-cli-both-flags) get conflict --id and --objective together: exit 1, exact mutual-exclusion message", async () => {
  const result = await runGetConflict(
    { id: TASK_ID, objective: "obj-1" },
    poisonedGetConflict(),
    poisonedGetObjectiveConflict(),
  );

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: --id and --objective are mutually exclusive",
  ]);
});

test("(017-S7-cli-neither-flag) get conflict with neither --id nor --objective: exit 1, exact required-one-of message", async () => {
  const result = await runGetConflict(
    {},
    poisonedGetConflict(),
    poisonedGetObjectiveConflict(),
  );

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: one of --id or --objective is required",
  ]);
});

test("(017-S7-cli-objective-routes) get conflict --objective <id>: exit 0, routes to getObjectiveConflict (never getConflict), JSON stdout matches output", async () => {
  const uc = makeGetObjectiveConflictUc(SAMPLE_OBJECTIVE_OUTPUT);

  const result = await runGetConflict(
    { objective: "obj-1", json: true },
    poisonedGetConflict(),
    uc,
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 1);
  assert.deepEqual(JSON.parse(result.stdout[0]!), SAMPLE_OBJECTIVE_OUTPUT);
});

// ---------------------------------------------------------------------------
// Review blocker S1 — Story 7 §C / epic:189-191 require the text branch to
// render `evidence.inspect` as its own `inspect:` line, shell-escaped for
// copy-paste — not the raw `JSON.stringify(evidence)` the current text
// branch produces for every object-valued field.
// ---------------------------------------------------------------------------

test("(017-S1-cli-objective-conflict-inspect-line) get conflict --objective <id> (text, no --json): stdout has a shell-escaped `inspect: git -C <dir> diff <a>..<b>` line, not raw JSON of evidence", async () => {
  const outputWithInspect: ObjectiveConflictOutput = {
    ...SAMPLE_OBJECTIVE_OUTPUT,
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: {
        executable: "git",
        args: ["-C", "/tmp/kanthord home/i1", "diff", "aaaaaaa..bbbbbbb"],
      },
    },
  };
  const uc = makeGetObjectiveConflictUc(outputWithInspect);

  const result = await runGetConflict(
    { objective: "obj-1" },
    poisonedGetConflict(),
    uc,
  );

  assert.equal(result.exitCode, 0);
  const out = result.stdout.join("\n");
  assert.ok(
    !out.includes('"executable"') && !out.includes('"args"'),
    `text branch must not render evidence as raw JSON.stringify; got:\n${out}`,
  );
  const inspectLine = result.stdout.find((line) => line.startsWith("inspect:"));
  assert.ok(
    inspectLine !== undefined,
    `stdout must contain a dedicated 'inspect:' line; got:\n${out}`,
  );
  assert.ok(
    inspectLine!.includes(
      "git -C '/tmp/kanthord home/i1' diff aaaaaaa..bbbbbbb",
    ) ||
      inspectLine!.includes(
        'git -C "/tmp/kanthord home/i1" diff aaaaaaa..bbbbbbb',
      ),
    `inspect line must be the shell-escaped, copy-paste-runnable command (the space in the homeDir must be quoted/escaped); got: ${inspectLine}`,
  );
});

test("(017-S7-cli-objective-not-in-conflict) get conflict --objective <id>: ObjectiveNotInConflictError maps to exit 1 with the actual status", async () => {
  const uc = {
    execute: async (_args: { objectiveId: string }) => {
      throw new ObjectiveNotInConflictError("obj-1", "building");
    },
  } as unknown as GetObjectiveConflict;

  const result = await runGetConflict(
    { objective: "obj-1" },
    poisonedGetConflict(),
    uc,
  );

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: objective obj-1 is not in conflict (status: building)",
  ]);
});
