// src/apps/http/routes.conflict.test.ts — Story S9: the two conflict rows,
// over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import { ObjectiveNotInConflictError } from "../../app/errors.ts";
import type { ConflictOverview } from "../../app/task/get-conflict.ts";
import type { ObjectiveConflictOutput } from "../../app/objective/get-objective-conflict.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function taskConflictFixture(): ConflictOverview {
  return {
    taskId: "t1",
    branch: "main",
    targetOID: "abc",
    candidateOID: "def",
    files: [{ path: "a.ts", hunks: "@@ -1 +1 @@" }],
  };
}

function objectiveConflictFixture(): ObjectiveConflictOutput {
  return {
    objectiveId: "o1",
    initiativeId: "i1",
    status: "conflict",
    conflictCause: null,
    parentOid: null,
    commitOid: null,
    observedTipOid: null,
    currentTip: null,
    tipMovedSinceAnchor: false,
    conflictReason: null,
    note: null,
    evidence: {
      basis: "verification-and-summary",
      diffAvailable: false,
      inspect: null,
    },
  };
}

interface DepsFixture {
  deps: HttpDeps;
  received: Record<string, unknown>;
  throwGetConflict: Error | undefined;
  throwGetObjectiveConflict: Error | undefined;
}

function makeDeps(): DepsFixture {
  const state: DepsFixture = {
    received: {},
    throwGetConflict: undefined,
    throwGetObjectiveConflict: undefined,
    deps: undefined as unknown as HttpDeps,
  };
  state.deps = {
    logger: makeLogger(),
    getConflict: {
      execute: (input: unknown) => {
        state.received.getConflict = input;
        if (state.throwGetConflict) throw state.throwGetConflict;
        return taskConflictFixture();
      },
    },
    getObjectiveConflict: {
      execute: (input: unknown) => {
        state.received.getObjectiveConflict = input;
        if (state.throwGetObjectiveConflict)
          throw state.throwGetObjectiveConflict;
        return objectiveConflictFixture();
      },
    },
  } as unknown as HttpDeps;
  return state;
}

test("GET /api/task/t1/conflict forwards { taskId: 't1' }; success is enveloped as { data }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/task/t1/conflict")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getConflict, { taskId: "t1" });
  assert.equal(res.body.data.taskId, "t1");
});

test("GET /api/task/t1/conflict where the fake throws NoConflictCandidateError is 409 no_conflict_candidate", async () => {
  const state = makeDeps();
  state.throwGetConflict = new NoConflictCandidateError("t1");
  const app = buildHttpApp(state.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/task/t1/conflict")
    .set("Authorization", AUTH);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "no_conflict_candidate");
  assert.equal(res.body.error.requestId, REQUEST_ID);
  assert.doesNotMatch(
    res.body.error.message,
    /no conflict candidate found for task t1/,
  );
});

test("GET /api/objective/o1/conflict forwards { objectiveId: 'o1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/objective/o1/conflict")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getObjectiveConflict, { objectiveId: "o1" });
});

test("GET /api/objective/o1/conflict where the fake throws ObjectiveNotInConflictError is 409 objective_not_in_conflict", async () => {
  const state = makeDeps();
  state.throwGetObjectiveConflict = new ObjectiveNotInConflictError(
    "o1",
    "building",
  );
  const app = buildHttpApp(state.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/objective/o1/conflict")
    .set("Authorization", AUTH);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "objective_not_in_conflict");
});

test("GET /api/task/%20/conflict is 400 invalid_input, use case not called", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/task/%20/conflict")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal("getConflict" in received, false);
});
