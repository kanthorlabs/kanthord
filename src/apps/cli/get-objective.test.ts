/**
 * Story F — `get objective` CLI handler
 *
 * Unit tests for `runGetObjective`: human-readable output (id/name/status,
 * one line per integration), `--json` envelope, and the unknown-id error
 * path.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runGetObjective } from "./objective.ts";
import { GetObjective } from "../../app/objective/get-objective.ts";
import type { Objective } from "../../domain/initiative.ts";

type HandlerResult = { exitCode: number; stdout: string[]; stderr: string[] };

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";

interface FakeObjectiveSource {
  getObjective(id: string): Objective | undefined;
}

class MemObjectiveSource implements FakeObjectiveSource {
  readonly #objectives: Map<string, Objective>;
  constructor(objectives: Objective[]) {
    this.#objectives = new Map(objectives.map((o) => [o.id, o]));
  }
  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }
}

class MockRepositoryResolver {
  readonly #repositoryId: string | undefined;
  constructor(repositoryId: string | undefined) {
    this.#repositoryId = repositoryId;
  }
  resolveInitiativeRepository(_initiativeId: string): string | undefined {
    return this.#repositoryId;
  }
}

function makeGetObjective(
  objective: Objective | undefined,
  repositoryId: string | undefined,
): GetObjective {
  return new GetObjective(
    new MemObjectiveSource(objective !== undefined ? [objective] : []),
    new MockRepositoryResolver(repositoryId),
  );
}

describe("runGetObjective", () => {
  test("human output: prints id, name, status, and one integration line once brokered", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "backend-slice",
      status: "integrated",
    };
    const getObjective = makeGetObjective(objective, "repo-1");

    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID },
      getObjective,
    );

    assert.equal(r.exitCode, 0, "exit 0 on success");
    assert.ok(
      r.stdout.some((l) => l.startsWith("id:") && l.includes(OBJ_ID)),
      "stdout must have id: line",
    );
    assert.ok(
      r.stdout.some(
        (l) => l.startsWith("name:") && l.includes("backend-slice"),
      ),
      "stdout must have name: line",
    );
    assert.ok(
      r.stdout.some((l) => l.startsWith("status:") && l.includes("integrated")),
      "stdout must have status: line",
    );
    assert.ok(
      r.stdout.some((l) => l.includes("repo-1") && l.includes("integrated")),
      "stdout must have an integration line naming the repository and its state",
    );
  });

  test("human output: no integration line when the initiative has no resolvable repository", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "backend-slice",
      status: "building",
    };
    const getObjective = makeGetObjective(objective, undefined);

    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID },
      getObjective,
    );

    assert.equal(r.exitCode, 0);
    assert.ok(
      !r.stdout.some((l) => l.startsWith("integration:")),
      "no integration: line when no repository resolves",
    );
  });

  test("--json: prints the GetObjectiveOutput verbatim as one JSON line", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "backend-slice",
      status: "integrated",
    };
    const getObjective = makeGetObjective(objective, "repo-1");

    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID, json: true },
      getObjective,
    );

    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json prints exactly one line");
    const parsed = JSON.parse(r.stdout[0]!);
    assert.deepEqual(parsed, {
      id: OBJ_ID,
      name: "backend-slice",
      status: "integrated",
      integrations: [{ repository: "repo-1", state: "integrated" }],
    });
  });

  test("returns exitCode 1 with an error line for an unknown id", async () => {
    const getObjective = makeGetObjective(undefined, undefined);

    const r: HandlerResult = await runGetObjective(
      { id: "no-such-id" },
      getObjective,
    );

    assert.equal(r.exitCode, 1);
    assert.equal(r.stdout.length, 0);
    assert.ok(
      r.stderr[0]!.startsWith("error:"),
      `expected 'error:' prefix, got: ${r.stderr[0]}`,
    );
  });
});
