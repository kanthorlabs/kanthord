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
    branch: `kanthord/init/${INIT_ID}`,
    workspace: "/tmp/kanthord-init-clone",
    after: [],
    waiting: [],
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
    branch: `kanthord/init/${INIT_ID}`,
    after: [],
    waiting: [],
  });
});

// Story 6 — after / waiting rendering
const S6_X = "01JZZZZZZZZZZZZZZZZZZZX001";
const S6_Y = "01JZZZZZZZZZZZZZZZZZZZY002";

interface FakeInitiativeSequencingSource {
  listInitiativeAfter(initiativeId: string): string[];
}

function makeStoreMap(initiatives: Initiative[]): FakeInitiativeSource {
  const map = new Map(initiatives.map((i) => [i.id, i]));
  return { get: (id) => map.get(id) };
}

test("(S6-1) no edges → after and waiting are empty arrays", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "p1",
    name: "test",
    status: "building",
  };
  const store = makeStoreMap([initiative]);
  const sequencing: FakeInitiativeSequencingSource = {
    listInitiativeAfter: () => [],
  };
  const useCase = new GetInitiative(store, sequencing);
  const output = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(output.after, []);
  assert.deepEqual(output.waiting, []);
});

test("(S6-2) after: [X] with X landed → after is [X], waiting is []", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "p1",
    name: "test",
    status: "building",
  };
  const other: Initiative = {
    id: S6_X,
    projectId: "p1",
    name: "other",
    status: "landed",
  };
  const store = makeStoreMap([initiative, other]);
  const sequencing: FakeInitiativeSequencingSource = {
    listInitiativeAfter: () => [S6_X],
  };
  const useCase = new GetInitiative(store, sequencing);
  const output = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(output.after, [S6_X]);
  assert.deepEqual(output.waiting, []);
});

test("(S6-3) after: [X] with X building → waiting includes X with neverSatisfies=false", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "p1",
    name: "test",
    status: "building",
  };
  const other: Initiative = {
    id: S6_X,
    projectId: "p1",
    name: "other",
    status: "building",
  };
  const store = makeStoreMap([initiative, other]);
  const sequencing: FakeInitiativeSequencingSource = {
    listInitiativeAfter: () => [S6_X],
  };
  const useCase = new GetInitiative(store, sequencing);
  const output = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(output.after, [S6_X]);
  assert.deepEqual(output.waiting, [{ id: S6_X, neverSatisfies: false }]);
});

test("(S6-4) after: [X] with X discarded → waiting includes X with neverSatisfies=true", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "p1",
    name: "test",
    status: "building",
  };
  const other: Initiative = {
    id: S6_X,
    projectId: "p1",
    name: "other",
    status: "discarded",
  };
  const store = makeStoreMap([initiative, other]);
  const sequencing: FakeInitiativeSequencingSource = {
    listInitiativeAfter: () => [S6_X],
  };
  const useCase = new GetInitiative(store, sequencing);
  const output = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(output.after, [S6_X]);
  assert.deepEqual(output.waiting, [{ id: S6_X, neverSatisfies: true }]);
});

test("(S6-5) after: [B, A] from repo → after and waiting preserve repo order", async () => {
  const initiative: Initiative = {
    id: INIT_ID,
    projectId: "p1",
    name: "test",
    status: "building",
  };
  const a: Initiative = {
    id: S6_Y,
    projectId: "p1",
    name: "A",
    status: "building",
  };
  const b: Initiative = {
    id: S6_X,
    projectId: "p1",
    name: "B",
    status: "landed",
  };
  const store = makeStoreMap([initiative, a, b]);
  const sequencing: FakeInitiativeSequencingSource = {
    listInitiativeAfter: () => [S6_Y, S6_X],
  };
  const useCase = new GetInitiative(store, sequencing);
  const output = await useCase.execute({ id: INIT_ID });
  assert.deepEqual(output.after, [S6_Y, S6_X]);
  assert.deepEqual(output.waiting, [{ id: S6_Y, neverSatisfies: false }]);
});
