import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TASK_STATUSES,
  newTask,
  transitionTask,
  IllegalTransitionError,
  setDependencies,
  DependenciesLockedError,
  InvalidTaskFieldError,
  TaskSpecLockedError,
  applyTaskSpec,
  reparentTask,
} from "./task.ts";
import type { TaskStatus, TaskSpecPatch } from "./task.ts";

// Base required inputs for newTask (Story 02 — agent/instructions/ac required)
const BASE = {
  objectiveId: "obj-1",
  title: "Do something",
  agent: "generic@1",
  instructions: "do X",
  ac: ["builds"],
};

test("TASK_STATUSES lists exactly the six literals in canonical order", () => {
  assert.deepEqual(TASK_STATUSES, [
    "pending",
    "running",
    "completed",
    "failed",
    "awaiting_confirmation",
    "discarded",
  ]);
});

test("newTask returns status pending and empty dependencies by default", () => {
  const task = newTask({
    ...BASE,
    objectiveId: "obj-1",
    title: "Do something",
  });
  assert.equal(task.status, "pending");
  assert.deepEqual(task.dependencies, []);
  assert.equal(task.objectiveId, "obj-1");
  assert.equal(task.title, "Do something");
  assert.match(task.id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("newTask keeps a passed dependencies array as given", () => {
  const deps = ["id-a", "id-b"];
  const task = newTask({
    ...BASE,
    objectiveId: "obj-2",
    title: "Do more",
    dependencies: deps,
  });
  assert.deepEqual(task.dependencies, ["id-a", "id-b"]);
});

// Story 004 — T1: legal-transition enforcement
test("transitionTask pending→running→completed yields correct statuses and does not mutate input", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  assert.equal(running.status, "running");
  assert.equal(pending.status, "pending"); // input not mutated
  const completed = transitionTask(running, "completed");
  assert.equal(completed.status, "completed");
  assert.equal(running.status, "running"); // input not mutated
});

test("transitionTask running→failed, failed→pending, and running→pending succeed", () => {
  const pending = newTask({ ...BASE });
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
  const task = newTask({ ...BASE });
  assert.throws(
    () => transitionTask(task, "completed"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "pending");
      assert.equal((err as IllegalTransitionError).to, "completed");
      return true;
    },
  );
});

test("transitionTask pending→failed throws IllegalTransitionError", () => {
  const task = newTask({ ...BASE });
  assert.throws(
    () => transitionTask(task, "failed"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "pending");
      assert.equal((err as IllegalTransitionError).to, "failed");
      return true;
    },
  );
});

test("transitionTask completed→running throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(
    () => transitionTask(completed, "running"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "completed");
      assert.equal((err as IllegalTransitionError).to, "running");
      return true;
    },
  );
});

test("transitionTask completed→failed throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(
    () => transitionTask(completed, "failed"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "completed");
      assert.equal((err as IllegalTransitionError).to, "failed");
      return true;
    },
  );
});

test("transitionTask completed→pending throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(
    () => transitionTask(completed, "pending"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "completed");
      assert.equal((err as IllegalTransitionError).to, "pending");
      return true;
    },
  );
});

test("transitionTask failed→running throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  assert.throws(
    () => transitionTask(failed, "running"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "failed");
      assert.equal((err as IllegalTransitionError).to, "running");
      return true;
    },
  );
});

test("transitionTask failed→completed throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  assert.throws(
    () => transitionTask(failed, "completed"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "failed");
      assert.equal((err as IllegalTransitionError).to, "completed");
      return true;
    },
  );
});

// Story 004 — T2: dependency-mutation guard
test("setDependencies on a pending task replaces dependencies and does not mutate input", () => {
  const task = newTask({ ...BASE, dependencies: ["old"] });
  const updated = setDependencies(task, ["x", "y"]);
  assert.deepEqual(updated.dependencies, ["x", "y"]);
  assert.deepEqual(task.dependencies, ["old"]); // input not mutated
  assert.notEqual(updated, task); // new object returned
});

test("setDependencies on a pending task with empty array clears dependencies", () => {
  const task = newTask({ ...BASE, dependencies: ["a", "b"] });
  const updated = setDependencies(task, []);
  assert.deepEqual(updated.dependencies, []);
});

test("setDependencies on a running task throws DependenciesLockedError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  assert.throws(
    () => setDependencies(running, ["x"]),
    (err) => {
      assert.ok(err instanceof DependenciesLockedError);
      assert.equal((err as DependenciesLockedError).taskId, running.id);
      assert.equal((err as DependenciesLockedError).status, "running");
      return true;
    },
  );
});

test("setDependencies on a completed task throws DependenciesLockedError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(
    () => setDependencies(completed, ["x"]),
    (err) => {
      assert.ok(err instanceof DependenciesLockedError);
      assert.equal((err as DependenciesLockedError).taskId, completed.id);
      assert.equal((err as DependenciesLockedError).status, "completed");
      return true;
    },
  );
});

test("setDependencies on a failed task throws DependenciesLockedError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  assert.throws(
    () => setDependencies(failed, ["x"]),
    (err) => {
      assert.ok(err instanceof DependenciesLockedError);
      assert.equal((err as DependenciesLockedError).taskId, failed.id);
      assert.equal((err as DependenciesLockedError).status, "failed");
      return true;
    },
  );
});

// B1: Story 004 amended (EPIC 006 D3/D4) — awaiting_confirmation + discarded statuses

// (b) 4 new legal edges
test("transitionTask running→awaiting_confirmation yields awaiting_confirmation and does not mutate input", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = transitionTask(running, "awaiting_confirmation");
  assert.equal(awaiting.status, "awaiting_confirmation");
  assert.equal(running.status, "running"); // input not mutated
});

test("transitionTask awaiting_confirmation→completed yields completed and does not mutate input", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  const completed = transitionTask(awaiting, "completed");
  assert.equal(completed.status, "completed");
  assert.equal(awaiting.status, "awaiting_confirmation"); // input not mutated
});

test("transitionTask awaiting_confirmation→pending yields pending and does not mutate input", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  const rejectedToPending = transitionTask(awaiting, "pending");
  assert.equal(rejectedToPending.status, "pending");
  assert.equal(awaiting.status, "awaiting_confirmation"); // input not mutated
});

test("transitionTask awaiting_confirmation→discarded yields discarded and does not mutate input", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  const discarded = transitionTask(awaiting, "discarded");
  assert.equal(discarded.status, "discarded");
  assert.equal(awaiting.status, "awaiting_confirmation"); // input not mutated
});

// (c) representative new illegal pairs
test("transitionTask pending→awaiting_confirmation throws IllegalTransitionError", () => {
  const task = newTask({ ...BASE });
  assert.throws(
    () => transitionTask(task, "awaiting_confirmation"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "pending");
      assert.equal((err as IllegalTransitionError).to, "awaiting_confirmation");
      return true;
    },
  );
});

test("transitionTask pending→discarded throws IllegalTransitionError", () => {
  const task = newTask({ ...BASE });
  assert.throws(
    () => transitionTask(task, "discarded"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "pending");
      assert.equal((err as IllegalTransitionError).to, "discarded");
      return true;
    },
  );
});

test("transitionTask running→discarded throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  assert.throws(
    () => transitionTask(running, "discarded"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "running");
      assert.equal((err as IllegalTransitionError).to, "discarded");
      return true;
    },
  );
});

test("transitionTask awaiting_confirmation→running throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  assert.throws(
    () => transitionTask(awaiting, "running"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal(
        (err as IllegalTransitionError).from,
        "awaiting_confirmation",
      );
      assert.equal((err as IllegalTransitionError).to, "running");
      return true;
    },
  );
});

test("transitionTask awaiting_confirmation→failed throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  assert.throws(
    () => transitionTask(awaiting, "failed"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal(
        (err as IllegalTransitionError).from,
        "awaiting_confirmation",
      );
      assert.equal((err as IllegalTransitionError).to, "failed");
      return true;
    },
  );
});

test("transitionTask discarded→pending throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  const discardedTask = { ...awaiting, status: "discarded" as TaskStatus };
  assert.throws(
    () => transitionTask(discardedTask, "pending"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "discarded");
      assert.equal((err as IllegalTransitionError).to, "pending");
      return true;
    },
  );
});

test("transitionTask discarded→running throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const awaiting = {
    ...running,
    status: "awaiting_confirmation" as TaskStatus,
  };
  const discardedTask = { ...awaiting, status: "discarded" as TaskStatus };
  assert.throws(
    () => transitionTask(discardedTask, "running"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "discarded");
      assert.equal((err as IllegalTransitionError).to, "running");
      return true;
    },
  );
});

test("transitionTask completed→discarded throws IllegalTransitionError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const completed = transitionTask(running, "completed");
  assert.throws(
    () => transitionTask(completed, "discarded"),
    (err) => {
      assert.ok(err instanceof IllegalTransitionError);
      assert.equal((err as IllegalTransitionError).from, "completed");
      assert.equal((err as IllegalTransitionError).to, "discarded");
      return true;
    },
  );
});

// Story 02 — T1: agent, instructions, ac, verification fields on Task + newTask validation

test("newTask with agent, instructions, ac carries all three fields", () => {
  const task = newTask({
    objectiveId: "obj-1",
    title: "t",
    agent: "generic@1",
    instructions: "do X",
    ac: ["builds", "tests pass"],
  });
  assert.equal(task.agent, "generic@1");
  assert.equal(task.instructions, "do X");
  assert.deepEqual(task.ac, ["builds", "tests pass"]);
});

test("newTask with empty agent throws InvalidTaskFieldError", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "t",
        agent: "",
        instructions: "do X",
        ac: ["builds"],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "agent");
      return true;
    },
  );
});

test("newTask with empty instructions throws InvalidTaskFieldError", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "t",
        agent: "generic@1",
        instructions: "",
        ac: ["builds"],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "instructions");
      return true;
    },
  );
});

test("newTask with empty ac array throws InvalidTaskFieldError", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "t",
        agent: "generic@1",
        instructions: "do X",
        ac: [],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "ac");
      return true;
    },
  );
});

test("newTask with verification carries the verification field", () => {
  const task = newTask({
    objectiveId: "obj-1",
    title: "t",
    agent: "generic@1",
    instructions: "do X",
    ac: ["builds"],
    verification: ["npm test"],
  });
  assert.deepEqual(task.verification, ["npm test"]);
});

test("newTask without verification leaves verification absent", () => {
  const task = newTask({
    objectiveId: "obj-1",
    title: "t",
    agent: "generic@1",
    instructions: "do X",
    ac: ["builds"],
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(task, "verification"),
    false,
  );
});

test("newTask with verification containing empty-string item throws InvalidTaskFieldError", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "t",
        agent: "generic@1",
        instructions: "do X",
        ac: ["builds"],
        verification: ["npm test", ""],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "verification");
      return true;
    },
  );
});

// Story 007 S01 T1 — single-line/non-empty rule (B12/B17)

test("newTask with multi-line title throws InvalidTaskFieldError(title)", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "line one\nline two",
        agent: "generic@1",
        instructions: "do X",
        ac: ["builds"],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "title");
      return true;
    },
  );
});

test("newTask with whitespace-only title throws InvalidTaskFieldError(title)", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "   ",
        agent: "generic@1",
        instructions: "do X",
        ac: ["builds"],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "title");
      return true;
    },
  );
});

test("newTask with multi-line ac item throws InvalidTaskFieldError(ac)", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "t",
        agent: "generic@1",
        instructions: "do X",
        ac: ["valid item", "bad\nitem"],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "ac");
      return true;
    },
  );
});

test("newTask with multi-line verification item throws InvalidTaskFieldError(verification)", () => {
  assert.throws(
    () =>
      newTask({
        objectiveId: "obj-1",
        title: "t",
        agent: "generic@1",
        instructions: "do X",
        ac: ["builds"],
        verification: ["npm test\necho oops"],
      }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "verification");
      return true;
    },
  );
});

test("newTask with multi-line instructions is accepted (instructions stays multi-line)", () => {
  const task = newTask({
    objectiveId: "obj-1",
    title: "t",
    agent: "generic@1",
    instructions: "step one\nstep two",
    ac: ["builds"],
  });
  assert.equal(task.instructions, "step one\nstep two");
});

// Story 01 — T2: applyTaskSpec PATCH semantics + TaskSpecLockedError

test("applyTaskSpec on a running task throws TaskSpecLockedError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const patch: TaskSpecPatch = { title: "New title" };
  assert.throws(
    () => applyTaskSpec(running, patch),
    (err) => {
      assert.ok(err instanceof TaskSpecLockedError);
      assert.equal((err as TaskSpecLockedError).taskId, running.id);
      assert.equal((err as TaskSpecLockedError).status, "running");
      return true;
    },
  );
});

test("applyTaskSpec on a failed task throws TaskSpecLockedError", () => {
  const pending = newTask({ ...BASE });
  const running = transitionTask(pending, "running");
  const failed = transitionTask(running, "failed");
  const patch: TaskSpecPatch = { title: "New title" };
  assert.throws(
    () => applyTaskSpec(failed, patch),
    (err) => {
      assert.ok(err instanceof TaskSpecLockedError);
      assert.equal((err as TaskSpecLockedError).taskId, failed.id);
      assert.equal((err as TaskSpecLockedError).status, "failed");
      return true;
    },
  );
});

test("applyTaskSpec with absent key leaves field byte-identical", () => {
  const task = newTask({
    ...BASE,
    title: "Original",
    instructions: "original instructions",
    ac: ["original ac"],
  });
  const patch: TaskSpecPatch = {};
  const result = applyTaskSpec(task, patch);
  assert.equal(result.title, "Original");
  assert.equal(result.instructions, "original instructions");
  assert.deepEqual(result.ac, ["original ac"]);
  assert.equal(result.agent, "generic@1");
});

test("applyTaskSpec with present title replaces it", () => {
  const task = newTask({ ...BASE, title: "Old title" });
  const result = applyTaskSpec(task, { title: "New title" });
  assert.equal(result.title, "New title");
});

test("applyTaskSpec with present ac replaces the whole list", () => {
  const task = newTask({ ...BASE, ac: ["old criterion"] });
  const result = applyTaskSpec(task, {
    ac: ["new criterion one", "new criterion two"],
  });
  assert.deepEqual(result.ac, ["new criterion one", "new criterion two"]);
});

test("applyTaskSpec with present ac containing a multi-line item throws InvalidTaskFieldError", () => {
  const task = newTask({ ...BASE });
  assert.throws(
    () => applyTaskSpec(task, { ac: ["good item", "bad\nitem"] }),
    (err) => {
      assert.ok(err instanceof InvalidTaskFieldError);
      assert.equal((err as InvalidTaskFieldError).field, "ac");
      return true;
    },
  );
});

test("applyTaskSpec with verification null clears the field", () => {
  const task = newTask({ ...BASE, verification: ["npm test"] });
  const result = applyTaskSpec(task, { verification: null });
  assert.equal(result.verification, undefined);
});

test("applyTaskSpec with verification empty array clears the field", () => {
  const task = newTask({ ...BASE, verification: ["npm test"] });
  const result = applyTaskSpec(task, { verification: [] });
  assert.equal(result.verification, undefined);
});

test("applyTaskSpec with present non-empty verification replaces it", () => {
  const task = newTask({ ...BASE, verification: ["npm test"] });
  const result = applyTaskSpec(task, { verification: ["npm run verify"] });
  assert.deepEqual(result.verification, ["npm run verify"]);
});

test("applyTaskSpec returns a NEW object and does not mutate the input task", () => {
  const task = newTask({ ...BASE, title: "Original" });
  const original = { ...task };
  const result = applyTaskSpec(task, { title: "Changed" });
  assert.notEqual(result, task); // new object
  assert.equal(task.title, original.title); // input not mutated
  assert.equal(result.title, "Changed");
});

// Story 01 — T3: reparentTask (pending-only)
test("reparentTask on a pending task returns a new task with the new objectiveId", () => {
  const task = newTask({ ...BASE, objectiveId: "OBJ1" });
  const result = reparentTask(task, "OBJ2");
  assert.equal(result.objectiveId, "OBJ2");
  assert.notEqual(result, task); // new object
  assert.equal(task.objectiveId, "OBJ1"); // input not mutated
  // all other fields unchanged
  assert.equal(result.id, task.id);
  assert.equal(result.title, task.title);
  assert.equal(result.status, task.status);
  assert.deepEqual(result.dependencies, task.dependencies);
});

test("reparentTask on a running task throws TaskSpecLockedError", () => {
  const task = transitionTask(newTask({ ...BASE }), "running");
  assert.throws(
    () => reparentTask(task, "OBJ2"),
    (err: unknown) => {
      assert.ok(err instanceof TaskSpecLockedError);
      assert.equal(err.taskId, task.id);
      assert.equal(err.status, "running");
      return true;
    },
  );
});
