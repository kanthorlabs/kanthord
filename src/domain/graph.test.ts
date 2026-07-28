import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateGraph,
  validateDag,
  readiness,
  serialOrder,
  dependentClosure,
  longestRemainingChain,
  DuplicateTaskError,
  UnknownDependencyError,
  CycleError,
} from "./graph.ts";

// helper: build a GraphNode-like object
function node(
  id: string,
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "awaiting_confirmation"
    | "discarded",
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

// ---------------------------------------------------------------------------
// Story 05 (007.16) — dependentClosure (cascade discard)
// ---------------------------------------------------------------------------

test("dependentClosure: root with 4 direct dependents returns them in ascending id order, excluding root", () => {
  const nodes = [
    node("root", "failed", []),
    node("d3", "pending", ["root"]),
    node("d1", "pending", ["root"]),
    node("d4", "pending", ["root"]),
    node("d2", "pending", ["root"]),
  ];
  const closure = dependentClosure(nodes, "root");
  assert.deepEqual(closure, ["d1", "d2", "d3", "d4"]);
});

test("dependentClosure: chain a→b→c returns [b, c] in visit order, excluding a", () => {
  const nodes = [
    node("a", "failed", []),
    node("b", "pending", ["a"]),
    node("c", "pending", ["b"]),
  ];
  const closure = dependentClosure(nodes, "a");
  assert.deepEqual(closure, ["b", "c"]);
});

test("dependentClosure: a node with no dependents returns an empty array", () => {
  const nodes = [node("a", "failed", []), node("b", "pending", [])];
  const closure = dependentClosure(nodes, "a");
  assert.deepEqual(closure, []);
});

// ---------------------------------------------------------------------------
// Story 1 (007.17) — validateDag extraction
// ---------------------------------------------------------------------------

test("validateDag: throws DuplicateTaskError on duplicate id with plain {id,dependencies} (no status)", () => {
  assert.throws(
    () =>
      validateDag([
        { id: "a", dependencies: [] },
        { id: "b", dependencies: [] },
        { id: "a", dependencies: [] },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateTaskError);
      assert.equal(err.taskId, "a");
      return true;
    },
  );
});

test("validateDag: throws UnknownDependencyError on unknown dep with plain {id,dependencies} (no status)", () => {
  assert.throws(
    () => validateDag([{ id: "a", dependencies: ["missing"] }]),
    (err: unknown) => {
      assert.ok(err instanceof UnknownDependencyError);
      assert.equal(err.taskId, "a");
      assert.equal(err.dependency, "missing");
      return true;
    },
  );
});

test("validateDag: throws CycleError with path ['a','b','a'] for two-node cycle with plain {id,dependencies} (no status)", () => {
  assert.throws(
    () =>
      validateDag([
        { id: "a", dependencies: ["b"] },
        { id: "b", dependencies: ["a"] },
      ]),
    (err: unknown) => {
      assert.ok(err instanceof CycleError);
      assert.deepEqual(err.path, ["a", "b", "a"]);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Story 1 (016) — longestRemainingChain
// ---------------------------------------------------------------------------

test("longestRemainingChain: empty input returns {metric, nodeIds: [], length: 0}", () => {
  const result = longestRemainingChain([]);
  assert.deepEqual(result, {
    metric: "remaining-node-count",
    nodeIds: [],
    length: 0,
  });
});

test("longestRemainingChain: every node completed returns {metric, nodeIds: [], length: 0}", () => {
  const nodes = [
    node("a", "completed", []),
    node("b", "completed", ["a"]),
    node("c", "completed", ["b"]),
  ];
  const result = longestRemainingChain(nodes);
  assert.deepEqual(result, {
    metric: "remaining-node-count",
    nodeIds: [],
    length: 0,
  });
});

test("longestRemainingChain: chain a→b→c all pending returns [a,b,c] dependency-first, length=3", () => {
  const nodes = [
    node("a", "pending", []),
    node("b", "pending", ["a"]),
    node("c", "pending", ["b"]),
  ];
  const result = longestRemainingChain(nodes);
  assert.equal(result.length, 3);
  assert.deepEqual(result.nodeIds, ["a", "b", "c"]);
});

test("longestRemainingChain: a completed dependency is skipped without breaking the chain", () => {
  const nodes = [
    node("a", "completed", []),
    node("b", "pending", ["a"]),
    node("c", "pending", ["b"]),
  ];
  const result = longestRemainingChain(nodes);
  assert.equal(result.length, 2);
  assert.deepEqual(result.nodeIds, ["b", "c"]);
});

test("longestRemainingChain: discarded nodes are excluded from the path entirely", () => {
  const nodes = [
    node("a", "pending", []),
    node("b", "discarded", ["a"]),
    node("c", "pending", ["b"]),
    node("d", "pending", ["c"]),
  ];
  const result = longestRemainingChain(nodes);
  assert.equal(result.length, 2);
  assert.deepEqual(result.nodeIds, ["c", "d"]);
});

test("longestRemainingChain: two equal-length chains — the lexicographically smallest nodeIds wins", () => {
  // Two independent chains of length 2:
  //   "a1" → "a2"
  //   "b1" → "b2"
  // The lexicographically smaller chain is the "a1"/"a2" chain.
  const forward = [
    node("b1", "pending", []),
    node("b2", "pending", ["b1"]),
    node("a1", "pending", []),
    node("a2", "pending", ["a1"]),
  ];
  const reversed = [
    node("a2", "pending", ["a1"]),
    node("a1", "pending", []),
    node("b2", "pending", ["b1"]),
    node("b1", "pending", []),
  ];
  const expected = {
    metric: "remaining-node-count",
    nodeIds: ["a1", "a2"],
    length: 2,
  };
  assert.deepEqual(longestRemainingChain(forward), expected);
  assert.deepEqual(longestRemainingChain(reversed), expected);
});

test("longestRemainingChain: asserts metric is exactly the string 'remaining-node-count'", () => {
  const nodes = [node("a", "pending", [])];
  const result = longestRemainingChain(nodes);
  assert.equal(result.metric, "remaining-node-count");
});
