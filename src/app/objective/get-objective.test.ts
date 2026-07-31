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
    initiativeId: INIT_ID,
    name: "backend",
    status: "integrated",
    integrations: [{ repository: REPO_ID, state: "integrated" }],
    after: [],
    waiting: [],
    conflictCause: null,
    conflictReason: null,
    note: null,
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

// Story 6 — after / waiting rendering
const S6_X = "01JZZZZZZZZZZZZZZZZZZZX001";
const S6_Y = "01JZZZZZZZZZZZZZZZZZZZY002";

interface FakeObjectiveSequencingSource {
  listObjectiveAfter(objectiveId: string): string[];
}

function makeObjStoreMap(objectives: Objective[]): FakeObjectiveSource {
  const map = new Map(objectives.map((o) => [o.id, o]));
  return { getObjective: (id) => map.get(id) };
}

test("(S6-1) no edges → after and waiting are empty arrays", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "test",
    status: "building",
  };
  const objectives = makeObjStoreMap([objective]);
  const repos: FakeRepositoryResolver = {
    resolveInitiativeRepository: () => undefined,
  };
  const sequencing: FakeObjectiveSequencingSource = {
    listObjectiveAfter: () => [],
  };
  const useCase = new GetObjective(objectives, repos, sequencing);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output.after, []);
  assert.deepEqual(output.waiting, []);
});

test("(S6-2) after: [X] with X integrated → after is [X], waiting is []", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "test",
    status: "building",
  };
  const other: Objective = {
    id: S6_X,
    initiativeId: INIT_ID,
    name: "other",
    status: "integrated",
  };
  const objectives = makeObjStoreMap([objective, other]);
  const repos: FakeRepositoryResolver = {
    resolveInitiativeRepository: () => undefined,
  };
  const sequencing: FakeObjectiveSequencingSource = {
    listObjectiveAfter: () => [S6_X],
  };
  const useCase = new GetObjective(objectives, repos, sequencing);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output.after, [S6_X]);
  assert.deepEqual(output.waiting, []);
});

test("(S6-3) after: [X] with X awaiting_confirmation → waiting includes X with neverSatisfies=false", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "test",
    status: "building",
  };
  const other: Objective = {
    id: S6_X,
    initiativeId: INIT_ID,
    name: "other",
    status: "awaiting_confirmation",
  };
  const objectives = makeObjStoreMap([objective, other]);
  const repos: FakeRepositoryResolver = {
    resolveInitiativeRepository: () => undefined,
  };
  const sequencing: FakeObjectiveSequencingSource = {
    listObjectiveAfter: () => [S6_X],
  };
  const useCase = new GetObjective(objectives, repos, sequencing);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output.after, [S6_X]);
  assert.deepEqual(output.waiting, [{ id: S6_X, neverSatisfies: false }]);
});

test("(S6-4) after: [X] with X discarded → waiting includes X with neverSatisfies=true", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "test",
    status: "building",
  };
  const other: Objective = {
    id: S6_X,
    initiativeId: INIT_ID,
    name: "other",
    status: "discarded",
  };
  const objectives = makeObjStoreMap([objective, other]);
  const repos: FakeRepositoryResolver = {
    resolveInitiativeRepository: () => undefined,
  };
  const sequencing: FakeObjectiveSequencingSource = {
    listObjectiveAfter: () => [S6_X],
  };
  const useCase = new GetObjective(objectives, repos, sequencing);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output.after, [S6_X]);
  assert.deepEqual(output.waiting, [{ id: S6_X, neverSatisfies: true }]);
});

test("(S6-5) after: [B, A] from repo → after and waiting preserve repo order", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "test",
    status: "building",
  };
  const a: Objective = {
    id: S6_Y,
    initiativeId: INIT_ID,
    name: "A",
    status: "building",
  };
  const b: Objective = {
    id: S6_X,
    initiativeId: INIT_ID,
    name: "B",
    status: "integrated",
  };
  const objectives = makeObjStoreMap([objective, a, b]);
  const repos: FakeRepositoryResolver = {
    resolveInitiativeRepository: () => undefined,
  };
  const sequencing: FakeObjectiveSequencingSource = {
    listObjectiveAfter: () => [S6_Y, S6_X],
  };
  const useCase = new GetObjective(objectives, repos, sequencing);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.deepEqual(output.after, [S6_Y, S6_X]);
  assert.deepEqual(output.waiting, [{ id: S6_Y, neverSatisfies: false }]);
});

// ---------------------------------------------------------------------------
// Story 3 — commitOid / parentOid on the read view (012)
// ---------------------------------------------------------------------------

const S3_COMMIT = "a".repeat(40);
const S3_PARENT = "b".repeat(40);

test("(S3-1) execute returns commitOid and parentOid when both are set on the objective", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "awaiting_confirmation",
    commitOid: S3_COMMIT,
    parentOid: S3_PARENT,
  };
  const { objectives, repos } = makeStore(objective, REPO_ID);
  const useCase = new GetObjective(objectives, repos);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.equal(output.commitOid, S3_COMMIT, "commitOid carried into output");
  assert.equal(output.parentOid, S3_PARENT, "parentOid carried into output");
  assert.deepEqual(output, {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "awaiting_confirmation",
    commitOid: S3_COMMIT,
    parentOid: S3_PARENT,
    integrations: [{ repository: REPO_ID, state: "awaiting_confirmation" }],
    after: [],
    waiting: [],
    conflictCause: null,
    conflictReason: null,
    note: null,
  });
});

test("(S3-2) execute omits commitOid and parentOid keys when neither is set (a building objective)", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "building",
  };
  const { objectives, repos } = makeStore(objective, REPO_ID);
  const useCase = new GetObjective(objectives, repos);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.equal(
    "commitOid" in output,
    false,
    "commitOid key must be absent when domain value is undefined",
  );
  assert.equal(
    "parentOid" in output,
    false,
    "parentOid key must be absent when domain value is undefined",
  );
  assert.equal(
    output.commitOid,
    undefined,
    "commitOid is undefined, never null or empty string",
  );
  assert.equal(
    output.parentOid,
    undefined,
    "parentOid is undefined, never null or empty string",
  );
});

// ---------------------------------------------------------------------------
// Story 7 §D — conflictCause / conflictReason / note surfaced as string|null
// ---------------------------------------------------------------------------

test("(017-S7D-1) execute returns conflictCause, conflictReason and note verbatim when set on the objective", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "conflict",
    conflictCause: "non-single-commit",
    conflictReason: "gate failed",
    note: "use the anchor",
  };
  const { objectives, repos } = makeStore(objective, REPO_ID);
  const useCase = new GetObjective(objectives, repos);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.equal(output.conflictCause, "non-single-commit");
  assert.equal(output.conflictReason, "gate failed");
  assert.equal(output.note, "use the anchor");
});

test("(017-S7D-2) execute reports conflictCause, conflictReason and note as null (not omitted) when unset", async () => {
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INIT_ID,
    name: "backend",
    status: "building",
  };
  const { objectives, repos } = makeStore(objective, REPO_ID);
  const useCase = new GetObjective(objectives, repos);
  const output = await useCase.execute({ id: OBJ_ID });
  assert.equal("conflictCause" in output, true, "conflictCause key present");
  assert.equal("conflictReason" in output, true, "conflictReason key present");
  assert.equal("note" in output, true, "note key present");
  assert.equal(output.conflictCause, null);
  assert.equal(output.conflictReason, null);
  assert.equal(output.note, null);
});
