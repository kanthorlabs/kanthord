import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runAddDependency, runRemoveDependency } from "./dependency.ts";
import type {
  TaskRepository,
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { Task } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Event } from "../../domain/event.ts";
import { AddDependency } from "../../app/task/add-dependency.ts";
import { RemoveDependency } from "../../app/task/remove-dependency.ts";

// --- Fakes ---

type KindResult =
  "project" | "resource" | "initiative" | "objective" | "task" | undefined;

class FakeReferenceResolver implements ReferenceResolver {
  readonly #kinds: Map<string, Exclude<KindResult, undefined>>;
  constructor(kinds: Record<string, Exclude<KindResult, undefined>>) {
    this.#kinds = new Map(Object.entries(kinds));
  }
  resolveKind(id: string): KindResult {
    return this.#kinds.get(id);
  }
}

class FakeTaskRepository implements TaskRepository {
  readonly #tasks: Map<string, Task> = new Map();

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

  saveTaskContext(_taskId: string, _ctx: Record<string, string>): void {}

  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }

  addDependency(taskId: string, dependsOn: string): void {
    const task = this.#tasks.get(taskId);
    if (task) {
      this.#tasks.set(taskId, {
        ...task,
        dependencies: [...task.dependencies, dependsOn],
      });
    }
  }

  removeDependency(taskId: string, dependsOn: string): void {
    const task = this.#tasks.get(taskId);
    if (task) {
      this.#tasks.set(taskId, {
        ...task,
        dependencies: task.dependencies.filter((d) => d !== dependsOn),
      });
    }
  }

  listTasksByObjective(_objectiveId: string): Task[] {
    return [...this.#tasks.values()];
  }

  getInitiativeId(_taskId: string): string | undefined {
    return undefined;
  }
}

class FakeInitiativeRepository implements InitiativeRepository {
  readonly #initiatives: Map<string, Initiative> = new Map();
  readonly #objectives: Map<string, Objective> = new Map();

  save(initiative: Initiative): void {
    this.#initiatives.set(initiative.id, { ...initiative });
  }

  get(id: string): Initiative | undefined {
    return this.#initiatives.get(id);
  }

  saveObjective(objective: Objective): void {
    this.#objectives.set(objective.id, { ...objective });
  }

  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }

  listObjectives(_initiativeId: string): Objective[] {
    return [...this.#objectives.values()];
  }

  resolveInitiativeByName(_projectId: string, _name: string): string[] {
    return [];
  }

  resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
    return [];
  }

  listInitiatives(_projectId: string): Initiative[] {
    return [];
  }

  setPaused(_id: string, _paused: boolean): void {}

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }
}

class FakeEventFeed implements EventFeed {
  readonly events: Event[] = [];

  append(event: Event): void {
    this.events.push(event);
  }

  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

// --- Fixture IDs ---
const TASK_A = "01JZZZZZZZZZZZZZZZZZZTSKA0";
const TASK_B = "01JZZZZZZZZZZZZZZZZZZTSKB0";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ0";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";
const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ0";

function buildFakes() {
  const referenceResolver = new FakeReferenceResolver({
    [TASK_A]: "task",
    [TASK_B]: "task",
  });
  const taskRepository = new FakeTaskRepository();
  const initiativeRepository = new FakeInitiativeRepository();
  const events = new FakeEventFeed();
  const transactor = { run: <T>(work: () => T): T => work() };

  initiativeRepository.save({ id: INIT_ID, projectId: PROJ_ID, name: "oauth" });
  initiativeRepository.saveObjective({
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
  });

  return {
    taskRepository,
    initiativeRepository,
    referenceResolver,
    events,
    transactor,
  };
}

describe("runAddDependency", () => {
  test("runAddDependency valid flags returns exitCode 0 with success message on stderr", async () => {
    const f = buildFakes();
    f.taskRepository.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [],
    });
    f.taskRepository.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const result = await runAddDependency(
      { task: TASK_A, "depends-on": TASK_B },
      new AddDependency(
        f.taskRepository,
        f.initiativeRepository,
        f.referenceResolver,
        f.events,
        f.transactor,
      ),
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, []);
    assert.equal(result.stderr.length, 1);
    assert.ok(
      result.stderr[0]!.includes("dependency added"),
      `expected 'dependency added' in stderr, got: ${result.stderr[0]}`,
    );
  });

  test("runAddDependency cycle-closing edge returns exit 1 with one error line on stderr", async () => {
    const f = buildFakes();
    // A depends on B; adding B → A closes a cycle
    f.taskRepository.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [TASK_B],
    });
    f.taskRepository.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const result = await runAddDependency(
      { task: TASK_B, "depends-on": TASK_A },
      new AddDependency(
        f.taskRepository,
        f.initiativeRepository,
        f.referenceResolver,
        f.events,
        f.transactor,
      ),
    );

    assert.equal(result.exitCode, 1);
    assert.equal(
      result.stderr.length,
      1,
      "exactly one error line, no stack trace",
    );
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runAddDependency non-pending task returns exit 1 with one error line on stderr", async () => {
    const f = buildFakes();
    f.taskRepository.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "completed",
      dependencies: [],
    });
    f.taskRepository.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const result = await runAddDependency(
      { task: TASK_A, "depends-on": TASK_B },
      new AddDependency(
        f.taskRepository,
        f.initiativeRepository,
        f.referenceResolver,
        f.events,
        f.transactor,
      ),
    );

    assert.equal(result.exitCode, 1);
    assert.equal(
      result.stderr.length,
      1,
      "exactly one error line, no stack trace",
    );
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

describe("runRemoveDependency", () => {
  test("runRemoveDependency non-existent edge returns exit 0 no-op", async () => {
    const f = buildFakes();
    // TASK_A does not depend on TASK_B
    f.taskRepository.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [],
    });
    f.taskRepository.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const result = await runRemoveDependency(
      { task: TASK_A, "depends-on": TASK_B },
      new RemoveDependency(
        f.taskRepository,
        f.initiativeRepository,
        f.referenceResolver,
        f.events,
        f.transactor,
      ),
    );

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stdout, []);
  });
});
