import { test } from "node:test";
import assert from "node:assert/strict";
import { newProject } from "./project.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("newProject returns an object with a ULID id and the given name", () => {
  const p = newProject("alpha");
  assert.match(p.id, ULID_RE);
  assert.equal(p.name, "alpha");
});

test("newProject generates distinct ids for each call", () => {
  const a = newProject("a");
  const b = newProject("b");
  assert.notEqual(a.id, b.id);
});
