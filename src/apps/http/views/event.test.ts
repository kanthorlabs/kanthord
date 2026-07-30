// src/apps/http/views/event.test.ts — EPIC 022 Story S1.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event } from "../../../domain/event.ts";
import { eventView, type EventView } from "./shared.ts";
import { eventPageView } from "./event.ts";

test("eventView leak test: an event carrying an extra projectId and secret presents only id and type", () => {
  const source = {
    id: "A1",
    type: "task.ready",
    projectId: "p1",
    secret: "leak-me",
  } as unknown as Event;

  const view = eventView(source);

  assert.deepEqual(Object.keys(view).sort(), ["id", "type"]);
  assert.equal("projectId" in view, false);
  assert.equal("secret" in view, false);
});

test("eventView: every optional field is absent (not just undefined) when the event only carries taskId", () => {
  const source = { id: "A1", type: "task.ready", taskId: "T1" } as Event;

  const view = eventView(source);

  assert.equal("objectiveId" in view, false);
  assert.equal("initiativeId" in view, false);
  assert.equal("repositoryId" in view, false);
  assert.equal("payload" in view, false);
});

test("eventView: every optional field present shows the exact key set", () => {
  const source = {
    id: "A1",
    type: "task.ready",
    taskId: "T1",
    objectiveId: "O1",
    initiativeId: "I1",
    repositoryId: "R1",
    payload: { reason: "done" },
  } as Event;

  const view = eventView(source);

  assert.deepEqual(Object.keys(view).sort(), [
    "id",
    "initiativeId",
    "objectiveId",
    "payload",
    "repositoryId",
    "taskId",
    "type",
  ]);
});

test("eventView: payload is a copy — mutating the source after presenting does not change the view", () => {
  const payload: Record<string, string> = { reason: "done" };
  const source = { id: "A1", type: "task.completed", payload } as Event;

  const view = eventView(source);
  payload.reason = "mutated";

  assert.equal((view.payload as Record<string, string>).reason, "done");
});

test("eventPageView: two events present as an events array plus nextCursor", () => {
  const e1 = { id: "A1", type: "task.ready", taskId: "T1" } as Event;
  const e2 = { id: "B2", type: "task.started", taskId: "T1" } as Event;

  const view = eventPageView({
    events: [e1, e2],
    nextCursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  });

  assert.deepEqual(Object.keys(view).sort(), ["events", "nextCursor"]);
  assert.equal(view.events.length, 2);
  const expectedKeys: (keyof EventView)[] = ["id", "type", "taskId"];
  assert.deepEqual(
    Object.keys(view.events[0]!).sort(),
    [...expectedKeys].sort(),
  );
});

test("eventPageView: an empty page keeps nextCursor null through presentation", () => {
  const view = eventPageView({ events: [], nextCursor: null });

  assert.deepEqual(view, { events: [], nextCursor: null });
});
