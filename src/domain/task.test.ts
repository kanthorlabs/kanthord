import { test } from "node:test";
import assert from "node:assert/strict";
import { TASK_STATUSES, newTask, transitionTask, IllegalTransitionError, setDependencies, DependenciesLockedError } from "./task.ts";
import type { TaskStatus } from "./task.ts";

test("TASK_STATUSES lists exactly the six literals in canonical order", () => {
  assert.deepEqual(TASK_STATUSES, ["pending", "running", "completed", "failed", "awaiting_confirmation", "discarded"]);
});

test("newTask returns status pending and empty dependencies by default", () => {
  const task = newTask({ objectiveId: "obj-1", title: "Do something" });
  assert.equal(task.status, "pending");
  assert.deepEqual(task.dependencies, []);
  assert.equal(task.objectiveId, "obj-1");
  assert.equal(task.title, "Do something");
  assert.match(task.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("newTask keeps a passed dependencies array as given", () => {
  const deps = ["id-a", "id-b"];
  const task = newTask({ objectiveId: "obj-2", title: "Do more", dependencies: deps });
  assert.deepEqual(task.dependencies, ["id-a", "id-b"]);
});

// Story 004 — T1: legal-transition enforcement
test("transitionTask pending→running→completed yields correct statuses and does not mutate input", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  assert.equal(running.status, "running");
  assert.equal(pending.status, "pending"); // input not mutated
  const completed = transitionTask(running, "completed");
  assert.equal(completed.status, "completed");
  assert.equal(running.status, "running"); // input not mutated
});

test("transitionTask running→failed, failed→pending, and running→pending succeed", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");

  const failed = transitionTask(running, "failed");
  assert.equal(failed.status, "failed");

  const retried = transitionTask(failed, "pending");
  assert.equal(retried.status, "pending");

  const running2 = transitionTask(pending, "running");
  const crashRecovered = transitionTask(running2, "pending");
  assert.equal(crashRecovered.status, "pending");
});

test("transitionTask pending→completed throws IllegalTransitionError", () => {
  const task = newTask({ objectiveId: "obj-1", title: "t" });
  assert.throws(() => transitionTask(task, "completed"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "pending");
    assert.equal((err as IllegalTransitionError).to, "completed");
    return true;
  });
});

test("transitionTask pending→failed throws IllegalTransitionError", () => {
  const task = newTask({ objectiveId: "obj-1", title: "t" });
  assert.throws(() => transitionTask(task, "failed"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "pending");
    assert.equal((err as IllegalTransitionError).to, "failed");
    return true;
  });
});

test("transitionTask completed→running throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(() => transitionTask(completed, "running"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "completed");
    assert.equal((err as IllegalTransitionError).to, "running");
    return true;
  });
});

test("transitionTask completed→failed throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(() => transitionTask(completed, "failed"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "completed");
    assert.equal((err as IllegalTransitionError).to, "failed");
    return true;
  });
});

test("transitionTask completed→pending throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(() => transitionTask(completed, "pending"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "completed");
    assert.equal((err as IllegalTransitionError).to, "pending");
    return true;
  });
});

test("transitionTask failed→running throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  assert.throws(() => transitionTask(failed, "running"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "failed");
    assert.equal((err as IllegalTransitionError).to, "running");
    return true;
  });
});

test("transitionTask failed→completed throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  assert.throws(() => transitionTask(failed, "completed"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "failed");
    assert.equal((err as IllegalTransitionError).to, "completed");
    return true;
  });
});

// Story 004 — T2: dependency-mutation guard
test("setDependencies on a pending task replaces dependencies and does not mutate input", () => {
  const task = newTask({ objectiveId: "obj-1", title: "t", dependencies: ["old"] });
  const updated = setDependencies(task, ["x", "y"]);
  assert.deepEqual(updated.dependencies, ["x", "y"]);
  assert.deepEqual(task.dependencies, ["old"]); // input not mutated
  assert.notEqual(updated, task); // new object returned
});

test("setDependencies on a pending task with empty array clears dependencies", () => {
  const task = newTask({ objectiveId: "obj-1", title: "t", dependencies: ["a", "b"] });
  const updated = setDependencies(task, []);
  assert.deepEqual(updated.dependencies, []);
});

test("setDependencies on a running task throws DependenciesLockedError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  assert.throws(() => setDependencies(running, ["x"]), (err) => {
    assert.ok(err instanceof DependenciesLockedError);
    assert.equal((err as DependenciesLockedError).taskId, running.id);
    assert.equal((err as DependenciesLockedError).status, "running");
    return true;
  });
});

test("setDependencies on a completed task throws DependenciesLockedError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(() => setDependencies(completed, ["x"]), (err) => {
    assert.ok(err instanceof DependenciesLockedError);
    assert.equal((err as DependenciesLockedError).taskId, completed.id);
    assert.equal((err as DependenciesLockedError).status, "completed");
    return true;
  });
});

test("setDependencies on a failed task throws DependenciesLockedError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  assert.throws(() => setDependencies(failed, ["x"]), (err) => {
    assert.ok(err instanceof DependenciesLockedError);
    assert.equal((err as DependenciesLockedError).taskId, failed.id);
    assert.equal((err as DependenciesLockedError).status, "failed");
    return true;
  });
});

// B1: Story 004 amended (EPIC 006 D3/D4) — awaiting_confirmation + discarded statuses

// (b) 4 new legal edges
test("transitionTask running→awaiting_confirmation yields awaiting_confirmation and does not mutate input", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = transitionTask(running, "awaiting_confirmation");
  assert.equal(awaiting.status, "awaiting_confirmation");
  assert.equal(running.status, "running"); // input not mutated
});

test("transitionTask awaiting_confirmation→completed yields completed and does not mutate input", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  const completed = transitionTask(awaiting, "completed");
  assert.equal(completed.status, "completed");
  assert.equal(awaiting.status, "awaiting_confirmation"); // input not mutated
});

test("transitionTask awaiting_confirmation→pending yields pending and does not mutate input", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  const rejectedToPending = transitionTask(awaiting, "pending");
  assert.equal(rejectedToPending.status, "pending");
  assert.equal(awaiting.status, "awaiting_confirmation"); // input not mutated
});

test("transitionTask awaiting_confirmation→discarded yields discarded and does not mutate input", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  const discarded = transitionTask(awaiting, "discarded");
  assert.equal(discarded.status, "discarded");
  assert.equal(awaiting.status, "awaiting_confirmation"); // input not mutated
});

// (c) representative new illegal pairs
test("transitionTask pending→awaiting_confirmation throws IllegalTransitionError", () => {
  const task = newTask({ objectiveId: "obj-1", title: "t" });
  assert.throws(() => transitionTask(task, "awaiting_confirmation"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "pending");
    assert.equal((err as IllegalTransitionError).to, "awaiting_confirmation");
    return true;
  });
});

test("transitionTask pending→discarded throws IllegalTransitionError", () => {
  const task = newTask({ objectiveId: "obj-1", title: "t" });
  assert.throws(() => transitionTask(task, "discarded"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "pending");
    assert.equal((err as IllegalTransitionError).to, "discarded");
    return true;
  });
});

test("transitionTask running→discarded throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  assert.throws(() => transitionTask(running, "discarded"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "running");
    assert.equal((err as IllegalTransitionError).to, "discarded");
    return true;
  });
});

test("transitionTask awaiting_confirmation→running throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  assert.throws(() => transitionTask(awaiting, "running"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "awaiting_confirmation");
    assert.equal((err as IllegalTransitionError).to, "running");
    return true;
  });
});

test("transitionTask awaiting_confirmation→failed throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  assert.throws(() => transitionTask(awaiting, "failed"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "awaiting_confirmation");
    assert.equal((err as IllegalTransitionError).to, "failed");
    return true;
  });
});

test("transitionTask discarded→pending throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  const discardedTask = { ...awaiting, status: "discarded" as TaskStatus };
  assert.throws(() => transitionTask(discardedTask, "pending"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "discarded");
    assert.equal((err as IllegalTransitionError).to, "pending");
    return true;
  });
});

test("transitionTask discarded→running throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const awaiting = { ...running, status: "awaiting_confirmation" as TaskStatus };
  const discardedTask = { ...awaiting, status: "discarded" as TaskStatus };
  assert.throws(() => transitionTask(discardedTask, "running"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "discarded");
    assert.equal((err as IllegalTransitionError).to, "running");
    return true;
  });
});

test("transitionTask completed→discarded throws IllegalTransitionError", () => {
  const pending = newTask({ objectiveId: "obj-1", title: "t" });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(() => transitionTask(completed, "discarded"), (err) => {
    assert.ok(err instanceof IllegalTransitionError);
    assert.equal((err as IllegalTransitionError).from, "completed");
    assert.equal((err as IllegalTransitionError).to, "discarded");
    return true;
  });
});
