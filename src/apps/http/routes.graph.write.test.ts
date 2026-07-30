// src/apps/http/routes.graph.write.test.ts — Story S7: the three graph rows
// (project.graph.create, initiative.graph.apply, initiative.package.get),
// over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import {
  CreateModeIdError,
  UnknownNodeError,
  CrossInitiativeError,
  UnboundAliasError,
  StaleManifestError,
  UncreatableObjectiveError,
} from "../../app/graph/import-errors.ts";
import { ROUTES } from "./routes.ts";
import type { GraphPackage } from "../../app/graph/graph-package.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function minimalPkg(): Record<string, unknown> {
  return {
    packageId: "PKG1",
    formatVersion: 1,
    initiative: { ref: "init", name: "Initiative", sourcePath: "init.md" },
    objectives: [],
    tasks: [],
  };
}

type Recorder = { received?: unknown; calls: number };

function recordExecute<T>(
  recorder: Recorder,
  impl: (input: unknown) => T | Promise<T>,
) {
  return {
    execute: async (input: unknown) => {
      recorder.received = input;
      recorder.calls += 1;
      return impl(input);
    },
  };
}

function makeDeps() {
  const createGraphRec: Recorder = { calls: 0 };
  const applyGraphRec: Recorder = { calls: 0 };
  const exportInitiativeRec: Recorder = { calls: 0 };

  let createGraphImpl: (input: unknown) => unknown = () => ({
    initiativeId: "i1",
    refToId: { objectives: {}, tasks: {} },
    nodes: {},
  });
  let applyGraphImpl: (input: unknown) => unknown = () => ({
    applied: false,
    classifications: [],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 0 },
    conflicts: [],
  });
  let exportInitiativeImpl: (id: string) => unknown = () => ({
    packageId: "PKG1",
    formatVersion: 1,
    initiative: { ref: "init", name: "Initiative", sourcePath: "init.md" },
    objectives: [],
    tasks: [],
  });

  const deps = {
    logger: makeLogger(),
    newId: () => "MINTED",
    createGraph: recordExecute(createGraphRec, (input) =>
      createGraphImpl(input),
    ),
    applyGraph: recordExecute(applyGraphRec, (input) => applyGraphImpl(input)),
    exportInitiative: {
      execute: async (id: string) => {
        exportInitiativeRec.received = id;
        exportInitiativeRec.calls += 1;
        return exportInitiativeImpl(id);
      },
    },
    getInitiativeGraph: {
      execute: async () => ({
        projectId: "p1",
        initiative: {
          id: "i1",
          name: "init one",
          status: "building",
          paused: false,
          branch: "kanthord/init/i1",
          action: null,
        },
        groups: [],
        nodes: [],
        edges: [],
        criticalPath: {
          metric: "remaining-node-count",
          nodeIds: [],
          length: 0,
        },
        counts: {
          pending: 0,
          running: 0,
          completed: 0,
          failed: 0,
          awaiting_confirmation: 0,
          discarded: 0,
          blocked: 0,
          blockedForever: 0,
          actionable: 0,
        },
      }),
    },
  } as unknown as HttpDeps;

  return {
    deps,
    setCreateGraphImpl: (impl: (input: unknown) => unknown) => {
      createGraphImpl = impl;
    },
    setApplyGraphImpl: (impl: (input: unknown) => unknown) => {
      applyGraphImpl = impl;
    },
    setExportInitiativeImpl: (impl: (id: string) => unknown) => {
      exportInitiativeImpl = impl;
    },
    recs: { createGraphRec, applyGraphRec, exportInitiativeRec },
  };
}

function app(deps: HttpDeps) {
  return buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID });
}

test("POST /api/project/p1/graph with pkg+bindings -> 201, Location, and the fake receives {pkg,projectId,packageId:MINTED,paused:false,bindings}", async () => {
  const { deps, recs } = makeDeps();
  const pkg = minimalPkg();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg, bindings: { source: "r1" } });
  assert.equal(res.status, 201);
  assert.equal(res.headers.location, "/api/initiative/i1");
  assert.deepEqual(res.body.data, {
    initiativeId: "i1",
    refToId: { objectives: {}, tasks: {} },
    nodes: {},
  });
  const received = recs.createGraphRec.received as {
    pkg: GraphPackage;
    projectId: string;
    packageId: string;
    paused: boolean;
    bindings?: Record<string, string>;
  };
  assert.deepEqual(received, {
    pkg,
    projectId: "p1",
    packageId: "MINTED",
    paused: false,
    bindings: { source: "r1" },
  });
});

test("POST /api/project/p1/graph without bindings -> the fake receives no bindings key", async () => {
  const { deps, recs } = makeDeps();
  const pkg = minimalPkg();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg });
  assert.equal(res.status, 201);
  const received = recs.createGraphRec.received as Record<string, unknown>;
  assert.ok(!("bindings" in received));
});

test("POST /api/project/p1/graph with paused:true -> the fake receives paused:true", async () => {
  const { deps, recs } = makeDeps();
  const pkg = minimalPkg();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg, paused: true });
  assert.equal(res.status, 201);
  const received = recs.createGraphRec.received as { paused: boolean };
  assert.equal(received.paused, true);
});

test("POST /api/project/p1/graph with {} -> 400 invalid_input naming pkg, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.match(res.body.error.message, /pkg/);
  assert.equal(recs.createGraphRec.calls, 0);
});

test("POST /api/project/p1/graph with {pkg:'x'} -> 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: "x" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/project/p1/graph with {pkg:{}} -> 400 invalid_package (not 500), fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: {} });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_package");
  assert.equal(recs.createGraphRec.calls, 0);
});

test("POST /api/initiative/i1/graph with a structurally-broken pkg -> 400 invalid_package, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: { packageId: "p", formatVersion: 3 } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_package");
  assert.equal(recs.applyGraphRec.calls, 0);
});

test("createGraph throwing CreateModeIdError -> 400 create_mode_id", async () => {
  const { deps, setCreateGraphImpl } = makeDeps();
  setCreateGraphImpl(() => {
    throw new CreateModeIdError("a.md", "01X");
  });
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "create_mode_id");
});

test("createGraph throwing UnknownNodeError -> 404 unknown_node", async () => {
  const { deps, setCreateGraphImpl } = makeDeps();
  setCreateGraphImpl(() => {
    throw new UnknownNodeError("a.md", "ref");
  });
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_node");
});

test("createGraph throwing CrossInitiativeError -> 409 cross_initiative", async () => {
  const { deps, setCreateGraphImpl } = makeDeps();
  setCreateGraphImpl(() => {
    throw new CrossInitiativeError("a.md", "ref", "i1", "i2");
  });
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "cross_initiative");
});

test("createGraph throwing UnboundAliasError -> 400 unbound_alias", async () => {
  const { deps, setCreateGraphImpl } = makeDeps();
  setCreateGraphImpl(() => {
    throw new UnboundAliasError("source");
  });
  const res = await request(app(deps).callback())
    .post("/api/project/p1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "unbound_alias");
});

test("POST /api/initiative/i1/graph with dryRun:true -> 200, fake receives {pkg,initiativeId,dryRun:true}, body.data.applied is the fake's return", async () => {
  const { deps, recs, setApplyGraphImpl } = makeDeps();
  setApplyGraphImpl(() => ({
    applied: false,
    classifications: [],
    summary: { created: 0, updated: 0, unchanged: 0, missing: 0 },
    conflicts: [],
  }));
  const pkg = minimalPkg();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg, dryRun: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.applied, false);
  assert.deepEqual(recs.applyGraphRec.received, {
    pkg,
    initiativeId: "i1",
    dryRun: true,
  });
});

test("POST /api/initiative/i1/graph with only pkg -> fake receives exactly {pkg,initiativeId}, no dryRun/deleteMissing/confirmDelete keys", async () => {
  const { deps, recs } = makeDeps();
  const pkg = minimalPkg();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg });
  assert.equal(res.status, 200);
  assert.deepEqual(recs.applyGraphRec.received, { pkg, initiativeId: "i1" });
});

test("applyGraph throwing StaleManifestError -> 409 stale_manifest", async () => {
  const { deps, setApplyGraphImpl } = makeDeps();
  setApplyGraphImpl(() => {
    throw new StaleManifestError(2, 3, "i1");
  });
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "stale_manifest");
});

test("applyGraph throwing UncreatableObjectiveError -> 409 uncreatable_objective", async () => {
  const { deps, setApplyGraphImpl } = makeDeps();
  setApplyGraphImpl(() => {
    throw new UncreatableObjectiveError("i1", [
      { objectiveRef: "obj1", taskRefs: ["t1"] },
    ]);
  });
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "uncreatable_objective");
});

test("GET /api/initiative/i1/package -> 200, fake receives the positional string 'i1', ETag present", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .get("/api/initiative/i1/package")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(recs.exportInitiativeRec.received, "i1");
  assert.equal(res.body.data.packageId, "PKG1");
  assert.ok(res.headers.etag);
});

test("GET /api/initiative/%20/package -> 400 invalid_input, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .get("/api/initiative/%20/package")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(recs.exportInitiativeRec.calls, 0);
});

test("GET /api/initiative/x/package with exportInitiative throwing UnknownReferenceError -> 404 unknown_reference", async () => {
  const { deps, setExportInitiativeImpl } = makeDeps();
  setExportInitiativeImpl(() => {
    throw new UnknownReferenceError("initiative", "x");
  });
  const res = await request(app(deps).callback())
    .get("/api/initiative/x/package")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("POST /api/initiative/i1/graph and GET /api/initiative/i1/graph both resolve: POST reaches applyGraph, GET reaches getInitiativeGraph", async () => {
  const { deps, recs } = makeDeps();
  const postRes = await request(app(deps).callback())
    .post("/api/initiative/i1/graph")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ pkg: minimalPkg() });
  assert.equal(postRes.status, 200);
  assert.equal(recs.applyGraphRec.calls, 1);

  const getRes = await request(app(deps).callback())
    .get("/api/initiative/i1/graph")
    .set("Authorization", AUTH);
  assert.equal(getRes.status, 200);
});

test("021 S7: row shapes — project.graph.create has location+present; initiative.graph.apply and initiative.package.get have no location but do have present", () => {
  const createRoute = ROUTES.find((r) => r.id === "project.graph.create");
  const applyRoute = ROUTES.find((r) => r.id === "initiative.graph.apply");
  const getRoute = ROUTES.find((r) => r.id === "initiative.package.get");
  assert.ok(createRoute, "missing route project.graph.create");
  assert.ok(applyRoute, "missing route initiative.graph.apply");
  assert.ok(getRoute, "missing route initiative.package.get");
  assert.equal(typeof createRoute!.location, "function");
  assert.ok(createRoute!.present);
  assert.equal(applyRoute!.location, undefined);
  assert.ok(applyRoute!.present);
  assert.equal(getRoute!.location, undefined);
  assert.ok(getRoute!.present);
});
