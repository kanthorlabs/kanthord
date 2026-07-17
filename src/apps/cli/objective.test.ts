import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runCreateObjective, runRenameObjective } from "./objective.ts";
import type {
  InitiativeRepository,
  ReferenceResolver,
} from "../../storage/port.ts";
import type { Initiative, Objective } from "../../domain/initiative.ts";
import { CreateObjective } from "../../app/objective/create-objective.ts";
import { RenameObjective } from "../../app/objective/rename-objective.ts";

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
  readonly #kind: KindResult;

  constructor(kind: KindResult) {
    this.#kind = kind;
  }

  resolveKind(_id: string): KindResult {
    return this.#kind;
  }
}

describe("runCreateObjective handler", () => {
  test("runCreateObjective returns exitCode 0, stdout [id], stderr [created msg] on success", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("initiative");
    const result = await runCreateObjective(
      { initiative: "init-1", name: "backend" },
      new CreateObjective(repo, resolver),
    );
    assert.equal(result.exitCode, 0);
    assert.ok(
      result.stdout.length === 1,
      "stdout has exactly one entry (the id)",
    );
    assert.match(result.stdout[0]!, /^[0-9A-Z]{26}$/, "id is a ULID");
    assert.ok(result.stderr.length === 1);
    assert.ok(
      result.stderr[0]!.includes("backend"),
      "stderr mentions the objective name",
    );
  });

  test("runCreateObjective returns exitCode 1 with error line for unknown initiative reference", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver(undefined);
    const result = await runCreateObjective(
      { initiative: "no-such", name: "backend" },
      new CreateObjective(repo, resolver),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });

  test("runCreateObjective returns exitCode 1 with error line for wrong-type initiative reference", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("project");
    const result = await runCreateObjective(
      { initiative: "proj-1", name: "backend" },
      new CreateObjective(repo, resolver),
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});

describe("runRenameObjective handler", () => {
  test("runRenameObjective returns exitCode 0 on success", async () => {
    const repo = new FakeInitiativeRepository();
    const resolver = new MockReferenceResolver("initiative");
    const createResult = await runCreateObjective(
      { initiative: "init-1", name: "original" },
      new CreateObjective(repo, resolver),
    );
    const id = createResult.stdout[0]!;
    const result = await runRenameObjective(
      { id, name: "renamed" },
      new RenameObjective(repo),
    );
    assert.equal(result.exitCode, 0);
  });

  test("runRenameObjective returns exitCode 1 with error line for unknown id", async () => {
    const repo = new FakeInitiativeRepository();
    const result = await runRenameObjective(
      { id: "no-such-id", name: "whatever" },
      new RenameObjective(repo),
    );
    assert.equal(result.exitCode, 1);
    assert.ok(
      result.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${result.stderr[0]}`,
    );
  });
});
