/**
 * EPIC 013 Story 3 — AbandonTask use case.
 *
 * Fakes only, following the `src/app/task/recover-interrupted-tasks.test.ts`
 * convention. The test pins the user-observable behaviour of `execute()`:
 *
 *   - unknown task → `UnknownReferenceError`
 *   - task not in `running` status → `TaskNotAbandonableError` whose `message`
 *     names the actual status
 *   - `running` task with zero / multiple running jobs → typed errors
 *     (`NoRunningJobError`, `AmbiguousRunningJobError`); revoke is NOT called
 *   - `running` task with one non-revoked job → `{ outcome: "abandoning" }`,
 *     and `revoke` recorded exactly `(jobId, reason)`
 *   - `running` task with an already-revoked job → `{ outcome:
 *     "already_abandoning" }`, revoke is NOT called, no event appended
 *     (idempotency)
 *   - the whole body runs inside one transaction
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Task } from "../../domain/task.ts";
import { UnknownReferenceError } from "../errors.ts";
import type { Event } from "../../domain/event.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type {
  JobQueue,
  ClaimedJob,
  RunningJob,
  LeaseToken,
} from "../../queue/port.ts";
import {
  AbandonTask,
  TaskNotAbandonableError,
  NoRunningJobError,
  AmbiguousRunningJobError,
} from "./abandon-task.ts";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface TaskStore {
  get(id: string): Task | undefined;
}

class SimpleTaskStore implements TaskStore {
  readonly #tasks: Map<string, Task>;

  constructor(tasks: Task[]) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }
}

class RecordingJobQueue implements JobQueue {
  /** EPIC 013 S3 — `revoke(leaseToken, reason)` calls recorded in order. */
  readonly revokeCalls: Array<{ leaseToken: string; reason: string }> = [];
  readonly discarded: string[] = [];
  readonly enqueued: string[] = [];
  readonly #runningJobs: RunningJob[];
  /**
   * EPIC 013 S6 — force `revoke` to contradict the step 3 read. Only a broken
   * adapter or broken transaction isolation can produce this in production.
   */
  revokeResultOverride: "already_revoked" | "not_found" | undefined;

  constructor(runningJobs: RunningJob[] = []) {
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
    return this.#runningJobs.map((j) => ({ id: j.id, taskId: j.taskId }));
  }

  isLeaseCurrent(_leaseToken: LeaseToken): boolean {
    return true;
  }

  listRunningJobsForTask(_taskId: string): RunningJob[] {
    return this.#runningJobs.map((j) => ({ ...j }));
  }

  /** EPIC 013 S3 — Story 3's seam. */
  revoke(
    leaseToken: string,
    reason: string,
  ): "revoked" | "already_revoked" | "not_found" {
    this.revokeCalls.push({ leaseToken, reason });
    if (this.revokeResultOverride !== undefined) {
      return this.revokeResultOverride;
    }
    const job = this.#runningJobs.find((j) => j.id === leaseToken);
    if (job === undefined) return "not_found";
    if (job.revoked) return "already_revoked";
    job.revoked = true;
    job.revokeReason = reason;
    return "revoked";
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

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ3";
const JOB_ID = "01JZZZZZZZZZZZZZZZZZZZJOB3";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSK3";

function makeTask(status: Task["status"]): Task {
  return {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "abandoned-task",
    status,
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// 1. unknown task → UnknownReferenceError
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: unknown task id → throws UnknownReferenceError", () => {
  const store = new SimpleTaskStore([]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: "missing-task", reason: "stuck" }),
    (err: unknown) => err instanceof UnknownReferenceError,
    "an unknown task id must reject with UnknownReferenceError",
  );

  // No side-effects: no revoke, no event, no enqueue.
  assert.equal(
    queue.revokeCalls.length,
    0,
    "revoke must NOT be called for an unknown task",
  );
  assert.equal(feed.events.length, 0, "no event appended for an unknown task");
});

// ---------------------------------------------------------------------------
// 2. task not in `running` status → TaskNotAbandonableError naming the actual status
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: pending task → TaskNotAbandonableError, message names 'pending'", () => {
  const store = new SimpleTaskStore([makeTask("pending")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  let captured: unknown;
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => {
      captured = err;
      return err instanceof TaskNotAbandonableError;
    },
    "a pending task is not abandonable — must throw TaskNotAbandonableError",
  );
  assert.ok(captured instanceof TaskNotAbandonableError);
  assert.equal((captured as { status: Task["status"] }).status, "pending");
  assert.ok(
    (captured as Error).message.includes("pending"),
    `error message must name the actual status 'pending'; got: ${(captured as Error).message}`,
  );
  assert.equal(queue.revokeCalls.length, 0, "no revoke on a non-running task");
  assert.equal(feed.events.length, 0, "no event on a non-running task");
});

test("(013 S3) abandon execute: completed task → TaskNotAbandonableError, message names 'completed'", () => {
  const store = new SimpleTaskStore([makeTask("completed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => {
      if (!(err instanceof TaskNotAbandonableError)) return false;
      return (err as Error).message.includes("completed");
    },
    "a completed task is not abandonable — message must name 'completed'",
  );
  assert.equal(queue.revokeCalls.length, 0);
});

test("(013 S3) abandon execute: failed task → TaskNotAbandonableError, message names 'failed'", () => {
  const store = new SimpleTaskStore([makeTask("failed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => {
      if (!(err instanceof TaskNotAbandonableError)) return false;
      return (err as Error).message.includes("failed");
    },
    "a failed task is not abandonable — message must name 'failed'",
  );
  assert.equal(queue.revokeCalls.length, 0);
});

test("(013 S3) abandon execute: awaiting_confirmation task → TaskNotAbandonableError, message names 'awaiting_confirmation'", () => {
  const store = new SimpleTaskStore([makeTask("awaiting_confirmation")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => {
      if (!(err instanceof TaskNotAbandonableError)) return false;
      return (err as Error).message.includes("awaiting_confirmation");
    },
    "an awaiting_confirmation task is not abandonable — message must name 'awaiting_confirmation'",
  );
  assert.equal(queue.revokeCalls.length, 0);
});

test("(013 S3) abandon execute: discarded task → TaskNotAbandonableError, message names 'discarded'", () => {
  const store = new SimpleTaskStore([makeTask("discarded")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => {
      if (!(err instanceof TaskNotAbandonableError)) return false;
      return (err as Error).message.includes("discarded");
    },
    "a discarded task is not abandonable — message must name 'discarded'",
  );
  assert.equal(queue.revokeCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 3. running task with zero running jobs → NoRunningJobError
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: running task with zero running jobs → NoRunningJobError", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([]); // no running jobs for any task
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => err instanceof NoRunningJobError,
    "a running task with no running job rows must reject with NoRunningJobError",
  );
  assert.equal(
    queue.revokeCalls.length,
    0,
    "no revoke when there is no running job",
  );
  assert.equal(feed.events.length, 0, "no event on no-running-job");
});

// ---------------------------------------------------------------------------
// 4. running task with multiple running jobs → AmbiguousRunningJobError
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: running task with two running jobs → AmbiguousRunningJobError(count=2), revoke NOT called", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([
    { id: JOB_ID, taskId: TASK_ID, revoked: false, revokeReason: null },
    {
      id: "01JZZZZZZZZZZZZZZZZZZZJOB4",
      taskId: TASK_ID,
      revoked: false,
      revokeReason: null,
    },
  ]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) => {
      if (!(err instanceof AmbiguousRunningJobError)) return false;
      return (err as { count: number }).count === 2;
    },
    "two running jobs for one task must reject with AmbiguousRunningJobError(count=2)",
  );
  assert.equal(
    queue.revokeCalls.length,
    0,
    "ambiguous state must NOT trigger a revoke (refuse, do not guess)",
  );
  assert.equal(feed.events.length, 0, "no event on ambiguous state");
});

// ---------------------------------------------------------------------------
// 5. running task with one non-revoked job → abandoning, revoke called
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: running task with one non-revoked job → outcome 'abandoning', revoke recorded exactly (jobId, reason)", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([
    { id: JOB_ID, taskId: TASK_ID, revoked: false, revokeReason: null },
  ]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  const result = uc.execute({
    taskId: TASK_ID,
    reason: "stuck on a slow tool",
  });

  assert.deepEqual(
    result,
    { outcome: "abandoning", taskId: TASK_ID },
    "the happy-path outcome is 'abandoning'",
  );
  assert.equal(
    queue.revokeCalls.length,
    1,
    "revoke must be called exactly once",
  );
  assert.deepEqual(
    queue.revokeCalls[0],
    { leaseToken: JOB_ID, reason: "stuck on a slow tool" },
    "revoke must receive the (jobId, reason) tuple",
  );
  assert.equal(
    feed.events.length,
    0,
    "no event on abandon (Story 4 appends task.abandoned on the requeue path)",
  );
});

// ---------------------------------------------------------------------------
// 6. running task with an already-revoked job → already_abandoning (idempotency)
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: running task with an already-revoked job → outcome 'already_abandoning', revoke NOT called, no event appended", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([
    {
      id: JOB_ID,
      taskId: TASK_ID,
      revoked: true,
      revokeReason: "first reason",
    },
  ]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  const result = uc.execute({
    taskId: TASK_ID,
    reason: "second reason overwrites nothing",
  });

  assert.deepEqual(
    result,
    { outcome: "already_abandoning", taskId: TASK_ID },
    "an already-revoked job is a no-op — outcome is 'already_abandoning'",
  );
  assert.equal(
    queue.revokeCalls.length,
    0,
    "a second abandon must NOT call revoke (idempotency — the first reason stays)",
  );
  assert.equal(feed.events.length, 0, "no event on already_abandoning");
});

// ---------------------------------------------------------------------------
// 7. whole body runs inside one transaction
// ---------------------------------------------------------------------------

test("(013 S3) abandon execute: the whole body runs inside exactly one transaction (uow.txCount === 1)", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([
    { id: JOB_ID, taskId: TASK_ID, revoked: false, revokeReason: null },
  ]);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  uc.execute({ taskId: TASK_ID, reason: "stuck" });

  assert.equal(uow.txCount, 1, "the body must use exactly one transaction");
});

// ---------------------------------------------------------------------------
// 8. revoke's result is never ignored — a discriminant that contradicts the
//    step 3 read is an invariant violation, not an ordinary outcome. Mapping
//    it onto `already_abandoning` / `NoRunningJobError` would disguise broken
//    isolation as an operator race and hide that the reason was never stored.
// ---------------------------------------------------------------------------

test("(013 S6) abandon execute: revoke returning 'already_revoked' after a non-revoked read throws, never reports already_abandoning", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([
    { id: JOB_ID, taskId: TASK_ID, revoked: false, revokeReason: null },
  ]);
  queue.revokeResultOverride = "already_revoked";
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes("revoke invariant violated") &&
      err.message.includes(TASK_ID) &&
      err.message.includes(JOB_ID) &&
      err.message.includes("already_revoked"),
    "a revoke result contradicting the step 3 read must throw and name the task, job and discriminant",
  );
});

test("(013 S6) abandon execute: revoke returning 'not_found' after a running read throws, never reports NoRunningJobError", () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue([
    { id: JOB_ID, taskId: TASK_ID, revoked: false, revokeReason: null },
  ]);
  queue.revokeResultOverride = "not_found";
  const uow = new RecordingUnitOfWork();

  const uc = new AbandonTask(store, queue, uow);
  assert.throws(
    () => uc.execute({ taskId: TASK_ID, reason: "stuck" }),
    (err: unknown) =>
      err instanceof Error &&
      !(err instanceof NoRunningJobError) &&
      err.message.includes("revoke invariant violated") &&
      err.message.includes("not_found"),
    "a vanished lease at write time is an invariant violation, not the operator-facing NoRunningJobError",
  );
});
