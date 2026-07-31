// src/apps/http/routes.verdict.test.ts — EPIC 023 Story S4: the three
// objective verdict rows, over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  StaleCandidateError,
  ObjectiveNotAwaitingConfirmationError,
  ImpactChangedError,
} from "../../app/errors.ts";
import { ObjectiveNotRetryableError } from "../../app/objective/retry-objective.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function makeVerdictDeps(): {
  deps: HttpDeps;
  received: {
    approveObjective?: unknown;
    rejectObjective?: unknown;
    retryObjective?: unknown;
  };
  approveObjectiveCalls: number;
  rejectObjectiveCalls: number;
  retryObjectiveCalls: number;
} {
  const received: {
    approveObjective?: unknown;
    rejectObjective?: unknown;
    retryObjective?: unknown;
  } = {};
  let approveObjectiveCalls = 0;
  let rejectObjectiveCalls = 0;
  let retryObjectiveCalls = 0;
  const deps = {
    logger: makeLogger(),
    approveObjective: {
      execute: async (input: unknown) => {
        received.approveObjective = input;
        approveObjectiveCalls += 1;
        return { outcome: "integrated" };
      },
    },
    rejectObjective: {
      execute: async (input: unknown) => {
        received.rejectObjective = input;
        rejectObjectiveCalls += 1;
        return {
          preview: {
            damage: [],
            counts: {
              "discarded-by-cascade": 0,
              "left-blocked": 0,
              "permanently-unsatisfiable": 0,
            },
            digest: "d1",
          },
        };
      },
    },
    retryObjective: {
      execute: async (input: unknown) => {
        received.retryObjective = input;
        retryObjectiveCalls += 1;
      },
    },
  } as unknown as HttpDeps;
  return {
    deps,
    received,
    get approveObjectiveCalls() {
      return approveObjectiveCalls;
    },
    get rejectObjectiveCalls() {
      return rejectObjectiveCalls;
    },
    get retryObjectiveCalls() {
      return retryObjectiveCalls;
    },
  };
}

test("decode task.approval-style objective.approval.create: {expectedCommit:'abc'} -> exactly {objectiveId,expectedCommit}", async () => {
  const { deps, received } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 200);
  assert.deepEqual(received.approveObjective, {
    objectiveId: "o1",
    expectedCommit: "abc",
  });
});

test("objective.approval.create with an empty body is 400 invalid_input, use case not called", async () => {
  const { deps, received } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal("approveObjective" in received, false);
});

test("objective.approval.create with a blank expectedCommit is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "  " });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/objective/o1/approval calls the fake once, answers 200 with data.outcome integrated and an ETag", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.outcome, "integrated");
  assert.ok(res.headers["etag"], "expected an ETag header on a 200 response");
  assert.equal(verdictDeps.approveObjectiveCalls, 1);
});

test("POST /api/objective/o1/approval where the fake returns conflict outcome also answers 200, not 409", async () => {
  const { deps } = makeVerdictDeps();
  deps.approveObjective.execute = async () => ({ outcome: "conflict" });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.outcome, "conflict");
});

test("POST /api/objective/ /approval (blank id) is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/%20/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/objective/o1/approval where the fake raises StaleCandidateError is 409 stale_candidate", async () => {
  const { deps } = makeVerdictDeps();
  deps.approveObjective.execute = async () => {
    throw new StaleCandidateError("o1", "abc", "def");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "stale_candidate");
});

test("POST /api/objective/o1/approval where the fake raises ObjectiveNotAwaitingConfirmationError is 409 objective_not_awaiting_confirmation", async () => {
  const { deps } = makeVerdictDeps();
  deps.approveObjective.execute = async () => {
    throw new ObjectiveNotAwaitingConfirmationError("o1", "integrated");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "objective_not_awaiting_confirmation");
});

test("decode objective.rejection.create with full body -> exactly {objectiveId,expectedCommit,reason,dryRun,expectImpact}", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      expectedCommit: "abc",
      reason: "r",
      dryRun: true,
      expectImpact: "d",
    });
  assert.equal(res.status, 200);
  assert.deepEqual(received.rejectObjective, {
    objectiveId: "o1",
    expectedCommit: "abc",
    reason: "r",
    dryRun: true,
    expectImpact: "d",
  });
  assert.equal(verdictDeps.rejectObjectiveCalls, 1);
});

test("decode objective.rejection.create with only expectedCommit -> exactly {objectiveId,expectedCommit}, no undefined-valued keys, no resolution key", async () => {
  const { deps, received } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 200);
  assert.deepEqual(received.rejectObjective, {
    objectiveId: "o1",
    expectedCommit: "abc",
  });
  assert.equal(
    "resolution" in (received.rejectObjective as Record<string, unknown>),
    false,
  );
});

test("objective.rejection.create with an empty body is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/objective/ /rejection (blank id) is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/%20/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/objective/o1/rejection where the fake raises ImpactChangedError is 409 impact_changed", async () => {
  const { deps } = makeVerdictDeps();
  deps.rejectObjective.execute = async () => {
    throw new ImpactChangedError("d1", "d2");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc", expectImpact: "wrong" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "impact_changed");
});

test("decode objective.reattempt.create with {expectedCommit,note} -> exactly {objectiveId,expectedCommit,note}; POST answers 204 with empty body and no etag", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc", note: "n" });
  assert.equal(res.status, 204);
  assert.deepEqual(received.retryObjective, {
    objectiveId: "o1",
    expectedCommit: "abc",
    note: "n",
  });
  assert.equal(verdictDeps.retryObjectiveCalls, 1);
  assert.equal(res.headers["etag"], undefined);
  assert.equal(res.text, "");
});

test("objective.reattempt.create with an empty body is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/objective/ /reattempt (blank id) is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/%20/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/objective/o1/reattempt where the fake raises ObjectiveNotRetryableError is 409 objective_not_retryable", async () => {
  const { deps } = makeVerdictDeps();
  deps.retryObjective.execute = async () => {
    throw new ObjectiveNotRetryableError("o1");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/objective/o1/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ expectedCommit: "abc" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "objective_not_retryable");
});
