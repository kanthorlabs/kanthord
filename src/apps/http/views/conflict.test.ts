import { test } from "node:test";
import assert from "node:assert/strict";
import { taskConflictView, objectiveConflictView } from "./conflict.ts";
import type { ConflictOverview } from "../../../app/task/get-conflict.ts";
import type { ObjectiveConflictOutput } from "../../../app/objective/get-objective-conflict.ts";

test("taskConflictView: exact key set, files mapped, extras dropped", () => {
  const result = {
    taskId: "t1",
    branch: "main",
    targetOID: "abc",
    candidateOID: "def",
    files: [{ path: "a.ts", hunks: "@@ -1 +1 @@", extra: "leak-me" }],
    extra: "leak-me",
  } as unknown as ConflictOverview;
  const view = taskConflictView(result) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(view).sort(), [
    "branch",
    "candidateOID",
    "files",
    "targetOID",
    "taskId",
  ]);
  const files = view.files as Record<string, unknown>[];
  assert.equal(files.length, 1);
  assert.deepEqual(Object.keys(files[0]!).sort(), ["hunks", "path"]);
  assert.equal(files[0]!.path, "a.ts");
  assert.equal(files[0]!.hunks, "@@ -1 +1 @@");
});

test("objectiveConflictView: exact twelve-field key set, nullable fields present and null", () => {
  const result: ObjectiveConflictOutput = {
    objectiveId: "o1",
    initiativeId: "i1",
    status: "conflict",
    conflictCause: null,
    parentOid: null,
    commitOid: null,
    observedTipOid: null,
    currentTip: null,
    tipMovedSinceAnchor: false,
    conflictReason: null,
    note: null,
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: null,
    },
  };
  const view = objectiveConflictView(result) as unknown as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(view).sort(), [
    "commitOid",
    "conflictCause",
    "conflictReason",
    "currentTip",
    "evidence",
    "initiativeId",
    "note",
    "objectiveId",
    "observedTipOid",
    "parentOid",
    "status",
    "tipMovedSinceAnchor",
  ]);
  assert.equal(view.conflictCause, null);
  assert.equal(view.parentOid, null);
  assert.equal(view.commitOid, null);
  assert.equal(view.observedTipOid, null);
  assert.equal(view.currentTip, null);
  assert.equal(view.conflictReason, null);
  assert.equal(view.note, null);
  const evidence = view.evidence as Record<string, unknown>;
  assert.equal(evidence.inspect, null);
});

test("objectiveConflictView: populated inspect has exactly executable and args", () => {
  const result: ObjectiveConflictOutput = {
    objectiveId: "o1",
    initiativeId: "i1",
    status: "conflict",
    conflictCause: "cas-mismatch",
    parentOid: "aaa",
    commitOid: "bbb",
    observedTipOid: "ccc",
    currentTip: "ccc",
    tipMovedSinceAnchor: true,
    conflictReason: "landing failed",
    note: "please retry",
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: { executable: "git", args: ["-C", "/repo", "diff", "aaa..bbb"] },
    },
  };
  const view = objectiveConflictView(result) as unknown as Record<
    string,
    unknown
  >;
  const evidence = view.evidence as Record<string, unknown>;
  const inspect = evidence.inspect as Record<string, unknown>;
  assert.deepEqual(Object.keys(inspect).sort(), ["args", "executable"]);
  assert.equal(inspect.executable, "git");
  assert.deepEqual(inspect.args, ["-C", "/repo", "diff", "aaa..bbb"]);
});
