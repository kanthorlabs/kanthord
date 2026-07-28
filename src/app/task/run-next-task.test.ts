import { test } from "node:test";
import assert from "node:assert/strict";
import { RunNextTask } from "./run-next-task.ts";
import type { JobQueue, ClaimedJob, RunningJob } from "../../queue/port.ts";
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
import type { Objective } from "../../domain/initiative.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  ResolvedProvider,
  TaskContextBinding,
  TaskResult,
} from "../../agent-runner/port.ts";
import { RunnerNotResolvableError } from "../../agent-runner/port.ts";
import { FakeRunner } from "../../agent-runner/fake.ts";
import type { GlobalAiProvider } from "../../storage/port.ts";

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
  /** Optional — absent means "no edges" (identical to today's behaviour). */
  listObjectiveAfter?(objectiveId: string): string[];
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class SimpleTaskStore implements TaskStore {
  readonly saved: Task[] = [];
  readonly taskResults: TaskResultRow[] = [];
  readonly savedObjectives: Objective[] = [];
  readonly #tasks: Map<string, Task>;
  readonly #initiativeId: string;
  readonly #contexts: Map<string, Record<string, string>>;
  #repoBranch: string;
  readonly #objectives: Map<string, Objective>;
  readonly #objectiveParentOid: string;

  constructor(
    tasks: Task[],
    initiativeId: string,
    contexts: Map<string, Record<string, string>> = new Map(),
    repoBranch = "main",
    objectives: Objective[] = [],
    objectiveParentOid = "PARENT_OID_1",
  ) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#initiativeId = initiativeId;
    this.#contexts = contexts;
    this.#repoBranch = repoBranch;
    this.#objectives = new Map(objectives.map((o) => [o.id, o]));
    this.#objectiveParentOid = objectiveParentOid;
  }

  // Story B objective-boundary squash: the objective read/write + expected
  // parent-OID lookup `RunNextTask` needs to squash + transition an
  // initiative-clone objective once its last task completes.
  getObjective(id: string): Objective | undefined {
    return this.#objectives.get(id);
  }

  saveObjective(objective: Objective): void {
    this.#objectives.set(objective.id, objective);
    this.savedObjectives.push(objective);
  }

  getObjectiveParentOid(_objectiveId: string): string {
    return this.#objectiveParentOid;
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
  /** EPIC 013 S1 — arguments passed to isLeaseCurrent, in call order. */
  readonly isLeaseCurrentCalls: string[] = [];
  /** EPIC 013 S1 — arguments passed to listRunningJobsForTask, in call order. */
  readonly listRunningJobsForTaskCalls: string[] = [];
  /** EPIC 013 S1 — controlled return for isLeaseCurrent (default true = "current"). */
  leaseCurrentResult = true;
  #nextClaim: ClaimedJob | undefined;
  readonly #preEnqueued: Set<string>;

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

  isLeaseCurrent(leaseToken: string): boolean {
    this.isLeaseCurrentCalls.push(leaseToken);
    return this.leaseCurrentResult;
  }

  listRunningJobsForTask(taskId: string): RunningJob[] {
    this.listRunningJobsForTaskCalls.push(taskId);
    return [];
  }

  // EPIC 013 Story 3 — `revoke` seam. RunNextTask does not call revoke
  // (the AbandonTask use case does); default `not_found` keeps a stray
  // call debuggable.
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

test("RunNextTask execute verification failure persists a task_results row with the reason and a null summary (Story 02)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_PARENT.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const verificationFailingRunner: AgentRunner = {
    calls: [] as Array<{ taskId: string; context: TaskContextBinding[] }>,
    async run(): Promise<TaskResult> {
      return {
        outcome: "failed",
        reason: "VerificationFailedError: npm test (exit 1)",
      };
    },
  } as unknown as AgentRunner;
  const resolver: AgentRunnerResolver = {
    for: () => verificationFailingRunner,
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "failed", taskId: TASK_PARENT.id });

  assert.equal(
    store.taskResults.length,
    1,
    "a task_results row must be persisted on the failure path",
  );
  const row = store.taskResults[0]!;
  assert.ok(
    row.reason?.startsWith("VerificationFailedError"),
    `row.reason must start with 'VerificationFailedError'; got: ${row.reason}`,
  );
  assert.equal(row.summary, null, "row.summary must be null on failure");
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

test("RunNextTask completes an initiative-clone task directly (no per-task approve gate) even though it is repository-bound and its run yields a changed-work candidate — the objective, not the task, is the integration unit (Story B constraint, EPIC 007.12 Proof PASS A/B gap)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  // BOTH a repository binding AND a workspace binding — exactly how a task
  // routed to the Story A initiative clone is bound (repository via the
  // "source" alias, workspace via the clone dir).
  const contexts = new Map([
    [TASK_SIMPLE.id, { repository: "res-1", workspace: "/tmp/init-clone" }],
  ]);
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

  assert.deepEqual(
    result,
    { outcome: "completed", taskId: TASK_SIMPLE.id },
    "an initiative-clone (workspace-bound) task completes directly, not held as a candidate",
  );
  const lastSaved = store.saved[store.saved.length - 1]!;
  assert.equal(
    lastSaved.status,
    "completed",
    "initiative-clone task must complete directly — Story B: integration unit is the objective commit, not the per-task candidate",
  );
  assert.equal(queue.finished[0]!.outcome, "completed");
  assert.equal(
    landing.saved.length,
    0,
    "no per-task candidate row is persisted for an initiative-clone task",
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

test("RunNextTask squashes the objective into one commit and moves it to awaiting_confirmation only once all of its clone-routed tasks are completed (Story B objective boundary)", async () => {
  const cloneDir = "/tmp/kanthord-init-clone";
  const contexts = new Map([
    [T_PARENT_ID, { workspace: cloneDir }],
    [T_CHILD_ID, { workspace: cloneDir }],
  ]);
  const objective: Objective = {
    id: OBJ_ID,
    initiativeId: INI_ID,
    name: "obj-a",
    status: "building",
  };
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
    contexts,
    "main",
    [objective],
    "PARENT_OID_1",
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const squashCalls: Array<{
    dir: string;
    parentOid: string;
    message: string;
  }> = [];
  const workspaces = {
    async squashObjective(dir: string, parentOid: string, message: string) {
      squashCalls.push({ dir, parentOid, message });
      return { oid: "SQUASHED_OID_1" };
    },
  };

  // 1st run: parent (no deps) is claimed and completes. Child becomes ready,
  // but the objective still has an incomplete task — no squash yet.
  const queue1 = new RecordingJobQueue({ id: JOB_ID, taskId: T_PARENT_ID });
  const uc1 = new RunNextTask(queue1, store, feed, uow, resolver, undefined, {
    workspaces,
  });
  await uc1.execute();

  assert.equal(
    squashCalls.length,
    0,
    "squashObjective must not run while the objective still has an incomplete task",
  );
  assert.equal(
    store.savedObjectives.length,
    0,
    "objective must not be transitioned while incomplete",
  );

  // 2nd run: child (now ready) is claimed and completes — the last task of
  // the objective — so it must squash + transition + record the OID.
  const queue2 = new RecordingJobQueue({
    id: "01JZZZZZZZZZZZZZZZZZZZJOB2",
    taskId: T_CHILD_ID,
  });
  const uc2 = new RunNextTask(queue2, store, feed, uow, resolver, undefined, {
    workspaces,
  });
  await uc2.execute();

  assert.equal(
    squashCalls.length,
    1,
    "squashObjective called exactly once, on objective completion",
  );
  assert.equal(squashCalls[0]!.dir, cloneDir, "squash runs in the clone dir");
  assert.equal(
    squashCalls[0]!.parentOid,
    "PARENT_OID_1",
    "squash parent is the recorded expected parent OID",
  );

  const savedObjective = store.savedObjectives.at(-1);
  assert.ok(savedObjective, "objective saved");
  assert.equal(savedObjective!.status, "awaiting_confirmation");
  assert.equal(
    (savedObjective as Objective & { commitOid?: string }).commitOid,
    "SQUASHED_OID_1",
    "recorded objective-commit OID",
  );
  assert.equal(
    (savedObjective as Objective & { parentOid?: string }).parentOid,
    "PARENT_OID_1",
    "recorded expected parent OID",
  );

  assert.ok(
    feed.events.some(
      (e) =>
        e.type === "objective.awaiting_confirmation" &&
        e.objectiveId === OBJ_ID,
    ),
    "objective.awaiting_confirmation event appended, scoped to the objective",
  );
});

test("RunNextTask ensures the claimed task's initiative workspace is provisioned before the task runs (Story A/B wiring gap — daemon must actually provision the initiative branch/clone)", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const ensureCalls: string[] = [];
  const initiativeWorkspaces = {
    async ensure(initiativeId: string): Promise<void> {
      ensureCalls.push(initiativeId);
    },
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    initiativeWorkspaces,
  });
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.deepEqual(
    ensureCalls,
    [INI_ID],
    "initiativeWorkspaces.ensure(initiativeId) must be called exactly once, with the claimed task's initiative id, before the task runs",
  );
});

// ---------------------------------------------------------------------------
// Story 3 — Readiness gate: objective-level sequencing in inline re-scan
// ---------------------------------------------------------------------------

const OBJ_A = "01JZZZZZZZZZZZZZZZZZZZOBJA1";
const OBJ_B = "01JZZZZZZZZZZZZZZZZZZZOBJB1";
const T_O1 = "01JZZZZZZZZZZZZZZZZZZZTSO1";
const T_O2 = "01JZZZZZZZZZZZZZZZZZZZTSO2";

test("(9) completing task unblocks only its own objective — O2 with after: [O1] and O1 building → O2's task not enqueued", async () => {
  // O1 has T_O1 (pending, no deps) and O2 has T_O2 (pending, no deps).
  // O2 has after: [O1]; O1 is building.
  // Claim T_O1 (it is ready), execute → T_O1 completes, re-scan gates O2.
  const claimed: ClaimedJob = { id: JOB_ID, taskId: T_O1 };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [
      {
        id: T_O1,
        objectiveId: OBJ_A,
        title: "o1-task",
        status: "pending",
        dependencies: [],
      },
      {
        id: T_O2,
        objectiveId: OBJ_B,
        title: "o2-task",
        status: "pending",
        dependencies: [],
      },
    ],
    INI_ID,
  );
  // Add listObjectiveAfter support — O2's after set includes O1
  (store as unknown as Record<string, unknown>).listObjectiveAfter = (
    id: string,
  ) => {
    if (id === OBJ_B) return [OBJ_A];
    return [];
  };
  // getObjective for O1 returns building (the gating condition)
  const origGetObj = store.getObjective.bind(store);
  store.getObjective = (id: string) => {
    if (id === OBJ_A)
      return {
        id: OBJ_A,
        initiativeId: INI_ID,
        name: "o1",
        status: "building",
      };
    return origGetObj(id);
  };

  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.equal(result.outcome, "completed", "T_O1 must complete");

  // O2's task must NOT be enqueued
  assert.ok(
    !queue.enqueued.includes(T_O2),
    "O2's task must NOT be enqueued when O1 is building",
  );
  const readyForO2 = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_O2,
  );
  assert.equal(readyForO2.length, 0, "no task.ready event for O2's task");
});

test("(10) completing task — O2 with after: [O1] and O1 integrated → O2's task is enqueued with task.ready", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: T_O1 };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [
      {
        id: T_O1,
        objectiveId: OBJ_A,
        title: "o1-task",
        status: "pending",
        dependencies: [],
      },
      {
        id: T_O2,
        objectiveId: OBJ_B,
        title: "o2-task",
        status: "pending",
        dependencies: [],
      },
    ],
    INI_ID,
  );
  (store as unknown as Record<string, unknown>).listObjectiveAfter = (
    id: string,
  ) => {
    if (id === OBJ_B) return [OBJ_A];
    return [];
  };
  // O1 is integrated (satisfies the edge)
  const origGetObj2 = store.getObjective.bind(store);
  store.getObjective = (id: string) => {
    if (id === OBJ_A)
      return {
        id: OBJ_A,
        initiativeId: INI_ID,
        name: "o1",
        status: "integrated",
      };
    return origGetObj2(id);
  };

  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.equal(result.outcome, "completed", "T_O1 must complete");
  assert.ok(
    queue.enqueued.includes(T_O2),
    "O2's task must be enqueued when O1 is integrated",
  );
  const readyForO2 = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_O2,
  );
  assert.equal(readyForO2.length, 1, "one task.ready event for O2's task");
});

test("(11) regression: existing parent-completes-child-enqueued test passes unchanged without listObjectiveAfter", async () => {
  // Exact copy of the test at line 298-327: parent completes, child enqueued.
  const claimed: ClaimedJob = { id: JOB_ID, taskId: T_PARENT_ID };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
  );
  // Ensure listObjectiveAfter is NOT set (undefined on SimpleTaskStore)
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.equal(result.outcome, "completed");
  assert.ok(
    queue.enqueued.includes(T_CHILD_ID),
    `newly-ready child must be enqueued; enqueued: ${JSON.stringify(queue.enqueued)}`,
  );
  const readyEvents = feed.events.filter((e) => e.type === "task.ready");
  assert.ok(
    readyEvents.some((e) => e.taskId === T_CHILD_ID),
    "task.ready event emitted for the newly-unblocked child",
  );
});

// ---------------------------------------------------------------------------
// Story A — Daemon resolves the chain; runner takes a resolved provider
// Story B — Empty chain fails loudly
// ---------------------------------------------------------------------------

const PROVIDER: GlobalAiProvider = {
  id: "prov-001",
  name: "test-provider",
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  baseUrl: null,
  effort: null,
  value: "sk-test",
  state: "active",
  credentialVersion: 1,
  api: null,
  contextWindow: null,
  maxTokens: null,
};

test("(Story A) RunNextTask passes resolved provider from providerChainFor to runner as 3rd arg", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  let capturedProvider: unknown = undefined;
  const capturingRunner: AgentRunner = {
    async run(...args: unknown[]): Promise<TaskResult> {
      capturedProvider = args[2];
      return { outcome: "completed", summary: "fake" };
    },
  } as unknown as AgentRunner;
  const resolver: AgentRunnerResolver = { for: () => capturingRunner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [PROVIDER],
  } as any);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.deepEqual(
    capturedProvider,
    PROVIDER,
    "runner must receive the resolved provider as 3rd arg",
  );
});

test("(Story A) RunNextTask executes task without ai_provider/credential context when providerChainFor returns a provider", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const contexts = new Map([[TASK_SIMPLE.id, { repository: "res-1" }]]);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID, contexts);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [PROVIDER],
  } as any);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "completed", taskId: TASK_SIMPLE.id });
  assert.equal(runner.calls.length, 1, "runner must be called exactly once");
});

test("(Story B) RunNextTask fails task with typed error when providerChainFor returns empty chain", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };
  const PROJECT_ID = "proj-for-story-b";

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [],
    getProjectId: (_id: string) => PROJECT_ID,
  } as any);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "failed", taskId: TASK_SIMPLE.id });

  // task.failed event with the exact provider-resolution error (BLOCKER 5a: full-string equality with projectId)
  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted");
  assert.equal(
    failedEvt!.payload?.reason,
    `no AI provider available for project ${PROJECT_ID}`,
    "reason must be the exact full string with the resolved project id, not the initiative id",
  );
  assert.equal(
    failedEvt!.payload?.reasonCode,
    "no_provider_available",
    "reasonCode must be 'no_provider_available'",
  );

  // Runner must NOT be called when the chain is empty
  assert.equal(
    runner.calls.length,
    0,
    "runner must not be called when chain is empty",
  );
});

test("(Story B2) RunNextTask fails fake@1 task when providerChainFor returns empty chain (carve-out removed)", async () => {
  const FAKE1_TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSK9";
  const TASK_FAKE1: Task = {
    ...TASK_SIMPLE,
    id: FAKE1_TASK_ID,
    agent: "fake@1",
  };
  const PROJECT_ID = "proj-for-story-b2";

  const claimed: ClaimedJob = { id: JOB_ID, taskId: FAKE1_TASK_ID };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_FAKE1 }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const runner = new FakeRunner({});
  const resolver: AgentRunnerResolver = { for: () => runner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [],
    getProjectId: (_id: string) => PROJECT_ID,
  } as any);
  const result = await uc.execute();

  assert.deepEqual(result, { outcome: "failed", taskId: FAKE1_TASK_ID });

  // task.failed event with the exact provider-resolution error
  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted");
  assert.equal(
    failedEvt!.payload?.reason,
    `no AI provider available for project ${PROJECT_ID}`,
    "reason must be the exact full string with the resolved project id",
  );
  assert.equal(
    failedEvt!.payload?.reasonCode,
    "no_provider_available",
    "reasonCode must be 'no_provider_available'",
  );

  // Runner must NOT be called when the chain is empty — even for fake@1 tasks
  assert.equal(
    runner.calls.length,
    0,
    "runner must not be called when chain is empty",
  );
});

test("(12) candidate-completes-directly branch also gates: filesystem-bound changed task with blocked O2 must not enqueue O2's task", async () => {
  // Drive the candidate-completes-directly branch (filesystem-bound changed work
  // with no repository binding) with an O2 that has unsatisfied after set.
  const claimed: ClaimedJob = { id: JOB_ID, taskId: T_O1 };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore(
    [
      {
        id: T_O1,
        objectiveId: OBJ_A,
        title: "o1-task",
        status: "pending",
        dependencies: [],
      },
      {
        id: T_O2,
        objectiveId: OBJ_B,
        title: "o2-task",
        status: "pending",
        dependencies: [],
      },
    ],
    INI_ID,
  );
  (store as unknown as Record<string, unknown>).listObjectiveAfter = (
    id: string,
  ) => {
    if (id === OBJ_B) return [OBJ_A];
    return [];
  };
  const origGetObj3 = store.getObjective.bind(store);
  store.getObjective = (id: string) => {
    if (id === OBJ_A)
      return {
        id: OBJ_A,
        initiativeId: INI_ID,
        name: "o1",
        status: "building",
      };
    return origGetObj3(id);
  };

  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  // A candidate-returning runner without repository binding → completes directly
  const resolver: AgentRunnerResolver = { for: () => candidateRunner() };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.equal(
    result.outcome,
    "completed",
    "filesystem-bound changed task must complete directly",
  );
  // O2's task must NOT be enqueued
  assert.ok(
    !queue.enqueued.includes(T_O2),
    "O2's task must NOT be enqueued via candidate-completes-directly re-scan",
  );
  const readyForO2 = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === T_O2,
  );
  assert.equal(
    readyForO2.length,
    0,
    "no task.ready event for O2's task from candidate-completes-directly",
  );
});

// ---------------------------------------------------------------------------
// 008.4 Story 02 — Failover loop with a clean-attempt boundary
// ---------------------------------------------------------------------------

const BAD_PROVIDER: ResolvedProvider = {
  id: "prov-bad",
  name: "bad",
  provider: "openai-codex",
  model: "gpt-5.6-terra",
  value: "sk-bad",
  credentialVersion: 1,
};

const GOOD_PROVIDER: ResolvedProvider = {
  id: "prov-good",
  name: "good",
  provider: "openai-codex",
  model: "gpt-5.6-sol",
  value: "sk-good",
  credentialVersion: 1,
};

const BAD2_PROVIDER: ResolvedProvider = {
  id: "prov-bad2",
  name: "bad2",
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  value: "sk-bad2",
  credentialVersion: 1,
};

test("(008.4 Story 02) RunNextTask on a provider error: chain=[BAD,GOOD], task ends completed; runner.run called with BAD then GOOD; exactly one provider.failover event with payload {from, to, reasonCode}", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  // Runner: returns providerError for BAD, success for GOOD. Records the
  // provider passed on each call for the sequence assertion.
  const calls: Array<{
    taskId: string;
    providerId: string | undefined;
  }> = [];
  const failoverRunner: AgentRunner = {
    async run(
      task: Task,
      _context: TaskContextBinding[],
      provider?: ResolvedProvider,
    ): Promise<TaskResult> {
      calls.push({ taskId: task.id, providerId: provider?.id });
      if (provider !== undefined && provider.id === BAD_PROVIDER.id) {
        return {
          outcome: "failed",
          reason: "auth failed",
          providerError: true,
          reasonCode: "auth",
        };
      }
      return { outcome: "completed", summary: "ok" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => failoverRunner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [BAD_PROVIDER, GOOD_PROVIDER],
  } as any);
  const result = await uc.execute();

  // Task ends completed (failover succeeded on the second provider), and the
  // result reports the one failover for the daemon summary (Story D).
  assert.deepEqual(result, {
    outcome: "completed",
    taskId: TASK_SIMPLE.id,
    failovers: 1,
  });

  // Runner called exactly twice: BAD first, then GOOD.
  assert.equal(
    calls.length,
    2,
    `runner.run must be called exactly twice (BAD then GOOD); got ${calls.length} calls`,
  );
  assert.equal(
    calls[0]!.providerId,
    BAD_PROVIDER.id,
    "first run must use BAD provider",
  );
  assert.equal(
    calls[1]!.providerId,
    GOOD_PROVIDER.id,
    "second run must use GOOD provider",
  );

  // Exactly one provider.failover event with the right payload.
  const failoverEvts = feed.events.filter(
    (e) => e.type === "provider.failover",
  );
  assert.equal(
    failoverEvts.length,
    1,
    `exactly one provider.failover event must be emitted; got ${failoverEvts.length}`,
  );
  const ev = failoverEvts[0]!;
  assert.equal(ev.taskId, TASK_SIMPLE.id, "failover event scoped to the task");
  assert.equal(
    ev.payload?.from,
    BAD_PROVIDER.id,
    "failover payload.from must be the BAD provider's id",
  );
  assert.equal(
    ev.payload?.to,
    GOOD_PROVIDER.id,
    "failover payload.to must be the GOOD provider's id",
  );
  assert.equal(
    ev.payload?.reasonCode,
    "auth",
    "failover payload.reasonCode must match the typed reason code from the failed result",
  );
});

// ---------------------------------------------------------------------------
// 008.4 Story 03 — Task failures never fail over (no providerError ⇒ no
// chain advance, no provider.failover event). A task-level outcome
// (verify fail, bad work, budget, escalation) returns immediately on the
// current provider; the failover branch is gated on `providerError === true`.
// ---------------------------------------------------------------------------

test("(008.4 Story 03) RunNextTask on a task-level failure (providerError unset): chain=[GOOD,BAD], task ends failed; runner.run called exactly once (no advance to BAD); no provider.failover event", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  // Runner: returns a TASK-LEVEL failure (verify fail) for any provider —
  // note the absence of `providerError`. The runner must be called exactly
  // once; the loop's failover branch is gated on `providerError === true`,
  // so the absence of that flag means no chain advance and no event.
  const calls: Array<{
    taskId: string;
    providerId: string | undefined;
  }> = [];
  const taskFailRunner: AgentRunner = {
    async run(
      task: Task,
      _context: TaskContextBinding[],
      provider?: ResolvedProvider,
    ): Promise<TaskResult> {
      calls.push({ taskId: task.id, providerId: provider?.id });
      return {
        outcome: "failed",
        reason: "verify failed: test -f src/todo.mjs returned non-zero",
        // NOTE: providerError is intentionally OMITTED — this is a
        // task-level outcome, not a provider error.
      };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => taskFailRunner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [GOOD_PROVIDER, BAD_PROVIDER],
  } as any);
  const result = await uc.execute();

  // Task ends failed (verify fail is a task-level failure).
  assert.equal(
    result.outcome,
    "failed",
    `task must end failed (verify-fail is task-level); got ${JSON.stringify(result)}`,
  );

  // Runner called exactly ONCE — the failover branch is gated on
  // `providerError === true`, so a task-level failure does NOT advance the
  // chain to BAD.
  assert.equal(
    calls.length,
    1,
    `runner.run must be called exactly once (no chain advance on task-level failure); got ${calls.length} calls`,
  );
  assert.equal(
    calls[0]!.providerId,
    GOOD_PROVIDER.id,
    "the single run must use the FIRST provider in the chain (GOOD); a task-level failure must NOT walk to BAD",
  );

  // No `provider.failover` event must be emitted — the failure is not a
  // provider error, so the failover branch never fires.
  const failoverEvts = feed.events.filter(
    (e) => e.type === "provider.failover",
  );
  assert.equal(
    failoverEvts.length,
    0,
    `no provider.failover event may be emitted for a task-level failure; got ${failoverEvts.length}`,
  );
});

// ---------------------------------------------------------------------------
// 008.4 Story 04 — Provider failover chain exhaustion: a `task.failed` event
// carries the typed `reasonCode: "provider_chain_exhausted"` and a
// `providerReasons` list of each attempted provider's typed reason code (no
// secret, structured codes only).
// ---------------------------------------------------------------------------

test("(008.4 Story 04) RunNextTask on exhausted chain: chain=[BAD, BAD2] both providerError; task ends failed; provider.failover (BAD→BAD2) emitted; task.failed payload has reasonCode='provider_chain_exhausted' and providerReasons listing both codes; no secret in any payload", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  // Runner: returns a typed provider-level failure for BOTH providers, with
  // distinct reason codes ("auth" for BAD, "invalid_model" for BAD2) so the
  // aggregate `providerReasons` proves the loop walked the whole chain.
  const calls: Array<{
    taskId: string;
    providerId: string | undefined;
  }> = [];
  const exhaustingRunner: AgentRunner = {
    async run(
      task: Task,
      _context: TaskContextBinding[],
      provider?: ResolvedProvider,
    ): Promise<TaskResult> {
      calls.push({ taskId: task.id, providerId: provider?.id });
      if (provider !== undefined && provider.id === BAD_PROVIDER.id) {
        return {
          outcome: "failed",
          reason: "auth failed for sk-bad",
          providerError: true,
          reasonCode: "auth",
        };
      }
      if (provider !== undefined && provider.id === BAD2_PROVIDER.id) {
        return {
          outcome: "failed",
          reason: "model gpt-5.6-luna not in catalog",
          providerError: true,
          reasonCode: "invalid_model",
        };
      }
      return { outcome: "completed", summary: "ok" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => exhaustingRunner };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    providerChainFor: (_id: string) => [BAD_PROVIDER, BAD2_PROVIDER],
  } as any);
  const result = await uc.execute();

  // Task ends failed (chain exhausted; no provider succeeded).
  assert.equal(
    result.outcome,
    "failed",
    `exhausted chain must end failed; got ${JSON.stringify(result)}`,
  );
  assert.equal(
    (result as { taskId: string }).taskId,
    TASK_SIMPLE.id,
    "exhausted task id must equal the claimed task",
  );

  // Runner called exactly twice (BAD then BAD2 — the chain was walked).
  assert.equal(
    calls.length,
    2,
    `runner.run must walk the whole chain (BAD then BAD2); got ${calls.length} calls`,
  );
  assert.equal(
    calls[0]!.providerId,
    BAD_PROVIDER.id,
    "first run must use BAD provider",
  );
  assert.equal(
    calls[1]!.providerId,
    BAD2_PROVIDER.id,
    "second run must use BAD2 provider (chain advanced past BAD's providerError)",
  );

  // Exactly one provider.failover event with the right payload (BAD → BAD2).
  const failoverEvts = feed.events.filter(
    (e) => e.type === "provider.failover",
  );
  assert.equal(
    failoverEvts.length,
    1,
    `exactly one provider.failover event must be emitted on exhaustion; got ${failoverEvts.length}`,
  );
  const fEv = failoverEvts[0]!;
  assert.equal(fEv.taskId, TASK_SIMPLE.id, "failover event scoped to the task");
  assert.equal(
    fEv.payload?.from,
    BAD_PROVIDER.id,
    "failover payload.from must be the BAD provider's id",
  );
  assert.equal(
    fEv.payload?.to,
    BAD2_PROVIDER.id,
    "failover payload.to must be the BAD2 provider's id",
  );
  assert.equal(
    fEv.payload?.reasonCode,
    "auth",
    "failover payload.reasonCode must carry the typed reason code from the failed provider (BAD's auth)",
  );

  // The terminal task.failed event must carry the typed aggregate reason.
  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.ok(failedEvt, "task.failed event must be emitted on chain exhaustion");
  assert.equal(
    failedEvt!.payload?.reasonCode,
    "provider_chain_exhausted",
    `task.failed payload.reasonCode must equal 'provider_chain_exhausted'; got ${JSON.stringify(failedEvt!.payload)}`,
  );

  // providerReasons must list each attempted provider's typed reason code.
  const reasons = failedEvt!.payload?.providerReasons;
  assert.ok(
    reasons !== undefined && reasons.length > 0,
    `task.failed payload.providerReasons must be present; got ${JSON.stringify(failedEvt!.payload)}`,
  );
  // The two codes the runner returned ("auth" then "invalid_model") must both
  // appear in `providerReasons` in walk order.
  assert.equal(
    reasons,
    "auth,invalid_model",
    `task.failed payload.providerReasons must list each attempted provider's typed code in walk order; got ${JSON.stringify(reasons)}`,
  );

  // No credential value may leak into any payload. The two BAD providers
  // carry distinct `value` strings ("sk-bad" and "sk-bad2"); the Secret
  // marker from the EPIC's `set -euo pipefail` Proof block is "SECRET".
  const serialized = JSON.stringify(feed.events);
  assert.equal(
    /SECRET/.test(serialized),
    false,
    "task.failed/provider.failover payloads must not carry a 'SECRET' marker",
  );
  assert.equal(
    serialized.includes("sk-bad"),
    false,
    "task.failed/provider.failover payloads must not carry BAD's credential value (sk-bad)",
  );
  assert.equal(
    serialized.includes("sk-bad2"),
    false,
    "task.failed/provider.failover payloads must not carry BAD2's credential value (sk-bad2)",
  );

  // The task must be persisted as failed and the job finished as failed.
  const lastSaved = store.saved[store.saved.length - 1]!;
  assert.equal(
    lastSaved.status,
    "failed",
    "exhausted task must be saved with status=failed",
  );
  assert.deepEqual(
    queue.finished[0],
    { jobId: JOB_ID, outcome: "failed" },
    "exhausted job must be finished with outcome=failed",
  );
});

// ---------------------------------------------------------------------------
// 008.4 Story B — failover takes precedence over the same-provider transient
// retry (007.9 S2). A 429/503 is BOTH provider-level and transient; the epic's
// contract is to move to the next provider rather than retry the one that just
// rate-limited us. On the LAST provider of the chain there is nothing to fail
// over to, so the transient retry still applies.
// ---------------------------------------------------------------------------

test("(008.4 Story 02) a result that is both providerError and transient fails over instead of retrying: 1 provider.failover, 0 provider.retry, runner called BAD then GOOD, failovers=1 on the result", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const calls: Array<string | undefined> = [];
  const rateLimitedRunner: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      provider?: ResolvedProvider,
    ): Promise<TaskResult> {
      calls.push(provider?.id);
      if (provider !== undefined && provider.id === BAD_PROVIDER.id) {
        return {
          outcome: "failed",
          reason: "429 rate limited",
          providerError: true,
          reasonCode: "rate_limit",
          transient: true,
          retryAfterMs: 5000,
        };
      }
      return { outcome: "completed", summary: "ok" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => rateLimitedRunner };
  const sleepLog: number[] = [];

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    maxAttempts: 5,
    sleep: makeSleepRT(sleepLog),
    providerChainFor: (_id: string) => [BAD_PROVIDER, GOOD_PROVIDER],
  } as any);
  const result = await uc.execute();

  assert.equal(
    result.outcome,
    "completed",
    `expected completion on the second provider, got ${JSON.stringify(result)}`,
  );
  assert.deepEqual(
    calls,
    [BAD_PROVIDER.id, GOOD_PROVIDER.id],
    "the rate-limited provider must not be retried; the chain must advance",
  );
  assert.equal(
    feed.events.filter((e) => e.type === "provider.failover").length,
    1,
    "exactly one provider.failover event",
  );
  assert.equal(
    feed.events.filter((e) => e.type === "provider.retry").length,
    0,
    "a provider error with a next provider must NOT emit a same-provider retry",
  );
  assert.deepEqual(
    sleepLog,
    [],
    "failover must not wait out the retry backoff",
  );
  assert.equal(
    (result as { failovers?: number }).failovers,
    1,
    "the result must report the failover count for the daemon summary",
  );
});

test("(008.4 Story 02) a providerError+transient result on the LAST provider still retries on that provider, then fails with reasonCode=provider_chain_exhausted", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  let calls = 0;
  const alwaysRateLimited: AgentRunner = {
    async run(): Promise<TaskResult> {
      calls += 1;
      return {
        outcome: "failed",
        reason: "429 rate limited",
        providerError: true,
        reasonCode: "rate_limit",
        transient: true,
      };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => alwaysRateLimited };
  const sleepLog: number[] = [];

  const uc = new RunNextTask(queue, store, feed, uow, resolver, undefined, {
    maxAttempts: 2,
    sleep: makeSleepRT(sleepLog),
    providerChainFor: (_id: string) => [BAD_PROVIDER],
  } as any);
  const result = await uc.execute();

  assert.equal(result.outcome, "failed");
  assert.equal(calls, 2, "the single provider must exhaust its retry budget");
  assert.equal(
    feed.events.filter((e) => e.type === "provider.retry").length,
    1,
    "one provider.retry for the one retried attempt",
  );
  assert.equal(
    feed.events.filter((e) => e.type === "provider.failover").length,
    0,
    "no failover event when the chain has no next provider",
  );
  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.equal(
    failedEvt?.payload?.reasonCode,
    "provider_chain_exhausted",
    "the terminal failure is still the typed exhaustion aggregate",
  );
  assert.equal(
    (result as { failovers?: number }).failovers,
    undefined,
    "no failover happened, so the result carries no failover count",
  );
});

test("(008.4 Story 04) a provider error with NO resolved chain (legacy caller without providerChainFor) does not claim a chain was exhausted", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const providerErrorRunner: AgentRunner = {
    async run(): Promise<TaskResult> {
      return {
        outcome: "failed",
        reason: "CredentialError: bad key",
        providerError: true,
        reasonCode: "auth",
      };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => providerErrorRunner };

  // No providerChainFor → chain is undefined: there was never a chain to walk.
  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.equal(result.outcome, "failed");
  const failedEvt = feed.events.find((e) => e.type === "task.failed");
  assert.equal(
    failedEvt?.payload?.reasonCode,
    undefined,
    "without a resolved chain the failure must not be labelled provider_chain_exhausted",
  );
  assert.equal(
    failedEvt?.payload?.providerReasons,
    undefined,
    "no chain ⇒ no aggregated providerReasons",
  );
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 1 — lease identity threaded from claim into the runner
// ---------------------------------------------------------------------------

test("(013 S1) RunNextTask passes a lease whose isCurrent reaches the queue with the claimed job id", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  // A runner that captures the 4th argument (the lease) the use case is
  // supposed to pass. Typed loosely so the test is forward-compatible with the
  // new 4-arg AgentRunner.run signature (the SE widens the interface in
  // Story 1; this runner records whatever the use case hands it).
  const receivedLeases: unknown[] = [];
  const capturingRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      _provider: ResolvedProvider | undefined,
      ...rest: unknown[]
    ): Promise<TaskResult> {
      receivedLeases.push(rest[0]);
      return { outcome: "completed", summary: "fake" };
    },
  };
  const resolver: AgentRunnerResolver = {
    for: () => capturingRunner as unknown as AgentRunner,
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await uc.execute();

  assert.equal(receivedLeases.length, 1, "runner called exactly once");
  const lease = receivedLeases[0];
  assert.ok(
    lease !== undefined && lease !== null,
    "RunNextTask must hand the runner a lease object (the 4th argument)",
  );
  const observer = lease as { isCurrent: () => boolean };
  const current = observer.isCurrent();
  assert.equal(
    current,
    true,
    "the lease's isCurrent() returns whatever the queue says (true by default)",
  );
  // EPIC 013 S1 — the lease observer's `isCurrent()` must reach the queue
  // with the claimed job's id, proving the token is threaded from
  // claim → runner. After Story 2, the queue is consulted additional times
  // (tx2 top-level read + per-branch guard), so the call array is no
  // longer exactly `[JOB_ID]`. The load-bearing invariant is that the
  // observer's call reaches the queue — checked with `includes`, not
  // strict equality.
  assert.ok(
    queue.isLeaseCurrentCalls.includes(JOB_ID),
    `the lease's isCurrent() must reach the queue with the claimed job's id, ` +
      `proving the token is threaded from claim → runner; got ${JSON.stringify(queue.isLeaseCurrentCalls)}`,
  );
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 3 + Story 4 — the `abandoned` TaskResult arm. A scripted
// runner that returns `{ outcome: "abandoned" }` is the runner reporting a
// drained lease. The use case must:
//   - resolve to `{ outcome: "abandoned", taskId }`;
//   - NOT call `finish`, `saveTaskResult`;
//   - requeue the task (`running → pending`, discard the old job row, re-enqueue);
//   - append `task.ready` (only when the re-enqueue inserted) then
//     `task.abandoned` (with the operator's reason) inside tx2.
//
// The Story 3 turn wrote this test against a "soft early return" contract
// (no requeue, no `task.abandoned` event). Story 4 filled the tx2
// `abandoned` branch with the requeue + `task.abandoned` append per the
// Story 4 spec, so the assertions now mirror that contract. The base
// `RecordingJobQueue` returns `[]` from `listRunningJobsForTask`, so the
// reason defaults to `""` — the S4 test variant uses
// `S4RecordingJobQueue` to drive a non-empty `revokeReason`.
// ---------------------------------------------------------------------------

test("(013 S3) RunNextTask execute: scripted runner returning {outcome:'abandoned'} → outcome 'abandoned', requeue, task.abandoned event", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new RecordingJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const scripted: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      _provider: ResolvedProvider | undefined,
      _lease: { isCurrent: () => boolean },
    ): Promise<TaskResult> {
      return { outcome: "abandoned" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => scripted };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(
    result,
    { outcome: "abandoned", taskId: TASK_SIMPLE.id },
    "a drained run must surface as 'abandoned' from execute()",
  );

  // finish was never called — the lease row's lifecycle ends via discard
  // (the requeue path), not finish.
  assert.equal(
    queue.finished.length,
    0,
    "finish must NOT be called for an abandoned run (the row is discarded, not finished)",
  );

  // saveTaskResult was never called — an abandoned run has no result to persist.
  assert.equal(
    store.taskResults.length,
    0,
    "no task_results row must be saved for an abandoned run",
  );

  // The task was saved TWICE: once to `running` (tx1) and once to `pending`
  // (tx2 abandoned branch — the requeue).
  assert.equal(
    store.saved.length,
    2,
    "tx1 + tx2 each save once (tx1 pending→running, tx2 running→pending)",
  );
  assert.equal(store.saved[0]!.status, "running", "tx1: pending → running");
  assert.equal(
    store.saved[1]!.status,
    "pending",
    "tx2 abandoned branch: running → pending (requeue)",
  );

  // The lease row was discarded and a fresh enqueue happened.
  assert.deepEqual(
    queue.discarded,
    [JOB_ID],
    "the old lease row was discarded by the requeue",
  );
  assert.deepEqual(
    queue.enqueued,
    [TASK_SIMPLE.id],
    "the task was re-enqueued by the requeue",
  );

  // Event order inside the run: task.started (tx1) → task.ready (tx2 requeue)
  // → task.abandoned (tx2 abandonment record). The task.abandoned payload
  // carries the operator's reason (here: "" because listRunningJobsForTask
  // returned no revoked row in this test).
  const types = feed.events.map((e) => e.type);
  assert.deepEqual(
    types,
    ["task.started", "task.ready", "task.abandoned"],
    "events must be: task.started (tx1) → task.ready (tx2 requeue) → task.abandoned (tx2)",
  );
  const abandonedEvt = feed.events.find((e) => e.type === "task.abandoned");
  assert.ok(abandonedEvt !== undefined, "task.abandoned event was appended");
  assert.deepEqual(
    abandonedEvt!.payload,
    { reason: "" },
    "task.abandoned payload collapses to { reason: '' } when listRunningJobsForTask has no revoked row",
  );

  // No terminal event of any other kind.
  const terminalTypes = feed.events
    .map((e) => e.type)
    .filter(
      (t) =>
        t === "task.completed" || t === "task.failed" || t === "task.escalated",
    );
  assert.equal(
    terminalTypes.length,
    0,
    "no task.completed / task.failed / task.escalated event for a drained run",
  );
});

// ---------------------------------------------------------------------------
// EPIC 013 Story 4 — requeue on exit. The Story 3 early return at the top of
// tx2 must be filled with the requeue + `task.abandoned` append so a drained
// run hands the task back. The lease observer's `listRunningJobsForTask`
// returns the just-revoked row carrying the operator's `revokeReason`; that
// reason is the payload of `task.abandoned`. Event order inside tx2 is pinned:
// `task.started` (tx1) → `task.ready` (only when the re-enqueue inserted) →
// `task.abandoned`.
// ---------------------------------------------------------------------------

/**
 * RecordingJobQueue extended for S4 — surfaces a revoked running job via
 * `listRunningJobsForTask` so the abandoned branch can read its
 * `revokeReason` before requeueing (the requeue discards the row, so the
 * reason must be read first).
 */
class S4RecordingJobQueue extends RecordingJobQueue {
  readonly #revoked: { id: string; taskId: string; reason: string }[];
  constructor(
    nextClaim: ClaimedJob | undefined,
    preEnqueued: string[] = [],
    revoked: { id: string; taskId: string; reason: string }[] = [],
  ) {
    super(nextClaim, preEnqueued);
    this.#revoked = revoked;
  }

  override listRunningJobsForTask(taskId: string): RunningJob[] {
    this.listRunningJobsForTaskCalls.push(taskId);
    return this.#revoked
      .filter((r) => r.taskId === taskId)
      .map((r) => ({
        id: r.id,
        taskId: r.taskId,
        revoked: true,
        revokeReason: r.reason,
      }));
  }
}

test("(013 S4) RunNextTask execute: scripted 'abandoned' outcome + revoked running job → requeue to pending, task.abandoned event with reason", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new S4RecordingJobQueue(
    claimed,
    [],
    [{ id: JOB_ID, taskId: TASK_SIMPLE.id, reason: "stuck on a slow tool" }],
  );
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const scripted: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      _provider: ResolvedProvider | undefined,
      _lease: { isCurrent: () => boolean },
    ): Promise<TaskResult> {
      return { outcome: "abandoned" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => scripted };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(
    result,
    { outcome: "abandoned", taskId: TASK_SIMPLE.id },
    "a drained run must surface as 'abandoned' from execute()",
  );

  // The task was saved TWICE: once to `running` (tx1) and once to `pending`
  // (tx2 abandoned branch — the requeue).
  assert.equal(store.saved.length, 2, "tx1 + tx2 each save once");
  assert.equal(store.saved[0]!.status, "running", "tx1: pending → running");
  assert.equal(store.saved[1]!.status, "pending", "tx2: running → pending");

  // The lease row was discarded and a fresh enqueue happened.
  assert.deepEqual(
    queue.discarded,
    [JOB_ID],
    "the old lease row was discarded by the requeue",
  );
  assert.deepEqual(
    queue.enqueued,
    [TASK_SIMPLE.id],
    "the task was re-enqueued by the requeue",
  );

  // finish was never called — the lease row's lifecycle ends via discard.
  assert.equal(
    queue.finished.length,
    0,
    "finish must NOT be called for an abandoned run (the row is discarded, not finished)",
  );

  // saveTaskResult was never called.
  assert.equal(
    store.taskResults.length,
    0,
    "no task_results row must be saved for an abandoned run",
  );

  // Event order inside the run: task.started (tx1) → task.ready (tx2 requeue)
  // → task.abandoned (tx2 abandonment record). The task.abandoned payload
  // carries the operator's reason exactly as `listRunningJobsForTask` reported
  // it.
  const types = feed.events.map((e) => e.type);
  assert.deepEqual(
    types,
    ["task.started", "task.ready", "task.abandoned"],
    "events must be: task.started (tx1) → task.ready (tx2 requeue) → task.abandoned (tx2)",
  );
  const abandonedEvt = feed.events.find((e) => e.type === "task.abandoned");
  assert.ok(abandonedEvt !== undefined, "task.abandoned event was appended");
  assert.equal(
    abandonedEvt!.taskId,
    TASK_SIMPLE.id,
    "task.abandoned carries the task id",
  );
  assert.deepEqual(
    abandonedEvt!.payload,
    { reason: "stuck on a slow tool" },
    "task.abandoned payload carries the operator's reason from the revoked lease row",
  );

  // No terminal event of any other kind.
  const terminalTypes = feed.events
    .map((e) => e.type)
    .filter(
      (t) =>
        t === "task.completed" || t === "task.failed" || t === "task.escalated",
    );
  assert.equal(
    terminalTypes.length,
    0,
    "no task.completed / task.failed / task.escalated event for a drained run",
  );
});

test("(013 S4) RunNextTask execute: scripted 'abandoned' outcome with revokeReason=null → task.abandoned payload is { reason: '' }", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new S4RecordingJobQueue(
    claimed,
    [],
    [{ id: JOB_ID, taskId: TASK_SIMPLE.id, reason: "" }],
  );
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const scripted: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      _provider: ResolvedProvider | undefined,
      _lease: { isCurrent: () => boolean },
    ): Promise<TaskResult> {
      return { outcome: "abandoned" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => scripted };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, {
    outcome: "abandoned",
    taskId: TASK_SIMPLE.id,
  });

  const abandonedEvt = feed.events.find((e) => e.type === "task.abandoned");
  assert.ok(abandonedEvt !== undefined);
  assert.deepEqual(
    abandonedEvt!.payload,
    { reason: "" },
    "a null revokeReason collapses to { reason: '' } in the task.abandoned payload",
  );
});

test("(013 S4) RunNextTask execute: runner reports 'completed' but isLeaseCurrent is false in tx2 → the 'run finished before it noticed' path; requeue + task.abandoned", async () => {
  // The runner hands back a normal completed result, but the lease was
  // revoked while the run was in flight (e.g. between tx1 and tx2, or
  // between the run's last turn and the use case's tx2). RunNextTask's tx2
  // top-level read sees `!isLeaseCurrent`, takes the abandoned branch, and
  // hands the task back. The runner's completed result is silently
  // discarded (a per-branch guard is unreachable because we never enter
  // the per-branch arms).
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_SIMPLE.id };
  const queue = new S4RecordingJobQueue(
    claimed,
    [],
    [{ id: JOB_ID, taskId: TASK_SIMPLE.id, reason: "abandoned mid-run" }],
  );
  queue.leaseCurrentResult = false;
  const store = new SimpleTaskStore([{ ...TASK_SIMPLE }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();

  const scripted: AgentRunner = {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      _provider: ResolvedProvider | undefined,
      _lease: { isCurrent: () => boolean },
    ): Promise<TaskResult> {
      return { outcome: "completed", summary: "would have completed" };
    },
  };
  const resolver: AgentRunnerResolver = { for: () => scripted };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  const result = await uc.execute();

  assert.deepEqual(result, {
    outcome: "abandoned",
    taskId: TASK_SIMPLE.id,
  });

  // Requeue: task → pending, job discarded, fresh enqueue, task.abandoned
  // appended with the reason.
  assert.equal(store.saved.length, 2, "tx1 + tx2 each save once");
  assert.equal(store.saved[1]!.status, "pending");
  assert.deepEqual(queue.discarded, [JOB_ID]);
  assert.deepEqual(queue.enqueued, [TASK_SIMPLE.id]);

  // The runner's completed result was ignored: no `task.completed` event,
  // no task_results row, finish was never called.
  assert.equal(queue.finished.length, 0, "no finish on a late-revoked run");
  assert.equal(store.taskResults.length, 0, "no task_results row");
  const completedEvts = feed.events.filter((e) => e.type === "task.completed");
  assert.equal(
    completedEvts.length,
    0,
    "no task.completed event when the lease was revoked before tx2",
  );

  // task.abandoned still carries the reason.
  const abandonedEvt = feed.events.find((e) => e.type === "task.abandoned");
  assert.ok(abandonedEvt !== undefined);
  assert.deepEqual(
    abandonedEvt!.payload,
    { reason: "abandoned mid-run" },
    "task.abandoned payload mirrors the reason stored on the revoked lease row",
  );
});
