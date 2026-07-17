import { test } from "node:test";
import assert from "node:assert/strict";
import { RunNextTask } from "./run-next-task.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  TaskContextBinding,
} from "../../agent-runner/port.ts";
import { RunnerNotResolvableError } from "../../agent-runner/port.ts";
import { FakeRunner } from "../../agent-runner/fake.ts";

// ---------------------------------------------------------------------------
// Narrow structural interface the test wires to RunNextTask (duck-typed)
// ---------------------------------------------------------------------------

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
  getTaskContext(taskId: string): Record<string, string>;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class SimpleTaskStore implements TaskStore {
  readonly saved: Task[] = [];
  readonly #tasks: Map<string, Task>;
  readonly #initiativeId: string;
  readonly #contexts: Map<string, Record<string, string>>;

  constructor(
    tasks: Task[],
    initiativeId: string,
    contexts: Map<string, Record<string, string>> = new Map(),
  ) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#initiativeId = initiativeId;
    this.#contexts = contexts;
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  save(task: Task): void {
    this.#tasks.set(task.id, task);
    this.saved.push(task);
  }

  listByInitiative(_id: string): Task[] {
    return [...this.#tasks.values()];
  }

  getInitiativeId(taskId: string): string | undefined {
    return this.#tasks.has(taskId) ? this.#initiativeId : undefined;
  }

  getTaskContext(taskId: string): Record<string, string> {
    return this.#contexts.get(taskId) ?? {};
  }
}

class RecordingJobQueue implements JobQueue {
  readonly finished: Array<{
    jobId: string;
    outcome: "completed" | "failed";
  }> = [];
  readonly discarded: string[] = [];
  readonly enqueued: string[] = [];
  readonly #preEnqueued: Set<string>;
  #nextClaim: ClaimedJob | undefined;

  constructor(nextClaim: ClaimedJob | undefined, preEnqueued: string[] = []) {
    this.#nextClaim = nextClaim;
    this.#preEnqueued = new Set(preEnqueued);
  }

  claim(): ClaimedJob | undefined {
    const c = this.#nextClaim;
    this.#nextClaim = undefined;
    return c;
  }

  finish(jobId: string, outcome: "completed" | "failed"): void {
    this.finished.push({ jobId, outcome });
  }

  discard(jobId: string): void {
    this.discarded.push(jobId);
  }

  enqueue(taskId: string): boolean {
    if (this.#preEnqueued.has(taskId)) return false;
    this.enqueued.push(taskId);
    this.#preEnqueued.add(taskId);
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INI_ID = "01JZZZZZZZZZZZZZZZZZZZINI1";
const JOB_ID = "01JZZZZZZZZZZZZZZZZZZZJOB1";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";

/** A simple task with no dependencies — always ready when pending. */
const TASK_SIMPLE: Task = {
  id: "01JZZZZZZZZZZZZZZZZZZZTSK1",
  objectiveId: OBJ_ID,
  title: "simple task",
  status: "pending",
  dependencies: [],
};

/** Parent: pending, no deps (ready on its own). */
const T_PARENT_ID = "01JZZZZZZZZZZZZZZZZZZZTSK2";
/** Child: pending, depends on parent (blocked until parent completes). */
const T_CHILD_ID = "01JZZZZZZZZZZZZZZZZZZZTSK3";

const TASK_PARENT: Task = {
  id: T_PARENT_ID,
  objectiveId: OBJ_ID,
  title: "parent",
  status: "pending",
  dependencies: [],
};

const TASK_CHILD: Task = {
  id: T_CHILD_ID,
  objectiveId: OBJ_ID,
  title: "child",
  status: "pending",
  dependencies: [T_PARENT_ID],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("RunNextTask execute returns idle when queue is empty", async () => {
  const queue = new RecordingJobQueue(undefined);
  const store = new SimpleTaskStore([], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver: AgentRunnerResolver = { for: () => new FakeRunner({}) };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "idle" });
  assert.equal(feed.events.length, 0, "no events on idle");
  assert.equal(queue.finished.length, 0, "no job finished on idle");
});

test("RunNextTask execute happy path returns completed and emits started then completed events", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });

  // task saved as completed
  assert.ok(store.saved.length >= 1, "task saved at least once");
  assert.equal(
    store.saved[store.saved.length - 1]!.status,
    "completed",
    "last saved status is completed",
  );

  // job finished as completed
  assert.equal(queue.finished.length, 1);
  assert.deepEqual(queue.finished[0], { jobId: JOB_ID, outcome: "completed" });

  // events: task.started then task.completed (in that order)
  const types = feed.events.map((e) => e.type);
  assert.ok(types.includes("task.started"), "task.started emitted");
  assert.ok(types.includes("task.completed"), "task.completed emitted");
  assert.ok(
    types.indexOf("task.started") < types.indexOf("task.completed"),
    "task.started precedes task.completed",
  );
});

test("RunNextTask execute happy path forwards task context bindings to runner", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  // context: { repository: 'res-1' } → binding { type: 'repository', resourceId: 'res-1' }
  const contexts = new Map([[TASK_SIMPLE.id, { repository: "res-1" }]]);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID, contexts);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await uc.execute();

  assert.equal(runner.calls.length, 1, "runner called exactly once");
  const call = runner.calls[0]!;
  assert.equal(call.taskId, TASK_SIMPLE.id);
  assert.ok(
    call.context.some(
      (b) => b.type === "repository" && b.resourceId === "res-1",
    ),
    `context binding { type:'repository', resourceId:'res-1' } must be forwarded; got: ${JSON.stringify(call.context)}`,
  );
});

test("RunNextTask execute completing a task enqueues newly-ready dependents and emits task.ready", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: T_PARENT_ID };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.equal(result.outcome, "completed");

  // child enqueued because parent is now complete
  assert.ok(
    queue.enqueued.includes(T_CHILD_ID),
    `newly-ready child must be enqueued; enqueued: ${JSON.stringify(queue.enqueued)}`,
  );

  // task.ready event emitted for child
  const readyEvents = feed.events.filter((e) => e.type === "task.ready");
  assert.ok(
    readyEvents.some((e) => e.taskId === T_CHILD_ID),
    "task.ready event emitted for the newly-unblocked child",
  );
});

test("RunNextTask execute scripted failure records failed outcome with reason payload and does not enqueue dependents", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_PARENT.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({ failTaskIds: [TASK_PARENT.id] });
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "failed", taskId: TASK_PARENT.id });

  // task saved as failed
  const lastSaved = store.saved[store.saved.length - 1]!;
  assert.equal(lastSaved.status, "failed", "task must be saved as failed");

  // job finished as failed
  assert.deepEqual(queue.finished[0], { jobId: JOB_ID, outcome: "failed" });

  // task.failed event with reason payload
  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted");
  assert.equal(
    failedEvt!.payload?.reason,
    "scripted failure",
    "task.failed payload.reason must equal 'scripted failure'",
  );

  // dependents NOT enqueued on failure
  assert.equal(
    queue.enqueued.length,
    0,
    "no dependents must be enqueued when a task fails",
  );
});

test("RunNextTask execute skips stale job when claimed task has unsatisfied dependencies", async () => {
  // T_CHILD depends on T_PARENT which is still pending → child is blocked
  const claimed: ClaimedJob = { id: JOB_ID, taskId: T_CHILD_ID };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "skipped", taskId: T_CHILD_ID });

  // stale job must be discarded
  assert.ok(queue.discarded.includes(JOB_ID), "stale job must be discarded");

  // task remains unchanged (not saved)
  const savedForChild = store.saved.filter((t) => t.id === T_CHILD_ID);
  assert.equal(
    savedForChild.length,
    0,
    "task must not be saved on skip (still pending)",
  );

  // no events emitted
  assert.equal(feed.events.length, 0, "no events on skip");

  // runner never called
  assert.equal(runner.calls.length, 0, "runner must not be called on skip");
});

test("RunNextTask execute ai_provider binding records failed without propagating the error", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const contexts = new Map([[TASK_SIMPLE.id, { ai_provider: "ai-res-1" }]]);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID, contexts);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const resolver: AgentRunnerResolver = {
    for(task: Task, context: TaskContextBinding[]): AgentRunner {
      const ai = context.find((b) => b.type === "ai_provider");
      if (ai !== undefined)
        throw new RunnerNotResolvableError(task.id, ai.resourceId);
      return new FakeRunner({});
    },
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  // must not reject — daemon survives resolver errors
  const result = await uc.execute();

  assert.equal(result.outcome, "failed");
  assert.equal((result as { taskId: string }).taskId, TASK_SIMPLE.id);

  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted");
  assert.ok(
    (failedEvt!.payload?.reason ?? "").includes("RunnerNotResolvableError"),
    `reason must include 'RunnerNotResolvableError'; got: ${failedEvt!.payload?.reason}`,
  );

  // job finished as failed
  assert.deepEqual(queue.finished[0], { jobId: JOB_ID, outcome: "failed" });
});

test("RunNextTask execute rejected runner promise records failed without propagating", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  class BoomError extends Error {
    constructor() {
      super("network gone");
      this.name = "BoomError";
    }
  }

  const throwingRunner: AgentRunner = {
    async run(_task: Task, _context: TaskContextBinding[]): Promise<never> {
      throw new BoomError();
    },
  };
  const resolver: AgentRunnerResolver = { for: () => throwingRunner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  // must not reject — daemon survives runner throws
  const result = await uc.execute();

  assert.equal(result.outcome, "failed");

  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted");
  assert.ok(
    (failedEvt!.payload?.reason ?? "").includes("BoomError"),
    `reason must include 'BoomError'; got: ${failedEvt!.payload?.reason}`,
  );
  assert.ok(
    (failedEvt!.payload?.reason ?? "").includes("network gone"),
    `reason must include 'network gone'; got: ${failedEvt!.payload?.reason}`,
  );

  // job finished as failed
  assert.deepEqual(queue.finished[0], { jobId: JOB_ID, outcome: "failed" });
});

test("RunNextTask execute uses two transactions with runner executing between them", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();

  const log: string[] = [];

  const orderUow: UnitOfWork = {
    transaction<T>(fn: () => T): T {
      log.push("tx-start");
      const r = fn();
      log.push("tx-end");
      return r;
    },
  };

  const orderRunner: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
    ): Promise<{ outcome: "completed" }> {
      log.push("runner");
      return { outcome: "completed" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => orderRunner };

  const uc = new RunNextTask(queue, store, feed, orderUow, resolver);
  await uc.execute();

  const tx1End = log.indexOf("tx-end");
  const runnerIdx = log.indexOf("runner");
  const tx2Start = log.lastIndexOf("tx-start");
  const txStartCount = log.filter((e) => e === "tx-start").length;

  assert.ok(tx1End !== -1, "tx1 must complete");
  assert.ok(runnerIdx !== -1, "runner must be called");
  assert.ok(tx2Start !== -1, "tx2 must start");
  assert.ok(tx1End < runnerIdx, "tx1 must end before runner executes");
  assert.ok(runnerIdx < tx2Start, "runner must execute before tx2 starts");
  assert.equal(txStartCount, 2, "exactly two transaction calls total");
});
