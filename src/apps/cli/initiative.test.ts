import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCreateInitiative, runRenameInitiative } from "./initiative.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import { RenameInitiative } from "../../app/initiative/rename-initiative.ts";

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

  resolveObjectiveByName(_initiativeId: string, _name: string): string[] {
    return [];
  }

  listInitiatives(_projectId: string) {
    return [];
  }
}

type KindResult =
  "project" | "resource" | "initiative" | "objective" | "task" | undefined;

class MockReferenceResolver implements ReferenceResolver {
  readonly #kind: KindResult;

  constructor(kind: KindResult) {
    this.#kind = kind;
  }

  resolveKind(_id: string): KindResult {
    return this.#kind;
  }
}

describe("runCreateInitiative handler", () => {
  test("runCreateInitiative returns exitCode 0, stdout [id], stderr [created msg] on success", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("project");
    const result = await runCreateInitiative(
      { project: "proj-1", name: "oauth" },
      new CreateInitiative(repo, resolver),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the id)",
    );
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/, "id is a ULID");
    assert.ok(result.stderr.length === 1);
    assert.ok(
      result.stderr[0]!.includes("oauth"),
      "stderr mentions the initiative name",
    );
  });

  test("runCreateInitiative returns exitCode 1 with error line for unknown project reference", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(undefined);
    const result = await runCreateInitiative(
      { project: "no-such", name: "oauth" },
      new CreateInitiative(repo, resolver),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateInitiative returns exitCode 1 with error line for wrong-type project reference", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("initiative");
    const result = await runCreateInitiative(
      { project: "init-1", name: "oauth" },
      new CreateInitiative(repo, resolver),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

describe("runRenameInitiative handler", () => {
  test("runRenameInitiative returns exitCode 0 on success", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("project");
    const createResult = await runCreateInitiative(
      { project: "proj-1", name: "original" },
      new CreateInitiative(repo, resolver),
    );
    const id = createResult.stdout[0]!;
    const result = await runRenameInitiative(
      { id, name: "renamed" },
      new RenameInitiative(repo),
    );
    assert.equal(result.exitCode, 0);
  });

  test("runRenameInitiative returns exitCode 1 with error line for unknown id", async () => {
    const repo = new FakeInitiativeRepository();
    const result = await runRenameInitiative(
      { id: "no-such-id", name: "whatever" },
      new RenameInitiative(repo),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});
