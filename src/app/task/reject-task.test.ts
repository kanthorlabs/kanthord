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
import type { Objective, Initiative } from "../../domain/initiative.ts";

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
  getObjective(objectiveId: string): Objective | undefined;
  saveObjective(objective: Objective): void;
  listObjectives(initiativeId: string): Objective[];
  getInitiative(initiativeId: string): Initiative | undefined;
  saveInitiative(initiative: Initiative): void;
}

class MemStore implements RejectTaskStore {
  readonly savedTasks: Task[] = [];
  readonly savedResults: Array<{ taskId: string; row: TaskResultRow }> = [];
  readonly savedObjectives: Objective[] = [];
  readonly savedInitiatives: Initiative[] = [];
  readonly #tasks: Map<string, Task>;
  readonly #results: Map<string, TaskResultRow>;
  readonly #initiativeId: string;
  readonly #objectives: Map<string, Objective>;
  readonly #initiatives: Map<string, Initiative>;

  constructor(
    tasks: Task[],
    results: Map<string, TaskResultRow>,
    initiativeId: string,
    objectives: Objective[] = [
      { id: OBJ_ID, initiativeId, name: "O", status: "building" },
    ],
    initiatives: Initiative[] = [
      { id: initiativeId, projectId: "proj-1", name: "I", status: "building" },
    ],
  ) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#results = new Map(results);
    this.#initiativeId = initiativeId;
    this.#objectives = new Map(objectives.map((o) => [o.id, o]));
    this.#initiatives = new Map(initiatives.map((i) => [i.id, i]));
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

  getObjective(objectiveId: string): Objective | undefined {
    return this.#objectives.get(objectiveId);
  }

  saveObjective(objective: Objective): void {
    this.#objectives.set(objective.id, objective);
    this.savedObjectives.push(objective);
  }

  listObjectives(initiativeId: string): Objective[] {
    return [...this.#objectives.values()].filter(
      (o) => o.initiativeId === initiativeId,
    );
  }

  getInitiative(initiativeId: string): Initiative | undefined {
    return this.#initiatives.get(initiativeId);
  }

  saveInitiative(initiative: Initiative): void {
    this.#initiatives.set(initiative.id, initiative);
    this.savedInitiatives.push(initiative);
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
const OBJ2_ID = "01JZZZZZZZZZZZZZZZZZZZOBJE2";
const DEP_PENDING_ID = "01JZZZZZZZZZZZZZZZZZZZDEPP1";
const DEP_COMPLETED_ID = "01JZZZZZZZZZZZZZZZZZZZDEPC1";

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
  // Parent task + one child that depends on it. Story 05 adds a cascade that
  // discards `pending` dependents, so this child is kept out of `pending`
  // (using `awaiting_confirmation` instead) to isolate the pre-existing
  // task.blocked-per-dependent behavior this test targets from the new
  // cascade behavior, which the Story 05 tests below cover directly.
  const store = new MemStore(
    [
      makeAwaitingTask(TASK_ID),
      {
        id: CHILD_ID,
        objectiveId: OBJ_ID,
        title: "child task",
        status: "awaiting_confirmation",
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

// ---------------------------------------------------------------------------
// Story 05 (a/b) — reject from `failed`: discard now allowed, retry still not
// ---------------------------------------------------------------------------

test("(Story 05 a) RejectTask failed + discard: succeeds, task becomes discarded", async () => {
  const failedTask: Task = {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "unachievable task",
    status: "failed",
    dependencies: [],
  };
  const store = new MemStore([failedTask], new Map(), INI_ID);
  const uc = new RejectTask(store, new MemQueue(), new MemFeed(), new MemUow());

  await uc.execute({
    taskId: TASK_ID,
    resolution: "discard",
    reason: "unachievable",
  });

  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "discarded",
    `a failed task must become discarded after --resolution discard; got: ${last.status}`,
  );
});

test("(Story 05 b) RejectTask failed + retry: still throws TaskNotAwaitingConfirmationError", async () => {
  const failedTask: Task = {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "unachievable task",
    status: "failed",
    dependencies: [],
  };
  const store = new MemStore([failedTask], new Map(), INI_ID);
  const uc = new RejectTask(store, new MemQueue(), new MemFeed(), new MemUow());

  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID, resolution: "retry" }),
    (err: unknown) => {
      assert.ok(
        err instanceof TaskNotAwaitingConfirmationError,
        `must be TaskNotAwaitingConfirmationError; got: ${(err as Error).constructor.name}`,
      );
      return true;
    },
    "failed + retry must still throw TaskNotAwaitingConfirmationError — retry is the verb for that path",
  );
});

// ---------------------------------------------------------------------------
// Story 05 (c-g) — cascade to pending dependents, skip others, roll up
// objective + initiative to `discarded`, never `objective.integrated`
// ---------------------------------------------------------------------------

test("(Story 05 c-g) RejectTask discard cascades pending dependents, skips a completed one, and rolls up the objective + initiative to discarded", async () => {
  const root: Task = {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "root (unachievable)",
    status: "failed",
    dependencies: [],
  };
  const depPending: Task = {
    id: DEP_PENDING_ID,
    objectiveId: OBJ_ID,
    title: "dependent, never ran",
    status: "pending",
    dependencies: [TASK_ID],
  };
  const depCompleted: Task = {
    id: DEP_COMPLETED_ID,
    objectiveId: OBJ_ID,
    title: "dependent, already done",
    status: "completed",
    dependencies: [TASK_ID],
  };

  const store = new MemStore(
    [root, depPending, depCompleted],
    new Map(),
    INI_ID,
    [
      { id: OBJ_ID, initiativeId: INI_ID, name: "O1", status: "building" },
      { id: OBJ2_ID, initiativeId: INI_ID, name: "O2", status: "integrated" },
    ],
    [{ id: INI_ID, projectId: "proj-1", name: "I", status: "building" }],
  );
  const feed = new MemFeed();
  const uc = new RejectTask(store, new MemQueue(), feed, new MemUow());

  const result = await uc.execute({
    taskId: TASK_ID,
    resolution: "discard",
    reason: "unachievable",
  });

  // (c) cascade: the pending dependent is discarded, the completed one is
  // left untouched and reported skipped.
  assert.equal(
    store.get(DEP_PENDING_ID)?.status,
    "discarded",
    "pending dependent must cascade to discarded",
  );
  assert.equal(
    store.get(DEP_COMPLETED_ID)?.status,
    "completed",
    "completed dependent must NOT be touched by the cascade",
  );
  assert.ok(
    result !== undefined && Array.isArray(result.skipped),
    "execute() must return a skipped-task report the CLI can render",
  );
  assert.ok(
    result.skipped.includes(DEP_COMPLETED_ID),
    `skipped completed dependent must be reported; got: ${JSON.stringify(result.skipped)}`,
  );

  // (d) each cascaded task emits its own task.discarded with a cascade
  // payload naming the originating task.
  const cascadedDiscardEvent = feed.events.find(
    (e) => e.type === "task.discarded" && e.taskId === DEP_PENDING_ID,
  );
  assert.ok(
    cascadedDiscardEvent !== undefined,
    "a task.discarded event must be appended for the cascaded dependent",
  );
  assert.equal(
    cascadedDiscardEvent?.payload?.["reason"],
    "cascade",
    "cascaded task.discarded payload.reason must be 'cascade'",
  );
  assert.equal(
    cascadedDiscardEvent?.payload?.["origin"],
    TASK_ID,
    "cascaded task.discarded payload.origin must be the originating task id",
  );

  // (e) the objective becomes discarded (all tasks terminal, at least one
  // discarded) and emits objective.discarded.
  assert.equal(
    store.getObjective(OBJ_ID)?.status,
    "discarded",
    "objective must become discarded once all its tasks are terminal with at least one discarded",
  );
  const objectiveDiscardedEvent = feed.events.find(
    (e) => e.type === "objective.discarded" && e.objectiveId === OBJ_ID,
  );
  assert.ok(
    objectiveDiscardedEvent !== undefined,
    "an objective.discarded event must be appended",
  );

  // (f) the initiative becomes discarded (all objectives terminal, at least
  // one discarded) and emits initiative.discarded.
  assert.equal(
    store.getInitiative(INI_ID)?.status,
    "discarded",
    "initiative must become discarded once all its objectives are terminal with at least one discarded",
  );
  const initiativeDiscardedEvent = feed.events.find(
    (e) => e.type === "initiative.discarded" && e.initiativeId === INI_ID,
  );
  assert.ok(
    initiativeDiscardedEvent !== undefined,
    "an initiative.discarded event must be appended",
  );

  // (g) discarded work is NEVER completion — no objective.integrated event.
  const integratedEvents = feed.events.filter(
    (e) => e.type === "objective.integrated",
  );
  assert.equal(
    integratedEvents.length,
    0,
    "no objective.integrated event must ever be appended on a discard path",
  );
});

// ---------------------------------------------------------------------------
// (S8) task.blocked must not be emitted for a direct dependent the cascade
// discards in the same transaction; it must still be emitted for a direct
// dependent the cascade leaves untouched (reported as skipped).
// ---------------------------------------------------------------------------

test("(S8) RejectTask discard: task.blocked is emitted only for direct dependents the cascade does NOT discard", async () => {
  const root: Task = {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "root",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const depPending: Task = {
    id: DEP_PENDING_ID,
    objectiveId: OBJ_ID,
    title: "pending dependent — cascade will discard this one",
    status: "pending",
    dependencies: [TASK_ID],
  };
  const depAwaiting: Task = {
    id: CHILD_ID,
    objectiveId: OBJ_ID,
    title: "non-pending dependent — cascade skips this one",
    status: "awaiting_confirmation",
    dependencies: [TASK_ID],
  };

  const store = new MemStore(
    [root, depPending, depAwaiting],
    new Map(),
    INI_ID,
  );
  const feed = new MemFeed();
  const uc = new RejectTask(store, new MemQueue(), feed, new MemUow());

  const result = await uc.execute({
    taskId: TASK_ID,
    resolution: "discard",
  });

  // Sanity: the pending dependent did cascade to discarded, the
  // awaiting_confirmation one was left untouched and reported skipped.
  assert.equal(store.get(DEP_PENDING_ID)?.status, "discarded");
  assert.equal(store.get(CHILD_ID)?.status, "awaiting_confirmation");
  assert.ok(result !== undefined && result.skipped.includes(CHILD_ID));

  const blockedEvents = feed.events.filter((e) => e.type === "task.blocked");
  assert.equal(
    blockedEvents.length,
    1,
    `exactly one task.blocked event must be emitted — only for the non-discarded dependent; got: ${JSON.stringify(blockedEvents)}`,
  );
  assert.equal(
    blockedEvents[0]!.taskId,
    CHILD_ID,
    "the task.blocked event must name the non-discarded dependent, not the cascade-discarded one",
  );
  assert.equal(
    blockedEvents[0]!.payload?.["dependencyId"],
    TASK_ID,
    "task.blocked payload must name the discarded dependency (unchanged shape)",
  );

  const blockedForCascaded = feed.events.find(
    (e) => e.type === "task.blocked" && e.taskId === DEP_PENDING_ID,
  );
  assert.equal(
    blockedForCascaded,
    undefined,
    "no task.blocked event may be emitted for a dependent the cascade already discarded",
  );
});
