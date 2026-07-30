// src/apps/http/routes.readiness.test.ts — Story S8: the three diagnostic/
// readiness rows (initiative.diagnostic.export, graph.readiness.check,
// project.readiness.get), over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  CycleError,
  DuplicateTaskError,
  UnknownDependencyError,
  UnknownReferenceError,
} from "../../app/errors.ts";
import { ROUTES } from "./routes.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

type Recorder = { received?: unknown; calls: number };

function makeDeps() {
  const buildRec: Recorder = { calls: 0 };
  const checkProjectRec: Recorder = { calls: 0 };

  let buildImpl: (input: unknown) => unknown = () => ({
    schemaVersion: "007.1",
    exportedAt: "2026-07-30T00:00:00.000Z",
    initiativeRef: "opaque-init-1",
    records: [],
  });
  let checkGraphImpl: (input: unknown) => unknown = () => [];
  let checkProjectImpl: (input: unknown) => unknown = () => ({
    projectId: "p1",
    configured: true,
    verified: true,
    operational: true,
    ready: true,
    checks: [],
    next: null,
  });

  const deps = {
    logger: makeLogger(),
    diagnosticsExport: {
      build: async (input: unknown) => {
        buildRec.received = input;
        buildRec.calls += 1;
        return buildImpl(input);
      },
    },
    checkGraph: {
      // Deliberately SYNCHRONOUS execute — proves `run`'s async wrapper.
      execute: (input: unknown) => checkGraphImpl(input),
    },
    checkProject: {
      execute: async (input: unknown) => {
        checkProjectRec.received = input;
        checkProjectRec.calls += 1;
        return checkProjectImpl(input);
      },
    },
  } as unknown as HttpDeps;

  return {
    deps,
    setBuildImpl: (impl: (input: unknown) => unknown) => {
      buildImpl = impl;
    },
    setCheckGraphImpl: (impl: (input: unknown) => unknown) => {
      checkGraphImpl = impl;
    },
    setCheckProjectImpl: (impl: (input: unknown) => unknown) => {
      checkProjectImpl = impl;
    },
    recs: { buildRec, checkProjectRec },
  };
}

function app(deps: HttpDeps) {
  return buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID });
}

test("POST /api/initiative/i1/diagnostic with {} -> 200, build received exactly {initiativeId}, no outPath", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/diagnostic")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 200);
  assert.deepEqual(recs.buildRec.received, { initiativeId: "i1" });
  assert.equal("outPath" in res.body.data, false);
});

test("POST /api/initiative/i1/diagnostic with {task,debug} -> build received {initiativeId,taskId,debug}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/diagnostic")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ task: "t1", debug: true });
  assert.equal(res.status, 200);
  assert.deepEqual(recs.buildRec.received, {
    initiativeId: "i1",
    taskId: "t1",
    debug: true,
  });
});

test("POST /api/initiative/x/diagnostic with build throwing UnknownReferenceError -> 404 unknown_reference", async () => {
  const { deps, setBuildImpl } = makeDeps();
  setBuildImpl(() => {
    throw new UnknownReferenceError("initiative", "x");
  });
  const res = await request(app(deps).callback())
    .post("/api/initiative/x/diagnostic")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("POST /api/initiative/i1/diagnostic response carries an ETag", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/diagnostic")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.ok(res.headers.etag);
});

test("POST /api/graph/readiness with two nodes -> 200, fake received tasks exactly, first has no dependencies key", async () => {
  const { deps, recs, setCheckGraphImpl } = makeDeps();
  setCheckGraphImpl((input) =>
    (input as { tasks: Array<{ id: string }> }).tasks.map((t) => ({
      id: t.id,
      state: "ready",
      waiting: [],
    })),
  );
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: [{ id: "a" }, { id: "b", dependencies: ["a"] }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, [
    { id: "a", state: "ready", waiting: [] },
    { id: "b", state: "ready", waiting: [] },
  ]);
  void recs;
});

test("POST /api/graph/readiness records the exact fake input, no dependencies key when absent", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  let received: unknown;
  setCheckGraphImpl((input) => {
    received = input;
    return [];
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: [{ id: "a" }, { id: "b", dependencies: ["a"] }] });
  assert.equal(res.status, 200);
  assert.deepEqual(received, {
    tasks: [{ id: "a" }, { id: "b", dependencies: ["a"] }],
  });
});

test("POST /api/graph/readiness with {} -> 400 invalid_input naming tasks", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  let calls = 0;
  setCheckGraphImpl(() => {
    calls += 1;
    return [];
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.match(res.body.error.message, /tasks/);
  assert.equal(calls, 0);
});

test("POST /api/graph/readiness with {tasks:[{}]} -> 400 invalid_input naming id", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  let calls = 0;
  setCheckGraphImpl(() => {
    calls += 1;
    return [];
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: [{}] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.match(res.body.error.message, /id/);
  assert.equal(calls, 0);
});

test("POST /api/graph/readiness with {tasks:'x'} -> 400 invalid_input, fake never called", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  let calls = 0;
  setCheckGraphImpl(() => {
    calls += 1;
    return [];
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: "x" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(calls, 0);
});

test("POST /api/graph/readiness with checkGraph throwing CycleError -> 409 cycle_detected", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  setCheckGraphImpl(() => {
    throw new CycleError(["a", "b"]);
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: [{ id: "a" }] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "cycle_detected");
});

test("POST /api/graph/readiness with checkGraph throwing UnknownDependencyError -> 400 unknown_dependency", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  setCheckGraphImpl(() => {
    throw new UnknownDependencyError("a", "z");
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: [{ id: "a" }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "unknown_dependency");
});

test("POST /api/graph/readiness with checkGraph throwing DuplicateTaskError -> 409 duplicate_task", async () => {
  const { deps, setCheckGraphImpl } = makeDeps();
  setCheckGraphImpl(() => {
    throw new DuplicateTaskError("a");
  });
  const res = await request(app(deps).callback())
    .post("/api/graph/readiness")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ tasks: [{ id: "a" }] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "duplicate_task");
});

test("GET /api/project/p1/readiness -> 200, fake received {id,probeRepositories:false,probeProvider:false}, body data.projectId is p1", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .get("/api/project/p1/readiness")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(recs.checkProjectRec.received, {
    id: "p1",
    probeRepositories: false,
    probeProvider: false,
  });
  assert.equal(res.body.data.projectId, "p1");
});

test("GET /api/project/p1/readiness?probe-repositories=true -> the fake STILL received probeRepositories:false", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .get("/api/project/p1/readiness?probe-repositories=true")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(
    (recs.checkProjectRec.received as { probeRepositories: boolean })
      .probeRepositories,
    false,
  );
});

test("GET /api/project/%20/readiness -> 400 invalid_input, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .get("/api/project/%20/readiness")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(recs.checkProjectRec.calls, 0);
});

test("GET /api/project/p1/readiness with checkProject throwing UnknownReferenceError -> 404 unknown_reference", async () => {
  const { deps, setCheckProjectImpl } = makeDeps();
  setCheckProjectImpl(() => {
    throw new UnknownReferenceError("project", "p1");
  });
  const res = await request(app(deps).callback())
    .get("/api/project/p1/readiness")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("021 S8: row shapes — all three rows have no location, no readRow, and a present", () => {
  const rows = [
    "initiative.diagnostic.export",
    "graph.readiness.check",
    "project.readiness.get",
  ];
  for (const id of rows) {
    const route = ROUTES.find((r) => r.id === id);
    assert.ok(route, `missing route ${id}`);
    assert.equal(route!.location, undefined, `${id} must have no location`);
    assert.equal(route!.readRow, undefined, `${id} must have no readRow`);
    assert.ok(route!.present, `${id} must have a present`);
  }
});
