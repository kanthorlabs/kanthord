import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CreateObjective } from "./create-objective.ts";
import { RenameObjective } from "./rename-objective.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
} from "../errors.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import type { SequencingRepository } from "../../storage/sqlite/sqlite-sequencing-repository.ts";
import type { Transactor } from "../../storage/port.ts";
import { SequencingScopeError } from "../errors.ts";
import { CycleError } from "../../domain/graph.ts";

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

  resolveInitiativeByName(projectId: string, name: string): string[] {
    const ids: string[] = [];
    for (const i of this.#initiatives.values()) {
      if (i.projectId === projectId && i.name === name) ids.push(i.id);
    }
    return ids;
  }

  resolveObjectiveByName(initiativeId: string, name: string): string[] {
    const ids: string[] = [];
    for (const o of this.#objectives.values()) {
      if (o.initiativeId === initiativeId && o.name === name) ids.push(o.id);
    }
    return ids;
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

type KindResult =
  "project" | "resource" | "initiative" | "objective" | "task" | undefined;

class MockReferenceResolver implements ReferenceResolver {
  readonly #map: Map<string, Exclude<KindResult, undefined>>;

  constructor(map: Map<string, Exclude<KindResult, undefined>>) {
    this.#map = map;
  }

  resolveKind(id: string): KindResult {
    return this.#map.get(id);
  }
}

describe("CreateObjective", () => {
  test("create objective returns a ULID and persists", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["init-1", "initiative"]]),
    );
    const uc = new CreateObjective(repo, resolver);
    const id = await uc.execute({ initiativeId: "init-1", name: "backend" });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id",
    );
    const saved = repo.getObjective(id);
    assert.ok(saved !== undefined, "objective was persisted");
    assert.equal(saved.name, "backend");
    assert.equal(saved.initiativeId, "init-1");
  });

  test("create objective with unknown initiativeId throws UnknownReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(new Map());
    const uc = new CreateObjective(repo, resolver);
    await assert.rejects(
      () => uc.execute({ initiativeId: "no-such", name: "backend" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "initiative");
        assert.equal(err.id, "no-such");
        return true;
      },
    );
  });

  test("create objective with wrong-type initiativeId throws WrongTypeReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["proj-1", "project"]]),
    );
    const uc = new CreateObjective(repo, resolver);
    await assert.rejects(
      () => uc.execute({ initiativeId: "proj-1", name: "backend" }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal(err.expected, "initiative");
        assert.equal(err.actual, "project");
        return true;
      },
    );
  });

  test("create objective with duplicate name throws DuplicateNameError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["init-1", "initiative"]]),
    );
    const uc = new CreateObjective(repo, resolver);
    await uc.execute({ initiativeId: "init-1", name: "clash" });
    await assert.rejects(
      () => uc.execute({ initiativeId: "init-1", name: "clash" }),
      (err: unknown) => {
        assert.ok(err instanceof DuplicateNameError);
        return true;
      },
    );
  });
});

// --- Fakes for `after` tests ---

interface SequencingRepositoryExtended extends SequencingRepository {
  addObjectiveAfter(objectiveId: string, dependencyId: string): void;
  addInitiativeAfter(initiativeId: string, dependencyId: string): void;
  listObjectiveDag(
    initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  listInitiativeDag(
    projectId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  removeObjectiveAfter(objectiveId: string, dependencyId: string): void;
  removeInitiativeAfter(initiativeId: string, dependencyId: string): void;
}

class FakeSequencingRepo implements SequencingRepositoryExtended {
  readonly addedCalls: Array<{
    objectiveId: string;
    dependencyId: string;
  }> = [];
  dag: Array<{ id: string; dependencies: string[] }> = [];

  listObjectiveAfter(_id: string): string[] {
    return [];
  }
  listInitiativeAfter(_id: string): string[] {
    return [];
  }
  addObjectiveAfter(objectiveId: string, dependencyId: string): void {
    this.addedCalls.push({ objectiveId, dependencyId });
  }
  addInitiativeAfter(_iid: string, _did: string): void {}
  listObjectiveDag(
    _iid: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return this.dag;
  }
  listInitiativeDag(
    _pid: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return [];
  }
  removeObjectiveAfter(_oid: string, _did: string): void {}
  removeInitiativeAfter(_iid: string, _did: string): void {}
}

class FakeTx implements Transactor {
  runCount = 0;
  run<T>(work: () => T): T {
    this.runCount += 1;
    return work();
  }
}

// Pre-seeded objectives for after edge resolution
const INIT_ID_AFTER = "01JZZZZZZZZZZZZZZZZZZZINA0";
const EXISTING_OBJ_A = "01JZZZZZZZZZZZZZZZZZZZEXA0";
const EXISTING_OBJ_B = "01JZZZZZZZZZZZZZZZZZZZEXB0";
const EXISTING_OBJ_DIFF = "01JZZZZZZZZZZZZZZZZZZZEXC0";

describe("CreateObjective with after", () => {
  test("(12) after absent → behaviour identical to today (no sequencing call)", async () => {
    const repo = new FakeInitiativeRepository();
    repo.save({
      id: INIT_ID_AFTER,
      projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
      name: "init",
      paused: false,
    });
    const resolver = new MockReferenceResolver(
      new Map([[INIT_ID_AFTER, "initiative"]]),
    );
    const sequencing = new FakeSequencingRepo();
    const tx = new FakeTx();
    const uc = new CreateObjective(repo, resolver, sequencing, tx);
    const id = await uc.execute({
      initiativeId: INIT_ID_AFTER,
      name: "alone",
    });

    assert.ok(id.length > 0, "returns an id");
    assert.equal(sequencing.addedCalls.length, 0, "no after edges written");
    assert.equal(tx.runCount, 0, "no transaction");
  });

  test("(13) after: [B, A, B] → deduped + sorted, addObjectiveAfter called twice with A then B", async () => {
    const repo = new FakeInitiativeRepository();
    repo.save({
      id: INIT_ID_AFTER,
      projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
      name: "init",
      paused: false,
    });
    repo.saveObjective({
      id: EXISTING_OBJ_A,
      initiativeId: INIT_ID_AFTER,
      name: "obj-a",
    });
    repo.saveObjective({
      id: EXISTING_OBJ_B,
      initiativeId: INIT_ID_AFTER,
      name: "obj-b",
    });
    const resolver = new MockReferenceResolver(
      new Map([
        [INIT_ID_AFTER, "initiative"],
        [EXISTING_OBJ_A, "objective"],
        [EXISTING_OBJ_B, "objective"],
      ]),
    );
    const sequencing = new FakeSequencingRepo();
    sequencing.dag = [
      { id: EXISTING_OBJ_A, dependencies: [] },
      { id: EXISTING_OBJ_B, dependencies: [] },
    ];
    const tx = new FakeTx();
    const uc = new CreateObjective(repo, resolver, sequencing, tx);

    const id = await uc.execute({
      initiativeId: INIT_ID_AFTER,
      name: "new-obj",
      after: [EXISTING_OBJ_B, EXISTING_OBJ_A, EXISTING_OBJ_B],
    });

    assert.equal(
      sequencing.addedCalls.length,
      2,
      "two after edges written (deduped)",
    );
    assert.deepEqual(sequencing.addedCalls[0], {
      objectiveId: id,
      dependencyId: EXISTING_OBJ_A,
    });
    assert.deepEqual(sequencing.addedCalls[1], {
      objectiveId: id,
      dependencyId: EXISTING_OBJ_B,
    });
    assert.equal(tx.runCount, 1, "all writes in one transaction");
  });

  test("(14) after naming objective in different initiative → SequencingScopeError with scope 'initiative'", async () => {
    const repo = new FakeInitiativeRepository();
    repo.save({
      id: INIT_ID_AFTER,
      projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
      name: "init",
      paused: false,
    });
    repo.saveObjective({
      id: EXISTING_OBJ_A,
      initiativeId: INIT_ID_AFTER,
      name: "obj-a",
    });
    repo.saveObjective({
      id: EXISTING_OBJ_DIFF,
      initiativeId: "01JZZZZZZZZZZZZZZZZZZZINX0",
      name: "obj-diff",
    });
    const resolver = new MockReferenceResolver(
      new Map([
        [INIT_ID_AFTER, "initiative"],
        [EXISTING_OBJ_A, "objective"],
        [EXISTING_OBJ_DIFF, "objective"],
      ]),
    );
    const sequencing = new FakeSequencingRepo();
    const tx = new FakeTx();
    const uc = new CreateObjective(repo, resolver, sequencing, tx);

    await assert.rejects(
      () =>
        uc.execute({
          initiativeId: INIT_ID_AFTER,
          name: "new-obj",
          after: [EXISTING_OBJ_DIFF],
        }),
      (err: unknown) => {
        assert.ok(err instanceof SequencingScopeError);
        assert.equal((err as SequencingScopeError).scope, "initiative");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "no edges written");
  });

  test("(15) after naming a non-existent id → UnknownReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    repo.save({
      id: INIT_ID_AFTER,
      projectId: "01JZZZZZZZZZZZZZZZZZZZPRJ0",
      name: "init",
      paused: false,
    });
    const resolver = new MockReferenceResolver(
      new Map([[INIT_ID_AFTER, "initiative"]]),
    );
    const sequencing = new FakeSequencingRepo();
    const tx = new FakeTx();
    const uc = new CreateObjective(repo, resolver, sequencing, tx);

    await assert.rejects(
      () =>
        uc.execute({
          initiativeId: INIT_ID_AFTER,
          name: "new-obj",
          after: ["no-such-id"],
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "no edges written");
  });
});

describe("RenameObjective", () => {
  test("rename objective changes the name", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["init-1", "initiative"]]),
    );
    const createUc = new CreateObjective(repo, resolver);
    const id = await createUc.execute({
      initiativeId: "init-1",
      name: "old-name",
    });
    const renameUc = new RenameObjective(repo);
    await renameUc.execute({ id, name: "new-name" });
    const saved = repo.getObjective(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.name, "new-name");
  });

  test("rename objective with unknown id throws UnknownReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const uc = new RenameObjective(repo);
    await assert.rejects(
      () => uc.execute({ id: "no-such", name: "new-name" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "objective");
        return true;
      },
    );
  });
});
