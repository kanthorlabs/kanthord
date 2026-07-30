// src/apps/http/routes.event.test.ts — EPIC 022 Story S2: event.list and
// project.acknowledgement.create rows over the wire, fakes only, no server,
// no sqlite. Built on the routes.task.test.ts pattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import { UnknownReferenceError } from "../../app/errors.ts";
import {
  CursorNotUlidError,
  CursorAheadOfFeedError,
} from "../../app/project/ack-project.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

type ReadEventPageResult = { events: unknown[]; nextCursor: string | null };

function makeDeps(options?: {
  readEventPageResult?: ReadEventPageResult;
  ackProjectResult?: { cursor: string };
  ackProjectThrows?: unknown;
}) {
  const received: { readEventPage?: unknown; ackProject?: unknown } = {};
  let readEventPageCalls = 0;
  let ackProjectCalls = 0;
  const readEventPageResult: ReadEventPageResult =
    options?.readEventPageResult ?? { events: [], nextCursor: null };
  const deps = {
    logger: makeLogger(),
    readEventPage: {
      execute: (input: unknown) => {
        received.readEventPage = input;
        readEventPageCalls += 1;
        return readEventPageResult;
      },
    } as unknown as HttpDeps["readEventPage"],
    ackProject: {
      execute: async (input: unknown) => {
        received.ackProject = input;
        ackProjectCalls += 1;
        if (options?.ackProjectThrows) {
          throw options.ackProjectThrows;
        }
        return (
          options?.ackProjectResult ?? { cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }
        );
      },
    } as HttpDeps["ackProject"],
  } as unknown as HttpDeps;
  return {
    deps,
    received,
    get readEventPageCalls() {
      return readEventPageCalls;
    },
    get ackProjectCalls() {
      return ackProjectCalls;
    },
  };
}

test("GET /api/event forwards exactly { after: '' } and answers 200", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.readEventPage, { after: "" });
});

test("GET /api/event?after=…&limit=5&project=p1 forwards { after, limit, projectId }", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event?after=01ARZ3NDEKTSV4RRFFQ69G5FAV&limit=5&project=p1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.readEventPage, {
    after: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    limit: 5,
    projectId: "p1",
  });
});

test("GET /api/event?project=p1 forwards { after: '', projectId: 'p1' } (no limit key)", async () => {
  const { deps, received } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event?project=p1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(received.readEventPage, { after: "", projectId: "p1" });
});

test("GET /api/event?after=0 is 400 invalid_input; readEventPage is not called", async () => {
  const setup = makeDeps();
  const app = buildHttpApp(setup.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event?after=0")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(setup.readEventPageCalls, 0);
});

for (const bad of ["0", "501", "abc"]) {
  test(`GET /api/event?limit=${bad} is 400 invalid_input; readEventPage is not called`, async () => {
    const setup = makeDeps();
    const app = buildHttpApp(setup.deps, {
      apiKey: KEY,
      newRequestId: () => REQUEST_ID,
    });
    const res = await request(app.callback())
      .get(`/api/event?limit=${bad}`)
      .set("Authorization", AUTH);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "invalid_input");
    assert.equal(setup.readEventPageCalls, 0);
  });
}

test("GET /api/event?limit=1&limit=2 (repeated) is 400 invalid_input; readEventPage is not called", async () => {
  const setup = makeDeps();
  const app = buildHttpApp(setup.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event?limit=1&limit=2")
    .set("Authorization", AUTH);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(setup.readEventPageCalls, 0);
});

test("GET /api/event 200 body shape is exactly { events, nextCursor } with a non-empty ETag", async () => {
  const setup = makeDeps({
    readEventPageResult: {
      events: [{ id: "A1", type: "task.ready" }],
      nextCursor: "A1",
    },
  });
  const app = buildHttpApp(setup.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body.data).sort(), ["events", "nextCursor"]);
  assert.equal(typeof res.headers.etag, "string");
  assert.ok((res.headers.etag as string).length > 0);
  assert.equal(setup.readEventPageCalls, 1);
});

test("GET /api/event with an empty page answers 200 and nextCursor is null", async () => {
  const { deps } = makeDeps({
    readEventPageResult: { events: [], nextCursor: null },
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/event")
    .set("Authorization", AUTH);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.nextCursor, null);
});

test("POST /api/project/p1/acknowledgement forwards { projectId, cursor }, answers 200 with { cursor }, no If-Match sent", async () => {
  const setup = makeDeps();
  const app = buildHttpApp(setup.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/p1/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.equal(res.status, 200);
  assert.deepEqual(setup.received.ackProject, {
    projectId: "p1",
    cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  });
  assert.equal(setup.ackProjectCalls, 1);
  assert.deepEqual(Object.keys(res.body.data), ["cursor"]);
  assert.equal(typeof res.headers.etag, "string");
  assert.ok((res.headers.etag as string).length > 0);
});

test("POST /api/project/p1/acknowledgement returns the fake's cursor even when it differs from the submitted one", async () => {
  const { deps } = makeDeps({
    ackProjectResult: { cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAT" },
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/p1/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.cursor, "01ARZ3NDEKTSV4RRFFQ69G5FAT");
});

test("POST /api/project/p1/acknowledgement with {} is 400 invalid_input; ackProject is not called", async () => {
  const setup = makeDeps();
  const app = buildHttpApp(setup.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/p1/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(setup.ackProjectCalls, 0);
});

test("POST /api/project/%20/acknowledgement is 400 invalid_input (blank id after trim); ackProject is not called", async () => {
  const setup = makeDeps();
  const app = buildHttpApp(setup.deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/%20/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(setup.ackProjectCalls, 0);
});

test("POST /api/project/p1/acknowledgement: a fake CursorNotUlidError maps to 400 cursor_not_ulid", async () => {
  const { deps } = makeDeps({
    ackProjectThrows: new CursorNotUlidError("nope"),
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/p1/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "cursor_not_ulid");
});

test("POST /api/project/p1/acknowledgement: a fake CursorAheadOfFeedError maps to 409 cursor_ahead_of_feed", async () => {
  const { deps } = makeDeps({
    ackProjectThrows: new CursorAheadOfFeedError(
      "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      null,
    ),
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/p1/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "cursor_ahead_of_feed");
});

test("POST /api/project/p9/acknowledgement: a fake UnknownReferenceError maps to 404 unknown_reference", async () => {
  const { deps } = makeDeps({
    ackProjectThrows: new UnknownReferenceError("project", "p9"),
  });
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .post("/api/project/p9/acknowledgement")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("PUT /api/event is 405", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .put("/api/event")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 405);
});

test("GET /api/events (plural) is 404 unknown_route", async () => {
  const { deps } = makeDeps();
  const app = buildHttpApp(deps, {
    apiKey: KEY,
    newRequestId: () => REQUEST_ID,
  });
  const res = await request(app.callback())
    .get("/api/events")
    .set("Authorization", AUTH);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_route");
});
