import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newInitiative,
  newObjective,
  transitionInitiative,
  transitionObjective,
  IllegalObjectiveTransitionError,
  IllegalInitiativeTransitionError,
  canRetryObjective,
} from "./initiative.ts";
import type { ObjectiveStatus } from "./initiative.ts";

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

test("transitionInitiative allows building -> landed", () => {
  const ini = newInitiative("proj-01", "init alpha");
  const landed = transitionInitiative(ini, "landed");
  assert.equal(landed.status, "landed");
});

test("transitionInitiative rejects building -> awaiting_pr (removed status)", () => {
  const ini = newInitiative("proj-01", "init alpha");
  assert.throws(() =>
    // @ts-expect-error — "awaiting_pr" is no longer a valid InitiativeStatus
    transitionInitiative(ini, "awaiting_pr"),
  );
});

test("transitionInitiative rejects building -> delivered (removed status)", () => {
  const ini = newInitiative("proj-01", "init alpha");
  assert.throws(() =>
    // @ts-expect-error — "delivered" is no longer a valid InitiativeStatus
    transitionInitiative(ini, "delivered"),
  );
});

// Story 05 (007.16) — discarded objective/initiative status

test("transitionObjective allows building -> discarded", () => {
  const obj = newObjective("ini-01", "obj beta");
  const discarded = transitionObjective(obj, "discarded");
  assert.equal(discarded.status, "discarded");
});

test("transitionObjective rejects discarded -> anything (terminal, no outbound edge)", () => {
  const obj = newObjective("ini-01", "obj beta");
  const discarded = transitionObjective(obj, "discarded");
  assert.throws(
    () => transitionObjective(discarded, "awaiting_confirmation"),
    (err) => {
      assert.ok(err instanceof IllegalObjectiveTransitionError);
      assert.equal((err as IllegalObjectiveTransitionError).from, "discarded");
      return true;
    },
  );
});

test("transitionInitiative allows building -> discarded", () => {
  const ini = newInitiative("proj-01", "init alpha");
  const discarded = transitionInitiative(ini, "discarded");
  assert.equal(discarded.status, "discarded");
});

test("transitionInitiative rejects discarded -> anything (terminal, no outbound edge)", () => {
  const ini = newInitiative("proj-01", "init alpha");
  const discarded = transitionInitiative(ini, "discarded");
  assert.throws(
    () => transitionInitiative(discarded, "landed"),
    (err) => {
      assert.ok(err instanceof IllegalInitiativeTransitionError);
      assert.equal((err as IllegalInitiativeTransitionError).from, "discarded");
      return true;
    },
  );
});

// B3.1 (007.16 review blocker fix) — canRetryObjective: the shared
// retry-eligibility rule moved into domain/, true for exactly
// awaiting_confirmation and conflict.

test("canRetryObjective is true for exactly awaiting_confirmation and conflict, false for building/integrated/discarded", () => {
  const expected: Record<ObjectiveStatus, boolean> = {
    building: false,
    awaiting_confirmation: true,
    conflict: true,
    integrated: false,
    discarded: false,
  };
  for (const [status, want] of Object.entries(expected) as Array<
    [ObjectiveStatus, boolean]
  >) {
    assert.equal(
      canRetryObjective(status),
      want,
      `canRetryObjective(${status}) must be ${want}`,
    );
  }
});
