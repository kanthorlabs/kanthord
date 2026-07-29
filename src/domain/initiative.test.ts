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
  assertCandidateFresh,
  StaleCandidateError,
  clearConflictDiagnosis,
} from "./initiative.ts";
import type { ObjectiveStatus } from "./initiative.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("newInitiative returns an object with a ULID id, the given projectId and name", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
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
  const a = newInitiative({ projectId: "p", name: "a", paused: false });
  const b = newInitiative({ projectId: "p", name: "b", paused: false });
  assert.notEqual(a.id, b.id);
});

test("newObjective generates distinct ids for each call", () => {
  const a = newObjective("i", "a");
  const b = newObjective("i", "b");
  assert.notEqual(a.id, b.id);
});

test("newInitiative defaults status to building", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
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
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
  const landed = transitionInitiative(ini, "landed");
  assert.equal(landed.status, "landed");
});

test("transitionInitiative rejects building -> awaiting_pr (removed status)", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
  assert.throws(() =>
    // @ts-expect-error — "awaiting_pr" is no longer a valid InitiativeStatus
    transitionInitiative(ini, "awaiting_pr"),
  );
});

test("transitionInitiative rejects building -> delivered (removed status)", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
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
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
  const discarded = transitionInitiative(ini, "discarded");
  assert.equal(discarded.status, "discarded");
});

test("transitionInitiative rejects discarded -> anything (terminal, no outbound edge)", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
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

// ---------------------------------------------------------------------------
// Story 1 (012) — `paused` is part of the Initiative on construction and
// survives a status transition. The transition function never reads or writes
// `paused`; it only spreads.
// ---------------------------------------------------------------------------

test("newInitiative({ paused: true }) sets paused === true and status === 'building'", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: true,
  });
  assert.equal(ini.paused, true, "paused flag must equal the input value");
  assert.equal(ini.status, "building", "default status is unchanged");
});

test("newInitiative({ paused: false }) sets paused === false", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: false,
  });
  assert.equal(ini.paused, false, "paused flag must equal the input value");
});

test("transitionInitiative carries paused through unchanged (building -> landed keeps paused === true)", () => {
  const ini = newInitiative({
    projectId: "proj-01",
    name: "init alpha",
    paused: true,
  });
  const landed = transitionInitiative(ini, "landed");
  assert.equal(landed.status, "landed");
  assert.equal(
    landed.paused,
    true,
    "transitionInitiative must not read or write paused",
  );
});

// ---------------------------------------------------------------------------
// Story 4 (012) — verdict guard: `assertCandidateFresh` is the single
// comparison implementation for objective verdicts. Three behaviors: pass
// through, stale oid, and missing oid. Message must match /stale|expected|moved/i.
// ---------------------------------------------------------------------------

test("assertCandidateFresh('o','abc','abc') returns without throwing", () => {
  assert.doesNotThrow(() => assertCandidateFresh("o", "abc", "abc"));
});

test("assertCandidateFresh('o','abc','def') throws StaleCandidateError with expected='abc', actual='def', message matching /stale|expected|moved/i", () => {
  assert.throws(
    () => assertCandidateFresh("o", "abc", "def"),
    (err) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}`,
      );
      const e = err as StaleCandidateError;
      assert.equal(e.objectiveId, "o");
      assert.equal(e.expected, "abc");
      assert.equal(e.actual, "def");
      assert.match(e.message, /stale|expected|moved/i);
      assert.equal(err.name, "StaleCandidateError");
      return true;
    },
  );
});

test("assertCandidateFresh('o','abc',undefined) throws StaleCandidateError with actual === ''", () => {
  assert.throws(
    () => assertCandidateFresh("o", "abc", undefined),
    (err) => {
      assert.ok(
        err instanceof StaleCandidateError,
        `must be StaleCandidateError; got: ${(err as Error).constructor.name}`,
      );
      const e = err as StaleCandidateError;
      assert.equal(e.expected, "abc");
      assert.equal(
        e.actual,
        "",
        "actual must be empty string when stored commitOid is undefined",
      );
      assert.match(e.message, /stale|expected|moved/i);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// EPIC 017 Story 1 (D5) — clearConflictDiagnosis
// ---------------------------------------------------------------------------

test("(017-S1-clear-conflict-diagnosis) clearConflictDiagnosis omits conflictCause, observedTipOid, conflictReason and keeps note, commitOid, parentOid, status", () => {
  const obj = {
    ...newObjective("ini-01", "obj beta"),
    status: "conflict" as ObjectiveStatus,
    note: "resolve at the new tip",
    commitOid: "commit-oid",
    parentOid: "parent-oid",
    conflictCause: "cas-mismatch" as const,
    observedTipOid: "observed-oid",
    conflictReason: "gate failed",
  };
  const cleared = clearConflictDiagnosis(obj);
  assert.equal("conflictCause" in cleared, false);
  assert.equal("observedTipOid" in cleared, false);
  assert.equal("conflictReason" in cleared, false);
  assert.equal(cleared.note, "resolve at the new tip");
  assert.equal(cleared.commitOid, "commit-oid");
  assert.equal(cleared.parentOid, "parent-oid");
  assert.equal(cleared.status, "conflict");
});
