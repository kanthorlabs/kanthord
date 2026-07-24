/**
 * Story F (007.12) part 2 — GetInitiative use case
 *
 * `GetInitiative.execute({ id })` returns `{ id, name, status, workspace }`
 * for a known initiative (mirroring GetTask's shape), and throws
 * `UnknownReferenceError("initiative", id)` for an unknown id.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { GetInitiative } from "./get-initiative.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Initiative } from "../../domain/initiative.ts";

const INIT_ID = "01JZZZZZZZZZZZZZZZZZZZINIT1";

interface FakeInitiativeSource {
  get(id: string): Initiative | undefined;
}

function makeStore(initiative: Initiative | undefined): FakeInitiativeSource {
  return {
    get: (id: string) => (id === INIT_ID ? initiative : undefined),
  };
}

test("execute throws UnknownReferenceError('initiative', id) when the initiative does not exist", async () => {
  const useCase = new GetInitiative(makeStore(undefined));
  await assert.rejects(
    () => useCase.execute({ id: INIT_ID }),
    (err: unknown) => {
      assert.ok(err instanceof UnknownReferenceError);
      assert.equal(err.kind, "initiative");
      assert.equal(err.id, INIT_ID);
      return true;
    },
  );
});

test("execute returns { id, name, status, workspace } for a provisioned initiative", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "proj-1",
    name: "init-wf",
    status: "building",
    workspace: "/tmp/kanthord-init-clone",
  };
  const useCase = new GetInitiative(makeStore(initiative));
  const output = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(output, {
    id: INIT_ID,
    name: "init-wf",
    status: "building",
    workspace: "/tmp/kanthord-init-clone",
  });
});

test("execute omits workspace when the initiative has not been provisioned yet", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "proj-1",
    name: "init-wf",
    status: "building",
  };
  const useCase = new GetInitiative(makeStore(initiative));
  const output = await useCase.execute({ id: INIT_ID });
  assert.equal("workspace" in output, false);
  assert.deepEqual(output, {
    id: INIT_ID,
    name: "init-wf",
    status: "building",
  });
});
