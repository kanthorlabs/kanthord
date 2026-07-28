import { test } from "node:test";
import assert from "node:assert/strict";
import type { InitiativeStatus, ObjectiveStatus } from "./initiative.ts";
import type { TaskStatus } from "./task.ts";
import { TASK_STATUSES } from "./task.ts";
import {
  initiativeEdgeSatisfied,
  objectiveEdgeSatisfied,
  unsatisfiedInitiativeEdges,
  unsatisfiedObjectiveEdges,
  SequencingLockedError,
  SequencingScopeError,
  taskEdgeSatisfied,
  unsatisfiedTaskEdges,
  permanentlyBlockedTasks,
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

// ---------------------------------------------------------------------------
// Story 1 (016) — taskEdgeSatisfied / unsatisfiedTaskEdges /
//                 permanentlyBlockedTasks
// ---------------------------------------------------------------------------

test("taskEdgeSatisfied: exhaustive over all six TASK_STATUSES — only completed is true", () => {
  const expected: Record<TaskStatus, boolean> = {
    pending: false,
    running: false,
    completed: true,
    failed: false,
    awaiting_confirmation: false,
    discarded: false,
  };
  for (const status of TASK_STATUSES) {
    assert.equal(
      taskEdgeSatisfied(status),
      expected[status],
      `taskEdgeSatisfied(${status}) must be ${expected[status]}`,
    );
  }
});

test("taskEdgeSatisfied(undefined) returns false", () => {
  assert.equal(taskEdgeSatisfied(undefined), false);
});

test("unsatisfiedTaskEdges: pending node with one completed dependency returns []", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "completed", dependencies: [] },
    { id: "b", status: "pending", dependencies: ["a"] },
  ]);
  // Every node gets an entry (the prose spec says "for any non-pending node
  // the value is []" — the entry must exist). The completed `a` maps to `[]`;
  // the pending `b` maps to `[]` because its only dep is satisfied.
  assert.equal(result.size, 2);
  assert.deepEqual(result.get("a"), []);
  assert.deepEqual(result.get("b"), []);
});

test("unsatisfiedTaskEdges: pending node with a failed dependency yields one entry, neverSatisfies=false", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "failed", dependencies: [] },
    { id: "b", status: "pending", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), [{ id: "a", neverSatisfies: false }]);
});

test("unsatisfiedTaskEdges: pending node with a discarded dependency yields one entry, neverSatisfies=true", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "discarded", dependencies: [] },
    { id: "b", status: "pending", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), [{ id: "a", neverSatisfies: true }]);
});

test("unsatisfiedTaskEdges: running node maps to [] even when dependencies are not completed", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "pending", dependencies: [] },
    { id: "b", status: "running", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), []);
});

test("unsatisfiedTaskEdges: completed node maps to [] even when dependencies are not completed", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "pending", dependencies: [] },
    { id: "b", status: "completed", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), []);
});

test("unsatisfiedTaskEdges: failed node maps to [] even when dependencies are not completed", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "pending", dependencies: [] },
    { id: "b", status: "failed", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), []);
});

test("unsatisfiedTaskEdges: awaiting_confirmation node maps to [] even when dependencies are not completed", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "pending", dependencies: [] },
    { id: "b", status: "awaiting_confirmation", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), []);
});

test("unsatisfiedTaskEdges: discarded node maps to [] even when dependencies are not completed", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "pending", dependencies: [] },
    { id: "b", status: "discarded", dependencies: ["a"] },
  ]);
  assert.deepEqual(result.get("b"), []);
});

test("unsatisfiedTaskEdges: edge order equals the node's dependencies order, and Map key order equals input order", () => {
  const result = unsatisfiedTaskEdges([
    { id: "a", status: "pending", dependencies: [] },
    { id: "c", status: "discarded", dependencies: [] },
    { id: "b", status: "failed", dependencies: [] },
    { id: "d", status: "running", dependencies: [] },
    { id: "p", status: "pending", dependencies: ["a", "c", "b", "d"] },
  ]);
  assert.deepEqual(Array.from(result.keys()), ["a", "c", "b", "d", "p"]);
  assert.deepEqual(result.get("p"), [
    { id: "a", neverSatisfies: false },
    { id: "c", neverSatisfies: true },
    { id: "b", neverSatisfies: false },
    { id: "d", neverSatisfies: false },
  ]);
});

test("unsatisfiedTaskEdges: a dependency id not present in nodes yields neverSatisfies=false", () => {
  const result = unsatisfiedTaskEdges([
    { id: "p", status: "pending", dependencies: ["missing"] },
  ]);
  assert.deepEqual(result.get("p"), [{ id: "missing", neverSatisfies: false }]);
});

test("permanentlyBlockedTasks: direct — pending B depends on discarded A → {B}", () => {
  const nodes = [
    { id: "A", status: "discarded" as const, dependencies: [] },
    { id: "B", status: "pending" as const, dependencies: ["A"] },
  ];
  assert.deepEqual(permanentlyBlockedTasks(nodes), new Set(["B"]));
});

test("permanentlyBlockedTasks: two-hop transitive — discarded A, pending B→A, pending C→B → {B, C}", () => {
  const nodes = [
    { id: "A", status: "discarded" as const, dependencies: [] },
    { id: "B", status: "pending" as const, dependencies: ["A"] },
    { id: "C", status: "pending" as const, dependencies: ["B"] },
  ];
  assert.deepEqual(permanentlyBlockedTasks(nodes), new Set(["B", "C"]));
  // unsatisfiedTaskEdges reports neverSatisfies=true on C's edge to B
  const edges = unsatisfiedTaskEdges(nodes);
  assert.deepEqual(edges.get("C"), [{ id: "B", neverSatisfies: true }]);
});

test("permanentlyBlockedTasks: failed A with pending B→A → empty set", () => {
  const nodes = [
    { id: "A", status: "failed" as const, dependencies: [] },
    { id: "B", status: "pending" as const, dependencies: ["A"] },
  ];
  assert.deepEqual(permanentlyBlockedTasks(nodes), new Set());
});

test("permanentlyBlockedTasks: diamond — pending D depends on discarded A and completed B → D is permanently blocked", () => {
  const nodes = [
    { id: "A", status: "discarded" as const, dependencies: [] },
    { id: "B", status: "completed" as const, dependencies: [] },
    { id: "D", status: "pending" as const, dependencies: ["A", "B"] },
  ];
  assert.deepEqual(permanentlyBlockedTasks(nodes), new Set(["D"]));
  // D's edge list contains only the A edge (B is satisfied)
  const edges = unsatisfiedTaskEdges(nodes);
  assert.deepEqual(edges.get("D"), [{ id: "A", neverSatisfies: true }]);
});

test("permanentlyBlockedTasks: a node with two dead arms reports both edges with neverSatisfies=true", () => {
  const nodes = [
    { id: "A", status: "discarded" as const, dependencies: [] },
    { id: "B", status: "discarded" as const, dependencies: [] },
    { id: "D", status: "pending" as const, dependencies: ["A", "B"] },
  ];
  assert.deepEqual(permanentlyBlockedTasks(nodes), new Set(["D"]));
  const edges = unsatisfiedTaskEdges(nodes);
  assert.deepEqual(edges.get("D"), [
    { id: "A", neverSatisfies: true },
    { id: "B", neverSatisfies: true },
  ]);
});

test("permanentlyBlockedTasks: the same graph given in reversed input order yields the identical set (fixpoint independence)", () => {
  const forward = [
    { id: "A", status: "discarded" as const, dependencies: [] },
    { id: "B", status: "pending" as const, dependencies: ["A"] },
    { id: "C", status: "pending" as const, dependencies: ["B"] },
  ];
  const reversed = [
    { id: "C", status: "pending" as const, dependencies: ["B"] },
    { id: "B", status: "pending" as const, dependencies: ["A"] },
    { id: "A", status: "discarded" as const, dependencies: [] },
  ];
  assert.deepEqual(
    permanentlyBlockedTasks(forward),
    permanentlyBlockedTasks(reversed),
  );
});
