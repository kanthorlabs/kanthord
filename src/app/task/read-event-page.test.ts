// src/app/task/read-event-page.test.ts — EPIC 022 Story S1: the CQRS-lite
// query behind GET /api/event. Mirrors list-events.test.ts's FakeEventFeed.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event } from "../../domain/event.ts";
import { ReadEventPage } from "./read-event-page.ts";

class FakeEventFeed {
  readonly events: Event[];
  constructor(events: Event[]) {
    this.events = events;
  }
  readAfter(cursor: string, limit?: number, projectId?: string): Event[] {
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    const filtered = this.events.filter((e) => e.id > cursor);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }
}

const E1: Event = { id: "A1", type: "task.ready", taskId: "T1" };
const E2: Event = { id: "B2", type: "task.started", taskId: "T1" };
const E3: Event = {
  id: "C3",
  type: "task.completed",
  taskId: "T1",
  payload: { reason: "done" },
};

test("ReadEventPage execute: a non-empty page's nextCursor is the last returned event's id", () => {
  const feed = new FakeEventFeed([E1, E2, E3]);
  const useCase = new ReadEventPage(feed);

  const out = useCase.execute({ after: "" });

  assert.equal(out.events.length, 3);
  assert.equal(out.nextCursor, "C3");
});

test("ReadEventPage execute: an empty page echoes a non-blank input cursor as nextCursor", () => {
  const feed = new FakeEventFeed([]);
  const useCase = new ReadEventPage(feed);

  const out = useCase.execute({ after: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });

  assert.deepEqual(out.events, []);
  assert.equal(out.nextCursor, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
});

test("ReadEventPage execute: an empty page with after: '' has nextCursor null", () => {
  const feed = new FakeEventFeed([]);
  const useCase = new ReadEventPage(feed);

  const out = useCase.execute({ after: "" });

  assert.equal(out.events.length, 0);
  assert.equal(out.nextCursor, null);
});

test("ReadEventPage execute: a non-empty page with after: '' has nextCursor equal to the last event's id, not null", () => {
  const feed = new FakeEventFeed([E1, E2]);
  const useCase = new ReadEventPage(feed);

  const out = useCase.execute({ after: "" });

  assert.equal(out.nextCursor, "B2");
});

class RecordingEventFeed {
  readonly received: Array<{
    cursor: string;
    limit?: number;
    projectId?: string;
  }> = [];
  readAfter(cursor: string, limit?: number, projectId?: string): Event[] {
    this.received.push({ cursor, limit, projectId });
    return [];
  }
}

test("ReadEventPage execute forwards after, limit and projectId positionally to readAfter, verbatim", () => {
  const feed = new RecordingEventFeed();
  const useCase = new ReadEventPage(feed);

  useCase.execute({
    after: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    limit: 5,
    projectId: "p1",
  });

  assert.equal(feed.received.length, 1);
  assert.deepEqual(feed.received[0], {
    cursor: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    limit: 5,
    projectId: "p1",
  });
});

test("ReadEventPage execute({after: ''}) forwards limit and projectId as undefined", () => {
  const feed = new RecordingEventFeed();
  const useCase = new ReadEventPage(feed);

  useCase.execute({ after: "" });

  assert.equal(feed.received.length, 1);
  assert.deepEqual(feed.received[0], {
    cursor: "",
    limit: undefined,
    projectId: undefined,
  });
});

test("ReadEventPage execute propagates the fake's RangeError for an invalid limit", () => {
  const feed = new FakeEventFeed([E1]);
  const useCase = new ReadEventPage(feed);
  assert.throws(() => useCase.execute({ after: "", limit: 0 }), RangeError);
});
