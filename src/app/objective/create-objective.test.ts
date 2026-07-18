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
