import { test } from "node:test";
import assert from "node:assert/strict";
import { toResult, MissingFlagError } from "./error-map.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  AmbiguousNameError,
} from "../../app/errors.ts";
import {
  CrossInitiativeError,
  UnknownNodeError,
  DuplicateRefError,
  CreateModeIdError,
  DriftConflictError,
} from "../../app/graph/import-errors.ts";

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

// ---------------------------------------------------------------------------
// Story 09 T1 (c) — error-map renders each named import error to a single
// "error: …" line + exit 1, and the line CITES the sourcePath (B7/B15).
// ---------------------------------------------------------------------------

test("CrossInitiativeError maps to exit 1 with sourcePath cited", () => {
  const err = new CrossInitiativeError(
    "src/tasks/task.md",
    "task-ref",
    "INIT001",
    "INIT999",
  );
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(
    result.stderr[0]!.includes("src/tasks/task.md"),
    `expected stderr line to cite sourcePath; got: ${result.stderr[0]!}`,
  );
  assert.ok(
    result.stderr[0]!.startsWith("error:"),
    `expected stderr line to start with "error:"; got: ${result.stderr[0]!}`,
  );
});

test("UnknownNodeError maps to exit 1 with sourcePath cited", () => {
  const err = new UnknownNodeError("src/tasks/task.md", "unknown-ref");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(
    result.stderr[0]!.includes("src/tasks/task.md"),
    `expected stderr line to cite sourcePath; got: ${result.stderr[0]!}`,
  );
  assert.ok(result.stderr[0]!.startsWith("error:"));
});

test("DuplicateRefError maps to exit 1 with sourcePath cited", () => {
  const err = new DuplicateRefError(
    "src/tasks/task-a.md",
    "src/tasks/task-b.md",
    "shared-ref",
  );
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(
    result.stderr[0]!.includes("src/tasks/task-a.md"),
    `expected stderr line to cite sourcePath; got: ${result.stderr[0]!}`,
  );
  assert.ok(result.stderr[0]!.startsWith("error:"));
});

test("CreateModeIdError maps to exit 1 with sourcePath cited", () => {
  const err = new CreateModeIdError(
    "src/tasks/task.md",
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  );
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(
    result.stderr[0]!.includes("src/tasks/task.md"),
    `expected stderr line to cite sourcePath; got: ${result.stderr[0]!}`,
  );
  assert.ok(result.stderr[0]!.startsWith("error:"));
});

test("DriftConflictError maps to exit 1 with sourcePath cited", () => {
  const err = new DriftConflictError(
    "src/tasks/implement-api.md",
    "implement-api",
    "a".repeat(64),
    "b".repeat(64),
  );
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(
    result.stderr[0]!.includes("src/tasks/implement-api.md"),
    `expected stderr line to cite sourcePath; got: ${result.stderr[0]!}`,
  );
  assert.ok(result.stderr[0]!.startsWith("error:"));
});
