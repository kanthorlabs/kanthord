// src/apps/http/routes.task.test.ts — Story S6: initiative.task.list, task.get
// rows over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  UnknownReferenceError,
  TaskNotAwaitingConfirmationError,
  ImpactChangedError,
} from "../../app/errors.ts";
import type { GetTaskOutput } from "../../app/task/get-task.ts";
import { RejectionConflictError } from "../../app/task/reject-task.ts";
import { TaskNotRetryableError } from "../../app/task/retry-task.ts";
import {
  TaskNotAbandonableError,
  NoRunningJobError,
  AmbiguousRunningJobError,
} from "../../app/task/abandon-task.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function taskFixture(id: string): GetTaskOutput {
  return {
    id,
    title: "task one",
    status: "pending",
    agent: undefined,
    objectiveId: "obj-1",
    dependencies: [],
    result: undefined,
    landingCandidate: null,
    abandoning: false,
    waiting: [],
    blockedForever: false,
    downstream: 0,
    action: null,
  };
}

function makeDeps(): {
  deps: HttpDeps;
  received: { listTasks?: unknown; getTask?: unknown };
  listTasksResult: unknown[];
  listTasksCalls: number;
} {
  const received: { listTasks?: unknown; getTask?: unknown } = {};
  let listTasksCalls = 0;
  const listTasksResult: unknown[] = [
    {
      id: "t1",
      title: "task one",
      status: "pending",
      state: "ready",
      dependencies: [],
      waiting: [],
    },
  ];
  const deps = {
    logger: makeLogger(),
    listTasks: {
      execute: async (input: unknown) => {
        received.listTasks = input;
        listTasksCalls += 1;
        return listTasksResult;
      },
    } as HttpDeps["listTasks"],
    getTask: {
      execute: async (input: unknown) => {
        received.getTask = input;
        const id = (input as { id: string }).id;
        if (id === "missing") {
          throw new UnknownReferenceError("task", id);
        }
        return taskFixture(id);
      },
    } as HttpDeps["getTask"],
  } as unknown as HttpDeps;
  return { deps, received, listTasksResult, listTasksCalls };
}

test("GET /api/initiative/i1/task forwards exactly { initiativeId: 'i1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/task")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listTasks, { initiativeId: "i1" });
});

test("GET /api/initiative/i1/task?status=pending&objective=o1 forwards { initiativeId, status, objectiveId }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/task?status=pending&objective=o1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listTasks, {
    initiativeId: "i1",
    status: "pending",
    objectiveId: "o1",
  });
});

test("GET /api/initiative/i1/task?status=bogus is 400 invalid_input; the use case is not called", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/task?status=bogus")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("GET /api/initiative/i1/task?objective=o1&objective=o2 is 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/task?objective=o1&objective=o2")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("GET /api/initiative/i1/task where the fake returns [] is 200 with { data: [] }", async () => {
  const { deps } = makeDeps();
  deps.listTasks.execute = async () => [];
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/task")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { data: [] });
});

test("GET /api/task/t1 forwards { id: 't1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/task/t1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getTask, { id: "t1" });
});

test("GET /api/task/missing where the fake throws UnknownReferenceError is 404 unknown_reference", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/task/missing")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

// ─── EPIC 023 Story S2 — task.approval.create, task.rejection.create ───────

function makeVerdictDeps(): {
  deps: HttpDeps;
  received: {
    approveTask?: unknown;
    rejectTask?: unknown;
    retryTask?: unknown;
    abandonTask?: unknown;
  };
  approveTaskCalls: number;
  rejectTaskCalls: number;
  retryTaskCalls: number;
  abandonTaskCalls: number;
} {
  const received: {
    approveTask?: unknown;
    rejectTask?: unknown;
    retryTask?: unknown;
    abandonTask?: unknown;
  } = {};
  let approveTaskCalls = 0;
  let rejectTaskCalls = 0;
  let retryTaskCalls = 0;
  let abandonTaskCalls = 0;
  const deps = {
    ...makeDeps().deps,
    approveTask: {
      execute: async (input: unknown) => {
        received.approveTask = input;
        approveTaskCalls += 1;
        return { kind: "approved", taskId: "t1", canonicalSHA: "abc123" };
      },
    } as HttpDeps["approveTask"],
    rejectTask: {
      execute: async (input: unknown) => {
        received.rejectTask = input;
        rejectTaskCalls += 1;
        return {
          skipped: [],
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
    } as unknown as HttpDeps["rejectTask"],
    retryTask: {
      execute: async (input: unknown) => {
        received.retryTask = input;
        retryTaskCalls += 1;
      },
    } as unknown as HttpDeps["retryTask"],
    abandonTask: {
      execute: (input: unknown) => {
        received.abandonTask = input;
        abandonTaskCalls += 1;
        return { outcome: "abandoning", taskId: "t1" };
      },
    } as unknown as HttpDeps["abandonTask"],
  } as unknown as HttpDeps;
  return {
    deps,
    received,
    get approveTaskCalls() {
      return approveTaskCalls;
    },
    get rejectTaskCalls() {
      return rejectTaskCalls;
    },
    get retryTaskCalls() {
      return retryTaskCalls;
    },
    get abandonTaskCalls() {
      return abandonTaskCalls;
    },
  };
}

test("POST /api/task/t1/approval decodes exactly { taskId: 't1' }, calls the fake once, answers 200 with an ETag", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 200);
  assert.deepEqual(received.approveTask, { taskId: "t1" });
  assert.ok(res.headers["etag"], "expected an ETag header on a 200 response");
  assert.equal(res.body.data.outcome, "approved");
  assert.equal("kind" in res.body.data, false);
  assert.equal(verdictDeps.approveTaskCalls, 1);
});

test("POST /api/task/ /approval (blank id) is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/%20/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/task/t1/rejection decodes {resolution:'discard',reason,dryRun,expectImpact} exactly", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      resolution: "discard",
      reason: "r",
      dryRun: true,
      expectImpact: "d",
    });
  assert.equal(res.status, 200);
  assert.deepEqual(received.rejectTask, {
    taskId: "t1",
    resolution: "discard",
    reason: "r",
    dryRun: true,
    expectImpact: "d",
  });
  assert.equal(verdictDeps.rejectTaskCalls, 1);
});

test("POST /api/task/t1/rejection decodes {resolution:'retry'} with no undefined-valued keys", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ resolution: "retry" });
  assert.equal(res.status, 200);
  assert.deepEqual(received.rejectTask, { taskId: "t1", resolution: "retry" });
  assert.equal(verdictDeps.rejectTaskCalls, 1);
});

test("POST /api/task/t1/rejection with an empty body is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/task/t1/rejection with an out-of-range resolution is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ resolution: "maybe" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/task/t1/approval where the fake returns landing_failed with a cause never leaks the cause into the envelope", async () => {
  const { deps } = makeVerdictDeps();
  deps.approveTask.execute = async () => ({
    kind: "landing_failed",
    taskId: "t1",
    message: "boom",
    cause: { secret: "leak-me" },
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.data.outcome, "landing_failed");
  assert.equal(JSON.stringify(res.body).includes("leak-me"), false);
});

test("POST /api/task/t1/approval where the fake raises TaskNotAwaitingConfirmationError is 409 task_not_awaiting_confirmation", async () => {
  const { deps } = makeVerdictDeps();
  deps.approveTask.execute = async () => {
    throw new TaskNotAwaitingConfirmationError("t1", "completed");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/approval")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "task_not_awaiting_confirmation");
});

test("POST /api/task/t1/rejection where the fake raises RejectionConflictError is 409 rejection_conflict", async () => {
  const { deps } = makeVerdictDeps();
  deps.rejectTask.execute = async () => {
    throw new RejectionConflictError("t1", "discard", "retry");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ resolution: "retry" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "rejection_conflict");
});

test("POST /api/task/t1/rejection where the fake raises ImpactChangedError is 409 impact_changed", async () => {
  const { deps } = makeVerdictDeps();
  deps.rejectTask.execute = async () => {
    throw new ImpactChangedError("d1", "d2");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/rejection")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ resolution: "discard", expectImpact: "wrong" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "impact_changed");
});

// ─── EPIC 023 Story S3 — task.reattempt.create, task.abandonment.create ────

test("POST /api/task/t1/reattempt decodes {note,rebuild,carryNote} exactly, calls the fake once, answers 204 with no ETag", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ note: "n", rebuild: true, carryNote: false });
  assert.equal(res.status, 204);
  assert.deepEqual(received.retryTask, {
    taskId: "t1",
    note: "n",
    rebuild: true,
    carryNote: false,
  });
  assert.equal(verdictDeps.retryTaskCalls, 1);
  assert.equal(res.headers["etag"], undefined);
  assert.equal(res.text, "");
});

test("POST /api/task/t1/reattempt with an empty body decodes exactly { taskId: 't1' }, no undefined-valued keys", async () => {
  const { deps, received } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 204);
  assert.deepEqual(received.retryTask, { taskId: "t1" });
});

test("POST /api/task/ /reattempt (blank id) is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/%20/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/task/t1/reattempt where the fake raises TaskNotRetryableError is 409 task_not_retryable", async () => {
  const { deps } = makeVerdictDeps();
  deps.retryTask.execute = async () => {
    throw new TaskNotRetryableError("t1", "pending");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/reattempt")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "task_not_retryable");
});

test("POST /api/task/t1/abandonment decodes {reason} exactly, calls the fake once, answers 200 with an ETag and outcome abandoning", async () => {
  const verdictDeps = makeVerdictDeps();
  const { deps, received } = verdictDeps;
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ reason: "stuck" });
  assert.equal(res.status, 200);
  assert.deepEqual(received.abandonTask, { taskId: "t1", reason: "stuck" });
  assert.equal(verdictDeps.abandonTaskCalls, 1);
  assert.ok(res.headers["etag"], "expected an ETag header on a 200 response");
  assert.equal(res.body.data.outcome, "abandoning");
});

test("POST /api/task/t1/abandonment where the fake returns already_abandoning answers 200 with that outcome", async () => {
  const { deps } = makeVerdictDeps();
  deps.abandonTask.execute = () => ({
    outcome: "already_abandoning",
    taskId: "t1",
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ reason: "stuck" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.outcome, "already_abandoning");
});

test("POST /api/task/t1/abandonment with an empty body is 400 invalid_input", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/task/t1/abandonment with a blank reason is 400 invalid_input (requireBodyString trims)", async () => {
  const { deps } = makeVerdictDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ reason: "   " });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/task/t1/abandonment where the fake raises TaskNotAbandonableError is 409 task_not_abandonable", async () => {
  const { deps } = makeVerdictDeps();
  deps.abandonTask.execute = () => {
    throw new TaskNotAbandonableError("t1", "pending");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ reason: "stuck" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "task_not_abandonable");
});

test("POST /api/task/t1/abandonment where the fake raises NoRunningJobError is 409 no_running_job", async () => {
  const { deps } = makeVerdictDeps();
  deps.abandonTask.execute = () => {
    throw new NoRunningJobError("t1");
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ reason: "stuck" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "no_running_job");
});

test("POST /api/task/t1/abandonment where the fake raises AmbiguousRunningJobError is 409 ambiguous_running_job", async () => {
  const { deps } = makeVerdictDeps();
  deps.abandonTask.execute = () => {
    throw new AmbiguousRunningJobError("t1", 2);
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/task/t1/abandonment")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ reason: "stuck" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "ambiguous_running_job");
});
