import { test } from "node:test";
import assert from "node:assert/strict";
import { RetryTask, TaskNotRetryableError } from "./retry-task.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Narrow interfaces the use case depends on
// ---------------------------------------------------------------------------

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

interface KindResolver {
  resolveKind(id: string): string | undefined;
}

// ---------------------------------------------------------------------------
// Fakes / Mocks
// ---------------------------------------------------------------------------

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
  readonly enqueued: string[] = [];

  claim(): ClaimedJob | undefined {
    return undefined;
  }

  finish(_jobId: string, _outcome: "completed" | "failed"): void {}

  discard(_jobId: string): void {}

  enqueue(taskId: string): boolean {
    this.enqueued.push(taskId);
    return true;
  }

  listRunningJobs(): ClaimedJob[] {
    return [];
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

class MockKindResolver implements KindResolver {
  readonly #kind: string | undefined;

  constructor(kind: string | undefined) {
    this.#kind = kind;
  }

  resolveKind(_id: string): string | undefined {
    return this.#kind;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ9";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTS90";

function makeTask(status: Task["status"]): Task {
  return {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "some task",
    status,
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("RetryTask execute resets a failed task to pending enqueues it and emits task.ready", async () => {
  const store = new SimpleTaskStore([makeTask("failed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await uc.execute({ taskId: TASK_ID });

  // task reset to pending
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]!.status, "pending");

  // task enqueued
  assert.deepEqual(queue.enqueued, [TASK_ID]);

  // task.ready event emitted
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0]!.type, "task.ready");
  assert.equal(feed.events[0]!.taskId, TASK_ID);
});

test("RetryTask execute a pending task throws TaskNotRetryableError and writes nothing", async () => {
  const store = new SimpleTaskStore([makeTask("pending")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).taskId === TASK_ID &&
      (err as TaskNotRetryableError).status === "pending",
  );
  assert.equal(store.saved.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RetryTask execute a running task throws TaskNotRetryableError and writes nothing", async () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).status === "running",
  );
  assert.equal(store.saved.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RetryTask execute a completed task throws TaskNotRetryableError and writes nothing", async () => {
  const store = new SimpleTaskStore([makeTask("completed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).status === "completed",
  );
  assert.equal(store.saved.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RetryTask execute throws UnknownReferenceError for unknown id", async () => {
  const store = new SimpleTaskStore([]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver(undefined);

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: "no-such" }),
    (err: unknown) => err instanceof UnknownReferenceError,
  );
});

test("RetryTask execute throws WrongTypeReferenceError for non-task id", async () => {
  const store = new SimpleTaskStore([]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("initiative");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: "some-initiative-id" }),
    (err: unknown) => err instanceof WrongTypeReferenceError,
  );
});

test("RetryTask execute wraps writes in exactly one transaction", async () => {
  const store = new SimpleTaskStore([makeTask("failed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await uc.execute({ taskId: TASK_ID });

  assert.equal(uow.txCount, 1, "must use exactly one transaction");
});
