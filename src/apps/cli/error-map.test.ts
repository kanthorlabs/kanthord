import { test } from "node:test";
import assert from "node:assert/strict";
import { toResult, MissingFlagError } from "./error-map.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  AmbiguousNameError,
} from "../../app/errors.ts";

test("UnknownReferenceError maps to exit 1 with locked message on stderr", () => {
  const err = new UnknownReferenceError("project", "abc123");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, ["error: no project with id abc123"]);
});

test("WrongTypeReferenceError maps to exit 1 with locked message on stderr", () => {
  const err = new WrongTypeReferenceError("project", "task", "abc123");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: abc123 is a task, expected a project",
  ]);
});

test("DuplicateNameError maps to exit 1 with locked message on stderr", () => {
  const err = new DuplicateNameError("project", "scope-id", "oauth");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: a project named oauth already exists in scope-id",
  ]);
});

test("AmbiguousNameError maps to exit 1 with locked message on stderr", () => {
  const err = new AmbiguousNameError("project", "deploy", ["id1", "id2"]);
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, [
    "error: multiple project named deploy: id1, id2",
  ]);
});

test("MissingFlagError maps to exit 1 with locked message on stderr", () => {
  const err = new MissingFlagError("--title");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.stderr, ["error: missing required flag --title"]);
});

test("unexpected Error rethrows from toResult", () => {
  const err = new Error("something went very wrong");
  assert.throws(() => toResult(err), /something went very wrong/);
});
