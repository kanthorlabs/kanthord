import { test } from "node:test";
import assert from "node:assert/strict";
import { RecoverInterruptedTasks } from "./recover-interrupted-tasks.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

class SimpleTaskStore implements TaskStore {
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

class RecordingJobQueue implements JobQueue {
  readonly discarded: string[] = [];
  readonly enqueued: string[] = [];
  readonly #runningJobs: ClaimedJob[];

  constructor(runningJobs: ClaimedJob[] = []) {
    this.#runningJobs = runningJobs;
  }

  claim(): ClaimedJob | undefined {
    return undefined;
  }

  finish(_jobId: string, _outcome: "completed" | "failed"): void {}

  discard(jobId: string): void {
    this.discarded.push(jobId);
  }

  enqueue(taskId: string): boolean {
    this.enqueued.push(taskId);
    return true;
  }

  listRunningJobs(): ClaimedJob[] {
    return [...this.#runningJobs];
  }
}

class RecordingEventFeed implements EventFeed {
  readonly events: Event[] = [];

  append(event: Event): void {
    this.events.push(event);
  }

  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

class RecordingUnitOfWork implements UnitOfWork {
  txCount = 0;
  transaction<T>(fn: () => T): T {
    this.txCount += 1;
    return fn();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JOB_ID = "01JZZZZZZZZZZZZZZZZZZZJOB1";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";

const TASK_RUNNING: Task = {
  id: "01JZZZZZZZZZZZZZZZZZZZTSK1",
  objectiveId: OBJ_ID,
  title: "interrupted task",
  status: "running",
  dependencies: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("RecoverInterruptedTasks execute one running job resets task to pending discards job re-enqueues and emits task.ready", () => {
  const runningJob: ClaimedJob = { id: JOB_ID, taskId: TASK_RUNNING.id };
  const queue = new RecordingJobQueue([runningJob]);
  const store = new SimpleTaskStore([{ ...TASK_RUNNING }]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new RecoverInterruptedTasks(queue, store, feed, uow);
  const recovered = uc.execute();

  // returns the recovered task id
  assert.deepEqual(recovered, [TASK_RUNNING.id]);

  // task was reset to pending
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]!.status, "pending");

  // job was discarded
  assert.deepEqual(queue.discarded, [JOB_ID]);

  // task was re-enqueued
  assert.deepEqual(queue.enqueued, [TASK_RUNNING.id]);

  // task.ready event emitted
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0]!.type, "task.ready");
  assert.equal(feed.events[0]!.taskId, TASK_RUNNING.id);
});

test("RecoverInterruptedTasks execute no running jobs returns empty array and writes nothing", () => {
  const queue = new RecordingJobQueue([]);
  const store = new SimpleTaskStore([]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new RecoverInterruptedTasks(queue, store, feed, uow);
  const recovered = uc.execute();

  assert.deepEqual(recovered, []);
  assert.equal(store.saved.length, 0);
  assert.equal(queue.discarded.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RecoverInterruptedTasks execute all writes happen inside one transaction", () => {
  const runningJob: ClaimedJob = { id: JOB_ID, taskId: TASK_RUNNING.id };
  const queue = new RecordingJobQueue([runningJob]);
  const store = new SimpleTaskStore([{ ...TASK_RUNNING }]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new RecoverInterruptedTasks(queue, store, feed, uow);
  uc.execute();

  assert.equal(uow.txCount, 1, "must use exactly one transaction");
});
