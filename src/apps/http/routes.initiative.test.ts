// src/apps/http/routes.initiative.test.ts — Story S5: project.initiative.list,
// initiative.get, initiative.graph.get, initiative.objective.list,
// objective.get rows over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
} from "../../app/errors.ts";
import type { GetInitiativeOutput } from "../../app/initiative/get-initiative.ts";
import type { GetInitiativeGraphOutput } from "../../app/initiative/get-initiative-graph.ts";
import type { GetObjectiveOutput } from "../../app/objective/get-objective.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function initiativeFixture(id: string): GetInitiativeOutput {
  return {
    id,
    name: "init one",
    status: "building",
    paused: false,
    branch: `kanthord/init/${id}`,
    after: [],
    waiting: [],
  };
}

function graphFixture(id: string): GetInitiativeGraphOutput {
  return {
    projectId: "p1",
    initiative: {
      id,
      name: "init one",
      status: "building",
      paused: false,
      branch: `kanthord/init/${id}`,
      action: null,
    },
    groups: [],
    nodes: [],
    edges: [],
    criticalPath: { metric: "remaining-node-count", nodeIds: [], length: 0 },
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
  };
}

function objectiveFixture(id: string): GetObjectiveOutput {
  return {
    id,
    name: "objective one",
    status: "building",
    integrations: [],
    after: [],
    waiting: [],
    conflictCause: null,
    conflictReason: null,
    note: null,
  };
}

function makeDeps(): {
  deps: HttpDeps;
  received: {
    listInitiatives?: unknown;
    getInitiative?: unknown;
    getInitiativeGraph?: unknown;
    listObjectives?: unknown;
    getObjective?: unknown;
  };
  getInitiativeGraphCalls: number;
} {
  const received: {
    listInitiatives?: unknown;
    getInitiative?: unknown;
    getInitiativeGraph?: unknown;
    listObjectives?: unknown;
    getObjective?: unknown;
  } = {};
  let getInitiativeGraphCalls = 0;
  const deps: HttpDeps = {
    logger: makeLogger(),
    listInitiatives: {
      execute: (input: unknown) => {
        received.listInitiatives = input;
        return [{ id: "i1", projectId: "p1", name: "init one", paused: false }];
      },
    } as HttpDeps["listInitiatives"],
    getInitiative: {
      execute: async (input: unknown) => {
        received.getInitiative = input;
        const id = (input as { id: string }).id;
        if (id === "missing") {
          throw new UnknownReferenceError("initiative", id);
        }
        return initiativeFixture(id);
      },
    } as HttpDeps["getInitiative"],
    getInitiativeGraph: {
      execute: async (input: unknown) => {
        received.getInitiativeGraph = input;
        getInitiativeGraphCalls += 1;
        return graphFixture((input as { id: string }).id);
      },
    } as HttpDeps["getInitiativeGraph"],
    listObjectives: {
      execute: (input: unknown) => {
        received.listObjectives = input;
        return [{ id: "o1", initiativeId: "i1", name: "objective one" }];
      },
    } as HttpDeps["listObjectives"],
    getObjective: {
      execute: async (input: unknown) => {
        received.getObjective = input;
        return objectiveFixture((input as { id: string }).id);
      },
    } as HttpDeps["getObjective"],
  } as unknown as HttpDeps;
  return { deps, received, getInitiativeGraphCalls };
}

test("GET /api/project/p1/initiative forwards { projectId: 'p1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/initiative")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listInitiatives, { projectId: "p1" });
});

test("GET /api/project/p1/initiative?name=x forwards { projectId: 'p1', name: 'x' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/initiative?name=x")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listInitiatives, { projectId: "p1", name: "x" });
});

test("GET /api/initiative/i1 forwards { id: 'i1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getInitiative, { id: "i1" });
});

test("GET /api/initiative/missing where the fake throws UnknownReferenceError is 404 unknown_reference", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/missing")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("GET /api/initiative/i1/graph forwards { id: 'i1' }, not { initiativeId: 'i1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/graph")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getInitiativeGraph, { id: "i1" });
});

test("GET /api/initiative/%20/graph is 400 invalid_input; the fake was never called", async () => {
  const { deps, getInitiativeGraphCalls } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/%20/graph")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(getInitiativeGraphCalls, 0);
});

test("GET /api/initiative/i1/objective forwards { initiativeId: 'i1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/initiative/i1/objective")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listObjectives, { initiativeId: "i1" });
});

test("GET /api/objective/o1 forwards { id: 'o1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/objective/o1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getObjective, { id: "o1" });
});

// ─── EPIC 023 Story S5 — initiative.suspension.put, initiative.suspension.delete ───

function makeSuspensionDeps(): {
  deps: HttpDeps;
  pauseInitiativeCalls: unknown[];
  resumeInitiativeCalls: unknown[];
  pauseThrows?: Error;
  resumeThrows?: Error;
} {
  const state: {
    pauseInitiativeCalls: unknown[];
    resumeInitiativeCalls: unknown[];
    pauseThrows?: Error;
    resumeThrows?: Error;
  } = { pauseInitiativeCalls: [], resumeInitiativeCalls: [] };
  const deps: HttpDeps = {
    logger: makeLogger(),
    pauseInitiative: {
      execute: async (input: unknown) => {
        state.pauseInitiativeCalls.push(input);
        if (state.pauseThrows) throw state.pauseThrows;
      },
    } as HttpDeps["pauseInitiative"],
    resumeInitiative: {
      execute: async (input: unknown) => {
        state.resumeInitiativeCalls.push(input);
        if (state.resumeThrows) throw state.resumeThrows;
      },
    } as HttpDeps["resumeInitiative"],
  } as unknown as HttpDeps;
  return Object.assign(state, { deps });
}

test("decode for initiative.suspension.put and .delete each produce exactly { initiativeId: 'i1' }; a blank id is 400 invalid_input", async () => {
  const { deps, pauseInitiativeCalls, resumeInitiativeCalls } =
    makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  await request(app.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.deepEqual(pauseInitiativeCalls[0], { initiativeId: "i1" });

  await request(app.callback())
    .delete("/api/initiative/i1/suspension")
    .set("Authorization", AUTH);
  assert.deepEqual(resumeInitiativeCalls[0], { initiativeId: "i1" });

  const blankPut = await request(app.callback())
    .put("/api/initiative/%20/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(blankPut.status, 400);
  assert.equal(blankPut.body.error.code, "invalid_input");

  const blankDelete = await request(app.callback())
    .delete("/api/initiative/%20/suspension")
    .set("Authorization", AUTH);
  assert.equal(blankDelete.status, 400);
  assert.equal(blankDelete.body.error.code, "invalid_input");
});

test("PUT /api/initiative/i1/suspension calls pauseInitiative exactly once, resumeInitiative zero times, answers 204 with no body and no etag header", async () => {
  const { deps, pauseInitiativeCalls, resumeInitiativeCalls } =
    makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 204);
  assert.equal(res.headers.etag, undefined);
  assert.equal(res.body && Object.keys(res.body).length, 0);
  assert.equal(pauseInitiativeCalls.length, 1);
  assert.equal(resumeInitiativeCalls.length, 0);
});

test("two consecutive PUTs both answer 204 and call pauseInitiative twice (idempotent at the protocol level)", async () => {
  const { deps, pauseInitiativeCalls } = makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res1 = await request(app.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  const res2 = await request(app.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res1.status, 204);
  assert.equal(res2.status, 204);
  assert.equal(pauseInitiativeCalls.length, 2);
});

test("DELETE /api/initiative/i1/suspension with no Content-Type answers 204 and calls resumeInitiative once", async () => {
  const { deps, resumeInitiativeCalls } = makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .delete("/api/initiative/i1/suspension")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.equal(resumeInitiativeCalls.length, 1);
});

test("two consecutive DELETEs both answer 204", async () => {
  const { deps } = makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res1 = await request(app.callback())
    .delete("/api/initiative/i1/suspension")
    .set("Authorization", AUTH);
  const res2 = await request(app.callback())
    .delete("/api/initiative/i1/suspension")
    .set("Authorization", AUTH);
  assert.equal(res1.status, 204);
  assert.equal(res2.status, 204);
});

test("PUT /api/initiative/i1/suspension with Content-Type: text/plain is 415 unsupported_media_type", async () => {
  const { deps } = makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "text/plain")
    .send("hi");
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, "unsupported_media_type");
});

test("PUT /api/initiative/i1/suspension with Origin: http://127.0.0.1:1 is 403 origin_not_allowed", async () => {
  const { deps } = makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("Origin", "http://127.0.0.1:1")
    .send({});
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "origin_not_allowed");
});

test("a fake pauseInitiative raising UnknownReferenceError is 404 unknown_reference; WrongTypeReferenceError is 400 wrong_type_reference", async () => {
  const notFound = makeSuspensionDeps();
  notFound.pauseThrows = new UnknownReferenceError("initiative", "i1");
  const app1 = buildHttpApp(notFound.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res1 = await request(app1.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res1.status, 404);
  assert.equal(res1.body.error.code, "unknown_reference");

  const wrongType = makeSuspensionDeps();
  wrongType.pauseThrows = new WrongTypeReferenceError(
    "initiative",
    "project",
    "i1",
  );
  const app2 = buildHttpApp(wrongType.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res2 = await request(app2.callback())
    .put("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res2.status, 400);
  assert.equal(res2.body.error.code, "wrong_type_reference");
});

test("POST /api/initiative/i1/suspension is 405 with an Allow header containing both DELETE and PUT", async () => {
  const { deps } = makeSuspensionDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/initiative/i1/suspension")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "DELETE, PUT");
});
