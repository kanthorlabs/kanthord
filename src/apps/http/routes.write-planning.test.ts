// src/apps/http/routes.write-planning.test.ts — Story S4: the seven planning
// write rows (project/initiative/objective/task create+patch) over the wire,
// fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  InvalidTaskFieldError,
} from "../../app/errors.ts";
import { UnknownAgentError } from "../../agent-runner/port.ts";
import { ROUTES } from "./routes.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return {
    info() {},
    warn() {},
    error() {},
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
  const createProjectRec: Recorder = { calls: 0 };
  const renameProjectRec: Recorder = { calls: 0 };
  const createInitiativeRec: Recorder = { calls: 0 };
  const renameInitiativeRec: Recorder = { calls: 0 };
  const createObjectiveRec: Recorder = { calls: 0 };
  const renameObjectiveRec: Recorder = { calls: 0 };
  const createTaskRec: Recorder = { calls: 0 };

  let projectName = "alpha";
  let initiativeName = "init";
  let objectiveName = "obj";

  const deps = {
    logger: makeLogger(),
    createProject: recordExecute(createProjectRec, (input) => {
      const { name } = input as { name: string };
      if (name === "dup") {
        throw new DuplicateNameError("project", "global", name);
      }
      return "p-new";
    }),
    renameProject: recordExecute(renameProjectRec, () => {
      projectName = "alpha-2";
    }),
    getProject: {
      execute: async (input: { id: string }) => ({
        id: input.id,
        name: projectName,
      }),
    },
    createInitiative: recordExecute(createInitiativeRec, (input) => {
      const rec = input as { projectId: string };
      if (rec.projectId === "wrong-type") {
        throw new WrongTypeReferenceError("project", "initiative", "p1");
      }
      if (rec.projectId === "missing") {
        throw new UnknownReferenceError("project", "missing");
      }
      return "i-new";
    }),
    renameInitiative: recordExecute(renameInitiativeRec, () => {
      initiativeName = "init-2";
    }),
    getInitiative: {
      execute: async (input: { id: string }) => ({
        id: input.id,
        name: initiativeName,
        status: "active",
        paused: false,
        branch: "main",
        after: [],
        waiting: [],
      }),
    },
    createObjective: recordExecute(createObjectiveRec, () => "o-new"),
    renameObjective: recordExecute(renameObjectiveRec, () => {
      objectiveName = "obj-2";
    }),
    getObjective: {
      execute: async (input: { id: string }) => ({
        id: input.id,
        initiativeId: "i1",
        name: objectiveName,
        status: "active",
        integrations: [],
        after: [],
        waiting: [],
        conflictReason: null,
        note: null,
      }),
    },
    createTask: recordExecute(createTaskRec, (input) => {
      const rec = input as Record<string, unknown>;
      if (
        typeof rec["title"] === "string" &&
        rec["title"].includes("bad-field")
      ) {
        throw new InvalidTaskFieldError("ac");
      }
      if (
        typeof rec["title"] === "string" &&
        rec["title"].includes("bad-agent")
      ) {
        throw new UnknownAgentError("nope");
      }
      return "t-new";
    }),
  } as unknown as HttpDeps;

  return {
    deps,
    recs: {
      createProjectRec,
      renameProjectRec,
      createInitiativeRec,
      renameInitiativeRec,
      createObjectiveRec,
      renameObjectiveRec,
      createTaskRec,
    },
  };
}

function app(deps: HttpDeps) {
  return buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID });
}

// --- project.create ---

test("POST /api/project with {name:'alpha'} -> 201, Location, id body, no ETag, fake received trimmed name", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "alpha" });
  assert.equal(res.status, 201);
  assert.equal(res.headers.location, "/api/project/p-new");
  assert.deepEqual(res.body, { data: { id: "p-new" } });
  assert.equal(res.headers.etag, undefined);
  assert.deepEqual(recs.createProjectRec.received, { name: "alpha" });
});

test("POST /api/project with padded name trims it before reaching the fake", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "  a  " });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.createProjectRec.received, { name: "a" });
});

test("POST /api/project with blank or missing name -> 400 invalid_input, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const blank = await request(app(deps).callback())
    .post("/api/project")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "   " });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.error.code, "invalid_input");

  const missing = await request(app(deps).callback())
    .post("/api/project")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "invalid_input");
  assert.equal(recs.createProjectRec.calls, 0);
});

test("POST /api/project where the fake throws DuplicateNameError -> 409 duplicate_name", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "dup" });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "duplicate_name");
});

// --- project.patch ---

test("PATCH /api/project/p1 with no If-Match -> 428, renameProject never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .patch("/api/project/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "alpha-2" });
  assert.equal(res.status, 428);
  assert.equal(res.body.error.code, "precondition_required");
  assert.equal(recs.renameProjectRec.calls, 0);
});

test("PATCH /api/project/p1 with a stale If-Match -> 412, renameProject never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .patch("/api/project/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"stale"')
    .send({ name: "alpha-2" });
  assert.equal(res.status, 412);
  assert.equal(res.body.error.code, "precondition_failed");
  assert.equal(recs.renameProjectRec.calls, 0);
});

test("PATCH /api/project/p1 with the real ETag -> 200, re-read DTO, fresh ETag, fake called once with {id,name}", async () => {
  const { deps, recs } = makeDeps();
  const a = app(deps);
  const before = await request(a.callback())
    .get("/api/project/p1")
    .set("Authorization", AUTH);
  const sentIfMatch = before.headers["etag"] as string;

  const res = await request(a.callback())
    .patch("/api/project/p1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", sentIfMatch)
    .send({ name: "alpha-2" });
  assert.equal(res.status, 200);
  assert.equal(recs.renameProjectRec.calls, 1);
  assert.deepEqual(recs.renameProjectRec.received, {
    id: "p1",
    name: "alpha-2",
  });
  assert.deepEqual(res.body.data, { id: "p1", name: "alpha-2" });
  assert.notEqual(res.headers["etag"], sentIfMatch);
});

test("PATCH /api/project/%20 -> 400 invalid_input, no use case called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .patch("/api/project/%20")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"whatever"')
    .send({ name: "alpha-2" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(recs.renameProjectRec.calls, 0);
});

// --- project.initiative.create ---

test("POST /api/project/p1/initiative with only {name} -> fake received projectId+name+paused:false", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/initiative")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "i" });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.createInitiativeRec.received, {
    projectId: "p1",
    name: "i",
    paused: false,
  });
});

test("POST /api/project/p1/initiative with paused+after -> fake received all four keys, trimmed", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/initiative")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "i", paused: true, after: ["x", " y "] });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.createInitiativeRec.received, {
    projectId: "p1",
    name: "i",
    paused: true,
    after: ["x", "y"],
  });
});

test("POST /api/project/p1/initiative -> Location: /api/initiative/<id>", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/project/p1/initiative")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "i" });
  assert.equal(res.headers.location, "/api/initiative/i-new");
});

test("POST /api/project/wrong-type/initiative -> 400 wrong_type_reference; /missing/ -> 404 unknown_reference", async () => {
  const { deps } = makeDeps();
  const a = app(deps);
  const wrongType = await request(a.callback())
    .post("/api/project/wrong-type/initiative")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "i" });
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.body.error.code, "wrong_type_reference");

  const missing = await request(a.callback())
    .post("/api/project/missing/initiative")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "i" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "unknown_reference");
});

// --- initiative.patch / objective.patch: 428/412/200-fresh-ETag triples ---

test("PATCH /api/initiative/i1: 428 without If-Match, 412 stale, 200 with fresh ETag and fake received {id,name}", async () => {
  const { deps, recs } = makeDeps();
  const a = app(deps);

  const noMatch = await request(a.callback())
    .patch("/api/initiative/i1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "init-2" });
  assert.equal(noMatch.status, 428);

  const stale = await request(a.callback())
    .patch("/api/initiative/i1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"stale"')
    .send({ name: "init-2" });
  assert.equal(stale.status, 412);
  assert.equal(recs.renameInitiativeRec.calls, 0);

  const before = await request(a.callback())
    .get("/api/initiative/i1")
    .set("Authorization", AUTH);
  const sentIfMatch = before.headers["etag"] as string;
  const ok = await request(a.callback())
    .patch("/api/initiative/i1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", sentIfMatch)
    .send({ name: "init-2" });
  assert.equal(ok.status, 200);
  assert.equal(recs.renameInitiativeRec.calls, 1);
  assert.deepEqual(recs.renameInitiativeRec.received, {
    id: "i1",
    name: "init-2",
  });
  assert.notEqual(ok.headers["etag"], sentIfMatch);
});

test("PATCH /api/objective/o1: 428 without If-Match, 412 stale, 200 with fresh ETag and fake received {id,name}", async () => {
  const { deps, recs } = makeDeps();
  const a = app(deps);

  const noMatch = await request(a.callback())
    .patch("/api/objective/o1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "obj-2" });
  assert.equal(noMatch.status, 428);

  const stale = await request(a.callback())
    .patch("/api/objective/o1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", '"stale"')
    .send({ name: "obj-2" });
  assert.equal(stale.status, 412);
  assert.equal(recs.renameObjectiveRec.calls, 0);

  const before = await request(a.callback())
    .get("/api/objective/o1")
    .set("Authorization", AUTH);
  const sentIfMatch = before.headers["etag"] as string;
  const ok = await request(a.callback())
    .patch("/api/objective/o1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .set("If-Match", sentIfMatch)
    .send({ name: "obj-2" });
  assert.equal(ok.status, 200);
  assert.equal(recs.renameObjectiveRec.calls, 1);
  assert.deepEqual(recs.renameObjectiveRec.received, {
    id: "o1",
    name: "obj-2",
  });
  assert.notEqual(ok.headers["etag"], sentIfMatch);
});

// --- initiative.objective.create ---

test("POST /api/initiative/i1/objective -> Location: /api/objective/<id>, fake received {initiativeId,name}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i1/objective")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ name: "o" });
  assert.equal(res.status, 201);
  assert.equal(res.headers.location, "/api/objective/o-new");
  assert.deepEqual(recs.createObjectiveRec.received, {
    initiativeId: "i1",
    name: "o",
  });
});

// --- objective.task.create ---

test("POST /api/objective/o1/task with only {title} -> fake received exactly {objectiveId,title}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/objective/o1/task")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ title: "t" });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.createTaskRec.received, {
    objectiveId: "o1",
    title: "t",
  });
});

test("POST /api/objective/o1/task with every optional field -> fake received all eight keys, trimmed, Location: /api/task/<id>", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/objective/o1/task")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({
      title: "t",
      instructions: "  do it  ",
      ac: ["  a  ", "b"],
      verification: ["  v  "],
      agent: "  claude  ",
      dependencies: ["  dep1  "],
      context: { note: "x" },
    });
  assert.equal(res.status, 201);
  assert.deepEqual(recs.createTaskRec.received, {
    objectiveId: "o1",
    title: "t",
    instructions: "do it",
    ac: ["a", "b"],
    verification: ["v"],
    agent: "claude",
    dependencies: ["dep1"],
    context: { note: "x" },
  });
  assert.equal(res.headers.location, "/api/task/t-new");
});

test("POST /api/objective/o1/task where the fake throws InvalidTaskFieldError -> 400; UnknownAgentError -> 400 unknown_agent", async () => {
  const { deps } = makeDeps();
  const a = app(deps);
  const badField = await request(a.callback())
    .post("/api/objective/o1/task")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ title: "bad-field" });
  assert.equal(badField.status, 400);
  assert.equal(badField.body.error.code, "invalid_task_field");

  const badAgent = await request(a.callback())
    .post("/api/objective/o1/task")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({ title: "bad-agent" });
  assert.equal(badAgent.status, 400);
  assert.equal(badAgent.body.error.code, "unknown_agent");
});

// --- per-row present/location contract, direct on ROUTES ---

const CREATE_ROWS: ReadonlyArray<{ id: string; location: string }> = [
  { id: "project.create", location: "/api/project/abc" },
  { id: "project.initiative.create", location: "/api/initiative/abc" },
  { id: "initiative.objective.create", location: "/api/objective/abc" },
  { id: "objective.task.create", location: "/api/task/abc" },
];

const PATCH_ROWS = ["project.patch", "initiative.patch", "objective.patch"];

test("021 S4: the four create rows present {id} and build the exact Location", () => {
  for (const { id, location } of CREATE_ROWS) {
    const row = ROUTES.find((r) => r.id === id);
    assert.ok(row, `expected a route named ${id}`);
    assert.ok(row!.present, `${id} must declare present`);
    const presented = row!.present!("abc");
    assert.deepEqual(presented, { id: "abc" });
    assert.deepEqual(Object.keys(presented as object), ["id"]);
    assert.ok(row!.location, `${id} must declare location`);
    assert.equal(row!.location!("abc"), location);
  }
});

test("021 S4: the three PATCH rows declare neither present nor location", () => {
  for (const id of PATCH_ROWS) {
    const row = ROUTES.find((r) => r.id === id);
    assert.ok(row, `expected a route named ${id}`);
    assert.equal(row!.present, undefined);
    assert.equal(row!.location, undefined);
  }
});
