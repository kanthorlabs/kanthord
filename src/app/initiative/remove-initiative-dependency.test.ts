import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { RemoveInitiativeDependency } from "./remove-initiative-dependency.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
  Transactor,
} from "../../storage/port.ts";
import type { SequencingRepository } from "../../storage/sqlite/sqlite-sequencing-repository.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { Task } from "../../domain/task.ts";
import { SequencingLockedError, SequencingScopeError } from "../errors.ts";

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
    initiativeId: string;
    dependencyId: string;
  }> = [];
  readonly removedCalls: Array<{
    initiativeId: string;
    dependencyId: string;
  }> = [];
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
    const current = this.afterEdges.get(initiativeId) ?? [];
    this.afterEdges.set(
      initiativeId,
      current.filter((d) => d !== dependencyId),
    );
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
const INIT_DIFF = "01JZZZZZZZZZZZZZZZZZZZIND0";
const TASK_RUN = "01JZZZZZZZZZZZZZZZZZZZTRU0";

function buildInitiatives(repo: FakeInitiativeRepository): void {
  repo.save({ id: INIT_A, projectId: PROJ_ID, name: "init-a" });
  repo.save({ id: INIT_B, projectId: PROJ_ID, name: "init-b" });
  repo.save({
    id: INIT_DIFF,
    projectId: "01JZZZZZZZZZZZZZZZZZZZPRX0",
    name: "init-diff",
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

describe("RemoveInitiativeDependency", () => {
  test("(9) removing existing edge on pending initiative calls removeInitiativeAfter once inside tx.run", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });
    // Seed the edge
    sequencing.addInitiativeAfter(INIT_B, INIT_A);

    const uc = new RemoveInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A });

    assert.equal(
      sequencing.removedCalls.length,
      1,
      "removeInitiativeAfter called once",
    );
    assert.deepEqual(sequencing.removedCalls[0], {
      initiativeId: INIT_B,
      dependencyId: INIT_A,
    });
    assert.equal(tx.runCount, 1, "removal inside tx.run");
  });

  test("(10) removing absent edge resolves without write, even when a task is running", async () => {
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

    const uc = new RemoveInitiativeDependency(
      initiatives,
      tasks,
      sequencing,
      resolver,
      tx,
    );
    await uc.execute({ initiativeId: INIT_B, dependencyId: INIT_A });

    assert.equal(
      sequencing.removedCalls.length,
      0,
      "removeInitiativeAfter not called",
    );
    assert.equal(tx.runCount, 0, "no transaction for no-op");
  });

  test("(11) removing existing edge when a task is running → SequencingLockedError", async () => {
    const { resolver, initiatives, tasks, sequencing, tx } = buildDeps({
      [INIT_A]: "initiative",
      [INIT_B]: "initiative",
    });
    sequencing.addInitiativeAfter(INIT_B, INIT_A);
    tasks.save({
      id: TASK_RUN,
      objectiveId: "01JZZZZZZZZZZZZZZZZZZZOBJ0",
      title: "running",
      status: "running",
      dependencies: [],
    });

    const uc = new RemoveInitiativeDependency(
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
        return true;
      },
    );
    assert.equal(sequencing.removedCalls.length, 0, "nothing removed");
  });
});
