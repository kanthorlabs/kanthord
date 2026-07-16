import { test } from "node:test";
import assert from "node:assert/strict";
import { newInitiative, newObjective } from "./initiative.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("newInitiative returns an object with a ULID id, the given projectId and name", () => {
  const ini = newInitiative("proj-01", "init alpha");
  assert.match(ini.id, ULID_RE);
  assert.equal(ini.projectId, "proj-01");
  assert.equal(ini.name, "init alpha");
});

test("newObjective returns an object with a ULID id, the given initiativeId and name", () => {
  const obj = newObjective("ini-01", "obj beta");
  assert.match(obj.id, ULID_RE);
  assert.equal(obj.initiativeId, "ini-01");
  assert.equal(obj.name, "obj beta");
});

test("newInitiative generates distinct ids for each call", () => {
  const a = newInitiative("p", "a");
  const b = newInitiative("p", "b");
  assert.notEqual(a.id, b.id);
});

test("newObjective generates distinct ids for each call", () => {
  const a = newObjective("i", "a");
  const b = newObjective("i", "b");
  assert.notEqual(a.id, b.id);
});
