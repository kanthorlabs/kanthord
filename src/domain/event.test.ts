import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeTime } from "ulid";
import { EVENT_TYPES, newEvent, eventTimeMs, type EventType } from "./event.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("EVENT_TYPES lists exactly the twenty-eight literals in order", () => {
  assert.deepEqual(EVENT_TYPES, [
    "task.created",
    "task.ready",
    "task.started",
    "task.completed",
    "task.failed",
    "task.dependencies_changed",
    "task.escalated",
    "task.approved",
    "task.rejected",
    "task.discarded",
    "task.abandoned", // 013 Story 5 — operator revoked a run's lease
    "task.blocked",
    "task.conflict", // C2/D5 — landing conflict
    "agent.started",
    "agent.progress",
    "agent.finished",
    "task.verification", // A4 — new
    "provider.retry", // 007.9 S2 — new
    "provider.failover", // 008.4 Story B — chain advance on provider error
    "objective.building", // 007.12 Story D — new
    "objective.awaiting_confirmation", // 007.12 Story D — new
    "objective.integrated", // 007.12 Story D — new
    "objective.conflict", // 007.12 Story D — new
    "initiative.landed", // 007.15 Story B — new (replaces initiative.awaiting_pr)
    "candidate.transplanted", // 007.14 Story D — new
    "repository.published", // 007.15 Story A — new
    "objective.discarded", // 007.16 Story 05 — new
    "initiative.discarded", // 007.16 Story 05 — new
  ]);
});

test("EVENT_TYPES no longer includes the removed initiative.awaiting_pr / initiative.delivered types", () => {
  assert.equal(
    (EVENT_TYPES as readonly string[]).includes("initiative.awaiting_pr"),
    false,
    "initiative.awaiting_pr must be removed from EVENT_TYPES",
  );
  assert.equal(
    (EVENT_TYPES as readonly string[]).includes("initiative.delivered"),
    false,
    "initiative.delivered must be removed from EVENT_TYPES",
  );
});

test("EVENT_TYPES includes task.verification as a valid EventType", () => {
  assert.ok(
    (EVENT_TYPES as readonly string[]).includes("task.verification"),
    "task.verification must be in EVENT_TYPES",
  );
});

test("EVENT_TYPES includes candidate.transplanted as a valid EventType", () => {
  assert.ok(
    (EVENT_TYPES as readonly string[]).includes("candidate.transplanted"),
    "candidate.transplanted must be in EVENT_TYPES",
  );
});

test("task.unknown is not assignable to EventType (compile guard)", () => {
  // @ts-expect-error — "task.unknown" is not a valid EventType
  const _bad: EventType = "task.unknown";
  void _bad;
});

test("newEvent returns a ULID-format id, the type, and the taskId", () => {
  const taskId = "some-task-id";
  const ev = newEvent("task.created", { taskId });
  assert.match(ev.id, ULID_RE);
  assert.equal(ev.type, "task.created");
  assert.equal(ev.taskId, taskId);
});

test("two consecutive newEvent calls have strictly increasing ids", () => {
  const taskId = "t1";
  const e1 = newEvent("task.ready", { taskId });
  const e2 = newEvent("task.started", { taskId });
  assert.ok(e1.id < e2.id, `expected ${e1.id} < ${e2.id}`);
});

test("newEvent with task.dependencies_changed is constructible", () => {
  const ev = newEvent("task.dependencies_changed", { taskId: "dep-task" });
  assert.equal(ev.type, "task.dependencies_changed");
  assert.match(ev.id, ULID_RE);
});

test("newEvent with payload passes payload through", () => {
  const taskId = "task-fail-1";
  const payload = { reason: "x" };
  const ev = newEvent("task.failed", { taskId, payload });
  assert.deepEqual(ev.payload, { reason: "x" });
});

test("newEvent without payload has no payload key", () => {
  const ev = newEvent("task.ready", { taskId: "task-ready-1" });
  assert.equal(Object.prototype.hasOwnProperty.call(ev, "payload"), false);
});

// ── objective/initiative-scoped events (007.12 Story D) ─────────────────────

test("newEvent constructs an objective-scoped event with objectiveId and no taskId key", () => {
  const objectiveId = "some-objective-id";
  const ev = newEvent("objective.integrated", { objectiveId });
  assert.match(ev.id, ULID_RE);
  assert.equal(ev.type, "objective.integrated");
  assert.equal(ev.objectiveId, objectiveId);
  assert.equal(Object.prototype.hasOwnProperty.call(ev, "taskId"), false);
});

test("newEvent constructs an initiative-scoped event with initiativeId and no taskId key", () => {
  const initiativeId = "some-initiative-id";
  const ev = newEvent("initiative.landed", { initiativeId });
  assert.match(ev.id, ULID_RE);
  assert.equal(ev.type, "initiative.landed");
  assert.equal(ev.initiativeId, initiativeId);
  assert.equal(Object.prototype.hasOwnProperty.call(ev, "taskId"), false);
});

// ── candidate.transplanted (007.14 Story D) ─────────────────────────────────

// ── discard events (007.16 Story 05) ────────────────────────────────────────

test("newEvent constructs an objective.discarded event with objectiveId and a reason payload", () => {
  const objectiveId = "some-objective-id";
  const ev = newEvent("objective.discarded", {
    objectiveId,
    payload: { reason: "unachievable" },
  });
  assert.match(ev.id, ULID_RE);
  assert.equal(ev.type, "objective.discarded");
  assert.equal(ev.objectiveId, objectiveId);
  assert.deepEqual(ev.payload, { reason: "unachievable" });
});

test("newEvent constructs an initiative.discarded event with initiativeId and no payload key", () => {
  const initiativeId = "some-initiative-id";
  const ev = newEvent("initiative.discarded", { initiativeId });
  assert.match(ev.id, ULID_RE);
  assert.equal(ev.type, "initiative.discarded");
  assert.equal(ev.initiativeId, initiativeId);
  assert.equal(Object.prototype.hasOwnProperty.call(ev, "payload"), false);
});

test("newEvent constructs a candidate.transplanted event carrying the old/new candidate + base SHAs", () => {
  const taskId = "some-task-id";
  const payload = {
    oldCandidateSHA: "aaa111",
    newCandidateSHA: "bbb222",
    newBaseSHA: "ccc333",
  };
  const ev = newEvent("candidate.transplanted", { taskId, payload });
  assert.match(ev.id, ULID_RE);
  assert.equal(ev.type, "candidate.transplanted");
  assert.equal(ev.taskId, taskId);
  assert.deepEqual(ev.payload, payload);
});

// ── 016 Story 3 — eventTimeMs (016 §A: decodeTime of the event id) ──────
// events has no timestamp column (see EPIC 016 facts). Event times are
// derived from the ULID. eventTimeMs is the single source of truth.

test("eventTimeMs: a known ULID returns its decodeTime (literal millisecond value)", () => {
  // 01H1234567890ABCDEFGHJKMNP → decodeTime=1684771312839
  const id = "01H1234567890ABCDEFGHJKMNP";
  assert.equal(eventTimeMs(id), decodeTime(id));
  // Pin a literal value so a future ULID-package update cannot silently
  // shift the result.
  assert.equal(eventTimeMs(id), 1684771312839);
});

test("eventTimeMs: another known ULID matches its decodeTime (second literal)", () => {
  // 01H0000000000000000000ABCD → decodeTime=1683627180032
  const id = "01H0000000000000000000ABCD";
  assert.equal(eventTimeMs(id), decodeTime(id));
  assert.equal(eventTimeMs(id), 1683627180032);
});

test("eventTimeMs: a fresh newEvent() id's time matches its own id's decodeTime", () => {
  const ev = newEvent("task.started", { taskId: "t" });
  assert.equal(eventTimeMs(ev.id), decodeTime(ev.id));
});
