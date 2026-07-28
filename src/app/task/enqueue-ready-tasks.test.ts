import { test } from "node:test";
import assert from "node:assert/strict";
import { EnqueueReadyTasks } from "./enqueue-ready-tasks.ts";
import type { JobQueue, ClaimedJob, RunningJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";
import type {
  InitiativeStatus,
  ObjectiveStatus,
} from "../../domain/initiative.ts";

// --- Minimal structural fakes (EnqueueReadyTasks depends on the narrow shape) ---

interface InitiativeSource {
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
  get(id: string): { status?: InitiativeStatus } | undefined;
  getObjective(id: string): { status?: ObjectiveStatus } | undefined;
}

interface SequencingSource {
  listInitiativeAfter(initiativeId: string): string[];
  listObjectiveAfter(objectiveId: string): string[];
}

interface TaskSource {
  listByInitiative(initiativeId: string): Task[];
}

class RecordingJobQueue implements JobQueue {
  readonly enqueued: string[] = [];
  readonly #blocked = new Set<string>();

  /** Pre-block a task id so the next enqueue returns false (idempotent). */
  blockEnqueue(taskId: string): void {
    this.#blocked.add(taskId);
  }

  enqueue(taskId: string): boolean {
    if (this.#blocked.has(taskId)) return false;
    this.enqueued.push(taskId);
    this.#blocked.add(taskId);
    return true;
  }

  claim(): ClaimedJob | undefined {
    return undefined;
  }

  finish(_jobId: string, _outcome: "completed" | "failed"): void {}

  discard(_jobId: string): void {}

  listRunningJobs(): ClaimedJob[] {
    return [];
  }

  isLeaseCurrent(_leaseToken: string): boolean {
    return true;
  }

  listRunningJobsForTask(_taskId: string): RunningJob[] {
    return [];
  }

  // EPIC 013 Story 3 — `revoke` seam. enqueue-ready-tasks never reaches it;
  // default to `not_found` so a stray call surfaces clearly in tests.
  revoke(
    _leaseToken: string,
    _reason: string,
  ): "revoked" | "already_revoked" | "not_found" {
    return "not_found";
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

// --- Fixture constants ---

const INI_ACTIVE = "01JZZZZZZZZZZZZZZZZZZZINI1";
const INI_PAUSED = "01JZZZZZZZZZZZZZZZZZZZINI2";
const T_ROOT = "01JZZZZZZZZZZZZZZZZZZTSK10";
const T_LEFT = "01JZZZZZZZZZZZZZZZZZZTSK20";
const T_RIGHT = "01JZZZZZZZZZZZZZZZZZZTSK30";
const T_BOTTOM = "01JZZZZZZZZZZZZZZZZZZTSK40";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";
const INI_A = "01JZZZZZZZZZZZZZZZZZZZINIA";
const INI_B = "01JZZZZZZZZZZZZZZZZZZZINIB";
const OBJ_A = "01JZZZZZZZZZZZZZZZZZZZOBA1";
const OBJ_B = "01JZZZZZZZZZZZZZZZZZZZOBB1";
const T_A = "01JZZZZZZZZZZZZZZZZZZZTSKA";
const T_B = "01JZZZZZZZZZZZZZZZZZZZTSKB";

// Diamond: root(completed) → left,right(pending, ready) → bottom(pending, blocked)
const DIAMOND_TASKS: Task[] = [
  {
    id: T_ROOT,
    objectiveId: OBJ_ID,
    title: "root",
    status: "completed",
    dependencies: [],
  },
  {
    id: T_LEFT,
    objectiveId: OBJ_ID,
    title: "left",
    status: "pending",
    dependencies: [T_ROOT],
  },
  {
    id: T_RIGHT,
    objectiveId: OBJ_ID,
    title: "right",
    status: "pending",
    dependencies: [T_ROOT],
  },
  {
    id: T_BOTTOM,
    objectiveId: OBJ_ID,
    title: "bottom",
    status: "pending",
    dependencies: [T_LEFT, T_RIGHT],
  },
];

type InitStatusMap = Map<string, InitiativeStatus | undefined>;
type ObjStatusMap = Map<string, ObjectiveStatus | undefined>;

function makeInitSrc(
  list: Array<{ id: string; paused: boolean }>,
  initStatuses?: InitStatusMap,
  objStatuses?: ObjStatusMap,
): InitiativeSource {
  return {
    listAllInitiatives() {
      return list;
    },
    get(id: string) {
      const s = initStatuses?.get(id);
      return s !== undefined ? { status: s } : undefined;
    },
    getObjective(id: string) {
      const s = objStatuses?.get(id);
      return s !== undefined ? { status: s } : undefined;
    },
  };
}

function makeSequencingSource(
  initAfter: Map<string, string[]>,
  objAfter: Map<string, string[]>,
): SequencingSource {
  return {
    listInitiativeAfter(initiativeId: string) {
      return initAfter.get(initiativeId) ?? [];
    },
    listObjectiveAfter(objectiveId: string) {
      return objAfter.get(objectiveId) ?? [];
    },
  };
}

function makeTaskSrc(tasks: Task[]): TaskSource {
  return {
    listByInitiative(_id: string) {
      return tasks;
    },
  };
}

/** TaskSource where tasks are scoped per-initiative id. */
function makeTaskSrcMap(taskMap: Map<string, Task[]>): TaskSource {
  return {
    listByInitiative(id: string) {
      return taskMap.get(id) ?? [];
    },
  };
}

// --- Tests ---

test("EnqueueReadyTasks execute enqueues ready pending tasks and emits task.ready events", async () => {
  const initSrc = makeInitSrc([{ id: INI_ACTIVE, paused: false }]);
  const taskSrc = makeTaskSrc(DIAMOND_TASKS);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow);
  const result = await uc.execute();

  // Only left and right are ready; root is completed, bottom is blocked
  assert.deepEqual(
    [...result].sort(),
    [T_LEFT, T_RIGHT].sort(),
    "returns the two enqueued task ids",
  );
  assert.deepEqual(
    [...queue.enqueued].sort(),
    [T_LEFT, T_RIGHT].sort(),
    "exactly the two ready tasks queued",
  );
  assert.equal(feed.events.length, 2, "one task.ready event per enqueued task");
  for (const ev of feed.events) {
    assert.equal(ev.type, "task.ready");
    assert.ok(
      ev.taskId !== undefined && [T_LEFT, T_RIGHT].includes(ev.taskId),
      `event taskId ${ev.taskId} must be left or right`,
    );
  }
});

test("EnqueueReadyTasks execute second run with all already-queued is idempotent", async () => {
  const initSrc = makeInitSrc([{ id: INI_ACTIVE, paused: false }]);
  const taskSrc = makeTaskSrc(DIAMOND_TASKS);

  // Second-run queue pre-blocks both tasks (simulate they are already queued)
  const queue2 = new RecordingJobQueue();
  queue2.blockEnqueue(T_LEFT);
  queue2.blockEnqueue(T_RIGHT);
  const feed2 = new RecordingEventFeed();
  const uow2 = new RecordingUnitOfWork();

  const uc2 = new EnqueueReadyTasks(initSrc, taskSrc, queue2, feed2, uow2);
  const result2 = await uc2.execute();

  assert.deepEqual(result2, [], "second run returns no enqueued ids");
  assert.equal(queue2.enqueued.length, 0, "no new rows inserted");
  assert.equal(feed2.events.length, 0, "no events emitted");
});

test("EnqueueReadyTasks execute skips tasks of paused initiatives", async () => {
  const T_PAUSED_TASK = "01JZZZZZZZZZZZZZZZZZZTSK50";
  const initSrc = makeInitSrc([
    { id: INI_ACTIVE, paused: false },
    { id: INI_PAUSED, paused: true },
  ]);
  const taskSrc: TaskSource = {
    listByInitiative(id: string): Task[] {
      if (id === INI_ACTIVE) {
        return [
          {
            id: T_LEFT,
            objectiveId: OBJ_ID,
            title: "left",
            status: "pending",
            dependencies: [],
          },
        ];
      }
      if (id === INI_PAUSED) {
        return [
          {
            id: T_PAUSED_TASK,
            objectiveId: OBJ_ID,
            title: "paused-task",
            status: "pending",
            dependencies: [],
          },
        ];
      }
      return [];
    },
  };
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow);
  const result = await uc.execute();

  assert.deepEqual(
    result,
    [T_LEFT],
    "only the active initiative's task enqueued",
  );
  assert.ok(
    !queue.enqueued.includes(T_PAUSED_TASK),
    "paused initiative task never enqueued",
  );
  assert.equal(
    feed.events.length,
    1,
    "only one task.ready event (active initiative)",
  );
});

test("EnqueueReadyTasks execute does not enqueue non-pending tasks", async () => {
  const initSrc = makeInitSrc([{ id: INI_ACTIVE, paused: false }]);
  const tasks: Task[] = [
    {
      id: "t-running",
      objectiveId: OBJ_ID,
      title: "r",
      status: "running",
      dependencies: [],
    },
    {
      id: "t-completed",
      objectiveId: OBJ_ID,
      title: "c",
      status: "completed",
      dependencies: [],
    },
    {
      id: "t-failed",
      objectiveId: OBJ_ID,
      title: "f",
      status: "failed",
      dependencies: [],
    },
  ];
  const taskSrc = makeTaskSrc(tasks);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow);
  const result = await uc.execute();

  assert.deepEqual(result, [], "no non-pending tasks enqueued");
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("EnqueueReadyTasks execute runs inside exactly one transaction", async () => {
  const initSrc = makeInitSrc([{ id: INI_ACTIVE, paused: false }]);
  const taskSrc = makeTaskSrc(DIAMOND_TASKS);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow);
  await uc.execute();

  assert.equal(
    uow.txCount,
    1,
    "all enqueues + events happen inside one transaction call",
  );
});

// ---------------------------------------------------------------------------
// Story 3 — Readiness gate: initiative-level sequencing
// ---------------------------------------------------------------------------

const T0 = "01JZZZZZZZZZZZZZZZZZZZTSK0";

test("(1) initiative B after: [A] with A building → B's ready task not enqueued, no task.ready for B's task", async () => {
  // A — pending and ready (no deps); B after: [A], also pending and ready.
  const initStatuses: InitStatusMap = new Map([[INI_A, "building"]]);
  const initSrc = makeInitSrc(
    [
      { id: INI_A, paused: false },
      { id: INI_B, paused: false },
    ],
    initStatuses,
  );
  const taskSrc = makeTaskSrcMap(
    new Map([
      [
        INI_A,
        [
          {
            id: T_A,
            objectiveId: OBJ_A,
            title: "a",
            status: "pending",
            dependencies: [],
          },
        ],
      ],
      [
        INI_B,
        [
          {
            id: T_B,
            objectiveId: OBJ_B,
            title: "b",
            status: "pending",
            dependencies: [],
          },
          {
            id: T0,
            objectiveId: OBJ_B,
            title: "b-other",
            status: "pending",
            dependencies: [],
          },
        ],
      ],
    ]),
  );
  const seq = makeSequencingSource(new Map([[INI_B, [INI_A]]]), new Map());
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow, seq);
  const result = await uc.execute();

  // A's task is enqueued (no edge on A)
  assert.ok(queue.enqueued.includes(T_A), "A's ready task must be enqueued");
  // B's tasks must NOT be enqueued
  assert.ok(
    !queue.enqueued.includes(T_B),
    "B's ready task must NOT be enqueued while A is building",
  );
  assert.ok(
    !queue.enqueued.includes(T0),
    "no B task must be enqueued while A is building",
  );
  // No task.ready event for B's tasks
  const bReady = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_B,
  );
  assert.equal(bReady.length, 0, "no task.ready event for B's task");
});

test("(2) initiative B after: [A] with A landed → B's ready task is enqueued with task.ready event", async () => {
  const initStatuses: InitStatusMap = new Map([[INI_A, "landed"]]);
  const initSrc = makeInitSrc(
    [
      { id: INI_A, paused: false },
      { id: INI_B, paused: false },
    ],
    initStatuses,
  );
  const taskSrc = makeTaskSrcMap(
    new Map([
      [
        INI_A,
        [
          {
            id: T_A,
            objectiveId: OBJ_A,
            title: "a",
            status: "pending",
            dependencies: [],
          },
        ],
      ],
      [
        INI_B,
        [
          {
            id: T_B,
            objectiveId: OBJ_B,
            title: "b",
            status: "pending",
            dependencies: [],
          },
        ],
      ],
    ]),
  );
  const seq = makeSequencingSource(new Map([[INI_B, [INI_A]]]), new Map());
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow, seq);
  const result = await uc.execute();

  assert.ok(
    queue.enqueued.includes(T_B),
    "B's ready task must be enqueued when A is landed",
  );
  const bReady = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_B,
  );
  assert.equal(bReady.length, 1, "one task.ready event for B's task");
});

test("(3) initiative B after: [A] with A discarded → B's task not enqueued, no event, task stays pending (no cascade)", async () => {
  const initStatuses: InitStatusMap = new Map([[INI_A, "discarded"]]);
  const initSrc = makeInitSrc(
    [
      { id: INI_A, paused: false },
      { id: INI_B, paused: false },
    ],
    initStatuses,
  );
  const taskSrc = makeTaskSrcMap(
    new Map([
      [
        INI_A,
        [
          {
            id: T_A,
            objectiveId: OBJ_A,
            title: "a",
            status: "completed",
            dependencies: [],
          },
        ],
      ],
      [
        INI_B,
        [
          {
            id: T_B,
            objectiveId: OBJ_B,
            title: "b",
            status: "pending",
            dependencies: [],
          },
        ],
      ],
    ]),
  );
  const seq = makeSequencingSource(new Map([[INI_B, [INI_A]]]), new Map());
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow, seq);
  const result = await uc.execute();

  assert.ok(
    !queue.enqueued.includes(T_B),
    "B's task must NOT be enqueued when A is discarded",
  );
  const bReady = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_B,
  );
  assert.equal(
    bReady.length,
    0,
    "no task.ready event for B's discarded-blocked task",
  );
});

// ---------------------------------------------------------------------------
// Objective-level sequencing
// ---------------------------------------------------------------------------

const OBJ_B2 = "01JZZZZZZZZZZZZZZZZZZZOB22";
const T_O1 = "01JZZZZZZZZZZZZZZZZZZZTSO1";
const T_O2 = "01JZZZZZZZZZZZZZZZZZZZTSO2";

test("(4) objective O2 has after: [O1], O1 is awaiting_confirmation → O2's ready task not enqueued but O1's task is", async () => {
  // O1 has a pending ready task, O2 has a pending ready task.
  // O1 is awaiting_confirmation → O2 blocked.
  const objStatuses: ObjStatusMap = new Map([
    [OBJ_A, "awaiting_confirmation"],
    [OBJ_B2, "building"],
  ]);
  const initSrc = makeInitSrc(
    [{ id: INI_ACTIVE, paused: false }],
    undefined,
    objStatuses,
  );
  const taskSrc = makeTaskSrc([
    {
      id: T_O1,
      objectiveId: OBJ_A,
      title: "o1",
      status: "pending",
      dependencies: [],
    },
    {
      id: T_O2,
      objectiveId: OBJ_B2,
      title: "o2",
      status: "pending",
      dependencies: [],
    },
  ]);
  const seq = makeSequencingSource(new Map(), new Map([[OBJ_B2, [OBJ_A]]]));
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow, seq);
  const result = await uc.execute();

  // O1's task must be enqueued
  assert.ok(queue.enqueued.includes(T_O1), "O1's ready task must be enqueued");
  // O2's task must NOT be enqueued
  assert.ok(
    !queue.enqueued.includes(T_O2),
    "O2's ready task must NOT be enqueued while O1 is awaiting_confirmation",
  );
  const o2Ready = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_O2,
  );
  assert.equal(o2Ready.length, 0, "no task.ready event for O2's task");
});

test("(5) objective O2 has after: [O1], O1 is integrated → O2's ready task is enqueued", async () => {
  const objStatuses: ObjStatusMap = new Map([
    [OBJ_A, "integrated"],
    [OBJ_B2, "building"],
  ]);
  const initSrc = makeInitSrc(
    [{ id: INI_ACTIVE, paused: false }],
    undefined,
    objStatuses,
  );
  const taskSrc = makeTaskSrc([
    {
      id: T_O1,
      objectiveId: OBJ_A,
      title: "o1",
      status: "completed",
      dependencies: [],
    },
    {
      id: T_O2,
      objectiveId: OBJ_B2,
      title: "o2",
      status: "pending",
      dependencies: [],
    },
  ]);
  const seq = makeSequencingSource(new Map(), new Map([[OBJ_B2, [OBJ_A]]]));
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow, seq);
  const result = await uc.execute();

  assert.ok(
    queue.enqueued.includes(T_O2),
    "O2's ready task must be enqueued when O1 is integrated",
  );
  const o2Ready = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_O2,
  );
  assert.equal(o2Ready.length, 1, "one task.ready event for O2's task");
});

test("(6) paused initiative skipped before edge lookup — sequencing.listInitiativeAfter never called", async () => {
  const calls: string[] = [];
  const recordingSeq: SequencingSource = {
    listInitiativeAfter(id: string): string[] {
      calls.push(id);
      return [];
    },
    listObjectiveAfter(_id: string): string[] {
      return [];
    },
  };
  const initSrc = makeInitSrc([{ id: INI_PAUSED, paused: true }]);
  const taskSrc = makeTaskSrc([
    {
      id: T_A,
      objectiveId: OBJ_A,
      title: "a",
      status: "pending",
      dependencies: [],
    },
  ]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(
    initSrc,
    taskSrc,
    queue,
    feed,
    uow,
    recordingSeq,
  );
  const result = await uc.execute();

  assert.deepEqual(
    calls,
    [],
    "listInitiativeAfter must not be called for a paused initiative",
  );
  assert.deepEqual(result, [], "no tasks enqueued for paused initiative");
});

test("(7) transaction count is 1 for every sequencing-gated case", async () => {
  // Both initiatives have sequencing edges that gate B's task — the gate
  // must NOT add a second transaction.
  const initStatuses: InitStatusMap = new Map([[INI_A, "building"]]);
  const initSrc = makeInitSrc(
    [
      { id: INI_A, paused: false },
      { id: INI_B, paused: false },
    ],
    initStatuses,
  );
  const taskSrc = makeTaskSrc([
    {
      id: T_A,
      objectiveId: OBJ_A,
      title: "a",
      status: "pending",
      dependencies: [],
    },
    {
      id: T_B,
      objectiveId: OBJ_B,
      title: "b",
      status: "pending",
      dependencies: [],
    },
  ]);
  const seq = makeSequencingSource(new Map([[INI_B, [INI_A]]]), new Map());
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const uc = new EnqueueReadyTasks(initSrc, taskSrc, queue, feed, uow, seq);
  await uc.execute();

  assert.equal(
    uow.txCount,
    1,
    "sequencing gate must not add an extra transaction",
  );
});

test("(8) determinism: two initiatives with 2 ready tasks each and no edges returns ids in listAllInitiatives order, stable across runs", async () => {
  const initSrc = makeInitSrc([
    { id: INI_A, paused: false },
    { id: INI_B, paused: false },
  ]);
  const T1 = "01JZZZZZZZZZZZZZZZZZZZTSD1";
  const T2 = "01JZZZZZZZZZZZZZZZZZZZTSD2";
  const T3 = "01JZZZZZZZZZZZZZZZZZZZTSD3";
  const T4 = "01JZZZZZZZZZZZZZZZZZZZTSD4";
  const taskSrc = makeTaskSrc([
    {
      id: T1,
      objectiveId: OBJ_A,
      title: "t1",
      status: "pending",
      dependencies: [],
    },
    {
      id: T2,
      objectiveId: OBJ_A,
      title: "t2",
      status: "pending",
      dependencies: [],
    },
    {
      id: T3,
      objectiveId: OBJ_A,
      title: "t3",
      status: "pending",
      dependencies: [],
    },
    {
      id: T4,
      objectiveId: OBJ_A,
      title: "t4",
      status: "pending",
      dependencies: [],
    },
  ]);
  // initiative A listByInitiative returns T1, T2 (ready); B returns T3, T4 (ready)
  // Deterministic: first run
  const seq1 = makeSequencingSource(new Map(), new Map());
  const q1 = new RecordingJobQueue();
  const f1 = new RecordingEventFeed();
  const u1 = new RecordingUnitOfWork();
  const uc1 = new EnqueueReadyTasks(initSrc, taskSrc, q1, f1, u1, seq1);
  const r1 = await uc1.execute();

  // A's tasks first (INI_A comes before INI_B), then B's tasks in task order
  const expectedOrder = [T1, T2, T3, T4];
  assert.deepEqual(
    r1,
    expectedOrder,
    "first run must return tasks in listAllInitiatives order",
  );

  // Second run over same seed must produce same order
  const q2 = new RecordingJobQueue();
  const f2 = new RecordingEventFeed();
  const u2 = new RecordingUnitOfWork();
  const uc2 = new EnqueueReadyTasks(initSrc, taskSrc, q2, f2, u2, seq1);
  const r2 = await uc2.execute();
  assert.deepEqual(
    r2,
    expectedOrder,
    "second run must produce identical order",
  );
});
