import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ListTasks } from "./list-tasks.ts";
import type { TaskRepository } from "../../storage/port.ts";
import type { Task } from "../../domain/task.ts";
import { UnknownReferenceError } from "../errors.ts";

// --- Fakes ---

class FakeTaskRepository implements TaskRepository {
  readonly #tasks: Map<string, Task> = new Map();

  seed(task: Task): void {
    this.#tasks.set(task.id, { ...task, dependencies: [...task.dependencies] });
  }

  save(task: Task): void {
    this.#tasks.set(task.id, { ...task, dependencies: [...task.dependencies] });
  }

  saveAll(tasks: Task[]): void {
    for (const t of tasks) this.save(t);
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  listByInitiative(_initiativeId: string): Task[] {
    return [...this.#tasks.values()];
  }

  listTasksByObjective(_objectiveId: string): Task[] {
    return [...this.#tasks.values()];
  }

  saveTaskContext(_taskId: string, _ctx: Record<string, string>): void {}

  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }

  addDependency(_taskId: string, _dependencyId: string): void {}

  removeDependency(_taskId: string, _dependencyId: string): void {}

  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  compareAndApply(
    _id: string,
    _expectedSha: string,
    _spec: {
      title: string;
      instructions: string;
      ac: string[];
      agent: string;
      verification: string[] | null;
      dependencies: string[];
    },
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalReparent(_id: string, _expectedSha: string, _objectiveId: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteTask(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
  }
}

// --- Fixture IDs ---
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";
const TASK_API = "01JZZZZZZZZZZZZZZZZZZTSK10";
const TASK_DEPLOY = "01JZZZZZZZZZZZZZZZZZZTSK20";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ0";

describe("ListTasks", () => {
  test("ListTasks two tasks: api ready, deploy blocked waiting api", async () => {
    const taskRepo = new FakeTaskRepository();
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "implement api",
      status: "pending",
      dependencies: [],
    });
    taskRepo.seed({
      id: TASK_DEPLOY,
      objectiveId: OBJ_ID,
      title: "deploy",
      status: "pending",
      dependencies: [TASK_API],
    });

    const useCase = new ListTasks(taskRepo);
    const rows = await useCase.execute({ initiativeId: INIT_ID });

    assert.equal(rows.length, 2, "should return 2 rows");

    const apiRow = rows.find((r) => r.id === TASK_API);
    const deployRow = rows.find((r) => r.id === TASK_DEPLOY);

    assert.ok(apiRow, "api row should exist");
    assert.equal(apiRow.title, "implement api");
    assert.equal(apiRow.status, "pending");
    assert.equal(apiRow.state, "ready");
    assert.deepEqual(apiRow.waiting, []);

    assert.ok(deployRow, "deploy row should exist");
    assert.equal(deployRow.title, "deploy");
    assert.equal(deployRow.status, "pending");
    assert.equal(deployRow.state, "blocked");
    assert.deepEqual(deployRow.waiting, [TASK_API]);
  });

  test("ListTasks unknown initiativeId throws UnknownReferenceError", async () => {
    const taskRepo = new FakeTaskRepository();
    // No tasks seeded — listByInitiative returns []
    // But we want to test that the use case validates the scope.
    // The use case should detect an empty/unknown initiative by checking
    // if listByInitiative returns [] and the id is unknown.
    // Per story: an unknown scope id → UnknownReferenceError
    // We seed a task for a DIFFERENT initiative; INIT_ID has none.
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "implement api",
      status: "pending",
      dependencies: [],
    });

    // Override listByInitiative so UNKNOWN_INIT returns []
    const badTaskRepo = new (class extends FakeTaskRepository {
      override listByInitiative(initiativeId: string): Task[] {
        if (initiativeId === INIT_ID) return [];
        return super.listByInitiative(initiativeId);
      }
    })();

    const useCase = new ListTasks(badTaskRepo);
    await assert.rejects(
      () => useCase.execute({ initiativeId: INIT_ID }),
      (err: unknown) => {
        assert.ok(
          err instanceof UnknownReferenceError,
          "should be UnknownReferenceError",
        );
        assert.equal((err as UnknownReferenceError).kind, "initiative");
        assert.equal((err as UnknownReferenceError).id, INIT_ID);
        return true;
      },
    );
  });

  test("ListTasks single ready task with no dependencies", async () => {
    const taskRepo = new FakeTaskRepository();
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "implement api",
      status: "pending",
      dependencies: [],
    });

    const useCase = new ListTasks(taskRepo);
    const rows = await useCase.execute({ initiativeId: INIT_ID });

    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.state, "ready");
    assert.deepEqual(rows[0]!.waiting, []);
  });

  // S1 — declared dependencies in list read model
  test("S1: root task row carries dependencies equal to declared empty array", async () => {
    const taskRepo = new FakeTaskRepository();
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "implement api",
      status: "pending",
      dependencies: [],
    });
    taskRepo.seed({
      id: TASK_DEPLOY,
      objectiveId: OBJ_ID,
      title: "deploy",
      status: "pending",
      dependencies: [TASK_API],
    });

    const useCase = new ListTasks(taskRepo);
    const rows = await useCase.execute({ initiativeId: INIT_ID });

    const apiRow = rows.find((r) => r.id === TASK_API);
    assert.ok(apiRow, "api row should exist");
    assert.deepEqual(
      apiRow.dependencies,
      [],
      "root task must have dependencies: []",
    );
    // waiting must still be present and distinct
    assert.deepEqual(apiRow.waiting, []);
  });

  test("S1: sibling task row carries dependencies equal to declared edge", async () => {
    const taskRepo = new FakeTaskRepository();
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "implement api",
      status: "pending",
      dependencies: [],
    });
    taskRepo.seed({
      id: TASK_DEPLOY,
      objectiveId: OBJ_ID,
      title: "deploy",
      status: "pending",
      dependencies: [TASK_API],
    });

    const useCase = new ListTasks(taskRepo);
    const rows = await useCase.execute({ initiativeId: INIT_ID });

    const deployRow = rows.find((r) => r.id === TASK_DEPLOY);
    assert.ok(deployRow, "deploy row should exist");
    assert.deepEqual(
      deployRow.dependencies,
      [TASK_API],
      "sibling task must have dependencies: [TASK_API]",
    );
    // waiting must still be present and distinct
    assert.deepEqual(deployRow.waiting, [TASK_API]);
  });

  test("S1: after root completes sibling dependencies stays while waiting becomes empty", async () => {
    const taskRepo = new FakeTaskRepository();
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "implement api",
      status: "completed",
      dependencies: [],
    });
    taskRepo.seed({
      id: TASK_DEPLOY,
      objectiveId: OBJ_ID,
      title: "deploy",
      status: "pending",
      dependencies: [TASK_API],
    });

    const useCase = new ListTasks(taskRepo);
    const rows = await useCase.execute({ initiativeId: INIT_ID });

    const deployRow = rows.find((r) => r.id === TASK_DEPLOY);
    assert.ok(deployRow, "deploy row should exist");
    // static declared edges must remain even after root completes
    assert.deepEqual(
      deployRow.dependencies,
      [TASK_API],
      "sibling dependencies must remain [TASK_API] even after root is completed",
    );
    // dynamic waiting must be empty once root is satisfied
    assert.deepEqual(
      deployRow.waiting,
      [],
      "sibling waiting must be [] once root is completed",
    );
  });

  // Story 07 T2 (i) — status filter
  test("ListTasks with status filter returns only awaiting_confirmation tasks (i)", async () => {
    const TASK_AWAIT = "01JZZZZZZZZZZZZZZZZZZTSKAW1";
    const TASK_DONE = "01JZZZZZZZZZZZZZZZZZZTSKAW2";
    const taskRepo = new FakeTaskRepository();
    taskRepo.seed({
      id: TASK_AWAIT,
      objectiveId: OBJ_ID,
      title: "escalated task",
      status: "awaiting_confirmation",
      dependencies: [],
    });
    taskRepo.seed({
      id: TASK_DONE,
      objectiveId: OBJ_ID,
      title: "completed task",
      status: "completed",
      dependencies: [],
    });
    taskRepo.seed({
      id: TASK_API,
      objectiveId: OBJ_ID,
      title: "pending task",
      status: "pending",
      dependencies: [],
    });

    const useCase = new ListTasks(taskRepo);
    const rows = await useCase.execute({
      initiativeId: INIT_ID,
      status: "awaiting_confirmation",
    });

    assert.equal(
      rows.length,
      1,
      "filter must return only awaiting_confirmation tasks",
    );
    assert.equal(
      rows[0]!.id,
      TASK_AWAIT,
      "must return the awaiting_confirmation task",
    );
    assert.equal(
      rows[0]!.status,
      "awaiting_confirmation",
      "returned task must have correct status",
    );
  });
});
