/**
 * Story 07 T2 — RejectTask use case
 *
 * Tests (e), (f), (h) from Story 07 AC. All tests use in-memory fakes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { RejectTask, RejectionConflictError } from "./reject-task.ts";
import { TaskNotAwaitingConfirmationError } from "./approve-task.ts";
import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

interface RejectTaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  getTaskResult(taskId: string): TaskResultRow | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}

class MemStore implements RejectTaskStore {
  readonly savedTasks: Task[] = [];
  readonly savedResults: Array<{ taskId: string; row: TaskResultRow }> = [];
  readonly #tasks: Map<string, Task>;
  readonly #results: Map<string, TaskResultRow>;
  readonly #initiativeId: string;

  constructor(
    tasks: Task[],
    results: Map<string, TaskResultRow>,
    initiativeId: string,
  ) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#results = new Map(results);
    this.#initiativeId = initiativeId;
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  save(task: Task): void {
    this.#tasks.set(task.id, task);
    this.savedTasks.push(task);
  }

  getTaskResult(taskId: string): TaskResultRow | undefined {
    return this.#results.get(taskId);
  }

  saveTaskResult(taskId: string, row: TaskResultRow): void {
    this.#results.set(taskId, row);
    this.savedResults.push({ taskId, row });
  }

  listByInitiative(_id: string): Task[] {
    return [...this.#tasks.values()];
  }

  getInitiativeId(taskId: string): string | undefined {
    return this.#tasks.has(taskId) ? this.#initiativeId : undefined;
  }
}

class MemQueue implements JobQueue {
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

class MemFeed implements EventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

class MemUow implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

// ---------------------------------------------------------------------------
// Fixture ids
// ---------------------------------------------------------------------------

const INI_ID = "01JZZZZZZZZZZZZZZZZZZZINIRJ";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJET";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSKRJ";
const CHILD_ID = "01JZZZZZZZZZZZZZZZZZZZCHIRJ";

function makeAwaitingTask(taskId: string, deps: string[] = []): Task {
  return {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "agent task",
    status: "awaiting_confirmation",
    dependencies: deps,
  };
}

function makeResultRow(overrides: Partial<TaskResultRow> = {}): TaskResultRow {
  return {
    workspace: "/tmp/ws/task",
    branch: `kanthord/${TASK_ID}`,
    baseCommit: "base123",
    proposalCommit: "prop456",
    commitSha: null,
    summary: "agent made a change",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (e) reject --resolution retry: task → pending, task.rejected event, NO task.failed
// ---------------------------------------------------------------------------

test("(e) RejectTask --resolution retry: task goes to pending, task.rejected event, NO task.failed event", async () => {
  const store = new MemStore(
    [makeAwaitingTask(TASK_ID)],
    new Map([[TASK_ID, makeResultRow()]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();

  const uc = new RejectTask(store, queue, feed, uow);
  await uc.execute({
    taskId: TASK_ID,
    resolution: "retry",
    reason: "wrong file edited",
  });

  // Task must be pending (NOT failed — a review decision is not a failure)
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "pending",
    `task must be pending after retry rejection; got: ${last.status}`,
  );
  assert.notEqual(
    last.status,
    "failed",
    "task must NEVER be failed for a retry rejection",
  );

  // rejection_resolution persisted
  const savedResult = store.savedResults[store.savedResults.length - 1];
  assert.ok(savedResult !== undefined, "saveTaskResult must be called");
  assert.equal(
    savedResult.row.rejectionResolution,
    "retry",
    "rejection_resolution must be 'retry'",
  );
  assert.equal(
    savedResult.row.rejectionReason,
    "wrong file edited",
    "rejection_reason must be persisted",
  );

  // task.rejected event emitted
  const rejectedEvents = feed.events.filter((e) => e.type === "task.rejected");
  assert.equal(rejectedEvents.length, 1, "exactly one task.rejected event");
  assert.equal(
    rejectedEvents[0]!.payload?.["code"],
    "REJECTED_BY_ACTOR",
    "event payload code must be REJECTED_BY_ACTOR",
  );
  assert.equal(
    rejectedEvents[0]!.payload?.["resolution"],
    "retry",
    "event payload resolution must be retry",
  );

  // NO task.failed event
  const failedEvents = feed.events.filter((e) => e.type === "task.failed");
  assert.equal(
    failedEvents.length,
    0,
    "must be NO task.failed event for a retry rejection",
  );
});

// ---------------------------------------------------------------------------
// (f) reject --resolution discard: task discarded, task.discarded + task.blocked events
// ---------------------------------------------------------------------------

test("(f) RejectTask --resolution discard: task discarded, task.discarded event, task.blocked for each dependent", async () => {
  // Parent task + one child that depends on it
  const store = new MemStore(
    [
      makeAwaitingTask(TASK_ID),
      {
        id: CHILD_ID,
        objectiveId: OBJ_ID,
        title: "child task",
        status: "pending",
        dependencies: [TASK_ID],
      },
    ],
    new Map([[TASK_ID, makeResultRow()]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();

  const uc = new RejectTask(store, queue, feed, uow);
  await uc.execute({
    taskId: TASK_ID,
    resolution: "discard",
  });

  // Task must be discarded (terminal status)
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "discarded",
    `task must be discarded; got: ${last.status}`,
  );

  // rejection_resolution persisted
  const savedResult = store.savedResults[store.savedResults.length - 1];
  assert.ok(savedResult !== undefined, "saveTaskResult must be called");
  assert.equal(
    savedResult.row.rejectionResolution,
    "discard",
    "rejection_resolution must be 'discard'",
  );

  // task.rejected event emitted
  const rejectedEvents = feed.events.filter((e) => e.type === "task.rejected");
  assert.equal(rejectedEvents.length, 1, "one task.rejected event");
  assert.equal(
    rejectedEvents[0]!.payload?.["resolution"],
    "discard",
    "event payload resolution must be discard",
  );

  // task.discarded event emitted
  const discardedEvents = feed.events.filter(
    (e) => e.type === "task.discarded",
  );
  assert.equal(discardedEvents.length, 1, "one task.discarded event");

  // task.blocked event emitted for the direct dependent
  const blockedEvents = feed.events.filter((e) => e.type === "task.blocked");
  assert.equal(
    blockedEvents.length,
    1,
    "one task.blocked event for the direct dependent",
  );
  assert.equal(
    blockedEvents[0]!.payload?.["dependencyId"],
    TASK_ID,
    "task.blocked payload must name the discarded dependency",
  );

  // Child must NOT be enqueued
  assert.ok(
    !queue.enqueued.includes(CHILD_ID),
    "child must not be enqueued when parent is discarded",
  );
});

// ---------------------------------------------------------------------------
// (h-same) same resolution repeated → idempotent no-op, no duplicate events
// ---------------------------------------------------------------------------

test("(h-same) RejectTask same resolution repeated → idempotent no-op, no duplicate events", async () => {
  // Pre-stored result with rejection_resolution already = "retry"
  const store = new MemStore(
    [makeAwaitingTask(TASK_ID)],
    new Map([
      [
        TASK_ID,
        makeResultRow({
          rejectionResolution: "retry",
          rejectionReason: "wrong file",
        }),
      ],
    ]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();

  const uc = new RejectTask(store, queue, feed, uow);
  // Same resolution as already stored → must not throw, no side effects
  await uc.execute({ taskId: TASK_ID, resolution: "retry" });

  assert.equal(
    store.savedTasks.length,
    0,
    "no task save on idempotent re-reject",
  );
  assert.equal(feed.events.length, 0, "no events on idempotent re-reject");
});

// ---------------------------------------------------------------------------
// (h-conflict) opposite resolution → RejectionConflictError
// ---------------------------------------------------------------------------

test("(h-conflict) RejectTask opposite resolution → RejectionConflictError { taskId, stored, requested }", async () => {
  // Pre-stored result with rejection_resolution = "retry"
  const store = new MemStore(
    [makeAwaitingTask(TASK_ID)],
    new Map([[TASK_ID, makeResultRow({ rejectionResolution: "retry" })]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();

  const uc = new RejectTask(store, queue, feed, uow);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID, resolution: "discard" }),
    (err: unknown) => {
      assert.ok(
        err instanceof RejectionConflictError,
        `must be RejectionConflictError; got: ${(err as Error).constructor.name}`,
      );
      assert.equal(
        (err as RejectionConflictError).taskId,
        TASK_ID,
        "err.taskId must match",
      );
      assert.equal(
        (err as RejectionConflictError).stored,
        "retry",
        "err.stored must be the already-stored resolution",
      );
      assert.equal(
        (err as RejectionConflictError).requested,
        "discard",
        "err.requested must be the conflicting resolution",
      );
      return true;
    },
    "opposite resolution must throw RejectionConflictError",
  );
});

// ---------------------------------------------------------------------------
// (h-after-approve) reject after task completed (approved) → RejectionConflictError
// ---------------------------------------------------------------------------

test("(h-after-approve) RejectTask after task completed (no stored decision) → RejectionConflictError", async () => {
  // Task is completed (approved) — no rejectionResolution stored
  const completedTask: Task = {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "approved task",
    status: "completed",
    dependencies: [],
  };
  const approvedResult: TaskResultRow = {
    workspace: "/tmp/ws/task",
    branch: `kanthord/${TASK_ID}`,
    baseCommit: "base123",
    proposalCommit: "prop456",
    commitSha: "prop456", // already approved
    summary: "done",
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };

  const store = new MemStore(
    [completedTask],
    new Map([[TASK_ID, approvedResult]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();

  const uc = new RejectTask(store, queue, feed, uow);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID, resolution: "retry" }),
    (err: unknown) => {
      assert.ok(
        err instanceof RejectionConflictError,
        `must be RejectionConflictError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
    "reject after approve must throw RejectionConflictError",
  );
});
