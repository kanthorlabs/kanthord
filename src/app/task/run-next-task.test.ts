import { test } from "node:test";
import assert from "node:assert/strict";
import { RunNextTask } from "./run-next-task.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type {
  UnitOfWork,
  TaskResultRow,
  LandingRepository,
} from "../../storage/port.ts";
import type {
  ChangeCandidate,
  CandidateState,
  Integration,
} from "../../domain/landing.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  TaskContextBinding,
  TaskResult,
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
  getRepositoryBranch(repoId: string): string | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class SimpleTaskStore implements TaskStore {
  readonly saved: Task[] = [];
  readonly taskResults: TaskResultRow[] = [];
  readonly #tasks: Map<string, Task>;
  readonly #initiativeId: string;
  readonly #contexts: Map<string, Record<string, string>>;
  #repoBranch: string;

  constructor(
    tasks: Task[],
    initiativeId: string,
    contexts: Map<string, Record<string, string>> = new Map(),
    repoBranch = "main",
  ) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#initiativeId = initiativeId;
    this.#contexts = contexts;
    this.#repoBranch = repoBranch;
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

  getRepositoryBranch(_repoId: string): string | undefined {
    return this.#repoBranch;
  }

  saveTaskResult(_taskId: string, row: TaskResultRow): void {
    this.taskResults.push(row);
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

// ---------------------------------------------------------------------------
// Story 04 T1 — atomic candidate persistence in RunNextTask (F3)
// ---------------------------------------------------------------------------

class FakeLandingRepository implements LandingRepository {
  readonly saved: ChangeCandidate[] = [];

  saveCandidate(candidate: ChangeCandidate): void {
    this.saved.push(candidate);
  }

  getCandidate(id: string): ChangeCandidate | undefined {
    return this.saved.find((c) => c.id === id);
  }

  updateCandidateState(_id: string, _state: CandidateState): void {}

  saveIntegration(_integration: Integration): void {}

  getIntegration(_candidateId: string): Integration | undefined {
    return undefined;
  }
}

/** A runner that always returns a changed-work `candidate` result. */
function candidateRunner(
  opts: {
    baseCommit?: string;
    candidateCommit?: string;
  } = {},
): AgentRunner {
  return {
    async run(task: Task, _context: TaskContextBinding[]): Promise<TaskResult> {
      return {
        outcome: "candidate",
        workspace: "/w/run",
        branch: `kanthord/${task.id}`,
        baseCommit: opts.baseCommit ?? "BASE_SHA",
        candidateCommit: opts.candidateCommit ?? "CAND_SHA",
        summary: "changed work ready to land",
      };
    },
  };
}

test("RunNextTask repository-bound candidate persists a unique pending candidate and holds the task at awaiting_confirmation (Story 04 T1 a)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const contexts = new Map([[TASK_SIMPLE.id, { repository: "res-1" }]]);
  const store = new SimpleTaskStore(
    [{ ...TASK_SIMPLE }],
    INI_ID,
    contexts,
    "release",
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const landing = new FakeLandingRepository();
  const resolver: AgentRunnerResolver = { for: () => candidateRunner() };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, landing);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "candidate", taskId: TASK_SIMPLE.id });

  // task held at awaiting_confirmation (changed work awaits a human gate)
  const lastSaved = store.saved[store.saved.length - 1]!;
  assert.equal(
    lastSaved.status,
    "awaiting_confirmation",
    "changed repo-bound task must await confirmation",
  );

  // exactly one candidate row persisted, with the right shape
  assert.equal(landing.saved.length, 1, "exactly one candidate row saved");
  const cand = landing.saved[0]!;
  assert.equal(cand.taskId, TASK_SIMPLE.id);
  assert.equal(cand.baseSHA, "BASE_SHA");
  assert.equal(cand.candidateSHA, "CAND_SHA");
  assert.equal(cand.ref, `kanthord/${TASK_SIMPLE.id}`);
  assert.equal(
    cand.target,
    "release",
    "target must be the repository's configured branch, not hardcoded 'main'",
  );
  assert.equal(cand.state, "pending");

  // candidate id identifies THIS execution attempt: a fresh ULID, not the legacy form
  assert.equal(cand.id.length, 26, "candidate id must be a 26-char ULID");
  assert.notEqual(
    cand.id,
    `${TASK_SIMPLE.id}-lc`,
    "candidate id must not be the legacy '${taskId}-lc' form",
  );

  // task_results row carries non-null base/proposal commits
  const row = store.taskResults[store.taskResults.length - 1]!;
  assert.equal(row.baseCommit, "BASE_SHA");
  assert.equal(row.proposalCommit, "CAND_SHA");
});

test("RunNextTask filesystem-bound candidate completes directly with no candidate row (Story 04 T1 b)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  // NO repository binding → filesystem-bound; there is nothing to land.
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const landing = new FakeLandingRepository();
  const resolver: AgentRunnerResolver = { for: () => candidateRunner() };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, landing);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  const lastSaved = store.saved[store.saved.length - 1]!;
  assert.equal(
    lastSaved.status,
    "completed",
    "filesystem-bound changed task completes directly",
  );
  assert.equal(queue.finished[0]!.outcome, "completed");
  assert.equal(
    landing.saved.length,
    0,
    "no candidate row for a filesystem-bound task",
  );
});

test("RunNextTask candidate persistence is atomic: a crash commits neither the transition nor the candidate (Story 04 T1 c)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const contexts = new Map([[TASK_SIMPLE.id, { repository: "res-1" }]]);
  const store = new SimpleTaskStore(
    [{ ...TASK_SIMPLE }],
    INI_ID,
    contexts,
    "release",
  );
  const feed = new RecordingEventFeed();
  // Crash only on the SECOND transaction (tx2 — the outcome persist), so tx1
  // completes and the candidate branch actually runs before the simulated crash.
  let txCalls = 0;
  const crashOnSecondTx: UnitOfWork = {
    transaction<T>(fn: () => T): T {
      txCalls += 1;
      const r = fn();
      if (txCalls >= 2) throw new Error("simulated crash at commit");
      return r;
    },
  };
  const landing = new FakeLandingRepository();
  const resolver: AgentRunnerResolver = { for: () => candidateRunner() };

  const uc = new RunNextTask(
    queue,
    store,
    feed,
    crashOnSecondTx,
    resolver,
    landing,
  );
  await assert.rejects(() => uc.execute(), /simulated crash/);

  const awaitingWithoutCandidate =
    store.saved.some((t) => t.status === "awaiting_confirmation") &&
    landing.saved.length === 0;
  assert.equal(
    awaitingWithoutCandidate,
    false,
    "a crash must not leave a candidate-less awaiting_confirmation (atomicity)",
  );
});

test("RunNextTask verified no-change still completes directly (Story 04 T1 d regression)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const landing = new FakeLandingRepository();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, landing);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.equal(store.saved[store.saved.length - 1]!.status, "completed");
  assert.equal(landing.saved.length, 0, "no candidate for a no-change run");
});

// ---------------------------------------------------------------------------
// HUMAN_REVIEW BLOCKER B1 (regression) — the filesystem-bound changed-task
// completion path (run-next-task.ts:211-239) transitions the task to
// completed, finishes the queue, and re-scans dependents, but OMITTED the
// `task.completed` event (contrary to the repo-bound completed path :145).
// A client polling `list event` never sees these tasks complete.
// ---------------------------------------------------------------------------

test("RunNextTask filesystem-bound changed task emits a task.completed event (B1 regression)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  // NO repository binding → filesystem-bound; there is nothing to land, so the
  // changed run completes directly (Story 04 T1 b behavior).
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const landing = new FakeLandingRepository();
  const resolver: AgentRunnerResolver = { for: () => candidateRunner() };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, landing);
  const result = await uc.execute();

  // The task transitions to completed (existing T1 b behavior)…
  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.equal(
    store.saved[store.saved.length - 1]!.status,
    "completed",
    "filesystem-bound changed task completes directly",
  );

  // …and a client polling `list event` MUST observe it complete: a
  // `task.completed` event must be emitted for this task.
  const completedEvts = feed.events.filter((e) => e.type === "task.completed");
  assert.ok(
    completedEvts.length >= 1,
    "a task.completed event must be emitted for the filesystem-bound changed task (B1)",
  );
  assert.ok(
    completedEvts.some((e) => e.taskId === TASK_SIMPLE.id),
    "the task.completed event must reference this task",
  );
});

// ---------------------------------------------------------------------------
// 007.9 Story 02 — provider transient-retry at the execution loop
// ---------------------------------------------------------------------------

/** Records every ms it is asked to wait; resolves immediately (no real delay). */
function makeSleepRT(log: number[]): (ms: number) => Promise<void> {
  return async (ms: number) => {
    log.push(ms);
  };
}

test("RunNextTask retries a transient failure with bounded attempts: 2 transient failures then completed → completed, exactly 2 provider.retry events, runner.run called 3x (007.9 S2 a)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({ failTransient: { [TASK_SIMPLE.id]: 2 } });
  const resolver: AgentRunnerResolver = { for: () => runner };
  const sleepLog: number[] = [];

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    maxAttempts: 3,
    sleep: makeSleepRT(sleepLog),
  });
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.equal(
    runner.calls.length,
    3,
    "runner.run must be called exactly 3 times (2 failed attempts + 1 success)",
  );
  const retryEvents = feed.events.filter((e) => e.type === "provider.retry");
  assert.equal(
    retryEvents.length,
    2,
    "exactly 2 provider.retry events for the 2 transient failures",
  );
});

test("RunNextTask exhausts retries: transient failures beyond the cap end failed with the LAST reason and no more than the cap of run() calls (007.9 S2 b)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  let calls = 0;
  const alwaysTransientRunner: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
    ): Promise<TaskResult> {
      calls += 1;
      return {
        outcome: "failed",
        reason: `transient error attempt ${calls}`,
        transient: true,
      };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => alwaysTransientRunner };
  const sleepLog: number[] = [];

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    maxAttempts: 2,
    sleep: makeSleepRT(sleepLog),
  });
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "failed", taskId: TASK_SIMPLE.id });
  assert.equal(
    calls,
    2,
    "runner.run must never be called more than the max-attempts cap",
  );

  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted");
  assert.equal(
    failedEvt!.payload?.reason,
    "transient error attempt 2",
    "failReason must be the LAST attempt's reason, not the first",
  );
  assert.equal(
    failedEvt!.payload?.attempts,
    "2",
    "the failed payload must record the total attempt count",
  );

  const retryEvents = feed.events.filter((e) => e.type === "provider.retry");
  assert.equal(
    retryEvents.length,
    1,
    "provider.retry fires once — before the 2nd (final, exhausting) attempt",
  );
});

test("RunNextTask does not retry a non-transient failure: failed on first attempt with zero provider.retry events (007.9 S2 c, regression guard)", async () => {
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

  // maxAttempts is generous (5) to prove the single call is because the
  // failure is non-transient, not because the budget happens to be 1.
  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    maxAttempts: 5,
    sleep: makeSleepRT([]),
  });
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "failed", taskId: TASK_PARENT.id });
  assert.equal(
    runner.calls.length,
    1,
    "a non-transient failure must not be retried — exactly one run() call",
  );
  const retryEvents = feed.events.filter((e) => e.type === "provider.retry");
  assert.equal(
    retryEvents.length,
    0,
    "zero provider.retry events for a non-transient failure",
  );
});

test("RunNextTask honors retryAfterMs from the failed result as a floor for the backoff wait (007.9 S2 d)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  let calls = 0;
  const rateLimitedRunner: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
    ): Promise<TaskResult> {
      calls += 1;
      if (calls === 1) {
        return {
          outcome: "failed",
          reason: "rate limited",
          transient: true,
          retryAfterMs: 5_000,
        };
      }
      return { outcome: "completed", summary: "ok" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => rateLimitedRunner };
  const sleepLog: number[] = [];

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    maxAttempts: 3,
    sleep: makeSleepRT(sleepLog),
  });
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.equal(
    sleepLog.length,
    1,
    "backoff waits exactly once (before the 2nd attempt)",
  );
  assert.ok(
    sleepLog[0]! >= 5_000,
    `backoff must wait at least the server's retryAfterMs (5000); waited ${sleepLog[0]}`,
  );
});
