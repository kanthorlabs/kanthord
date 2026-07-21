import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AddDependency } from "./add-dependency.ts";
import { RemoveDependency } from "./remove-dependency.ts";
import type {
  TaskRepository,
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { Task } from "../../domain/task.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Event } from "../../domain/event.ts";
import { CycleError } from "../../domain/graph.ts";
import { DependenciesLockedError } from "../../domain/task.ts";
import { WrongTypeReferenceError } from "../errors.ts";

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
  readonly addedEdges: Array<{ taskId: string; dependencyId: string }> = [];
  readonly removedEdges: Array<{ taskId: string; dependencyId: string }> = [];

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

  addDependency(taskId: string, dependencyId: string): void {
    this.addedEdges.push({ taskId, dependencyId });
    const task = this.#tasks.get(taskId);
    if (task) {
      this.#tasks.set(taskId, {
        ...task,
        dependencies: [...task.dependencies, dependencyId],
      });
    }
  }

  removeDependency(taskId: string, dependencyId: string): void {
    this.removedEdges.push({ taskId, dependencyId });
    const task = this.#tasks.get(taskId);
    if (task) {
      this.#tasks.set(taskId, {
        ...task,
        dependencies: task.dependencies.filter((d) => d !== dependencyId),
      });
    }
  }

  listTasksByObjective(_objectiveId: string): Task[] {
    return [];
  }

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

  listInitiatives(_projectId: string) {
    return [];
  }

  setPaused(_id: string, _paused: boolean): void {}

  listAllInitiatives(): Array<{ id: string; paused: boolean }> {
    return [];
  }

  getSha256(_id: string): string | undefined {
    return undefined;
  }
  conditionalRenameInitiative(
    _id: string,
    _expectedSha: string,
    _name: string,
  ) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalRenameObjective(_id: string, _expectedSha: string, _name: string) {
    return { status: "applied" as const, freshSha: "" };
  }
  conditionalDeleteObjective(_id: string, _expectedSha: string) {
    return { status: "applied" as const, freshSha: "" };
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

/** Runs work directly, recording how many transactions were opened. */
class FakeTransactor implements Transactor {
  runCount = 0;
  run<T>(work: () => T): T {
    this.runCount += 1;
    return work();
  }
}

// --- Fixture IDs ---
const TASK_A = "01JZZZZZZZZZZZZZZZZZZTSKA0";
const TASK_B = "01JZZZZZZZZZZZZZZZZZZTSKB0";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ0";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";

function buildDeps(kinds: Record<string, Exclude<KindResult, undefined>>) {
  const resolver = new FakeReferenceResolver(kinds);
  const taskRepo = new FakeTaskRepository();
  const initiativeRepo = new FakeInitiativeRepository();
  const events = new FakeEventFeed();
  const transactor = new FakeTransactor();
  initiativeRepo.save({
    id: INIT_ID,
    projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
    name: "oauth",
  });
  initiativeRepo.saveObjective({
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
  });
  return { resolver, taskRepo, initiativeRepo, events, transactor };
}

describe("AddDependency", () => {
  test("AddDependency valid edge persists and emits task.dependencies_changed event", async () => {
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [TASK_B]: "task",
      });
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [],
    });
    taskRepo.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const uc = new AddDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    await uc.execute({ taskId: TASK_A, dependencyId: TASK_B });

    assert.equal(taskRepo.addedEdges.length, 1, "addDependency called once");
    assert.deepEqual(taskRepo.addedEdges[0], {
      taskId: TASK_A,
      dependencyId: TASK_B,
    });
    assert.equal(events.events.length, 1, "one event emitted");
    assert.equal(events.events[0]?.type, "task.dependencies_changed");
    assert.equal(events.events[0]?.taskId, TASK_A);
    assert.equal(
      transactor.runCount,
      1,
      "edge + event committed in one transaction",
    );
  });

  test("AddDependency cycle-closing edge throws CycleError, nothing persisted, no event", async () => {
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [TASK_B]: "task",
      });
    // A depends on B; adding B depends on A would close a cycle
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [TASK_B],
    });
    taskRepo.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const uc = new AddDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    await assert.rejects(
      () => uc.execute({ taskId: TASK_B, dependencyId: TASK_A }),
      (err: unknown) => {
        assert.ok(err instanceof CycleError, "throws CycleError");
        return true;
      },
    );
    assert.equal(taskRepo.addedEdges.length, 0, "addDependency not called");
    assert.equal(events.events.length, 0, "no event emitted");
  });

  test("AddDependency non-task dependencyId id throws WrongTypeReferenceError", async () => {
    const OBJ_REF = "01JZZZZZZZZZZZZZZZZZZZOBJ9";
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [OBJ_REF]: "objective",
      });
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [],
    });

    const uc = new AddDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    await assert.rejects(
      () => uc.execute({ taskId: TASK_A, dependencyId: OBJ_REF }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal(err.expected, "task");
        return true;
      },
    );
  });

  test("AddDependency completed task throws DependenciesLockedError", async () => {
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [TASK_B]: "task",
      });
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "completed",
      dependencies: [],
    });
    taskRepo.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const uc = new AddDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    await assert.rejects(
      () => uc.execute({ taskId: TASK_A, dependencyId: TASK_B }),
      (err: unknown) => {
        assert.ok(err instanceof DependenciesLockedError);
        return true;
      },
    );
  });
});

describe("RemoveDependency", () => {
  test("RemoveDependency non-existent edge is no-op success with no event", async () => {
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [TASK_B]: "task",
      });
    // Task A does not depend on Task B
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "pending",
      dependencies: [],
    });
    taskRepo.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const uc = new RemoveDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    // Should succeed without throwing
    await uc.execute({ taskId: TASK_A, dependencyId: TASK_B });

    assert.equal(events.events.length, 0, "no event for no-op removal");
  });

  test("RemoveDependency non-existent edge on a non-pending task is still a no-op success", async () => {
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [TASK_B]: "task",
      });
    // Completed task, and it does not depend on TASK_B — removing that
    // absent edge changes nothing, so it must succeed (idempotent), NOT
    // raise DependenciesLockedError.
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "completed",
      dependencies: [],
    });
    taskRepo.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const uc = new RemoveDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    await uc.execute({ taskId: TASK_A, dependencyId: TASK_B });

    assert.equal(taskRepo.removedEdges.length, 0, "no edge removed");
    assert.equal(events.events.length, 0, "no event for no-op removal");
    assert.equal(transactor.runCount, 0, "no transaction opened for a no-op");
  });

  test("RemoveDependency of an existing edge on a non-pending task throws DependenciesLockedError", async () => {
    const { resolver, taskRepo, initiativeRepo, events, transactor } =
      buildDeps({
        [TASK_A]: "task",
        [TASK_B]: "task",
      });
    // Completed task that DOES depend on TASK_B — removing the real edge is a
    // genuine mutation and must be rejected on a locked task.
    taskRepo.save({
      id: TASK_A,
      objectiveId: OBJ_ID,
      title: "A",
      status: "completed",
      dependencies: [TASK_B],
    });
    taskRepo.save({
      id: TASK_B,
      objectiveId: OBJ_ID,
      title: "B",
      status: "pending",
      dependencies: [],
    });

    const uc = new RemoveDependency(
      taskRepo,
      initiativeRepo,
      resolver,
      events,
      transactor,
    );
    await assert.rejects(
      () => uc.execute({ taskId: TASK_A, dependencyId: TASK_B }),
      (err: unknown) => {
        assert.ok(err instanceof DependenciesLockedError);
        return true;
      },
    );
    assert.equal(taskRepo.removedEdges.length, 0, "nothing removed on reject");
    assert.equal(events.events.length, 0, "no event on reject");
  });
});
