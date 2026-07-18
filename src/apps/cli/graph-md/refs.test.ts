import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifyRef, MalformedReferenceError } from "./refs.ts";

describe("src/apps/cli/graph-md/refs.ts", () => {
  const VALID_ULID = "01JQVBZ3MHKP4FTGWR5XYENSD7"; // 26-char uppercase Crockford

  test("classifyRef returns ulid for a valid 26-char uppercase Crockford string", () => {
    assert.strictEqual(classifyRef(VALID_ULID), "ulid");
  });

  test("classifyRef returns ref for a lowercase slug", () => {
    assert.strictEqual(classifyRef("implement-api"), "ref");
    assert.strictEqual(classifyRef("backend"), "ref");
    assert.strictEqual(classifyRef("a1b2c3"), "ref");
  });

  test("classifyRef: lowercase 26-char Crockford string classifies as ref never ulid (case disjointness)", () => {
    // Same character pattern as a ULID but lowercase — must be ref, never ulid.
    // The two grammars are provably disjoint by case (B6).
    const lowercase26 = "01jqvbz3mhkp4ftgwr5xyensd7"; // valid ref slug
    assert.strictEqual(classifyRef(lowercase26), "ref");
  });

  test("classifyRef throws MalformedReferenceError for a mixed-case value", () => {
    // Has both uppercase and lowercase — satisfies neither ULID_RE nor REF_RE
    assert.throws(
      () => classifyRef("01JQVbz3MHKP4FTGWR5XYENSD7"),
      MalformedReferenceError,
    );
  });

  test("classifyRef throws MalformedReferenceError for a wrong-length uppercase-looking value", () => {
    // 25 chars uppercase — too short for a ULID, not lowercase so not a ref
    assert.throws(
      () => classifyRef("01JQVBZ3MHKP4FTGWR5XYENS"),
      MalformedReferenceError,
    );
  });
});
