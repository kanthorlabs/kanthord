/**
 * EPIC 013 Story 4 — `requeueRunningTask` extraction.
 *
 * Fakes-only tests (the convention used by `recover-interrupted-tasks.test.ts:1-99`).
 *
 * The function being tested is the verbatim extraction of the loop body at
 * `src/app/task/recover-interrupted-tasks.ts:35-46`. It moves a `running` task
 * back to `pending`, drops its job row, and re-enqueues it, appending
 * `task.ready` only when the re-enqueue inserted a new queued row. The
 * function does not open its own transaction — the caller is already inside
 * one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { requeueRunningTask } from "./requeue-running-task.ts";
import type { Task } from "../../domain/task.ts";
import type { Event } from "../../domain/event.ts";
import type { JobQueue, ClaimedJob, RunningJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";

// ---------------------------------------------------------------------------
// Fakes — same shape as the inlined loop body used to read/write
// ---------------------------------------------------------------------------

class FakeTaskStore {
  readonly saved: Task[] = [];
  readonly #tasks: Map<string, Task>;

  constructor(tasks: Task[]) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  save(task: Task): void {
    this.#tasks.set(task.id, task);
    this.saved.push(task);
  }
}

class FakeJobQueue implements JobQueue {
  readonly discarded: string[] = [];
  readonly enqueued: string[] = [];
  /** `true` makes the next enqueue return true (insert); `false` makes it no-op. */
  enqueueResult = true;

  claim(): ClaimedJob | undefined {
    return undefined;
  }
  finish(_jobId: string, _outcome: "completed" | "failed"): void {}
  discard(jobId: string): void {
    this.discarded.push(jobId);
  }
  enqueue(taskId: string): boolean {
    this.enqueued.push(taskId);
    return this.enqueueResult;
  }
  listRunningJobs(): ClaimedJob[] {
    return [];
  }
  isLeaseCurrent(_leaseToken: string): boolean {
    return true;
  }
  listRunningJobsForTask(_taskId: string): RunningJob[] {
    return [];
  }
  revoke(
    _leaseToken: string,
    _reason: string,
  ): "revoked" | "already_revoked" | "not_found" {
    return "not_found";
  }
}

class FakeEventFeed implements EventFeed {
  readonly events: Event[] = [];

  append(event: Event): void {
    this.events.push(event);
  }

  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";
const JOB_ID = "01JZZZZZZZZZZZZZZZZZZZJOB1";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSK1";

const RUNNING_TASK: Task = {
  id: TASK_ID,
  objectiveId: OBJ_ID,
  title: "requeue-task",
  status: "running",
  dependencies: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("(013 S4) requeueRunningTask: a running task is saved as pending, discarded, re-enqueued, and emits exactly one task.ready", () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const store = new FakeTaskStore([{ ...RUNNING_TASK }]);
  const queue = new FakeJobQueue();
  const feed = new FakeEventFeed();

  const inserted = requeueRunningTask(claimed, {
    store,
    queue,
    feed,
  });

  assert.equal(inserted, true, "enqueue inserted ⇒ returns true");

  // The task was saved as `pending`.
  assert.equal(store.saved.length, 1, "store.save was called exactly once");
  assert.equal(
    store.saved[0]!.status,
    "pending",
    "the saved task is the running→pending transition",
  );
  assert.equal(store.saved[0]!.id, TASK_ID, "the saved task id matches");

  // The job row was discarded.
  assert.deepEqual(
    queue.discarded,
    [JOB_ID],
    "queue.discard was called with the job id",
  );

  // The task was re-enqueued.
  assert.deepEqual(
    queue.enqueued,
    [TASK_ID],
    "queue.enqueue was called with the task id",
  );

  // Exactly one `task.ready` event, carrying the task id.
  assert.equal(feed.events.length, 1, "exactly one event appended");
  assert.equal(feed.events[0]!.type, "task.ready");
  assert.equal(feed.events[0]!.taskId, TASK_ID);
});

test("(013 S4) requeueRunningTask: when enqueue is a no-op (returns false), no task.ready is appended and the function returns false", () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const store = new FakeTaskStore([{ ...RUNNING_TASK }]);
  const queue = new FakeJobQueue();
  queue.enqueueResult = false;
  const feed = new FakeEventFeed();

  const inserted = requeueRunningTask(claimed, {
    store,
    queue,
    feed,
  });

  assert.equal(inserted, false, "enqueue did not insert ⇒ returns false");

  // The task is still saved as pending (the transition is local to the task,
  // independent of the queue's idempotency).
  assert.equal(store.saved.length, 1, "store.save was called exactly once");
  assert.equal(
    store.saved[0]!.status,
    "pending",
    "the saved task is the running→pending transition even when enqueue no-ops",
  );

  // The job row was discarded.
  assert.deepEqual(queue.discarded, [JOB_ID]);

  // Enqueue was called (it just returned false).
  assert.deepEqual(queue.enqueued, [TASK_ID]);

  // No event was appended — the "only if inserted" rule.
  assert.equal(
    feed.events.length,
    0,
    "no task.ready when the re-enqueue did not insert a new row",
  );
});

test("(013 S4) requeueRunningTask: a task the store does not know returns false, writes nothing", () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const store = new FakeTaskStore([]); // empty
  const queue = new FakeJobQueue();
  const feed = new FakeEventFeed();

  const inserted = requeueRunningTask(claimed, {
    store,
    queue,
    feed,
  });

  assert.equal(inserted, false, "missing task ⇒ returns false");
  assert.equal(store.saved.length, 0, "no save");
  assert.equal(queue.discarded.length, 0, "no discard");
  assert.equal(queue.enqueued.length, 0, "no enqueue");
  assert.equal(feed.events.length, 0, "no event");
});
