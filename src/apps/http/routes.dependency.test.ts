// src/apps/http/routes.dependency.test.ts — Story S6: the six dependency
// sub-resource rows (task/initiative/objective, create+delete), over the
// wire, fakes only, no server, no sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { buildHttpApp } from "./app.ts";
import type { HttpDeps } from "./deps.ts";
import {
  CycleError,
  UnknownReferenceError,
  WrongTypeReferenceError,
  DependenciesLockedError,
  SequencingScopeError,
  SequencingLockedError,
} from "../../app/errors.ts";
import { ROUTES } from "./routes.ts";

const KEY = "0123456789abcdef0123456789abcdef";
const AUTH = "Basic " + Buffer.from("kanthord:" + KEY).toString("base64");
const REQUEST_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function makeLogger() {
  return { info() {}, warn() {}, error() {} };
}

type Recorder = { received?: unknown; calls: number };

function recordExecute(
  recorder: Recorder,
  impl: (input: unknown) => void | Promise<void> = () => {},
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
  const addDependencyRec: Recorder = { calls: 0 };
  const removeDependencyRec: Recorder = { calls: 0 };
  const addInitiativeDependencyRec: Recorder = { calls: 0 };
  const removeInitiativeDependencyRec: Recorder = { calls: 0 };
  const addObjectiveDependencyRec: Recorder = { calls: 0 };
  const removeObjectiveDependencyRec: Recorder = { calls: 0 };

  let addDependencyImpl: (input: unknown) => void = () => {};
  let addInitiativeDependencyImpl: (input: unknown) => void = () => {};

  const deps = {
    logger: makeLogger(),
    addDependency: recordExecute(addDependencyRec, (input) =>
      addDependencyImpl(input),
    ),
    removeDependency: recordExecute(removeDependencyRec),
    addInitiativeDependency: recordExecute(
      addInitiativeDependencyRec,
      (input) => addInitiativeDependencyImpl(input),
    ),
    removeInitiativeDependency: recordExecute(removeInitiativeDependencyRec),
    addObjectiveDependency: recordExecute(addObjectiveDependencyRec),
    removeObjectiveDependency: recordExecute(removeObjectiveDependencyRec),
  } as unknown as HttpDeps;

  return {
    deps,
    setAddDependencyImpl: (impl: (input: unknown) => void) => {
      addDependencyImpl = impl;
    },
    setAddInitiativeDependencyImpl: (impl: (input: unknown) => void) => {
      addInitiativeDependencyImpl = impl;
    },
    recs: {
      addDependencyRec,
      removeDependencyRec,
      addInitiativeDependencyRec,
      removeInitiativeDependencyRec,
      addObjectiveDependencyRec,
      removeObjectiveDependencyRec,
    },
  };
}

function app(deps: HttpDeps) {
  return buildHttpApp(deps, { apiKey: KEY, newRequestId: () => REQUEST_ID });
}

test("POST /api/task/t2/dependency/t1 -> 204, empty body, no ETag, no Content-Type, fake received {taskId,dependencyId}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/task/t2/dependency/t1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 204);
  assert.equal(res.text, "");
  assert.equal(res.headers.etag, undefined);
  assert.equal(res.headers["content-type"], undefined);
  assert.deepEqual(recs.addDependencyRec.received, {
    taskId: "t2",
    dependencyId: "t1",
  });
});

test("DELETE /api/task/t2/dependency/t1 (no body, no Content-Type) -> 204, fake received {taskId,dependencyId}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .delete("/api/task/t2/dependency/t1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.deepEqual(recs.removeDependencyRec.received, {
    taskId: "t2",
    dependencyId: "t1",
  });
});

test("POST /api/initiative/i2/dependency/i1 -> 204, fake received {initiativeId,dependencyId}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/initiative/i2/dependency/i1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 204);
  assert.deepEqual(recs.addInitiativeDependencyRec.received, {
    initiativeId: "i2",
    dependencyId: "i1",
  });
});

test("DELETE /api/initiative/i2/dependency/i1 -> 204, fake received {initiativeId,dependencyId}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .delete("/api/initiative/i2/dependency/i1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.deepEqual(recs.removeInitiativeDependencyRec.received, {
    initiativeId: "i2",
    dependencyId: "i1",
  });
});

test("POST /api/objective/o2/dependency/o1 -> 204, fake received {objectiveId,dependencyId}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/objective/o2/dependency/o1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 204);
  assert.deepEqual(recs.addObjectiveDependencyRec.received, {
    objectiveId: "o2",
    dependencyId: "o1",
  });
});

test("DELETE /api/objective/o2/dependency/o1 -> 204, fake received {objectiveId,dependencyId}", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .delete("/api/objective/o2/dependency/o1")
    .set("Authorization", AUTH);
  assert.equal(res.status, 204);
  assert.deepEqual(recs.removeObjectiveDependencyRec.received, {
    objectiveId: "o2",
    dependencyId: "o1",
  });
});

test("POST /api/task/%20/dependency/t1 -> 400 invalid_input, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/task/%20/dependency/t1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(recs.addDependencyRec.calls, 0);
});

test("POST /api/task/t2/dependency/%20 -> 400 invalid_input, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/task/t2/dependency/%20")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "invalid_input");
  assert.equal(recs.addDependencyRec.calls, 0);
});

test("POST /api/task/t1/dependency/t1 where the fake throws CycleError -> 409 cycle_detected", async () => {
  const { deps, setAddDependencyImpl } = makeDeps();
  setAddDependencyImpl(() => {
    throw new CycleError(["t1"]);
  });
  const res = await request(app(deps).callback())
    .post("/api/task/t1/dependency/t1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "cycle_detected");
});

test("POST /api/task/t2/dependency/x where the fake throws UnknownReferenceError -> 404 unknown_reference", async () => {
  const { deps, setAddDependencyImpl } = makeDeps();
  setAddDependencyImpl(() => {
    throw new UnknownReferenceError("task", "x");
  });
  const res = await request(app(deps).callback())
    .post("/api/task/t2/dependency/x")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "unknown_reference");
});

test("POST /api/task/t2/dependency/t1 where the fake throws WrongTypeReferenceError -> 400 wrong_type_reference", async () => {
  const { deps, setAddDependencyImpl } = makeDeps();
  setAddDependencyImpl(() => {
    throw new WrongTypeReferenceError("task", "project", "x");
  });
  const res = await request(app(deps).callback())
    .post("/api/task/t2/dependency/t1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "wrong_type_reference");
});

test("POST /api/task/t2/dependency/t1 where the fake throws DependenciesLockedError -> 409 dependencies_locked", async () => {
  const { deps, setAddDependencyImpl } = makeDeps();
  setAddDependencyImpl(() => {
    throw new DependenciesLockedError("t2", "running");
  });
  const res = await request(app(deps).callback())
    .post("/api/task/t2/dependency/t1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "dependencies_locked");
});

test("POST /api/initiative/i2/dependency/i1 where the fake throws SequencingScopeError -> 400 sequencing_scope", async () => {
  const { deps, setAddInitiativeDependencyImpl } = makeDeps();
  setAddInitiativeDependencyImpl(() => {
    throw new SequencingScopeError("i2", "i1", "project");
  });
  const res = await request(app(deps).callback())
    .post("/api/initiative/i2/dependency/i1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "sequencing_scope");
});

test("POST /api/initiative/i2/dependency/i1 where the fake throws SequencingLockedError -> 409 sequencing_locked", async () => {
  const { deps, setAddInitiativeDependencyImpl } = makeDeps();
  setAddInitiativeDependencyImpl(() => {
    throw new SequencingLockedError("i2", []);
  });
  const res = await request(app(deps).callback())
    .post("/api/initiative/i2/dependency/i1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "sequencing_locked");
});

test("POST /api/task/t2/dependency/t1 WITHOUT Content-Type -> 415 unsupported_media_type, fake never called", async () => {
  const { deps, recs } = makeDeps();
  const res = await request(app(deps).callback())
    .post("/api/task/t2/dependency/t1")
    .set("Authorization", AUTH)
    .send("{}");
  assert.equal(res.status, 415);
  assert.equal(res.body.error.code, "unsupported_media_type");
  assert.equal(recs.addDependencyRec.calls, 0);
});

test("PUT /api/task/t2/dependency/t1 -> 405 with Allow: DELETE, POST", async () => {
  const { deps } = makeDeps();
  const res = await request(app(deps).callback())
    .put("/api/task/t2/dependency/t1")
    .set("Authorization", AUTH)
    .set("Content-Type", "application/json")
    .send({});
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, "DELETE, POST");
});

test("021 S6: each of the six dependency rows declares no present, no location, no readRow", () => {
  const ids = [
    "task.dependency.create",
    "task.dependency.delete",
    "initiative.dependency.create",
    "initiative.dependency.delete",
    "objective.dependency.create",
    "objective.dependency.delete",
  ];
  for (const id of ids) {
    const route = ROUTES.find((r) => r.id === id);
    assert.ok(route, `missing route ${id}`);
    assert.equal(route!.present, undefined, `${id} must not declare present`);
    assert.equal(route!.location, undefined, `${id} must not declare location`);
    assert.equal(route!.readRow, undefined, `${id} must not declare readRow`);
  }
});
