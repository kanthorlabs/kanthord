import { test } from "node:test";
import assert from "node:assert/strict";
import { EnqueueReadyTasks } from "./enqueue-ready-tasks.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";

// --- Minimal structural fakes (EnqueueReadyTasks depends on the narrow shape) ---

interface InitiativeSource {
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
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

function makeInitSrc(
  list: Array<{ id: string; paused: boolean }>,
): InitiativeSource {
  return {
    listAllInitiatives() {
      return list;
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
