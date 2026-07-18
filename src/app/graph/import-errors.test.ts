/**
 * Story 09 T1 — provenance contract over all named import errors (B7/B15).
 *
 * Each named error class in `import-errors.ts` must expose:
 *   - sourcePath (B7 — the offending file's path)
 *   - ref and/or id (the node reference or id)
 *   - kind-specific extras: expectedInitiativeId+actualInitiativeId,
 *     otherSourcePath+ref, or expectedSha+actualSha
 * CrossInitiativeError and UnknownNodeError must be DISTINCT classes (B15).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CrossInitiativeError,
  UnknownNodeError,
  DuplicateRefError,
  CreateModeIdError,
  DriftConflictError,
} from "./import-errors.ts";

// ---------------------------------------------------------------------------
// (a) CrossInitiativeError
// ---------------------------------------------------------------------------

test("CrossInitiativeError exposes sourcePath, ref, expectedInitiativeId, actualInitiativeId", () => {
  const err = new CrossInitiativeError(
    "src/tasks/task.md",
    "task-ref",
    "INIT001",
    "INIT999",
  );
  assert.equal(err.sourcePath, "src/tasks/task.md");
  assert.equal(err.ref, "task-ref");
  assert.equal(err.expectedInitiativeId, "INIT001");
  assert.equal(err.actualInitiativeId, "INIT999");
  assert.equal(err.name, "CrossInitiativeError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// (a) UnknownNodeError
// ---------------------------------------------------------------------------

test("UnknownNodeError exposes sourcePath and ref", () => {
  const err = new UnknownNodeError("src/tasks/task.md", "unknown-ref");
  assert.equal(err.sourcePath, "src/tasks/task.md");
  assert.equal(err.ref, "unknown-ref");
  assert.equal(err.name, "UnknownNodeError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// (a) DuplicateRefError
// ---------------------------------------------------------------------------

test("DuplicateRefError exposes sourcePath, otherSourcePath, and ref", () => {
  const err = new DuplicateRefError(
    "src/tasks/task-a.md",
    "src/tasks/task-b.md",
    "shared-ref",
  );
  assert.equal(err.sourcePath, "src/tasks/task-a.md");
  assert.equal(err.otherSourcePath, "src/tasks/task-b.md");
  assert.equal(err.ref, "shared-ref");
  assert.equal(err.name, "DuplicateRefError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// (a) CreateModeIdError — provenance extended with id field
// ---------------------------------------------------------------------------

test("CreateModeIdError exposes sourcePath and id", () => {
  const err = new CreateModeIdError(
    "src/tasks/task.md",
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  );
  assert.equal(err.sourcePath, "src/tasks/task.md");
  assert.equal(err.id, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
  assert.equal(err.name, "CreateModeIdError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// (a) DriftConflictError — carries expected vs actual sha (B15 provenance)
// ---------------------------------------------------------------------------

test("DriftConflictError exposes sourcePath, ref, expectedSha, actualSha", () => {
  const expected = "a".repeat(64);
  const actual = "b".repeat(64);
  const err = new DriftConflictError(
    "src/tasks/implement-api.md",
    "implement-api",
    expected,
    actual,
  );
  assert.equal(err.sourcePath, "src/tasks/implement-api.md");
  assert.equal(err.ref, "implement-api");
  assert.equal(err.expectedSha, expected);
  assert.equal(err.actualSha, actual);
  assert.equal(err.name, "DriftConflictError");
  assert.ok(err instanceof Error);
});

// ---------------------------------------------------------------------------
// (b) CrossInitiativeError and UnknownNodeError are DISTINCT classes (B15)
// ---------------------------------------------------------------------------

test("CrossInitiativeError.name and UnknownNodeError.name are distinct strings", () => {
  const crossErr = new CrossInitiativeError("path.md", "ref", "I1", "I2");
  const unknownErr = new UnknownNodeError("path.md", "ref");
  assert.notEqual(crossErr.name, unknownErr.name);
  assert.ok(!(crossErr instanceof UnknownNodeError));
  assert.ok(!(unknownErr instanceof CrossInitiativeError));
});
