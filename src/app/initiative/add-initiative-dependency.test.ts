import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { AddInitiativeDependency } from "./add-initiative-dependency.ts";
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

/** Extended sequencing interface for the use case's additional methods. */
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
    initiativeId: string;
    dependencyId: string;
  }> = [];
  readonly removedCalls: Array<{
    initiativeId: string;
    dependencyId: string;
  }> = [];
  /** The DAG returned by listInitiativeDag, seeded by the test. */
  dag: Array<{ id: string; dependencies: string[] }> = [];

  listInitiativeAfter(initiativeId: string): string[] {
    return this.afterEdges.get(initiativeId) ?? [];
  }

  listObjectiveAfter(_objectiveId: string): string[] {
    return [];
  }

  addInitiativeAfter(initiativeId: string, dependencyId: string): void {
    this.addedCalls.push({ initiativeId, dependencyId });
    const current = this.afterEdges.get(initiativeId) ?? [];
    this.afterEdges.set(initiativeId, [...current, dependencyId]);
  }

  removeInitiativeAfter(initiativeId: string, dependencyId: string): void {
    this.removedCalls.push({ initiativeId, dependencyId });
  }

  listInitiativeDag(
    _projectId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return this.dag;
  }

  listObjectiveDag(
    _initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return [];
  }

  addObjectiveAfter(_objectiveId: string, _dependencyId: string): void {}

  removeObjectiveAfter(_objectiveId: string, _dependencyId: string): void {}
}

class FakeTaskSource {
  readonly #tasks: Map<string, Task> = new Map();

  listByInitiative(_initiativeId: string): Task[] {
    return [...this.#tasks.values()];
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
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

const PROJ_ID = "01JZZZZZZZZZZZZZZZZZZZPRJ0";
const INIT_A = "01JZZZZZZZZZZZZZZZZZZZINA0";
const INIT_B = "01JZZZZZZZZZZZZZZZZZZZINB0";
const INIT_C = "01JZZZZZZZZZZZZZZZZZZZINC0";
const INIT_DIFF = "01JZZZZZZZZZZZZZZZZZZZIND0"; // different project
const TASK_PA = "01JZZZZZZZZZZZZZZZZZZZTPA0";
const TASK_RUN = "01JZZZZZZZZZZZZZZZZZZZTRU0";
const TASK_CMP = "01JZZZZZZZZZZZZZZZZZZZTCM0";

function buildInitiatives(repo: FakeInitiativeRepository): void {
  repo.save({
    id: INIT_A,
    projectId: PROJ_ID,
    name: "init-a",
    paused: false,
  });
  repo.save({
    id: INIT_B,
    projectId: PROJ_ID,
    name: "init-b",
    paused: false,
  });
  repo.save({
    id: INIT_C,
    projectId: PROJ_ID,
    name: "init-c",
    paused: false,
  });
  // Different project
  repo.save({
    id: INIT_DIFF,
    projectId: "01JZZZZZZZZZZZZZZZZZZZPRX0",
    name: "init-diff",
    paused: false,
  });
}

function buildDeps(kinds: Record<string, Exclude<KindResult, undefined>>) {
  const resolver = new FakeReferenceResolver(kinds);
  const initiatives = new FakeInitiativeRepository();
  const tasks = new FakeTaskSource();
  const sequencing = new FakeSequencingRepository();
  const tx = new FakeTransactor();
  buildInitiatives(initiatives);
  return { resolver, initiatives, tasks, sequencing, tx };
}

describe("AddInitiativeDependency", () => {
  test("(1) happy path: both initiatives building → addInitiativeAfter called once inside tx.run, no event appended", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A });

    assert.equal(
      sequencing.addedCalls.length,
      1,
      "addInitiativeAfter called once",
    );
    assert.deepEqual(sequencing.addedCalls[0], {
      initiativeId: INIT_B,
      dependencyId: INIT_A,
    });
    assert.equal(tx.runCount, 1, "write happened inside tx.run");
  });

  test("(2) resolveKind returns undefined → UnknownReferenceError for initiativeId", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      // INIT_B not in resolver
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal((err as UnknownReferenceError).kind, "initiative");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(2b) resolveKind returns wrong type → WrongTypeReferenceError for dependencyId", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "task", // NOT initiative
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal((err as WrongTypeReferenceError).expected, "initiative");
        assert.equal((err as WrongTypeReferenceError).actual, "task");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(3) different projectId → SequencingScopeError with scope 'project'", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_DIFF]: "initiative",
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ initiativeId: INIT_DIFF, dependencyId: INIT_A }),
      (err: unknown) => {
        assert.ok(err instanceof SequencingScopeError);
        assert.equal((err as SequencingScopeError).scope, "project");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(4) self-edge → CycleError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ initiativeId: INIT_A, dependencyId: INIT_A }),
      (err: unknown) => {
        assert.ok(err instanceof CycleError);
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });

  test("(5) edge already present → resolves without calling addInitiativeAfter, no retroactive gate consulted", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });
    // Seed the edge
    sequencing.addInitiativeAfter(INIT_B, INIT_A);
    // Have a running task — should NOT throw for a no-op
    tasks.save({
      id: TASK_RUN,
      objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ0",
      title: "running",
      status: "running",
      dependencies: [],
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A });

    // addInitiativeAfter not called again (no-op)
    assert.equal(
      sequencing.addedCalls.length,
      1,
      "addInitiativeAfter still called once from seed, not again",
    );
    assert.equal(
      sequencing.addedCalls[0]!.initiativeId,
      INIT_B,
      "only the seeded call",
    );
  });

  test("(6) retroactive refusal: dependent has running and completed tasks → SequencingLockedError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });
    tasks.save({
      id: TASK_RUN,
      objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ0",
      title: "running",
      status: "running",
      dependencies: [],
    });
    tasks.save({
      id: TASK_CMP,
      objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ1",
      title: "completed",
      status: "completed",
      dependencies: [],
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await assert.rejects(
      () => uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A }),
      (err: unknown) => {
        assert.ok(err instanceof SequencingLockedError);
        assert.equal((err as SequencingLockedError).nodeId, INIT_B);
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
        // startedTaskIds sorted ascending
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
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });
    tasks.save({
      id: TASK_PA,
      objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ0",
      title: "pending-a",
      status: "pending",
      dependencies: [],
    });

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A });

    assert.equal(sequencing.addedCalls.length, 1, "edge was written");
  });

  test("(8) cycle refusal: DAG has A after B, adding B after A → CycleError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });
    // Seed DAG: A already depends on B
    sequencing.dag = [
      { id: INIT_B, dependencies: [] },
      { id: INIT_A, dependencies: [INIT_B] },
    ];

    const uc = new AddInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    // Trying to make B depend on A closes the cycle
    await assert.rejects(
      () => uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A }),
      (err: unknown) => {
        assert.ok(err instanceof CycleError);
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "nothing written");
  });
});
