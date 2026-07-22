import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, newEvent, type EventType } from "./event.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("EVENT_TYPES lists exactly the seventeen literals in order", () => {
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
    "task.blocked",
    "task.conflict", // C2/D5 — landing conflict
    "agent.started",
    "agent.progress",
    "agent.finished",
    "task.verification", // A4 — new
    "provider.retry", // 007.9 S2 — new
  ]);
});

test("EVENT_TYPES includes task.verification as a valid EventType", () => {
  assert.ok(
    (EVENT_TYPES as readonly string[]).includes("task.verification"),
    "task.verification must be in EVENT_TYPES",
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
