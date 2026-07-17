import { test } from "node:test";
import assert from "node:assert/strict";
import { StoreGraph } from "./store-graph.ts";
import { CycleError, DuplicateTaskError } from "../../domain/graph.ts";
import type { TaskRepository } from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";

class FakeTaskRepository implements TaskRepository {
  readonly calls: Task[][] = [];

  save(_task: Task): void {}

  saveAll(tasks: Task[]): void {
    this.calls.push([...tasks]);
  }

  get(_id: string): Task | undefined {
    return undefined;
  }

  listByInitiative(_initiativeId: string): Task[] {
    return [];
  }
}

test("StoreGraph.execute stores two tasks, remaps dep label to ULID, returns in input order", async () => {
  const repo = new FakeTaskRepository();
  const uc = new StoreGraph(repo);
  const objectiveId = "obj-1";

  const result = await uc.execute({
    objectiveId,
    tasks: [{ id: "api" }, { id: "deploy", dependencies: ["api"] }],
  });

  assert.equal(result.length, 2);

  const [apiTask, deployTask] = result;
  assert.ok(apiTask, "apiTask must be defined");
  assert.equal(apiTask.objectiveId, objectiveId);
  assert.equal(apiTask.title, "api");
  assert.equal(apiTask.status, "pending");
  assert.deepEqual(apiTask.dependencies, []);
  // id is a ULID, not the label
  assert.notEqual(apiTask.id, "api");

  assert.ok(deployTask, "deployTask must be defined");
  assert.equal(deployTask.objectiveId, objectiveId);
  assert.equal(deployTask.title, "deploy");
  assert.equal(deployTask.status, "pending");
  // dependency remapped to api's new ULID, not the label
  assert.deepEqual(deployTask.dependencies, [apiTask.id]);

  // saveAll called once with both tasks in input order
  assert.equal(repo.calls.length, 1);
  const firstCall = repo.calls[0];
  assert.ok(firstCall, "first saveAll call must be defined");
  assert.deepEqual(firstCall, result);
});

test("StoreGraph.execute throws CycleError and does not call saveAll", async () => {
  const repo = new FakeTaskRepository();
  const uc = new StoreGraph(repo);

  await assert.rejects(
    () =>
      uc.execute({
        objectiveId: "obj-1",
        tasks: [
          { id: "a", dependencies: ["b"] },
          { id: "b", dependencies: ["a"] },
        ],
      }),
    CycleError,
  );

  assert.equal(repo.calls.length, 0);
});

test("StoreGraph.execute throws DuplicateTaskError and does not call saveAll", async () => {
  const repo = new FakeTaskRepository();
  const uc = new StoreGraph(repo);

  await assert.rejects(
    () =>
      uc.execute({
        objectiveId: "obj-1",
        tasks: [{ id: "x" }, { id: "x" }],
      }),
    DuplicateTaskError,
  );

  assert.equal(repo.calls.length, 0);
});
