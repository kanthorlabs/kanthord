// src/apps/http/error-registry.test.ts — mapError resolution + registry hygiene (Story 02).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UnknownReferenceError,
  DuplicateNameError,
  ObjectiveNotInConflictError,
} from "../../app/errors.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import { InvalidInputError } from "./errors.ts";
import {
  DOMAIN_ERROR_MAPPINGS,
  TRANSPORT_ERRORS,
  mapError,
} from "./error-registry.ts";

const ALLOWED_STATUSES = new Set([
  400, 401, 403, 404, 405, 409, 412, 413, 415, 500,
]);

test("registry hygiene: unique snake_case codes, allowed statuses only", () => {
  const codes: string[] = [
    ...DOMAIN_ERROR_MAPPINGS.map((m) => m.code),
    ...Object.values(TRANSPORT_ERRORS).map((m) => m.code),
  ];
  for (const code of codes) {
    assert.match(
      code,
      /^[a-z]+(_[a-z]+)*$/,
      `code "${code}" is not snake_case`,
    );
  }
  assert.equal(new Set(codes).size, codes.length, "codes must be unique");

  const statuses: number[] = [
    ...DOMAIN_ERROR_MAPPINGS.map((m) => m.status),
    ...Object.values(TRANSPORT_ERRORS).map((m) => m.status),
  ];
  for (const status of statuses) {
    assert.ok(ALLOWED_STATUSES.has(status), `status ${status} not allowed`);
  }
});

test("mapError maps UnknownReferenceError to unknown_reference/404 with its own message", () => {
  const err = new UnknownReferenceError("project", "P1");
  const mapped = mapError(err);
  assert.equal(mapped.code, "unknown_reference");
  assert.equal(mapped.status, 404);
  assert.equal(mapped.message, err.message);
});

test("mapError maps DuplicateNameError to duplicate_name/409", () => {
  const mapped = mapError(new DuplicateNameError("project", "global", "x"));
  assert.equal(mapped.code, "duplicate_name");
  assert.equal(mapped.status, 409);
});

test("mapError maps NoConflictCandidateError to no_conflict_candidate/409", () => {
  const mapped = mapError(new NoConflictCandidateError("t1"));
  assert.equal(mapped.code, "no_conflict_candidate");
  assert.equal(mapped.status, 409);
});

test("mapError maps ObjectiveNotInConflictError to objective_not_in_conflict/409", () => {
  const mapped = mapError(new ObjectiveNotInConflictError("o1", "building"));
  assert.equal(mapped.code, "objective_not_in_conflict");
  assert.equal(mapped.status, 409);
});

test("mapError maps InvalidInputError (an HttpFailure) to invalid_input/400", () => {
  const mapped = mapError(new InvalidInputError("id", "must not be blank"));
  assert.equal(mapped.code, "invalid_input");
  assert.equal(mapped.status, 400);
  assert.match(mapped.message, /id/);
});

test("mapError recognises an http-errors-shaped 413 (status) with a fixed message, never the thrown message", () => {
  const err = Object.assign(new Error("Payload Too Large"), { status: 413 });
  const mapped = mapError(err);
  assert.equal(mapped.code, "body_too_large");
  assert.equal(mapped.status, 413);
  assert.equal(mapped.message, "request body too large");
  assert.doesNotMatch(mapped.message, /Payload/);
});

test("mapError recognises the statusCode spelling too (400 -> malformed_body)", () => {
  const err = Object.assign(new Error("x"), { statusCode: 400 });
  const mapped = mapError(err);
  assert.equal(mapped.code, "malformed_body");
});

test("mapError does not pass through an unrecognised http-errors status", () => {
  const err = Object.assign(new Error("x"), { status: 418 });
  const mapped = mapError(err);
  assert.equal(mapped.code, "internal");
  assert.equal(mapped.status, 500);
});

test("mapError falls back to internal/500 for a plain Error, hiding its message", () => {
  const mapped = mapError(new Error("boom"));
  assert.deepEqual(mapped, {
    code: "internal",
    status: 500,
    message: "internal error",
  });
  assert.doesNotMatch(mapped.message, /boom/);
});

test("mapError falls back to internal for non-Error thrown values", () => {
  assert.equal(mapError("a string").code, "internal");
  assert.equal(mapError(undefined).code, "internal");
});
