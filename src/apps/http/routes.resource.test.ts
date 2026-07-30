// src/apps/http/routes.resource.test.ts — Story S7: the four typed resource
// sub-collections plus resource.get, over the wire, fakes only, no server, no
// sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import type { ResourceView } from "../../app/resource/resource-view.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

function repositoryFixture(): ResourceView {
  return {
    type: "repository",
    id: "r1",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "/repo",
    auth: { kind: "ambient" },
    publication: null,
  };
}

function makeDeps(): {
  deps: HttpDeps;
  received: { listResources?: unknown; getResource?: unknown };
} {
  const received: { listResources?: unknown; getResource?: unknown } = {};
  const deps = {
    logger: makeLogger(),
    listResources: {
      execute: (input: unknown) => {
        received.listResources = input;
        return [repositoryFixture()];
      },
    } as HttpDeps["listResources"],
    getResource: {
      execute: (input: unknown) => {
        received.getResource = input;
        const id = input as string;
        if (id === "missing") {
          throw new UnknownReferenceError("resource", id);
        }
        return repositoryFixture();
      },
    } as HttpDeps["getResource"],
  } as unknown as HttpDeps;
  return { deps, received };
}

for (const kind of ["repository", "credential", "notification", "filesystem"]) {
  test(`GET /api/project/p1/${kind} forwards { projectId: 'p1', type: '${kind}' }`, async () => {
    const { deps, received } = makeDeps();
    const app = buildHttpApp(deps, {
      apiKey: KEY,
      newRequestId: () => REQUEST_ID,
    });
    const res = await request(app.callback())
      .get(`/api/project/p1/${kind}`)
      .set("Authorization", AUTH);
    assert.equal(res.status, 200);
    assert.deepEqual(received.listResources, { projectId: "p1", type: kind });
  });
}

test("GET /api/project/p1/repository?name=home adds name to the input", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/repository?name=home")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.listResources, {
    projectId: "p1",
    type: "repository",
    name: "home",
  });
});

test("GET /api/project/p1/repository?name= (blank) is 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/repository?name=")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("GET /api/resource/r1 forwards the string 'r1', not an object", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/resource/r1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(received.getResource, "r1");
});

test("GET /api/resource/missing where the fake throws UnknownReferenceError is 404 unknown_reference", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/resource/missing")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("a credential row with a value field returned by the fake never appears in the HTTP response", async () => {
  const { deps } = makeDeps();
  deps.listResources.execute = () => [
    {
      type: "credential",
      id: "c1",
      projectId: "p1",
      name: "creds",
      provider: "github",
      value: "sekret",
    } as unknown as ResourceView,
  ];
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/project/p1/credential")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  const body = JSON.stringify(res.body);
  assert.equal(body.includes("sekret"), false);
  assert.equal(body.includes('"value"'), false);
});
