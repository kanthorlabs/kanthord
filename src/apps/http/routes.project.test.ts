// src/apps/http/routes.project.test.ts — Story S4: project.list, project.get,
// project.overview.get rows over the wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { GetProjectOverviewOutput } from "../../app/project/get-project-overview.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  const lines: string[] = [];
  return {
    lines,
    info() {},
    warn() {},
    error(message: string, fields?: Record<string, unknown>) {
      lines.push(JSON.stringify({ level: "error", message, ...fields }));
    },
  };
}

function overviewFixture(projectId: string): GetProjectOverviewOutput {
  return {
    projectId,
    initiatives: [],
    lanes: [],
    decisions: [],
    digest: {
      since: null,
      latest: null,
      totalCount: 0,
      byType: {},
      events: [],
      hasMore: false,
      pageCursor: null,
    },
  };
}

function makeDeps(): {
  deps: HttpDeps;
  received: {
    listProjects?: unknown;
    getProject?: unknown;
    getProjectOverview?: unknown;
  };
  getProjectCalls: () => number;
} {
  const received: {
    listProjects?: unknown;
    getProject?: unknown;
    getProjectOverview?: unknown;
  } = {};
  let getProjectCalls = 0;
  const deps = {
    logger: makeLogger(),
    listProjects: {
      execute: (input: unknown) => {
        received.listProjects = input;
        return [{ id: "p1", name: "alpha" }];
      },
    } as HttpDeps["listProjects"],
    getProject: {
      execute: async (input: unknown) => {
        received.getProject = input;
        getProjectCalls += 1;
        const id = (input as { id: string }).id;
        if (id === "missing") {
          throw new UnknownReferenceError("project", id);
        }
        return { id, name: "alpha" };
      },
    } as HttpDeps["getProject"],
    getProjectOverview: {
      execute: async (input: unknown) => {
        received.getProjectOverview = input;
        return overviewFixture((input as { projectId: string }).projectId);
      },
    } as HttpDeps["getProjectOverview"],
  } as unknown as HttpDeps;
  return { deps, received, getProjectCalls: () => getProjectCalls };
}

test("GET /api/project returns 200 with { data: [ {id,name} ] }; fake received {}", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { data: [{ id: "p1", name: "alpha" }] });
  assert.deepEqual(received.listProjects, {});
});

test("GET /api/project?name=alpha forwards { name: 'alpha' } to the fake", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project?name=alpha")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listProjects, { name: "alpha" });
});

test("GET /api/project?name=alpha&name=beta is 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project?name=alpha&name=beta")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("GET /api/project/p1 returns 200; fake received { id: 'p1' } and run called it once", async () => {
  const { deps, received, getProjectCalls } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getProject, { id: "p1" });
  assert.equal(getProjectCalls(), 1);
});

test("GET /api/project/%20 is 400 invalid_input; the fake's execute was never called", async () => {
  const { deps: baseDeps } = makeDeps();
  let calls = 0;
  const deps: HttpDeps = {
    ...baseDeps,
    getProject: {
      execute: async (input: unknown) => {
        calls += 1;
        return { id: (input as { id: string }).id, name: "alpha" };
      },
    } as HttpDeps["getProject"],
  };
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/%20")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(calls, 0);
});

test("GET /api/project/p1 where the fake throws UnknownReferenceError is 404 unknown_reference", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/missing")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("GET /api/project/p1/overview returns 200; fake received { projectId: 'p1' }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/overview")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.getProjectOverview, { projectId: "p1" });
  assert.equal(res.body.data.projectId, "p1");
});

test("POST /api/project is 405 with Allow: GET", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "GET");
});
