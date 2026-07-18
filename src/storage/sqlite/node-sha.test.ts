// Test suite: src/storage/sqlite/node-sha.test.ts
// Covers: canonicalTask, canonicalObjective, canonicalInitiative, sha256Hex
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  canonicalTask,
  canonicalObjective,
  canonicalInitiative,
  sha256Hex,
} from "./node-sha.ts";

// Base task fixture
const baseTask = {
  title: "implement api",
  instructions: "Implement POST /oauth/token",
  ac: ["returns 200 for valid creds"],
  agent: "generic@1",
  verification: undefined as string[] | undefined,
  dependencies: ["DEP1", "DEP2"],
  objectiveId: "OBJ1",
  status: "pending",
};

test("canonicalTask is stable — same input twice yields identical string", () => {
  const a = canonicalTask(baseTask);
  const b = canonicalTask(baseTask);
  assert.equal(a, b);
});

test("canonicalTask with reordered dependencies yields the SAME string (SET semantics)", () => {
  const t1 = canonicalTask({ ...baseTask, dependencies: ["DEP1", "DEP2"] });
  const t2 = canonicalTask({ ...baseTask, dependencies: ["DEP2", "DEP1"] });
  assert.equal(t1, t2);
});

test("canonicalTask with reordered ac yields a DIFFERENT string (ordered list)", () => {
  const t1 = canonicalTask({
    ...baseTask,
    ac: ["returns 200 for valid creds", "rejects bad creds with 401"],
  });
  const t2 = canonicalTask({
    ...baseTask,
    ac: ["rejects bad creds with 401", "returns 200 for valid creds"],
  });
  assert.notEqual(t1, t2);
});

test("canonicalTask with verification undefined and verification empty array produce DIFFERENT strings", () => {
  const withUndefined = canonicalTask({ ...baseTask, verification: undefined });
  const withEmpty = canonicalTask({ ...baseTask, verification: [] });
  assert.notEqual(withUndefined, withEmpty);
  // undefined encodes as null in JSON
  assert.ok(withUndefined.includes('"verification":null'));
  // empty array encodes as []
  assert.ok(withEmpty.includes('"verification":[]'));
});

test("canonicalTask JSON-escapes title with embedded quote — no collision with differently-partitioned input", () => {
  // A title containing a quote + newline must be escaped so the canonical
  // string is unambiguous: two different titles cannot produce the same canonical.
  const t1 = canonicalTask({ ...baseTask, title: 'say "hello"' });
  const t2 = canonicalTask({ ...baseTask, title: "say hello" });
  assert.notEqual(t1, t2);
  // newline in title is also escaped
  const t3 = canonicalTask({ ...baseTask, title: "line1\nline2" });
  const t4 = canonicalTask({ ...baseTask, title: "line1", ac: ["line2"] });
  assert.notEqual(t3, t4);
});

test("sha256Hex matches a known node:crypto sha256 vector", () => {
  const input = "hello world";
  const expected = createHash("sha256").update(input, "utf8").digest("hex");
  assert.equal(sha256Hex(input), expected);
});

test("canonicalObjective is stable and includes name + initiativeId", () => {
  const s1 = canonicalObjective({ name: "backend", initiativeId: "INIT1" });
  const s2 = canonicalObjective({ name: "backend", initiativeId: "INIT1" });
  assert.equal(s1, s2);
  // changing name produces a different canonical
  const s3 = canonicalObjective({ name: "frontend", initiativeId: "INIT1" });
  assert.notEqual(s1, s3);
  // changing initiativeId produces a different canonical
  const s4 = canonicalObjective({ name: "backend", initiativeId: "INIT2" });
  assert.notEqual(s1, s4);
});

test("canonicalInitiative is stable and includes name + projectId", () => {
  const s1 = canonicalInitiative({ name: "oauth", projectId: "PROJ1" });
  const s2 = canonicalInitiative({ name: "oauth", projectId: "PROJ1" });
  assert.equal(s1, s2);
  // changing name produces a different canonical
  const s3 = canonicalInitiative({ name: "sso", projectId: "PROJ1" });
  assert.notEqual(s1, s3);
});
