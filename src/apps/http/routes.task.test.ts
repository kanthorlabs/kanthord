// src/apps/http/routes.task.test.ts — Story S6: initiative.task.list, task.get
// rows over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { GetTaskOutput } from "../../app/task/get-task.ts";

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
    initiativeId: "i1",
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
