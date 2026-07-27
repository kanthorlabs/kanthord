import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RemoveObjectiveDependency } from "./remove-objective-dependency.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { SequencingRepository } from "../../storage/sqlite/sqlite-sequencing-repository.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import { SequencingLockedError } from "../errors.ts";

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
  addObjectiveAfter(objectiveId: string, dependencyId: string): void;
  removeObjectiveAfter(objectiveId: string, dependencyId: string): void;
  listObjectiveDag(
    initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  addInitiativeAfter(initiativeId: string, dependencyId: string): void;
  removeInitiativeAfter(initiativeId: string, dependencyId: string): void;
  listInitiativeDag(
    projectId: string,
  ): Array<{ id: string; dependencies: string[] }>;
}

class FakeSequencingRepository implements SequencingRepositoryExtended {
  readonly afterEdges: Map<string, string[]> = new Map();
  readonly removedCalls: Array<{
    objectiveId: string;
    dependencyId: string;
  }> = [];

  listObjectiveAfter(objectiveId: string): string[] {
    return this.afterEdges.get(objectiveId) ?? [];
  }

  removeObjectiveAfter(objectiveId: string, dependencyId: string): void {
    this.removedCalls.push({ objectiveId, dependencyId });
    const current = this.afterEdges.get(objectiveId) ?? [];
    this.afterEdges.set(
      objectiveId,
      current.filter((d) => d !== dependencyId),
    );
  }

  listObjectiveDag(
    _initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return [];
  }

  listInitiativeAfter(_initiativeId: string): string[] {
    return [];
  }
  addObjectiveAfter(objectiveId: string, dependencyId: string): void {
    const current = this.afterEdges.get(objectiveId) ?? [];
    this.afterEdges.set(objectiveId, [...current, dependencyId]);
  }
  addInitiativeAfter(_initiativeId: string, _dependencyId: string): void {}
  removeInitiativeAfter(_initiativeId: string, _dependencyId: string): void {}
  listInitiativeDag(
    _projectId: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return [];
  }
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
const TASK_RUN = "01JZZZZZZZZZZZZZZZZZZZTRU0";

function buildObjectives(repo: FakeInitiativeRepository): void {
  repo.save({
    id: INIT_ID,
    projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
    name: "init",
    paused: false,
  });
  repo.saveObjective({ id: OBJ_A, initiativeId: INIT_ID, name: "obj-a" });
  repo.saveObjective({ id: OBJ_B, initiativeId: INIT_ID, name: "obj-b" });
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

describe("RemoveObjectiveDependency", () => {
  test("(9) removing existing edge on pending objective calls removeObjectiveAfter once inside tx.run", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [OBJ_A]: "objective",
      [OBJ_B]: "objective",
    });
    sequencing.addObjectiveAfter(OBJ_B, OBJ_A);

    const uc = new RemoveObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A });

    assert.equal(
      sequencing.removedCalls.length,
      1,
      "removeObjectiveAfter called once",
    );
    assert.deepEqual(sequencing.removedCalls[0], {
      objectiveId: OBJ_B,
      dependencyId: OBJ_A,
    });
    assert.equal(tx.runCount, 1, "removal inside tx.run");
  });

  test("(10) removing absent edge resolves without write, even when a task is running", async () => {
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

    const uc = new RemoveObjectiveDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ objectiveId: OBJ_B, dependencyId: OBJ_A });

    assert.equal(
      sequencing.removedCalls.length,
      0,
      "removeObjectiveAfter not called",
    );
    assert.equal(tx.runCount, 0, "no transaction for no-op");
  });

  test("(11) removing existing edge when a task is running → SequencingLockedError", async () => {
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

    const uc = new RemoveObjectiveDependency(
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
        assert.equal((err as SequencingLockedError).nodeId, OBJ_B);
        return true;
      },
    );
    assert.equal(sequencing.removedCalls.length, 0, "nothing removed");
  });
});
