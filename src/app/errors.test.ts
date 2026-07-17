import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  AmbiguousNameError,
} from "./errors.ts";

test("UnknownReferenceError sets fields and locked message", () => {
  const err = new UnknownReferenceError("project", "01HZABC");
  assert.equal(err.kind, "project");
  assert.equal(err.id, "01HZABC");
  assert.equal(err.message, "no project with id 01HZABC");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "UnknownReferenceError");
});

test("WrongTypeReferenceError sets fields and locked message", () => {
  const err = new WrongTypeReferenceError("project", "task", "01HZXYZ");
  assert.equal(err.expected, "project");
  assert.equal(err.actual, "task");
  assert.equal(err.id, "01HZXYZ");
  assert.equal(err.message, "01HZXYZ is a task, expected a project");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "WrongTypeReferenceError");
});

test("DuplicateNameError sets fields and locked message", () => {
  const err = new DuplicateNameError("initiative", "proj-01", "oauth");
  assert.equal(err.kind, "initiative");
  assert.equal(err.scope, "proj-01");
  assert.equal(err.errorName, "oauth");
  assert.equal(
    err.message,
    "a initiative named oauth already exists in proj-01",
  );
  assert.ok(err instanceof Error);
  assert.equal(err.name, "DuplicateNameError");
});

test("AmbiguousNameError sets fields and locked message", () => {
  const err = new AmbiguousNameError("task", "deploy", ["01AAA", "01BBB"]);
  assert.equal(err.kind, "task");
  assert.equal(err.errorName, "deploy");
  assert.deepEqual(err.ids, ["01AAA", "01BBB"]);
  assert.equal(err.message, "multiple task named deploy: 01AAA, 01BBB");
  assert.ok(err instanceof Error);
  assert.equal(err.name, "AmbiguousNameError");
});
