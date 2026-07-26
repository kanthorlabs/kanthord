import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AddObjectiveDependency } from "./add-objective-dependency.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { SequencingRepository } from "../../storage/sqlite/sqlite-sequencing-repository.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import { CycleError } from "../../domain/graph.ts";
import {
  SequencingLockedError,
  SequencingScopeError,
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../errors.ts";

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

interface SequencingRepositoryExtended extends SequencingRepository {
  addInitiativeAfter(initiativeId: string, dependencyId: string): void;
  removeInitiativeAfter(initiativeId: string, dependencyId: string): void;
  listInitiativeDag(
    projectId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  listObjectiveDag(
    initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  addObjectiveAfter(objectiveId: string, dependencyId: string): void;
  removeObjectiveAfter(objectiveId: string, dependencyId: string): void;
}

class FakeSequencingRepository implements SequencingRepositoryExtended {
  readonly afterEdges: Map<string, string[]> = new Map();
  readonly addedCalls: Array<{
    objectiveId: string;
    dependencyId: string;
  }> = [];
  readonly removedCalls: Array<{
    objectiveId: string;
    dependencyId: string;
  }> = [];
  dag: Array<{ id: string; dependencies: string[] }> = [];

  listInitiativeAfter(_initiativeId: string): string[] {
    return [];
  }

  listObjectiveAfter(objectiveId: string): string[] {
    return this.afterEdges.get(objectiveId) ?? [];
  }

  addObjectiveAfter(objectiveId: string, dependencyId: string): void {
    this.addedCalls.push({ objectiveId, dependencyId });
    const current = this.afterEdges.get(objectiveId) ?? [];
    this.afterEdges.set(objectiveId, [...current, dependencyId]);
  }

  removeObjectiveAfter(objectiveId: string, dependencyId: string): void {
    this.removedCalls.push({ objectiveId, dependencyId });
  }

  listObjectiveDag(
    _initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return this.dag;
  }

  listInitiativeDag(
    _projectId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return [];
  }

  addInitiativeAfter(_initiativeId: string, _dependencyId: string): void {}
  removeInitiativeAfter(_initiativeId: string, _dependencyId: string): void {}
}

class FakeTaskSource {
  readonly #tasks: Map<string, Task> = new Map();

  listTasksByObjective(objectiveId: string): Task[] {
    return [...this.#tasks.values()].filter(
      (t) => t.objectiveId === objectiveId,
    );
  }

  save(task: Task): void {
    this.#tasks.set(task.id, { ...task, dependencies: [...task.dependencies] });
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

  listObjectives(initiativeId: string): Objective[] {
    return [...this.#objectives.values()].filter(
      (o) => o.initiativeId === initiativeId,
    );
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

class FakeTransactor implements Transactor {
  runCount = 0;
  run<T>(work: () => T): T {
    this.runCount += 1;
    return work();
  }
}

// --- Fixture IDs ---

const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINI0";
const OBJ_A = "01JZZZZZZZZZZZZZZZZZZZOBA0";
const OBJ_B = "01JZZZZZZZZZZZZZZZZZZZOBB0";
const OBJ_C = "01JZZZZZZZZZZZZZZZZZZZOBC0";
const OBJ_DIFF = "01JZZZZZZZZZZZZZZZZZZZOBD0"; // different initiative
const TASK_RUN = "01JZZZZZZZZZZZZZZZZZZZTRU0";
const TASK_CMP = "01JZZZZZZZZZZZZZZZZZZZTCM0";
const TASK_PA = "01JZZZZZZZZZZZZZZZZZZZTPA0";

function buildObjectives(repo: FakeInitiativeRepository): void {
  repo.save({
    id: INIT_ID,
    projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
    name: "init",
  });
  repo.saveObjective({ id: OBJ_A, initiativeId: INIT_ID, name: "obj-a" });
  repo.saveObjective({ id: OBJ_B, initiativeId: INIT_ID, name: "obj-b" });
  repo.saveObjective({ id: OBJ_C, initiativeId: INIT_ID, name: "obj-c" });
  // Different initiative
  repo.saveObjective({
    id: OBJ_DIFF,
    initiativeId: "01JZZZZZZZZZZZZZZZZZZZINX0",
    name: "obj-diff",
  });
}

function buildDeps(kinds: Record<string, Exclude<KindResult, undefined>>) {
  const resolver = new FakeReferenceResolver(kinds);
  const initiatives = new FakeInitiativeRepository();
  const tasks = new FakeTaskSource();
  const sequencing = new FakeSequencingRepository();
  const tx = new FakeTransactor();
  buildObjectives(initiatives);
  return { resolver, initiatives, tasks, sequencing, tx };
}

describe("AddObjectiveDependency", () => {
  test("(1) happy path: two building objectives → addObjectiveAfter called once inside tx.run", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "objective",
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A });

    assert.equal(
      sequencing.addedCalls.length,
      1,
      "addObjectiveAfter called once",
    );
    assert.deepEqual(sequencing.addedCalls[0], {
      objectiveId: OBJ_B,
      dependencyId: OBJ_A,
    });
    assert.equal(tx.runCount, 1, "write happened inside tx.run");
  });

  test("(2) resolveKind returns undefined → UnknownReferenceError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(2b) wrong kind → WrongTypeReferenceError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "task",
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal((err as WrongTypeReferenceError).expected, "objective");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(3) different initiative → SequencingScopeError with scope 'initiative'", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_DIFF]: "objective",
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_DIFF, dependencyId: OBJ_A }),
      (err: unknown) => {
        assert.ok(err instanceof SequencingScopeError);
        assert.equal((err as SequencingScopeError).scope, "initiative");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(4) self-edge → CycleError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_A, dependencyId: OBJ_A }),
      (err: unknown) => {
        assert.ok(err instanceof CycleError);
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(5) edge already present → resolves without calling addObjectiveAfter", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "objective",
    });
    sequencing.addObjectiveAfter(OBJ_B, OBJ_A);
    tasks.save({
      id: TASK_RUN,
      objectiveId: OBJ_B,
      title: "running",
      status: "running",
      dependencies: [],
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A });

    assert.equal(
      sequencing.addedCalls.length,
      1,
      "no additional call from the add operation",
    );
  });

  test("(6) retroactive refusal: dependent has running and completed tasks → SequencingLockedError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "objective",
    });
    tasks.save({
      id: TASK_RUN,
      objectiveId: OBJ_B,
      title: "running",
      status: "running",
      dependencies: [],
    });
    tasks.save({
      id: TASK_CMP,
      objectiveId: OBJ_B,
      title: "completed",
      status: "completed",
      dependencies: [],
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A }),
      (err: unknown) => {
        assert.ok(err instanceof SequencingLockedError);
        assert.ok(
          (err as SequencingLockedError).message.includes(
            "has already started",
          ),
        );
        assert.ok(
          (err as SequencingLockedError).message.includes(
            "ordering can no longer be guaranteed",
          ),
        );
        assert.deepEqual(
          (err as SequencingLockedError).startedTaskIds,
          [TASK_CMP, TASK_RUN].sort(),
        );
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(7) pending-only task list does not trip retroactive gate", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "objective",
    });
    tasks.save({
      id: TASK_PA,
      objectiveId: OBJ_B,
      title: "pending",
      status: "pending",
      dependencies: [],
    });

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A });

    assert.equal(sequencing.addedCalls.length, 1, "edge was written");
  });

  test("(8) cycle refusal: DAG has O_A after O_B, adding O_B after O_A → CycleError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "objective",
    });
    // Seed DAG: OBJ_A already depends on OBJ_B
    sequencing.dag = [
      { id: OBJ_B, dependencies: [] },
      { id: OBJ_A, dependencies: [OBJ_B] },
    ];

    const uc = new AddObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A }),
      (err: unknown) => {
        assert.ok(err instanceof CycleError);
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });
});
