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
