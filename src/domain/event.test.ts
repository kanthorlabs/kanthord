import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, newEvent } from "./event.ts";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test("EVENT_TYPES lists exactly the fourteen literals in order", () => {
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
    "agent.started",
    "agent.progress",
    "agent.finished",
  ]);
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
