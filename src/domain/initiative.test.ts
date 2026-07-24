import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInitiative,
  newObjective,
  transitionInitiative,
  transitionObjective,
} from "./initiative.ts";

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

test("newInitiative defaults status to building", () => {
  const ini = newInitiative("proj-01", "init alpha");
  assert.equal(ini.status, "building");
});

test("newObjective defaults status to building", () => {
  const obj = newObjective("ini-01", "obj beta");
  assert.equal(obj.status, "building");
});

test("transitionObjective allows building -> awaiting_confirmation -> integrated", () => {
  const obj = newObjective("ini-01", "obj beta");
  const awaiting = transitionObjective(obj, "awaiting_confirmation");
  assert.equal(awaiting.status, "awaiting_confirmation");
  const integrated = transitionObjective(awaiting, "integrated");
  assert.equal(integrated.status, "integrated");
});

test("transitionObjective allows awaiting_confirmation -> conflict -> awaiting_confirmation", () => {
  const obj = newObjective("ini-01", "obj beta");
  const awaiting = transitionObjective(obj, "awaiting_confirmation");
  const conflict = transitionObjective(awaiting, "conflict");
  assert.equal(conflict.status, "conflict");
  const backToAwaiting = transitionObjective(conflict, "awaiting_confirmation");
  assert.equal(backToAwaiting.status, "awaiting_confirmation");
});

test("transitionObjective rejects building -> integrated directly", () => {
  const obj = newObjective("ini-01", "obj beta");
  assert.throws(() => transitionObjective(obj, "integrated"));
});

test("transitionObjective rejects integrated -> anything (immutable once integrated)", () => {
  const obj = newObjective("ini-01", "obj beta");
  const awaiting = transitionObjective(obj, "awaiting_confirmation");
  const integrated = transitionObjective(awaiting, "integrated");
  assert.throws(() => transitionObjective(integrated, "conflict"));
});

test("transitionInitiative allows building -> awaiting_pr -> delivered", () => {
  const ini = newInitiative("proj-01", "init alpha");
  const awaitingPr = transitionInitiative(ini, "awaiting_pr");
  assert.equal(awaitingPr.status, "awaiting_pr");
  const delivered = transitionInitiative(awaitingPr, "delivered");
  assert.equal(delivered.status, "delivered");
});

test("transitionInitiative rejects building -> delivered directly", () => {
  const ini = newInitiative("proj-01", "init alpha");
  assert.throws(() => transitionInitiative(ini, "delivered"));
});
