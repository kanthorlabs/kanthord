import { test } from "node:test";
import assert from "node:assert/strict";
import type { Event } from "../../domain/event.ts";
import { ListEvents } from "./list-events.ts";

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

test("ListEvents execute delegates to feed.readAfter and returns events", () => {
  const feed = new FakeEventFeed([E1, E2, E3]);
  const useCase = new ListEvents(feed);

  const all = useCase.execute({ after: "0" });
  assert.equal(all.length, 3);
  assert.deepEqual(all[0], E1);
  assert.deepEqual(all[2], E3);

  const partial = useCase.execute({ after: "A1" });
  assert.equal(partial.length, 2);
  assert.deepEqual(partial[0], E2);

  const limited = useCase.execute({ after: "0", limit: 2 });
  assert.equal(limited.length, 2);
});

test("ListEvents execute propagates RangeError for invalid limit", () => {
  const feed = new FakeEventFeed([E1]);
  const useCase = new ListEvents(feed);
  assert.throws(() => useCase.execute({ after: "0", limit: 0 }), RangeError);
});

// ── 011 Story 4 — project-scoped read forwarding ───────────────

/** Recording fake that captures every readAfter call's positional args. */
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

test("ListEvents execute({after, projectId}) forwards projectId positionally to readAfter (011 S4)", () => {
  const feed = new RecordingEventFeed();
  const useCase = new ListEvents(feed);

  useCase.execute({ after: "0", projectId: "p1" });

  assert.equal(feed.received.length, 1);
  assert.deepEqual(feed.received[0], {
    cursor: "0",
    limit: undefined,
    projectId: "p1",
  });
});

test("ListEvents execute({after, limit, projectId}) forwards all three positionally to readAfter (011 S4)", () => {
  const feed = new RecordingEventFeed();
  const useCase = new ListEvents(feed);

  useCase.execute({ after: "X", limit: 5, projectId: "p2" });

  assert.equal(feed.received.length, 1);
  assert.deepEqual(feed.received[0], {
    cursor: "X",
    limit: 5,
    projectId: "p2",
  });
});

test("ListEvents execute({after}) forwards projectId as undefined to readAfter (011 S4)", () => {
  const feed = new RecordingEventFeed();
  const useCase = new ListEvents(feed);

  useCase.execute({ after: "0" });

  assert.equal(feed.received.length, 1);
  assert.deepEqual(feed.received[0], {
    cursor: "0",
    limit: undefined,
    projectId: undefined,
  });
});
