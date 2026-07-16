import { test } from "node:test";
import assert from "node:assert/strict";
import { CheckGraph } from "./check-graph.ts";
import {
  CycleError,
  UnknownDependencyError,
  DuplicateTaskError,
} from "../../domain/graph.ts";

test("execute with valid input returns readiness report", () => {
  const uc = new CheckGraph();
  const result = uc.execute({
    tasks: [
      { id: "design" },
      { id: "implement", dependencies: ["design"] },
      { id: "test", dependencies: ["implement"] },
    ],
  });
  // All three tasks are pending, design has no deps → ready
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { id: "design", state: "ready", waiting: [] });
  assert.deepEqual(result[1], {
    id: "implement",
    state: "blocked",
    waiting: ["design"],
  });
  assert.deepEqual(result[2], {
    id: "test",
    state: "blocked",
    waiting: ["implement"],
  });
});

test("execute with cyclic graph throws CycleError", () => {
  const uc = new CheckGraph();
  assert.throws(
    () =>
      uc.execute({
        tasks: [
          { id: "a", dependencies: ["b"] },
          { id: "b", dependencies: ["a"] },
        ],
      }),
    (err: unknown) => err instanceof CycleError
  );
});

test("execute with unknown dependency throws UnknownDependencyError", () => {
  const uc = new CheckGraph();
  assert.throws(
    () =>
      uc.execute({
        tasks: [{ id: "a", dependencies: ["ghost"] }],
      }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownDependencyError);
      assert.equal(err.taskId, "a");
      assert.equal(err.dependency, "ghost");
      return true;
    }
  );
});

test("execute with duplicate id throws DuplicateTaskError", () => {
  const uc = new CheckGraph();
  assert.throws(
    () =>
      uc.execute({
        tasks: [{ id: "a" }, { id: "a" }],
      }),
    (err: unknown) => {
      assert.ok(err instanceof DuplicateTaskError);
      assert.equal(err.taskId, "a");
      return true;
    }
  );
});
