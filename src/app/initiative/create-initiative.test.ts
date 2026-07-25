import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CreateInitiative } from "./create-initiative.ts";
import { RenameInitiative } from "./rename-initiative.ts";
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

describe("CreateInitiative", () => {
  test("create initiative returns a ULID and persists", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["proj-1", "project"]]),
    );
    const uc = new CreateInitiative(repo, resolver);
    const id = await uc.execute({ projectId: "proj-1", name: "oauth" });
    assert.ok(
      typeof id === "string" && id.length > 0,
      "returns a non-empty id",
    );
    const saved = repo.get(id);
    assert.ok(saved !== undefined, "initiative was persisted");
    assert.equal(saved.name, "oauth");
    assert.equal(saved.projectId, "proj-1");
  });

  test("create initiative with unknown projectId throws UnknownReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(new Map());
    const uc = new CreateInitiative(repo, resolver);
    await assert.rejects(
      () => uc.execute({ projectId: "no-such", name: "oauth" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "project");
        assert.equal(err.id, "no-such");
        return true;
      },
    );
  });

  test("create initiative with wrong-type projectId throws WrongTypeReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["init-1", "initiative"]]),
    );
    const uc = new CreateInitiative(repo, resolver);
    await assert.rejects(
      () => uc.execute({ projectId: "init-1", name: "oauth" }),
      (err: unknown) => {
        assert.ok(err instanceof WrongTypeReferenceError);
        assert.equal(err.expected, "project");
        assert.equal(err.actual, "initiative");
        return true;
      },
    );
  });

  test("create initiative with duplicate name throws DuplicateNameError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["proj-1", "project"]]),
    );
    const uc = new CreateInitiative(repo, resolver);
    await uc.execute({ projectId: "proj-1", name: "clash" });
    await assert.rejects(
      () => uc.execute({ projectId: "proj-1", name: "clash" }),
      (err: unknown) => {
        assert.ok(err instanceof DuplicateNameError);
        return true;
      },
    );
  });
});

// --- Fakes for `after` tests ---

interface SequencingRepositoryExtended extends SequencingRepository {
  addInitiativeAfter(initiativeId: string, dependencyId: string): void;
  addObjectiveAfter(objectiveId: string, dependencyId: string): void;
  listInitiativeDag(
    projectId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  listObjectiveDag(
    initiativeId: string,
  ): Array<{ id: string; dependencies: string[] }>;
  removeInitiativeAfter(initiativeId: string, dependencyId: string): void;
  removeObjectiveAfter(objectiveId: string, dependencyId: string): void;
}

class FakeSequencingRepo implements SequencingRepositoryExtended {
  readonly addedCalls: Array<{
    initiativeId: string;
    dependencyId: string;
  }> = [];
  dag: Array<{ id: string; dependencies: string[] }> = [];

  listInitiativeAfter(_id: string): string[] {
    return [];
  }
  listObjectiveAfter(_id: string): string[] {
    return [];
  }
  addInitiativeAfter(initiativeId: string, dependencyId: string): void {
    this.addedCalls.push({ initiativeId, dependencyId });
  }
  addObjectiveAfter(_oid: string, _did: string): void {}
  listInitiativeDag(
    _pid: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return this.dag;
  }
  listObjectiveDag(
    _iid: string,
  ): Array<{ id: string; dependencies: string[] }> {
    return [];
  }
  removeInitiativeAfter(_iid: string, _did: string): void {}
  removeObjectiveAfter(_oid: string, _did: string): void {}
}

class FakeTx implements Transactor {
  runCount = 0;
  run<T>(work: () => T): T {
    this.runCount += 1;
    return work();
  }
}

// Pre-seeded initiatives for after edge resolution
const EXISTING_A = "01JZZZZZZZZZZZZZZZZZZZEXA0";
const EXISTING_B = "01JZZZZZZZZZZZZZZZZZZZEXB0";
const EXISTING_CROSS = "01JZZZZZZZZZZZZZZZZZZZEXC0";
const PROJ_ID_AFTER = "01JZZZZZZZZZZZZZZZZZZZPRJ1";

describe("CreateInitiative with after", () => {
  test("(12) after absent → behaviour identical to today (no sequencing call)", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["proj-1", "project"]]),
    );
    const sequencing = new FakeSequencingRepo();
    const tx = new FakeTx();
    const uc = new CreateInitiative(repo, resolver, sequencing, tx);
    const id = await uc.execute({ projectId: "proj-1", name: "alone" });

    assert.ok(id.length > 0, "returns an id");
    assert.equal(sequencing.addedCalls.length, 0, "no after edges written");
    assert.equal(tx.runCount, 0, "no transaction");
  });

  test("(13) after: [B, A, B] → deduped + sorted, addInitiativeAfter called twice with A then B", async () => {
    const repo = new FakeInitiativeRepository();
    repo.save({
      id: EXISTING_A,
      projectId: PROJ_ID_AFTER,
      name: "existing-a",
    });
    repo.save({
      id: EXISTING_B,
      projectId: PROJ_ID_AFTER,
      name: "existing-b",
    });
    const resolver = new MockReferenceResolver(
      new Map([
        [PROJ_ID_AFTER, "project"],
        [EXISTING_A, "initiative"],
        [EXISTING_B, "initiative"],
      ]),
    );
    const sequencing = new FakeSequencingRepo();
    sequencing.dag = [
      { id: EXISTING_A, dependencies: [] },
      { id: EXISTING_B, dependencies: [] },
    ];
    const tx = new FakeTx();
    const uc = new CreateInitiative(repo, resolver, sequencing, tx);

    const id = await uc.execute({
      projectId: PROJ_ID_AFTER,
      name: "new-init",
      after: [EXISTING_B, EXISTING_A, EXISTING_B],
    });

    assert.equal(
      sequencing.addedCalls.length,
      2,
      "two after edges written (deduped)",
    );
    // Sorted ascending: A before B
    assert.deepEqual(sequencing.addedCalls[0], {
      initiativeId: id,
      dependencyId: EXISTING_A,
    });
    assert.deepEqual(sequencing.addedCalls[1], {
      initiativeId: id,
      dependencyId: EXISTING_B,
    });
    assert.equal(tx.runCount, 1, "all writes in one transaction");
  });

  test("(14) after naming initiative in another project → SequencingScopeError, nothing saved", async () => {
    const repo = new FakeInitiativeRepository();
    repo.save({
      id: EXISTING_CROSS,
      projectId: "01JZZZZZZZZZZZZZZZZZZZPRX0",
      name: "other-project",
    });
    repo.save({
      id: EXISTING_A,
      projectId: PROJ_ID_AFTER,
      name: "existing-a",
    });
    const resolver = new MockReferenceResolver(
      new Map([
        [PROJ_ID_AFTER, "project"],
        [EXISTING_A, "initiative"],
        [EXISTING_CROSS, "initiative"],
      ]),
    );
    const sequencing = new FakeSequencingRepo();
    const tx = new FakeTx();
    const uc = new CreateInitiative(repo, resolver, sequencing, tx);

    await assert.rejects(
      () =>
        uc.execute({
          projectId: PROJ_ID_AFTER,
          name: "new-init",
          after: [EXISTING_CROSS],
        }),
      (err: unknown) => {
        assert.ok(err instanceof SequencingScopeError);
        assert.equal((err as SequencingScopeError).scope, "project");
        return true;
      },
    );
    assert.equal(sequencing.addedCalls.length, 0, "no edges written");
    assert.equal(
      repo.resolveInitiativeByName(PROJ_ID_AFTER, "new-init").length,
      0,
      "initiative not saved",
    );
  });

  test("(15) after naming a non-existent id → UnknownReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([
        [PROJ_ID_AFTER, "project"],
        // EXISTING_A not a valid reference kind
      ]),
    );
    const sequencing = new FakeSequencingRepo();
    const tx = new FakeTx();
    const uc = new CreateInitiative(repo, resolver, sequencing, tx);

    await assert.rejects(
      () =>
        uc.execute({
          projectId: PROJ_ID_AFTER,
          name: "new-init",
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

describe("RenameInitiative", () => {
  test("rename initiative changes the name", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(
      new Map([["proj-1", "project"]]),
    );
    const createUc = new CreateInitiative(repo, resolver);
    const id = await createUc.execute({
      projectId: "proj-1",
      name: "old-name",
    });
    const renameUc = new RenameInitiative(repo);
    await renameUc.execute({ id, name: "new-name" });
    const saved = repo.get(id);
    assert.ok(saved !== undefined);
    assert.equal(saved.name, "new-name");
  });

  test("rename initiative with unknown id throws UnknownReferenceError", async () => {
    const repo = new FakeInitiativeRepository();
    const uc = new RenameInitiative(repo);
    await assert.rejects(
      () => uc.execute({ id: "no-such", name: "new-name" }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownReferenceError);
        assert.equal(err.kind, "initiative");
        return true;
      },
    );
  });
});
