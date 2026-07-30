// src/apps/http/routes.write-resource.test.ts — Story S5: the four typed
// resource creates, four typed PATCHes, and the bulk import row, over the
// wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  DuplicateNameError,
  EmbeddedCredentialError,
} from "../../app/errors.ts";
import {
  ImmutableFieldError,
  CacheConflictError,
} from "../../app/resource/update-resource.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";
import { ROUTES } from "./routes.ts";
import type { ResourceView } from "../../app/resource/resource-view.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
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

function repositoryFixture(
  overrides: Partial<ResourceView> = {},
): ResourceView {
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
    ...overrides,
  } as ResourceView;
}

function credentialFixture(overrides: Record<string, unknown> = {}) {
  return {
    type: "credential",
    id: "c1",
    projectId: "p1",
    name: "gh",
    provider: "github",
    ...overrides,
  } as unknown as ResourceView;
}

function makeDeps() {
  const addResourceRec: Recorder = { calls: 0 };
  const updateRepositoryRec: Recorder = { calls: 0 };
  const updateCredentialRec: Recorder = { calls: 0 };
  const updateNotificationRec: Recorder = { calls: 0 };
  const updateFilesystemRec: Recorder = { calls: 0 };
  const importResourcesRec: Recorder = { calls: 0 };

  let getResourceImpl = (id: string): ResourceView => {
    if (id === "r1") {
      return repositoryFixture();
    }
    return credentialFixture();
  };

  const deps = {
    logger: makeLogger(),
    addResource: recordExecute(addResourceRec, (input) => {
      const rec = input as { name: string; remoteUrl?: string };
      if (rec.name === "dup") {
        throw new DuplicateNameError("resource", "p1", "x");
      }
      if (rec.remoteUrl === "https://u:p@h/r.git") {
        throw new EmbeddedCredentialError(rec.remoteUrl);
      }
      return "res-new";
    }),
    updateRepository: recordExecute(updateRepositoryRec, (input) => {
      const rec = input as Record<string, unknown>;
      if (rec["type"] === "credential") {
        throw new ImmutableFieldError("type");
      }
      if (rec["remoteUrl"] === "x") {
        throw new CacheConflictError("r1");
      }
    }),
    updateCredential: recordExecute(updateCredentialRec, () => {}),
    updateNotification: recordExecute(updateNotificationRec, () => {}),
    updateFilesystem: recordExecute(updateFilesystemRec, () => {}),
    importResources: recordExecute(importResourcesRec, (input) => {
      const rec = input as { entries: unknown[] };
      const entries = rec.entries as Array<Record<string, unknown>>;
      if (entries.some((e) => e["name"] === "dup")) {
        throw new ImportValidationError(1, "dup");
      }
      return entries.map((_e, i) => (i === 0 ? "a" : "b"));
    }),
    getResource: {
      execute: async (id: string) => getResourceImpl(id),
    } as unknown as HttpDeps["getResource"],
  } as unknown as HttpDeps;

  return {
    deps,
    setGetResource: (impl: (id: string) => ResourceView) => {
      getResourceImpl = impl;
    },
    recs: {
      addResourceRec,
      updateRepositoryRec,
      updateCredentialRec,
      updateNotificationRec,
      updateFilesystemRec,
      importResourcesRec,
    },
  };
}

function app(deps: HttpDeps) {
  return buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID });
}

// --- the four typed creates ---

test("POST /api/project/p1/repository -> 201, Location: /api/resource/<id>, fake received exact input incl. type:'repository' and path:''", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "repo",
      remoteUrl: "https://example.com/r.git",
      branch: "main",
      auth: { kind: "ambient" },
    });
  assert.equal(res.status, 201);
  assert.equal(res.headers.location, "/api/resource/res-new");
  assert.deepEqual(res.body, { data: { id: "res-new" } });
  assert.deepEqual(recs.addResourceRec.received, {
    type: "repository",
    projectId: "p1",
    name: "repo",
    remoteUrl: "https://example.com/r.git",
    branch: "main",
    path: "",
    auth: { kind: "ambient" },
  });
});

test("POST /api/project/p1/credential -> 201, fake received exact input incl. type:'credential'", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/credential")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "gh", provider: "github", value: "s3cret" });
  assert.equal(res.status, 201);
  assert.equal(res.headers.location, "/api/resource/res-new");
  assert.deepEqual(recs.addResourceRec.received, {
    type: "credential",
    projectId: "p1",
    name: "gh",
    provider: "github",
    value: "s3cret",
  });
});

test("POST /api/project/p1/notification -> 201, fake received exact input incl. type:'notification'", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/notification")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "n", provider: "slack", destination: "#chan" });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.addResourceRec.received, {
    type: "notification",
    projectId: "p1",
    name: "n",
    provider: "slack",
    destination: "#chan",
  });
});

test("POST /api/project/p1/filesystem -> 201, fake received exact input incl. type:'filesystem'", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/filesystem")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "fs", path: "/data" });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.addResourceRec.received, {
    type: "filesystem",
    projectId: "p1",
    name: "fs",
    path: "/data",
  });
});

test("repository create with a https-token auth -> fake received that exact auth object", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "repo",
      remoteUrl: "https://example.com/r.git",
      branch: "main",
      auth: { kind: "https-token", credentialId: "c1" },
    });
  assert.equal(res.status, 201);
  assert.deepEqual((recs.addResourceRec.received as { auth: unknown }).auth, {
    kind: "https-token",
    credentialId: "c1",
  });
});

test("repository create with a bogus auth kind -> 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "repo",
      remoteUrl: "https://example.com/r.git",
      branch: "main",
      auth: { kind: "bogus" },
    });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("repository create with auth missing -> 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "repo",
      remoteUrl: "https://example.com/r.git",
      branch: "main",
    });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("repository create with https-token auth missing credentialId -> 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "repo",
      remoteUrl: "https://example.com/r.git",
      branch: "main",
      auth: { kind: "https-token" },
    });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("notification create with an unknown provider -> 400 invalid_input naming provider, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/notification")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "n", provider: "email", destination: "x@x.com" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.match(res.body.error.message, /provider/);
  assert.equal(recs.addResourceRec.calls, 0);
});

test("credential create: fake received value:'s3cret' but the response JSON does not contain it", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/credential")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "gh", provider: "github", value: "s3cret" });
  assert.equal(res.status, 201);
  assert.equal(
    (recs.addResourceRec.received as { value: string }).value,
    "s3cret",
  );
  assert.equal(JSON.stringify(res.body).includes("s3cret"), false);
});

test("repository create where the fake throws EmbeddedCredentialError -> 400 embedded_credential", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "repo",
      remoteUrl: "https://u:p@h/r.git",
      branch: "main",
      auth: { kind: "ambient" },
    });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "embedded_credential");
});

test("repository create where the fake throws DuplicateNameError -> 409 duplicate_name", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/repository")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      name: "dup",
      remoteUrl: "https://example.com/r.git",
      branch: "main",
      auth: { kind: "ambient" },
    });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "duplicate_name");
});

// --- the four typed PATCHes: 428/412/200 triples ---

for (const [path, use] of [
  ["repository", "updateRepositoryRec"],
  ["credential", "updateCredentialRec"],
  ["notification", "updateNotificationRec"],
  ["filesystem", "updateFilesystemRec"],
] as const) {
  test(`PATCH /api/${path}/r1: 428 without If-Match, 412 stale, 200 with fresh ETag and the write use case called once`, async () => {
    const { deps, recs, setGetResource } = makeDeps();
    // The read-back must reflect that `run` executed, or the pre-read and
    // post-run re-read hash identically and the fresh-ETag assertion below
    // can never pass — mirror the run-based (not call-count-based) state
    // tracking already fixed for S1's makePatchFixture.
    setGetResource(() =>
      path === "repository"
        ? repositoryFixture({
            name: recs[use].calls > 0 ? "repo-updated" : "repo",
          })
        : credentialFixture({
            name: recs[use].calls > 0 ? "updated" : "original",
          }),
    );
    const a = app(deps);
    const body =
      path === "credential"
        ? { name: "new" }
        : path === "notification"
          ? { name: "new" }
          : path === "filesystem"
            ? { name: "new" }
            : { name: "new" };

    const noMatch = await request(a.callback())
      .patch(`/api/${path}/r1`)
      .set("Authorization", AUTH)
      .set("Content-Type", "application/json")
      .send(body);
    assert.equal(noMatch.status, 428);
    assert.equal(recs[use].calls, 0);

    const stale = await request(a.callback())
      .patch(`/api/${path}/r1`)
      .set("Authorization", AUTH)
      .set("Content-Type", "application/json")
      .set("If-Match", '"stale"')
      .send(body);
    assert.equal(stale.status, 412);
    assert.equal(recs[use].calls, 0);

    const before = await request(a.callback())
      .get("/api/resource/r1")
      .set("Authorization", AUTH);
    const sentIfMatch = before.headers["etag"] as string;
    const ok = await request(a.callback())
      .patch(`/api/${path}/r1`)
      .set("Authorization", AUTH)
      .set("Content-Type", "application/json")
      .set("If-Match", sentIfMatch)
      .send(body);
    assert.equal(ok.status, 200);
    assert.equal(recs[use].calls, 1);
    assert.notEqual(ok.headers["etag"], sentIfMatch);
  });
}

test("PATCH /api/credential/c1 with {name} -> fake received exactly {id,name}", async () => {
  const { deps, recs, setGetResource } = makeDeps();
  setGetResource(() => credentialFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/c1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/credential/c1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ name: "gh-2" });
  assert.equal(res.status, 200);
  assert.deepEqual(recs.updateCredentialRec.received, {
    id: "c1",
    name: "gh-2",
  });
});

test("PATCH /api/credential/c1 with {name,type} -> the type probe IS forwarded", async () => {
  const { deps, recs, setGetResource } = makeDeps();
  setGetResource(() => credentialFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/c1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/credential/c1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ name: "gh-2", type: "credential" });
  assert.equal(res.status, 200);
  assert.deepEqual(recs.updateCredentialRec.received, {
    id: "c1",
    name: "gh-2",
    type: "credential",
  });
});

test("PATCH /api/credential/c1 with {name,provider} -> provider is NOT forwarded and is silently ignored, 200", async () => {
  const { deps, recs, setGetResource } = makeDeps();
  setGetResource(() => credentialFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/c1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/credential/c1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ name: "gh-2", provider: "github" });
  assert.equal(res.status, 200);
  assert.deepEqual(recs.updateCredentialRec.received, {
    id: "c1",
    name: "gh-2",
  });
});

test("PATCH /api/repository/r1 with {type:'repository'} (same stored value) -> 200, not 409", async () => {
  const { deps, setGetResource } = makeDeps();
  setGetResource(() => repositoryFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/r1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/repository/r1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ type: "repository" });
  assert.equal(res.status, 200);
});

test("PATCH /api/repository/r1 with {type:'credential'} where the fake throws ImmutableFieldError -> 409 immutable_field", async () => {
  const { deps, setGetResource } = makeDeps();
  setGetResource(() => repositoryFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/r1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/repository/r1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ type: "credential" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "immutable_field");
});

test("PATCH /api/repository/r1 with {type:5} -> 400 invalid_input naming type, write use case never called", async () => {
  const { deps, recs, setGetResource } = makeDeps();
  setGetResource(() => repositoryFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/r1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/repository/r1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ type: 5 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.match(res.body.error.message, /type/);
  assert.equal(recs.updateRepositoryRec.calls, 0);
});

test("PATCH /api/credential/c1 with {value:'rotated'} -> 200, response never contains 'rotated' even when getResource returns it", async () => {
  const { deps, setGetResource } = makeDeps();
  setGetResource(
    () =>
      ({
        ...credentialFixture(),
        value: "rotated",
      }) as unknown as ResourceView,
  );
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/c1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/credential/c1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ value: "rotated" });
  assert.equal(res.status, 200);
  assert.equal(JSON.stringify(res.body).includes("rotated"), false);
});

test("PATCH /api/repository/r1 with {remoteUrl:'x'} where the fake throws CacheConflictError -> 409 cache_conflict", async () => {
  const { deps, setGetResource } = makeDeps();
  setGetResource(() => repositoryFixture());
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/resource/r1")
    .set("Authorization", AUTH);
  const res = await request(a.callback())
    .patch("/api/repository/r1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", before.headers["etag"] as string)
    .send({ remoteUrl: "x" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "cache_conflict");
});

// --- project.resource.create (bulk import) ---

test("POST /api/project/p1/resource with two entries -> 200, {data:{ids}}, no Location, fake received {projectId,entries}", async () => {
  const { deps, recs } = makeDeps();
  const entries = [
    { type: "repository", name: "a" },
    { type: "repository", name: "b" },
  ];
  const res = await request(app(deps).callback())
    .post("/api/project/p1/resource")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ entries });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { data: { ids: ["a", "b"] } });
  assert.equal(res.headers.location, undefined);
  assert.deepEqual(recs.importResourcesRec.received, {
    projectId: "p1",
    entries,
  });
});

test("POST /api/project/p1/resource where the fake throws ImportValidationError -> 400 import_validation", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/resource")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ entries: [{ name: "dup" }] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "import_validation");
});

test("POST /api/project/p1/resource with entries:'x' (a scalar) -> 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/resource")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ entries: "x" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

test("POST /api/project/p1/resource with entries:[1] (a non-object entry) -> 400 invalid_input", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/resource")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ entries: [1] });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
});

// --- per-row present/location contract, direct on ROUTES ---

const CREATE_ROWS = [
  "project.repository.create",
  "project.credential.create",
  "project.notification.create",
  "project.filesystem.create",
];

const PATCH_ROWS = [
  "repository.patch",
  "credential.patch",
  "notification.patch",
  "filesystem.patch",
];

test("021 S5: the four create rows present {id} and build Location /api/resource/<id>", () => {
  for (const id of CREATE_ROWS) {
    const row = ROUTES.find((r) => r.id === id);
    assert.ok(row, `expected a route named ${id}`);
    assert.ok(row!.present, `${id} must declare present`);
    const presented = row!.present!("abc");
    assert.deepEqual(Object.keys(presented as object), ["id"]);
    assert.ok(row!.location, `${id} must declare location`);
    assert.equal(row!.location!("abc"), "/api/resource/abc");
  }
});

test("021 S5: project.resource.create presents {ids} and has no location", () => {
  const row = ROUTES.find((r) => r.id === "project.resource.create");
  assert.ok(row);
  assert.ok(row!.present);
  const presented = row!.present!(["a", "b"]);
  assert.deepEqual(Object.keys(presented as object), ["ids"]);
  assert.equal(row!.location, undefined);
});

test("021 S5: the four PATCH rows declare neither present nor location", () => {
  for (const id of PATCH_ROWS) {
    const row = ROUTES.find((r) => r.id === id);
    assert.ok(row, `expected a route named ${id}`);
    assert.equal(row!.present, undefined);
    assert.equal(row!.location, undefined);
  }
});
