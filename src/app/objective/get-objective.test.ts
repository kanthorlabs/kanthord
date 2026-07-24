/**
 * Story F (007.12) part 2 — GetObjective use case
 *
 * `GetObjective.execute({ id })` returns
 * `{ id, name, status, integrations: [{ repository, state }] }` — one
 * integration entry per repository bound to the objective's initiative
 * (this epic scopes exactly one), `state` mirroring the objective's own
 * status (`"integrated"` once brokered, per the epic Proof's
 * `(o.integrations||[]).find(...).state === "integrated"` check).
 * Throws `UnknownReferenceError("objective", id)` for an unknown id.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GetObjective } from "./get-objective.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Objective } from "../../domain/initiative.ts";

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";
const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINIT1";
const REPO_ID = "01JZZZZZZZZZZZZZZZZZZZREPO1";

interface FakeObjectiveSource {
  getObjective(id: string): Objective | undefined;
}

interface FakeRepositoryResolver {
  resolveInitiativeRepository(initiativeId: string): string | undefined;
}

function makeStore(
  objective: Objective | undefined,
  repositoryId: string | undefined,
): { objectives: FakeObjectiveSource; repos: FakeRepositoryResolver } {
  return {
    objectives: {
      getObjective: (id: string) => (id === OBJ_ID ? objective : undefined),
    },
    repos: {
      resolveInitiativeRepository: (initiativeId: string) =>
        initiativeId === INIT_ID ? repositoryId : undefined,
    },
  };
}

test("execute throws UnknownReferenceError('objective', id) when the objective does not exist", async () => {
  const { objectives, repos } = makeStore(undefined, REPO_ID);
  const useCase = new GetObjective(objectives, repos);
  await assert.rejects(
    () => useCase.execute({ id: OBJ_ID }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      assert.equal(err.kind, "objective");
      assert.equal(err.id, OBJ_ID);
      return true;
    },
  );
});

test("execute returns integrations=[{ repository, state }] with state=integrated once the objective is brokered", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "integrated",
  };
  const { objectives, repos } = makeStore(objective, REPO_ID);
  const useCase = new GetObjective(objectives, repos);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output, {
    id: OBJ_ID,
    name: "backend",
    status: "integrated",
    integrations: [{ repository: REPO_ID, state: "integrated" }],
  });
});

test("execute returns an empty integrations array when the initiative has no resolvable repository", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "building",
  };
  const { objectives, repos } = makeStore(objective, undefined);
  const useCase = new GetObjective(objectives, repos);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output.integrations, []);
});
