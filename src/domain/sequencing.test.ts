import { test } from "node:test";
import assert from "node:assert/strict";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import {
  initiativeEdgeSatisfied,
  objectiveEdgeSatisfied,
  unsatisfiedInitiativeEdges,
  unsatisfiedObjectiveEdges,
  SequencingLockedError,
  SequencingScopeError,
} from "./sequencing.ts";

// ---------------------------------------------------------------------------
// Story 1b — initiativeEdgeSatisfied / objectiveEdgeSatisfied
// ---------------------------------------------------------------------------

test("initiativeEdgeSatisfied: exhaustive over all InitiativeStatus values", () => {
  const expected: Record<InitiativeStatus, boolean> = {
    building: false,
    landed: true,
    discarded: false,
  };
  for (const [status, want] of Object.entries(expected) as Array<
    [InitiativeStatus, boolean]
  >) {
    assert.equal(
      initiativeEdgeSatisfied(status),
      want,
      `initiativeEdgeSatisfied(${status}) must be ${want}`,
    );
  }
});

test("initiativeEdgeSatisfied(undefined) returns false", () => {
  assert.equal(initiativeEdgeSatisfied(undefined), false);
});

test("objectiveEdgeSatisfied: exhaustive over all ObjectiveStatus values", () => {
  const expected: Record<ObjectiveStatus, boolean> = {
    building: false,
    awaiting_confirmation: false,
    conflict: false,
    integrated: true,
    discarded: false,
  };
  for (const [status, want] of Object.entries(expected) as Array<
    [ObjectiveStatus, boolean]
  >) {
    assert.equal(
      objectiveEdgeSatisfied(status),
      want,
      `objectiveEdgeSatisfied(${status}) must be ${want}`,
    );
  }
});

test("objectiveEdgeSatisfied(undefined) returns false", () => {
  assert.equal(objectiveEdgeSatisfied(undefined), false);
});

// ---------------------------------------------------------------------------
// Story 1b — unsatisfiedInitiativeEdges / unsatisfiedObjectiveEdges
// ---------------------------------------------------------------------------

test("unsatisfiedInitiativeEdges: landed is satisfied, building is unsatisfied with neverSatisfies=false", () => {
  const result = unsatisfiedInitiativeEdges([
    { id: "a", status: "landed" },
    { id: "b", status: "building" },
  ]);
  assert.deepEqual(result, [{ id: "b", neverSatisfies: false }]);
});

test("unsatisfiedInitiativeEdges: discarded is unsatisfied with neverSatisfies=true", () => {
  const result = unsatisfiedInitiativeEdges([{ id: "a", status: "discarded" }]);
  assert.deepEqual(result, [{ id: "a", neverSatisfies: true }]);
});

test("unsatisfiedInitiativeEdges: undefined status treated as building (unsatisfied, neverSatisfies=false)", () => {
  const result = unsatisfiedInitiativeEdges([{ id: "x" }]);
  assert.deepEqual(result, [{ id: "x", neverSatisfies: false }]);
});

test("unsatisfiedObjectiveEdges: building/awaiting_confirmation/conflict each produce unsatisfied entry with neverSatisfies=false", () => {
  const statuses: ObjectiveStatus[] = [
    "building",
    "awaiting_confirmation",
    "conflict",
  ];
  for (const status of statuses) {
    const result = unsatisfiedObjectiveEdges([{ id: "o", status }]);
    assert.deepEqual(result, [{ id: "o", neverSatisfies: false }]);
  }
});

test("unsatisfiedObjectiveEdges: discarded produces unsatisfied with neverSatisfies=true", () => {
  const result = unsatisfiedObjectiveEdges([{ id: "o", status: "discarded" }]);
  assert.deepEqual(result, [{ id: "o", neverSatisfies: true }]);
});

test("unsatisfiedObjectiveEdges: integrated returns empty array", () => {
  const result = unsatisfiedObjectiveEdges([{ id: "o", status: "integrated" }]);
  assert.deepEqual(result, []);
});

test("unsatisfiedObjectiveEdges: undefined status treated as building (unsatisfied, neverSatisfies=false)", () => {
  const result = unsatisfiedObjectiveEdges([{ id: "x" }]);
  assert.deepEqual(result, [{ id: "x", neverSatisfies: false }]);
});

test("unsatisfiedInitiativeEdges: input order is preserved (no sorting)", () => {
  const result = unsatisfiedInitiativeEdges([
    { id: "c", status: "building" },
    { id: "a", status: "building" },
    { id: "b", status: "building" },
  ]);
  assert.deepEqual(result, [
    { id: "c", neverSatisfies: false },
    { id: "a", neverSatisfies: false },
    { id: "b", neverSatisfies: false },
  ]);
});

test("unsatisfiedObjectiveEdges: input order is preserved (no sorting)", () => {
  const result = unsatisfiedObjectiveEdges([
    { id: "c", status: "building" },
    { id: "a", status: "building" },
    { id: "b", status: "building" },
  ]);
  assert.deepEqual(result, [
    { id: "c", neverSatisfies: false },
    { id: "a", neverSatisfies: false },
    { id: "b", neverSatisfies: false },
  ]);
});

// ---------------------------------------------------------------------------
// Story 1c — SequencingLockedError
// ---------------------------------------------------------------------------

test("SequencingLockedError: message contains both required strings and preserves startedTaskIds order", () => {
  const err = new SequencingLockedError("I1", ["T2", "T1"]);
  assert.ok(
    err.message.includes("has already started"),
    `message must contain "has already started": ${err.message}`,
  );
  assert.ok(
    err.message.includes("ordering can no longer be guaranteed"),
    `message must contain "ordering can no longer be guaranteed": ${err.message}`,
  );
  assert.deepEqual(err.startedTaskIds, ["T2", "T1"]);
  assert.equal(err.nodeId, "I1");
});

// ---------------------------------------------------------------------------
// Story 1c — SequencingScopeError
// ---------------------------------------------------------------------------

test("SequencingScopeError: message for initiative scope", () => {
  const err = new SequencingScopeError("O1", "O2", "initiative");
  assert.equal(
    err.message,
    "Sequencing edge refused: O1 and O2 are not in the same initiative",
  );
  assert.equal(err.dependentId, "O1");
  assert.equal(err.dependencyId, "O2");
  assert.equal(err.scope, "initiative");
});

test("SequencingScopeError: message for project scope", () => {
  const err = new SequencingScopeError("I1", "I2", "project");
  assert.equal(
    err.message,
    "Sequencing edge refused: I1 and I2 are not in the same project",
  );
  assert.equal(err.dependentId, "I1");
  assert.equal(err.dependencyId, "I2");
  assert.equal(err.scope, "project");
});
