import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateGraph,
  readiness,
  serialOrder,
  DuplicateTaskError,
  UnknownDependencyError,
  CycleError,
} from "./graph.ts";

// helper: build a GraphNode-like object
function node(
  id: string,
  status: "pending" | "running" | "completed" | "failed",
  dependencies: string[] = [],
) {
  return { id, status, dependencies };
}

test("validateGraph: two nodes sharing an id throw DuplicateTaskError", () => {
  const nodes = [
    node("a", "pending"),
    node("b", "pending"),
    node("a", "pending"),
  ];
  assert.throws(
    () => validateGraph(nodes),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateTaskError);
      assert.equal(err.taskId, "a");
      return true;
    },
  );
});

test("validateGraph: unknown dependency throws UnknownDependencyError with taskId and dependency", () => {
  const nodes = [node("a", "pending", ["missing"])];
  assert.throws(
    () => validateGraph(nodes),
    (err: unknown) => {
      assert.ok(err instanceof UnknownDependencyError);
      assert.equal(err.taskId, "a");
      assert.equal(err.dependency, "missing");
      return true;
    },
  );
});

test("validateGraph: two-node cycle throws CycleError with path ['a','b','a']", () => {
  const nodes = [node("a", "pending", ["b"]), node("b", "pending", ["a"])];
  assert.throws(
    () => validateGraph(nodes),
    (err: unknown) => {
      assert.ok(err instanceof CycleError);
      assert.deepEqual(err.path, ["a", "b", "a"]);
      return true;
    },
  );
});

test("validateGraph: self-loop throws CycleError with path ['a','a']", () => {
  const nodes = [node("a", "pending", ["a"])];
  assert.throws(
    () => validateGraph(nodes),
    (err: unknown) => {
      assert.ok(err instanceof CycleError);
      assert.deepEqual(err.path, ["a", "a"]);
      return true;
    },
  );
});

test("validateGraph: duplicate id + cycle — DuplicateTaskError takes precedence", () => {
  const nodes = [
    node("a", "pending", ["b"]),
    node("b", "pending", ["a"]),
    node("a", "pending"),
  ];
  assert.throws(
    () => validateGraph(nodes),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateTaskError);
      return true;
    },
  );
});

test("validateGraph: valid diamond DAG does not throw", () => {
  // root → left, right; left → bottom; right → bottom
  const nodes = [
    node("root", "pending", []),
    node("left", "pending", ["root"]),
    node("right", "pending", ["root"]),
    node("bottom", "pending", ["left", "right"]),
  ];
  assert.doesNotThrow(() => validateGraph(nodes));
});

// ---------------------------------------------------------------------------
// S005-T2 — readiness report
// ---------------------------------------------------------------------------

test("readiness: pending node with no dependencies is ready", () => {
  const nodes = [node("a", "pending", [])];
  const report = readiness(nodes);
  assert.deepEqual(report, [{ id: "a", state: "ready", waiting: [] }]);
});

test("readiness: pending node whose only dependency is completed is ready", () => {
  const nodes = [node("dep", "completed", []), node("a", "pending", ["dep"])];
  const report = readiness(nodes);
  assert.deepEqual(report, [{ id: "a", state: "ready", waiting: [] }]);
});

test("readiness: pending dependency yields blocked with that dependency in waiting", () => {
  const nodes = [node("dep", "pending", []), node("a", "pending", ["dep"])];
  const report = readiness(nodes);
  assert.deepEqual(report, [
    { id: "dep", state: "ready", waiting: [] },
    { id: "a", state: "blocked", waiting: ["dep"] },
  ]);
});

test("readiness: running dependency yields blocked with that dependency in waiting", () => {
  const nodes = [node("dep", "running", []), node("a", "pending", ["dep"])];
  const report = readiness(nodes);
  assert.deepEqual(report, [{ id: "a", state: "blocked", waiting: ["dep"] }]);
});

test("readiness: failed dependency yields blocked with that dependency in waiting", () => {
  const nodes = [node("dep", "failed", []), node("a", "pending", ["dep"])];
  const report = readiness(nodes);
  assert.deepEqual(report, [{ id: "a", state: "blocked", waiting: ["dep"] }]);
});

test("readiness: non-pending nodes are absent from the report", () => {
  const nodes = [
    node("r", "running", []),
    node("c", "completed", []),
    node("f", "failed", []),
    node("p", "pending", []),
  ];
  const report = readiness(nodes);
  assert.equal(report.length, 1);
  assert.equal(report[0]?.id, "p");
});

test("readiness: report order equals input order", () => {
  const nodes = [
    node("z", "pending", []),
    node("a", "pending", []),
    node("m", "pending", []),
  ];
  const report = readiness(nodes);
  assert.deepEqual(
    report.map((r) => r.id),
    ["z", "a", "m"],
  );
});

// ---------------------------------------------------------------------------
// Story B (007.12) — stable serial order for an objective's tasks
// ---------------------------------------------------------------------------

test("serialOrder: a dependency always precedes its dependent", () => {
  const nodes = [
    node("b", "pending", []),
    node("a", "pending", []),
    node("c", "pending", ["a", "b"]),
  ];
  const order = serialOrder(nodes);
  assert.equal(order.length, 3);
  assert.ok(order.indexOf("a") < order.indexOf("c"));
  assert.ok(order.indexOf("b") < order.indexOf("c"));
});

test("serialOrder: ties among ready nodes are broken by input order, not alphabetical id", () => {
  const nodes = [node("z", "pending", []), node("a", "pending", [])];
  const order = serialOrder(nodes);
  assert.deepEqual(order, ["z", "a"]);
});

test("serialOrder: diamond DAG — independent branches interleave in input order once unblocked", () => {
  // input order: root, right, left, bottom (right declared before left)
  const nodes = [
    node("root", "pending", []),
    node("right", "pending", ["root"]),
    node("left", "pending", ["root"]),
    node("bottom", "pending", ["left", "right"]),
  ];
  const order = serialOrder(nodes);
  assert.deepEqual(order, ["root", "right", "left", "bottom"]);
});

test("serialOrder: includes nodes regardless of status (full build order, not just pending)", () => {
  const nodes = [node("a", "completed", []), node("b", "pending", ["a"])];
  const order = serialOrder(nodes);
  assert.deepEqual(order, ["a", "b"]);
});
