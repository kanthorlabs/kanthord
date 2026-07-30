import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requirePathParam,
  optionalQueryInt,
  queryList,
  optionalQueryString,
  optionalQueryUlid,
} from "./decode.ts";
import { InvalidInputError } from "./errors.ts";

test("requirePathParam returns the value when present", () => {
  assert.equal(requirePathParam({ id: "x" }, "id"), "x");
});

test("requirePathParam trims the value", () => {
  assert.equal(requirePathParam({ id: " x " }, "id"), "x");
});

test("requirePathParam throws InvalidInputError naming the field when missing", () => {
  assert.throws(
    () => requirePathParam({}, "id"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "id",
  );
});

test("requirePathParam throws InvalidInputError when empty", () => {
  assert.throws(
    () => requirePathParam({ id: "" }, "id"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "id",
  );
});

test("requirePathParam throws InvalidInputError when blank after trim", () => {
  assert.throws(
    () => requirePathParam({ id: " " }, "id"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "id",
  );
});

test("optionalQueryInt returns undefined when absent", () => {
  assert.equal(optionalQueryInt({}, "limit", { min: 1, max: 100 }), undefined);
});

test("optionalQueryInt parses a valid integer", () => {
  assert.equal(
    optionalQueryInt({ limit: "10" }, "limit", { min: 1, max: 100 }),
    10,
  );
});

test("optionalQueryInt throws for a non-integer value", () => {
  assert.throws(
    () => optionalQueryInt({ limit: "abc" }, "limit", { min: 1, max: 100 }),
    (err: unknown) => err instanceof InvalidInputError && err.field === "limit",
  );
});

test("optionalQueryInt throws for a fractional value", () => {
  assert.throws(
    () => optionalQueryInt({ limit: "1.5" }, "limit", { min: 1, max: 100 }),
    (err: unknown) => err instanceof InvalidInputError && err.field === "limit",
  );
});

test("optionalQueryInt throws for a value below the min bound", () => {
  assert.throws(
    () => optionalQueryInt({ limit: "0" }, "limit", { min: 1, max: 100 }),
    (err: unknown) => err instanceof InvalidInputError && err.field === "limit",
  );
});

test("optionalQueryInt throws for a value above the max bound", () => {
  assert.throws(
    () => optionalQueryInt({ limit: "101" }, "limit", { min: 1, max: 100 }),
    (err: unknown) => err instanceof InvalidInputError && err.field === "limit",
  );
});

test("optionalQueryInt throws for an array value", () => {
  assert.throws(
    () =>
      optionalQueryInt({ limit: ["1", "2"] }, "limit", { min: 1, max: 100 }),
    (err: unknown) => err instanceof InvalidInputError && err.field === "limit",
  );
});

test("queryList returns [] when absent", () => {
  assert.deepEqual(queryList({}, "ids"), []);
});

test("queryList splits a string on commas, trims, and drops empties", () => {
  assert.deepEqual(queryList({ ids: "a, b ,,c" }, "ids"), ["a", "b", "c"]);
});

test("queryList flattens an array of comma-lists per element", () => {
  assert.deepEqual(queryList({ ids: ["a", "b,c"] }, "ids"), ["a", "b", "c"]);
});

test("optionalQueryString returns undefined when absent", () => {
  assert.equal(optionalQueryString({}, "name"), undefined);
});

test("optionalQueryString trims the value", () => {
  assert.equal(optionalQueryString({ name: " alpha " }, "name"), "alpha");
});

test("optionalQueryString throws InvalidInputError naming the field for an array value", () => {
  assert.throws(
    () => optionalQueryString({ name: ["a", "b"] }, "name"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "name",
  );
});

test("optionalQueryString throws InvalidInputError naming the field for a blank/whitespace value", () => {
  assert.throws(
    () => optionalQueryString({ name: "   " }, "name"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "name",
  );
});

// ─── EPIC 022 Story S1 — optionalQueryUlid ──────────────────────────────────

test("optionalQueryUlid returns undefined when absent", () => {
  assert.equal(optionalQueryUlid({}, "after"), undefined);
});

test("optionalQueryUlid returns a valid ULID unchanged", () => {
  assert.equal(
    optionalQueryUlid({ after: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, "after"),
    "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  );
});

test("optionalQueryUlid throws InvalidInputError naming the field for the CLI's '0' sentinel", () => {
  assert.throws(
    () => optionalQueryUlid({ after: "0" }, "after"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "after",
  );
});

test("optionalQueryUlid throws InvalidInputError naming the field for an empty string", () => {
  assert.throws(
    () => optionalQueryUlid({ after: "" }, "after"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "after",
  );
});

test("optionalQueryUlid throws InvalidInputError for a lowercase ULID", () => {
  assert.throws(
    () => optionalQueryUlid({ after: "01arz3ndektsv4rrffq69g5fav" }, "after"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "after",
  );
});

test("optionalQueryUlid throws InvalidInputError for a padded ULID (not trimmed)", () => {
  assert.throws(
    () => optionalQueryUlid({ after: " 01ARZ3NDEKTSV4RRFFQ69G5FAV " }, "after"),
    (err: unknown) => err instanceof InvalidInputError && err.field === "after",
  );
});

test("optionalQueryUlid throws InvalidInputError naming the field for an array value", () => {
  assert.throws(
    () =>
      optionalQueryUlid(
        { after: ["01ARZ3NDEKTSV4RRFFQ69G5FAV", "x"] },
        "after",
      ),
    (err: unknown) => err instanceof InvalidInputError && err.field === "after",
  );
});
