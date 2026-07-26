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
      after: [],
      waiting: [],
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

// Story 6 — after / waiting rendering
const S6_X = "01JZZZZZZZZZZZZZZZZZZZX001";
const S6_Y = "01JZZZZZZZZZZZZZZZZZZZY002";

describe("runGetObjective Story 6 — after/waiting rendering", () => {
  test("(S6-6) after: [] → no after: or waiting on: line", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "test",
      status: "building",
    };
    const getObjective = makeGetObjective(objective, undefined);
    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID },
      getObjective,
    );
    assert.equal(r.exitCode, 0);
    assert.ok(
      !r.stdout.some((l) => l.startsWith("after:")),
      "no after: line when empty",
    );
    assert.ok(
      !r.stdout.some((l) => l.startsWith("waiting on:")),
      "no waiting on: line when empty",
    );
  });

  test("(S6-7) after: [X] with X awaiting_confirmation → stdout has after: X and waiting on: X before integration:", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "test",
      status: "building",
    };
    const other: Objective = {
      id: S6_X,
      initiativeId: "init-1",
      name: "other",
      status: "awaiting_confirmation",
    };
    const source = new MemObjectiveSource([objective, other]);
    const repos = new MockRepositoryResolver("repo-42");
    const sequencing = { listObjectiveAfter: () => [S6_X] };
    const getObjective = new GetObjective(source, repos, sequencing);
    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID },
      getObjective,
    );
    assert.equal(r.exitCode, 0);
    const afterIdx = r.stdout.findIndex((l) => l.startsWith("after:"));
    const waitIdx = r.stdout.findIndex((l) => l.startsWith("waiting on:"));
    const intIdx = r.stdout.findIndex((l) => l.startsWith("integration:"));
    assert.ok(afterIdx >= 0, "stdout must have after: line");
    assert.ok(waitIdx >= 0, "stdout must have waiting on: line");
    assert.ok(intIdx >= 0, "stdout must have integration: line");
    assert.ok(afterIdx < intIdx, "after: must appear before integration:");
  });

  test("(S6-8) after: [X] with X discarded → stdout has waiting on: X (discarded — will never satisfy)", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "test",
      status: "building",
    };
    const other: Objective = {
      id: S6_X,
      initiativeId: "init-1",
      name: "other",
      status: "discarded",
    };
    const source = new MemObjectiveSource([objective, other]);
    const repos = new MockRepositoryResolver(undefined);
    const sequencing = { listObjectiveAfter: () => [S6_X] };
    const getObjective = new GetObjective(source, repos, sequencing);
    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID },
      getObjective,
    );
    assert.equal(r.exitCode, 0);
    assert.ok(
      r.stdout.some((l) => l.includes("(discarded — will never satisfy)")),
      "discarded warning must be in output",
    );
  });

  test("(S6-9) after: [A, B] → stdout has after: A B (space-joined)", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "test",
      status: "building",
    };
    const a: Objective = {
      id: S6_Y,
      initiativeId: "init-1",
      name: "A",
      status: "integrated",
    };
    const b: Objective = {
      id: S6_X,
      initiativeId: "init-1",
      name: "B",
      status: "integrated",
    };
    const source = new MemObjectiveSource([objective, a, b]);
    const repos = new MockRepositoryResolver(undefined);
    const sequencing = { listObjectiveAfter: () => [S6_Y, S6_X] };
    const getObjective = new GetObjective(source, repos, sequencing);
    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID },
      getObjective,
    );
    assert.equal(r.exitCode, 0);
    assert.ok(
      r.stdout.some(
        (l) => l.startsWith("after:") && l.includes(S6_Y) && l.includes(S6_X),
      ),
      "after: line must contain both ids space-joined",
    );
  });

  test("(S6-10) --json: parsed stdout has after and waiting matching the DTO", async () => {
    const objective: Objective = {
      id: OBJ_ID,
      initiativeId: "init-1",
      name: "test",
      status: "building",
    };
    const other: Objective = {
      id: S6_X,
      initiativeId: "init-1",
      name: "other",
      status: "awaiting_confirmation",
    };
    const source = new MemObjectiveSource([objective, other]);
    const repos = new MockRepositoryResolver(undefined);
    const sequencing = { listObjectiveAfter: () => [S6_X] };
    const getObjective = new GetObjective(source, repos, sequencing);
    const r: HandlerResult = await runGetObjective(
      { id: OBJ_ID, json: true },
      getObjective,
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout.length, 1, "--json prints exactly one line");
    const parsed = JSON.parse(r.stdout[0]!);
    assert.deepEqual(parsed.after, [S6_X]);
    assert.deepEqual(parsed.waiting, [{ id: S6_X, neverSatisfies: false }]);
  });
});
