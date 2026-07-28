import { test } from "node:test";
import assert from "node:assert/strict";
import { toResult, MissingFlagError } from "./error-map.ts";
import {
  UnknownReferenceError,
  WrongTypeReferenceError,
  DuplicateNameError,
  AmbiguousNameError,
  ObjectiveNotAwaitingConfirmationError,
  SequencingLockedError,
  SequencingScopeError,
} from "../../app/errors.ts";
import { StaleCandidateError } from "../../domain/initiative.ts";
import {
  CrossInitiativeError,
  UnknownNodeError,
  DuplicateRefError,
  CreateModeIdError,
  DriftConflictError,
} from "../../app/graph/import-errors.ts";
import {
  CursorNotUlidError,
  CursorAheadOfFeedError,
} from "../../app/project/ack-project.ts";

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

// ---------------------------------------------------------------------------
// Review blocker B1 (007.16) — `approve objective` on an `integrated`
// objective, and `reject objective --resolution retry` from `building`, both
// throw ObjectiveNotAwaitingConfirmationError today, but toResult's
// instanceof chain doesn't map it, so the CLI dies with a raw Node stack
// trace instead of Story 03 B's single-line error at non-zero exit.
// ---------------------------------------------------------------------------

test("ObjectiveNotAwaitingConfirmationError maps to exit 1 with a single-line message on stderr (B1)", () => {
  const err = new ObjectiveNotAwaitingConfirmationError(
    "01JZZZZZZZZZZZZZZZZZZZOBJ001",
    "integrated",
  );
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(
    result.stderr.length,
    1,
    "exactly one error line, not a stack trace",
  );
  assert.ok(
    result.stderr[0]!.startsWith("error:"),
    `expected 'error:' prefix; got: ${result.stderr[0]}`,
  );
});

// ---------------------------------------------------------------------------
// Story 4 (007.17-s4) — sequencing error types render to exit 1 + error line
// ---------------------------------------------------------------------------

test("SequencingLockedError maps to exit 1 with single error line (21)", () => {
  const err = new SequencingLockedError("I1", ["T1"]);
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(result.stderr[0]!.startsWith("error:"));
});

test("SequencingScopeError maps to exit 1 with single error line (22)", () => {
  const err = new SequencingScopeError("I1", "I2", "project");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1);
  assert.ok(result.stderr[0]!.startsWith("error:"));
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

// ---------------------------------------------------------------------------
// Story 4 (012) — StaleCandidateError is the verdict-guard refusal. The CLI
// must render it as a single `error: …` line and exit 1 (not re-throw, not
// print a stack trace).
// ---------------------------------------------------------------------------

test("StaleCandidateError maps to exit 1 with single error line matching /stale|expected|moved/i (Story 4, 012)", () => {
  const err = new StaleCandidateError("obj-1", "0".repeat(40), "abc");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1, "exactly one error line");
  assert.ok(
    result.stderr[0]!.startsWith("error:"),
    `expected 'error:' prefix; got: ${result.stderr[0]!}`,
  );
  assert.match(
    result.stderr[0]!,
    /stale|expected|moved/i,
    `expected verdict-guard message to mention the move; got: ${result.stderr[0]!}`,
  );
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 6 — `abandon task` typed errors map to exit 1 + error line.
// All three are produced by `AbandonTask.execute` and must be registered in
// `src/apps/cli/error-map.ts` so the CLI does not re-throw them as raw stack
// traces (unregistered errors are rethrown, error-map.ts:122).
// ---------------------------------------------------------------------------

import {
  TaskNotAbandonableError,
  NoRunningJobError,
  AmbiguousRunningJobError,
} from "../../app/task/abandon-task.ts";

test("TaskNotAbandonableError maps to exit 1 with the locked 'task … is not abandonable (status: …)' message (013 S6)", () => {
  const err = new TaskNotAbandonableError("t1", "completed");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(
    result.stderr.length,
    1,
    "exactly one error line, not a stack trace",
  );
  assert.equal(
    result.stderr[0],
    "error: task t1 is not abandonable (status: completed)",
    `stderr must be the locked error message; got: ${result.stderr[0]}`,
  );
});

test("NoRunningJobError maps to exit 1 with the locked 'task … has no running job to abandon' message (013 S6)", () => {
  const err = new NoRunningJobError("t1");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(
    result.stderr.length,
    1,
    "exactly one error line, not a stack trace",
  );
  assert.equal(
    result.stderr[0],
    "error: task t1 has no running job to abandon",
    `stderr must be the locked error message; got: ${result.stderr[0]}`,
  );
});

test("AmbiguousRunningJobError maps to exit 1 with the locked 'task … has N running jobs; refusing to guess which to abandon' message (013 S6)", () => {
  const err = new AmbiguousRunningJobError("t1", 2);
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(
    result.stderr.length,
    1,
    "exactly one error line, not a stack trace",
  );
  assert.equal(
    result.stderr[0],
    "error: task t1 has 2 running jobs; refusing to guess which to abandon",
    `stderr must be the locked error message; got: ${result.stderr[0]}`,
  );
});

// ---------------------------------------------------------------------------
// 016 Story 5 — AckProject error types render to exit 1 + single "error: …"
// line. Both are pinned in Story 5 §D: the CLI refuses to crash on a
// non-ULID or ahead-of-feed cursor so the operator can correct it.
// ---------------------------------------------------------------------------

test("CursorNotUlidError maps to exit 1 with the locked message on stderr (016 S5)", () => {
  const err = new CursorNotUlidError("not-a-ulid");
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1, "exactly one error line");
  assert.equal(
    result.stderr[0],
    "error: cursor is not a ULID: not-a-ulid",
    `stderr must be the locked message; got: ${result.stderr[0]}`,
  );
});

test("CursorAheadOfFeedError maps to exit 1 with the locked message on stderr (016 S5)", () => {
  const err = new CursorAheadOfFeedError(
    "01H99999999999999999999999",
    "01H00000000000000000000001",
  );
  const result = toResult(err);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr.length, 1, "exactly one error line");
  assert.equal(
    result.stderr[0],
    "error: cursor 01H99999999999999999999999 is ahead of the project feed (latest: 01H00000000000000000000001)",
    `stderr must be the locked message; got: ${result.stderr[0]}`,
  );
});
