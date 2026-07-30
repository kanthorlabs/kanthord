// src/apps/http/views/graph-apply.test.ts — Story S7: the two write-result
// views (`graphCreateView`, `graphApplyView`), no server, no fakes needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphCreateView, graphApplyView } from "./graph-apply.ts";
import type { CreateGraphResult } from "../../../app/graph/create-graph.ts";
import type { ApplyGraphResult } from "../../../app/graph/apply-graph.ts";

test("graphCreateView key set is exactly ['initiativeId','nodes','refToId'], maps copied", () => {
  const result: CreateGraphResult = {
    initiativeId: "i1",
    refToId: { objectives: { "obj-ref": "o1" }, tasks: { "task-ref": "t1" } },
    nodes: { i1: "sha-i1" },
  };
  const view = graphCreateView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "initiativeId",
    "nodes",
    "refToId",
  ]);
  assert.deepEqual(Object.keys(view.refToId).sort(), ["objectives", "tasks"]);
  assert.notEqual(view.refToId.objectives, result.refToId.objectives);
  assert.notEqual(view.refToId.tasks, result.refToId.tasks);
  assert.notEqual(view.nodes, result.nodes);
});

test("graphApplyView with a minimal result gives exactly the four required keys", () => {
  const result: ApplyGraphResult = {
    applied: true,
    classifications: [],
    summary: { created: 1, updated: 0, unchanged: 0, missing: 0 },
    conflicts: [],
  };
  const view = graphApplyView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "applied",
    "classifications",
    "conflicts",
    "summary",
  ]);
  assert.deepEqual(Object.keys(view.summary).sort(), [
    "created",
    "missing",
    "unchanged",
    "updated",
  ]);
});

test("graphApplyView with every optional present gives the full key set", () => {
  const result: ApplyGraphResult = {
    applied: false,
    classifications: [{ kind: "task", ref: "t1", class: "updated" }],
    summary: { created: 1, updated: 2, unchanged: 3, missing: 0, deleted: 1 },
    conflicts: [
      {
        kind: "task",
        ref: "t2",
        class: "drifted",
        casReason: { kind: "sha" },
      },
    ],
    freshNodeShas: { t1: "sha1" },
    createdNodes: [
      { ref: "t1", id: "id1", sourcePath: "task1.md" },
      { ref: "t2", id: "id2" },
    ],
    edgeChanges: [
      {
        kind: "task" as unknown as "initiative",
        id: "t1",
        dependency: "t0",
        change: "added",
      },
    ],
    refusedEdgeRemovals: [
      {
        kind: "task" as unknown as "initiative",
        id: "t3",
        dependency: "t2",
        change: "would-remove",
      },
    ],
  };
  const view = graphApplyView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "applied",
    "classifications",
    "conflicts",
    "createdNodes",
    "edgeChanges",
    "freshNodeShas",
    "refusedEdgeRemovals",
    "summary",
  ]);
  assert.deepEqual(Object.keys(view.summary).sort(), [
    "created",
    "deleted",
    "missing",
    "unchanged",
    "updated",
  ]);
  assert.deepEqual(view.createdNodes, [
    { ref: "t1", id: "id1", sourcePath: "task1.md" },
    { ref: "t2", id: "id2" },
  ]);
  assert.notEqual(view.freshNodeShas, result.freshNodeShas);
});

test("applyClassificationView with casReason {kind:'sha'} gives exactly ['kind'] inside casReason", () => {
  const result: ApplyGraphResult = {
    applied: false,
    classifications: [],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 0 },
    conflicts: [
      { kind: "task", ref: "t1", class: "drifted", casReason: { kind: "sha" } },
    ],
  };
  const view = graphApplyView(result);
  const conflict = view.conflicts[0]! as unknown as {
    casReason: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(conflict.casReason).sort(), ["kind"]);
});

test("applyClassificationView with casReason {kind:'status',currentStatus} gives exactly ['currentStatus','kind']", () => {
  const result: ApplyGraphResult = {
    applied: false,
    classifications: [],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 0 },
    conflicts: [
      {
        kind: "task",
        ref: "t1",
        class: "locked",
        casReason: { kind: "status", currentStatus: "running" },
      },
    ],
  };
  const view = graphApplyView(result);
  const conflict = view.conflicts[0]! as unknown as {
    casReason: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(conflict.casReason).sort(), [
    "currentStatus",
    "kind",
  ]);
});
