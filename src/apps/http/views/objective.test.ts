import { test } from "node:test";
import assert from "node:assert/strict";
import {
  objectiveView,
  objectiveDetailView,
  type ObjectiveResult,
} from "./objective.ts";
import type { GetObjectiveOutput } from "../../../app/objective/get-objective.ts";

test("objectiveView omits every optional field when absent from the source, and drops an injected extra", () => {
  const result = {
    id: "o1",
    initiativeId: "i1",
    name: "objective one",
    extra: "leak-me",
  } as unknown as ObjectiveResult;
  const view = objectiveView(result);
  assert.deepEqual(Object.keys(view).sort(), ["id", "initiativeId", "name"]);
  assert.equal(view.id, "o1");
  assert.equal(view.initiativeId, "i1");
  assert.equal(view.name, "objective one");
});

test("objectiveView includes every optional field when present in the source", () => {
  const result: ObjectiveResult = {
    id: "o1",
    initiativeId: "i1",
    name: "objective one",
    status: "building",
    commitOid: "sha1",
    parentOid: "sha0",
    conflictReason: "gate failed",
    note: "guidance",
    conflictCause: "cas-mismatch",
  };
  const view = objectiveView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "commitOid",
    "conflictCause",
    "conflictReason",
    "id",
    "initiativeId",
    "name",
    "note",
    "parentOid",
    "status",
  ]);
  assert.equal(view.status, "building");
  assert.equal(view.commitOid, "sha1");
  assert.equal(view.parentOid, "sha0");
  assert.equal(view.conflictReason, "gate failed");
  assert.equal(view.note, "guidance");
  assert.equal(view.conflictCause, "cas-mismatch");
});

test("objectiveDetailView omits commitOid and parentOid when absent from the source; conflictCause is never emitted", () => {
  const result: GetObjectiveOutput = {
    id: "o1",
    name: "objective one",
    status: "building",
    integrations: [{ repository: "repo-1", state: "building" }],
    after: ["o0"],
    waiting: [{ id: "o0", neverSatisfies: false }],
    conflictCause: null,
    conflictReason: null,
    note: null,
  };
  const view = objectiveDetailView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "after",
    "conflictReason",
    "id",
    "integrations",
    "name",
    "note",
    "status",
    "waiting",
  ]);
  assert.equal("conflictCause" in view, false);
  assert.equal("commitOid" in view, false);
  assert.equal("parentOid" in view, false);
  assert.equal(view.conflictReason, null);
  assert.equal(view.note, null);
});

test("objectiveDetailView includes commitOid and parentOid when present; waiting is mapped through unsatisfiedEdgeView, dropping an injected extra", () => {
  const result = {
    id: "o1",
    name: "objective one",
    status: "awaiting_confirmation",
    commitOid: "sha1",
    parentOid: "sha0",
    integrations: [{ repository: "repo-1", state: "awaiting_confirmation" }],
    after: ["o0"],
    waiting: [{ id: "o0", neverSatisfies: true, extra: "leak-me" }],
    conflictCause: null,
    conflictReason: "gate failed",
    note: "guidance",
  } as unknown as GetObjectiveOutput;
  const view = objectiveDetailView(result);
  assert.deepEqual(Object.keys(view).sort(), [
    "after",
    "commitOid",
    "conflictReason",
    "id",
    "integrations",
    "name",
    "note",
    "parentOid",
    "status",
    "waiting",
  ]);
  assert.equal("conflictCause" in view, false);
  assert.equal(view.commitOid, "sha1");
  assert.equal(view.parentOid, "sha0");
  assert.deepEqual(view.waiting, [{ id: "o0", neverSatisfies: true }]);
});
