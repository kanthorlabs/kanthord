import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionItemView, decisionQueueView } from "./queue.ts";
import type { GetDecisionQueueOutput } from "../../../app/project/get-decision-queue.ts";
import type { DecisionItem } from "../../../domain/decision-queue.ts";

function baseItem(): DecisionItem {
  return {
    verdicts: [
      {
        kind: "retry",
        target: { type: "task", id: "t1" },
        requiresInput: [],
        extra: "leak-me",
      } as unknown as DecisionItem["verdicts"][number],
    ],
    kindLabel: "task-review",
    projectId: "p1",
    projectName: "alpha",
    initiativeId: "i1",
    downstream: 0,
    actionableSince: null,
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: null,
    },
  };
}

test("decisionItemView with every optional field absent omits cause/objectiveId/taskId/expectedCommit; evidence.inspect stays null", () => {
  const view = decisionItemView(baseItem());
  assert.equal("cause" in view, false);
  assert.equal("objectiveId" in view, false);
  assert.equal("taskId" in view, false);
  assert.equal("expectedCommit" in view, false);
  const evidence = view.evidence as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(evidence).sort(), [
    "basis",
    "diffAvailable",
    "inspect",
  ]);
  assert.equal(evidence.inspect, null);
});

test("decisionItemView with every optional field present includes the full key set; inspect and verdicts[0] are mapped", () => {
  const item: DecisionItem = {
    ...baseItem(),
    cause: "escalation",
    objectiveId: "o1",
    taskId: "t1",
    expectedCommit: "deadbeef",
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: { executable: "git", args: ["diff"] },
    },
  };
  const view = decisionItemView(item);
  assert.deepEqual(Object.keys(view).sort(), [
    "actionableSince",
    "cause",
    "downstream",
    "evidence",
    "expectedCommit",
    "initiativeId",
    "kindLabel",
    "objectiveId",
    "projectId",
    "projectName",
    "taskId",
    "verdicts",
  ]);
  const inspect = (view.evidence as unknown as Record<string, unknown>)
    .inspect as Record<string, unknown>;
  assert.deepEqual(Object.keys(inspect).sort(), ["args", "executable"]);
  const verdict = (view.verdicts as unknown[])[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(verdict).sort(), [
    "kind",
    "requiresInput",
    "target",
  ]);
});

test("decisionQueueView key sets: top-level exactly counts/items/truncated/warnings, counts exactly byKind/total", () => {
  const output: GetDecisionQueueOutput = {
    items: [],
    counts: { total: 0, byKind: {} },
    truncated: false,
    warnings: [],
  };
  const view = decisionQueueView(output);
  assert.deepEqual(Object.keys(view).sort(), [
    "counts",
    "items",
    "truncated",
    "warnings",
  ]);
  assert.deepEqual(
    Object.keys(view.counts as unknown as Record<string, unknown>).sort(),
    ["byKind", "total"],
  );
  assert.deepEqual(view.items, []);
  assert.deepEqual(view.warnings, []);
});
