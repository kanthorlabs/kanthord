// src/apps/http/error-registry.test.ts — mapError resolution + registry hygiene (Story 02).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UnknownReferenceError,
  DuplicateNameError,
  ObjectiveNotInConflictError,
  WrongTypeReferenceError,
  CycleError,
  DuplicateTaskError,
  UnknownDependencyError,
  DependenciesLockedError,
  SequencingScopeError,
  SequencingLockedError,
  UnknownAgentError,
  InvalidTaskFieldError,
  EmbeddedCredentialError,
} from "../../app/errors.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import {
  ImmutableFieldError,
  CacheConflictError,
} from "../../app/resource/update-resource.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";
import { GraphPackageDocumentError } from "../../app/graph/decode-graph-package.ts";
import {
  CreateModeIdError,
  UnboundAliasError,
  ExecutorBindingSetError,
  UnknownNodeError,
  CrossInitiativeError,
  StaleManifestError,
  UncreatableObjectiveError,
} from "../../app/graph/import-errors.ts";
import { InvalidInputError } from "./errors.ts";
import {
  DOMAIN_ERROR_MAPPINGS,
  TRANSPORT_ERRORS,
  mapError,
} from "./error-registry.ts";

const ALLOWED_STATUSES = new Set([
  400, 401, 403, 404, 405, 409, 412, 413, 415, 428, 500,
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

test("TRANSPORT_ERRORS carries the two 021 precondition codes", () => {
  assert.deepEqual(TRANSPORT_ERRORS.precondition_required, {
    code: "precondition_required",
    status: 428,
    message: "If-Match is required",
  });
  assert.equal(TRANSPORT_ERRORS.precondition_failed.status, 412);
});

// ─── Story S3 — 21 domain mappings ──────────────────────────────────────────

test("021 S3: DOMAIN_ERROR_MAPPINGS.length is 25 (4 existing + 21 new)", () => {
  assert.equal(DOMAIN_ERROR_MAPPINGS.length, 25);
});

test("021 S3: one class per code — every mapping's type is unique", () => {
  assert.equal(
    new Set(DOMAIN_ERROR_MAPPINGS.map((m) => m.type)).size,
    DOMAIN_ERROR_MAPPINGS.length,
  );
});

test("021 S3: each of the 21 new classes maps to its exact code/status pair", () => {
  const table: Array<{ err: Error; code: string; status: number }> = [
    {
      err: new WrongTypeReferenceError("project", "objective", "X"),
      code: "wrong_type_reference",
      status: 400,
    },
    { err: new CycleError(["a", "b"]), code: "cycle_detected", status: 409 },
    { err: new DuplicateTaskError("T1"), code: "duplicate_task", status: 409 },
    {
      err: new UnknownDependencyError("T1", "T2"),
      code: "unknown_dependency",
      status: 400,
    },
    {
      err: new DependenciesLockedError("T1", "running"),
      code: "dependencies_locked",
      status: 409,
    },
    {
      err: new SequencingScopeError("A", "B", "cross-project"),
      code: "sequencing_scope",
      status: 400,
    },
    {
      err: new SequencingLockedError("N1", ["T1"]),
      code: "sequencing_locked",
      status: 409,
    },
    {
      err: new UnknownAgentError("nope@1"),
      code: "unknown_agent",
      status: 400,
    },
    {
      err: new InvalidTaskFieldError("title"),
      code: "invalid_task_field",
      status: 400,
    },
    {
      err: new EmbeddedCredentialError("https://u:p@h/r"),
      code: "embedded_credential",
      status: 400,
    },
    {
      err: new ImmutableFieldError("path"),
      code: "immutable_field",
      status: 409,
    },
    { err: new CacheConflictError("R1"), code: "cache_conflict", status: 409 },
    {
      err: new ImportValidationError(0, "e"),
      code: "import_validation",
      status: 400,
    },
    {
      err: new CreateModeIdError("obj1.md", "T1"),
      code: "create_mode_id",
      status: 400,
    },
    {
      err: new UnboundAliasError("source"),
      code: "unbound_alias",
      status: 400,
    },
    {
      err: new ExecutorBindingSetError([
        { taskRef: "t1", agent: "a1", missing: ["source"] },
      ]),
      code: "executor_binding_set",
      status: 400,
    },
    {
      err: new UnknownNodeError("obj1.md", "ref"),
      code: "unknown_node",
      status: 404,
    },
    {
      err: new CrossInitiativeError("obj1.md", "ref", "I1", "I2"),
      code: "cross_initiative",
      status: 409,
    },
    {
      err: new StaleManifestError(1, 2, "I1"),
      code: "stale_manifest",
      status: 409,
    },
    {
      err: new UncreatableObjectiveError("I1", []),
      code: "uncreatable_objective",
      status: 409,
    },
    {
      err: new GraphPackageDocumentError("pkg", "must be an object"),
      code: "invalid_package",
      status: 400,
    },
  ];

  assert.equal(table.length, 21, "table covers every new class once");

  for (const { err, code, status } of table) {
    const mapped = mapError(err);
    assert.equal(mapped.code, code, `${err.constructor.name} -> code`);
    assert.equal(mapped.status, status, `${err.constructor.name} -> status`);
    assert.equal(
      mapped.message,
      err.message,
      `${err.constructor.name} keeps its own thrown message`,
    );
  }
});

test("021 S3: registry hygiene still passes with the 23 new codes (21 domain + S1's 2 transport)", () => {
  const codes: string[] = [
    ...DOMAIN_ERROR_MAPPINGS.map((m) => m.code),
    ...Object.values(TRANSPORT_ERRORS).map((m) => m.code),
  ];
  assert.equal(new Set(codes).size, codes.length, "codes must be unique");
});
