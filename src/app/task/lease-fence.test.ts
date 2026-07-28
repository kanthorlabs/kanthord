/**
 * EPIC 013 Story 2 — RunNextTask lease fence.
 *
 * Two flavours of test:
 *
 * 1. Real-SQLite: a scripted runner revokes its own lease (UPDATE
 *    jobs SET revoked=1 WHERE id=?) before returning a scripted
 *    `TaskResult`. The use case must short-circuit tx2 to the
 *    `"abandoned"` outcome and write nothing — no terminal event,
 *    no `task_results` row, no candidate row, task stays `running`,
 *    jobs row stays `running`. One test per branch (completed,
 *    failed, escalated, candidate).
 *
 * 2. Direct-guard: a fake queue whose `isLeaseCurrent` returns
 *    `true` on the first call (tx2 top-level read) and `false` on
 *    subsequent calls (the per-branch guard). The use case must
 *    reject with `StaleLeaseError`, and the fake store / queue /
 *    event feed must show zero writes. One test per branch.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../../storage/sqlite/open.ts";
import { migrate } from "../../storage/sqlite/migrate.ts";
import { MIGRATIONS } from "../../storage/sqlite/migrations.ts";
import { newId } from "../../domain/entity.ts";
import { SqliteJobQueue } from "../../queue/sqlite.ts";
import { SqliteEventFeed } from "../../events/sqlite.ts";
import { SqliteUnitOfWork } from "../../storage/sqlite/sqlite-unit-of-work.ts";
import { SqliteTaskRepository } from "../../storage/sqlite/sqlite-task-repository.ts";
import { SqliteLandingRepository } from "../../storage/sqlite/landing.ts";
import { RegistryRunnerResolver } from "../../agent-runner/resolver.ts";
import { StaleLeaseError } from "../../queue/port.ts";
import type {
  JobQueue,
  ClaimedJob,
  RunningJob,
  LeaseToken,
} from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type {
  UnitOfWork,
  TaskResultRow,
  LandingRepository,
} from "../../storage/port.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  LeaseObserver,
  ResolvedProvider,
  TaskContextBinding,
  TaskResult,
} from "../../agent-runner/port.ts";
import type { Task } from "../../domain/task.ts";
import type { Event } from "../../domain/event.ts";
import type {
  ChangeCandidate,
  CandidateState,
  Integration,
} from "../../domain/landing.ts";
import { RunNextTask } from "./run-next-task.ts";

// ---------------------------------------------------------------------------
// Real-SQLite setup — temp DB with migrations + one FK chain + one queued job.
// ---------------------------------------------------------------------------

interface RealFixture {
  db: ReturnType<typeof openDatabase>;
  taskId: string;
  jobId: string;
  cleanup(): void;
}

function setupRealDb(): RealFixture {
  const dir = mkdtempSync(join(tmpdir(), "kanthord-lease-fence-"));
  const dbPath = join(dir, "test.db");
  const db = openDatabase(dbPath);
  migrate(db, MIGRATIONS);

  const projectId = newId();
  const initiativeId = newId();
  const objectiveId = newId();
  const taskId = newId();
  const jobId = newId();

  db.exec(
    `INSERT INTO projects(id, name) VALUES('${projectId}', 'proj');` +
      `INSERT INTO initiatives(id, projectId, name) VALUES('${initiativeId}', '${projectId}', 'init');` +
      `INSERT INTO objectives(id, initiativeId, name) VALUES('${objectiveId}', '${initiativeId}', 'obj');` +
      `INSERT INTO tasks(id, objectiveId, title, status) VALUES('${taskId}', '${objectiveId}', 'task', 'pending');` +
      `INSERT INTO jobs(id, taskId, status) VALUES('${jobId}', '${taskId}', 'queued');`,
  );

  return {
    db,
    taskId,
    jobId,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true });
    },
  };
}

/**
 * A scripted runner that revokes its own lease (UPDATE jobs SET
 * revoked=1, revokeReason=? WHERE id=?) before returning the
 * configured result. Captures the runner's result for later assertions.
 * Story 4 S4-T1 — the reason is recorded so the use case's tx2 abandoned
 * branch can read it via `listRunningJobsForTask` and embed it in the
 * `task.abandoned` payload.
 */
class SelfRevokingRunner implements AgentRunner {
  readonly #result: TaskResult;
  readonly #jobId: string;
  readonly #db: ReturnType<typeof openDatabase>;
  readonly #reason: string;
  constructor(
    db: ReturnType<typeof openDatabase>,
    jobId: string,
    result: TaskResult,
    reason = "self-revoke from runner",
  ) {
    this.#db = db;
    this.#jobId = jobId;
    this.#result = result;
    this.#reason = reason;
  }
  async run(
    _task: Task,
    _context: TaskContextBinding[],
    _provider: ResolvedProvider | undefined,
    _lease: LeaseObserver,
  ): Promise<TaskResult> {
    // Revoke the lease mid-run, so by the time RunNextTask reaches
    // tx2 the queue's `isLeaseCurrent` returns false.
    this.#db
      .prepare("UPDATE jobs SET revoked=1, revokeReason=? WHERE id=?")
      .run(this.#reason, this.#jobId);
    return this.#result;
  }
}

// ---------------------------------------------------------------------------
// Real-SQLite tests — runner revokes its own lease; use case must fence.
// ---------------------------------------------------------------------------

test("(013 S2) completed branch: runner revokes its lease → outcome 'abandoned', no task_results, no task.completed, jobs row is replaced by a fresh queued row (S4 requeue)", async () => {
  const { db, taskId, jobId, cleanup } = setupRealDb();
  try {
    const runner = new SelfRevokingRunner(
      db,
      jobId,
      {
        outcome: "completed",
        summary: "would have completed",
      },
      "stuck on a slow tool",
    );
    const repo = new SqliteTaskRepository(db);
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const resolver: AgentRunnerResolver = { for: () => runner };

    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    const result = await uc.execute();

    assert.equal(
      result.outcome,
      "abandoned",
      `a revoked lease must short-circuit tx2 to "abandoned"; got: ${result.outcome}`,
    );
    assert.equal(
      (result as { taskId: string }).taskId,
      taskId,
      "result.taskId must still name the claimed task",
    );

    // Story 4 — the task is requeued: running → pending, and a fresh queued
    // job row exists for the task under a NEW id. The revoked jobId is gone
    // (requeueRunningTask discards the row).
    const taskRow = db
      .prepare("SELECT status FROM tasks WHERE id=?")
      .get(taskId) as { status: string } | undefined;
    assert.ok(taskRow !== undefined);
    assert.equal(
      taskRow.status,
      "pending",
      "a revoked lease must requeue the task: running → pending",
    );

    // The old (revoked) job row is gone — requeueRunningTask discards it.
    const oldJobRow = db
      .prepare("SELECT id FROM jobs WHERE id=?")
      .get(jobId) as { id: string } | undefined;
    assert.equal(
      oldJobRow,
      undefined,
      "the revoked lease row must be discarded (requeueRunningTask deletes it)",
    );

    // A fresh queued row exists for the task (under a different id).
    const newJobRows = db
      .prepare("SELECT id, status FROM jobs WHERE taskId=? ORDER BY id ASC")
      .all(taskId) as Array<{ id: string; status: string }>;
    assert.equal(
      newJobRows.length,
      1,
      "exactly one queued job row exists for the task after requeue",
    );
    assert.equal(
      newJobRows[0]!.status,
      "queued",
      "the fresh row is queued, not running — the next claim gets a new lease",
    );
    assert.notEqual(
      newJobRows[0]!.id,
      jobId,
      "the fresh row's id is a new lease, not the revoked one",
    );

    // Zero rows in task_results.
    const resultCount = db
      .prepare("SELECT COUNT(*) AS n FROM task_results WHERE task_id=?")
      .get(taskId) as { n: number };
    assert.equal(
      resultCount.n,
      0,
      "a revoked lease must NOT write a task_results row",
    );

    // No task.completed event.
    const completedEvts = db
      .prepare(
        "SELECT * FROM events WHERE type='task.completed' AND \"taskId\"=?",
      )
      .all(taskId);
    assert.equal(
      completedEvts.length,
      0,
      "a revoked lease must NOT append a task.completed event",
    );

    // A task.abandoned event carries the runner-stored reason.
    const abandonedEvts = db
      .prepare(
        "SELECT * FROM events WHERE type='task.abandoned' AND \"taskId\"=?",
      )
      .all(taskId) as Array<{ id: string; payload: string | null }>;
    assert.equal(
      abandonedEvts.length,
      1,
      "exactly one task.abandoned event for the drained run",
    );
    const abandonedEvt = abandonedEvts[0]!;
    const payload = JSON.parse(abandonedEvt.payload ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(
      payload["reason"],
      "stuck on a slow tool",
      "task.abandoned payload.reason mirrors the reason stored on the revoked lease row",
    );

    // A task.ready event was appended (requeue enqueue was an insert).
    const readyEvts = db
      .prepare("SELECT * FROM events WHERE type='task.ready' AND \"taskId\"=?")
      .all(taskId);
    assert.equal(
      readyEvts.length,
      1,
      "exactly one task.ready event for the requeued task",
    );
  } finally {
    cleanup();
  }
});

test("(013 S2) failed branch: runner revokes its lease → outcome 'abandoned', no task_results, no task.failed, task is requeued (S4)", async () => {
  const { db, taskId, jobId, cleanup } = setupRealDb();
  try {
    const runner = new SelfRevokingRunner(
      db,
      jobId,
      {
        outcome: "failed",
        reason: "would have failed",
      },
      "stuck on a slow tool",
    );
    const repo = new SqliteTaskRepository(db);
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const resolver: AgentRunnerResolver = { for: () => runner };

    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    const result = await uc.execute();

    assert.equal(
      result.outcome,
      "abandoned",
      `a revoked lease on a failed-result run must short-circuit to "abandoned"; got: ${result.outcome}`,
    );

    // Task is requeued: running → pending.
    const taskRow = db
      .prepare("SELECT status FROM tasks WHERE id=?")
      .get(taskId) as { status: string } | undefined;
    assert.equal(
      taskRow?.status,
      "pending",
      "task must be requeued to pending",
    );

    // Old revoked job row is gone; a fresh queued row exists.
    const oldJobRow = db
      .prepare("SELECT id FROM jobs WHERE id=?")
      .get(jobId) as { id: string } | undefined;
    assert.equal(oldJobRow, undefined, "the revoked lease row was discarded");
    const newJobRows = db
      .prepare("SELECT id, status FROM jobs WHERE taskId=? ORDER BY id ASC")
      .all(taskId) as Array<{ id: string; status: string }>;
    assert.equal(
      newJobRows.length,
      1,
      "exactly one queued job row exists for the task after requeue",
    );
    assert.equal(newJobRows[0]!.status, "queued");

    // Zero rows in task_results, no task.failed event.
    const resultCount = db
      .prepare("SELECT COUNT(*) AS n FROM task_results WHERE task_id=?")
      .get(taskId) as { n: number };
    assert.equal(resultCount.n, 0, "no task_results row");
    const failedEvts = db
      .prepare("SELECT * FROM events WHERE type='task.failed' AND \"taskId\"=?")
      .all(taskId);
    assert.equal(failedEvts.length, 0, "no task.failed event");

    // A task.abandoned event with the runner-stored reason.
    const abandonedEvts = db
      .prepare(
        "SELECT * FROM events WHERE type='task.abandoned' AND \"taskId\"=?",
      )
      .all(taskId) as Array<{ id: string; payload: string | null }>;
    assert.equal(abandonedEvts.length, 1, "exactly one task.abandoned event");
    const payload = JSON.parse(abandonedEvts[0]!.payload ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(payload["reason"], "stuck on a slow tool");
  } finally {
    cleanup();
  }
});

test("(013 S2) escalated branch: runner revokes its lease → outcome 'abandoned', no task_results, no task.escalated, task is requeued (S4)", async () => {
  const { db, taskId, jobId, cleanup } = setupRealDb();
  try {
    const runner = new SelfRevokingRunner(
      db,
      jobId,
      {
        outcome: "escalated",
        reason: "would have escalated",
        summary: "needs human",
        workspace: "/ws/esc",
        branch: "kanthord/esc",
        baseCommit: "BASE_ESC",
      },
      "stuck on a slow tool",
    );
    const repo = new SqliteTaskRepository(db);
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const resolver: AgentRunnerResolver = { for: () => runner };

    const uc = new RunNextTask(queue, repo, feed, uow, resolver);
    const result = await uc.execute();

    assert.equal(
      result.outcome,
      "abandoned",
      `a revoked lease on an escalated run must short-circuit to "abandoned"; got: ${result.outcome}`,
    );

    // Task is requeued: running → pending.
    const taskRow = db
      .prepare("SELECT status FROM tasks WHERE id=?")
      .get(taskId) as { status: string } | undefined;
    assert.equal(
      taskRow?.status,
      "pending",
      "task must be requeued to pending — escalation must NOT persist",
    );

    // Old revoked job row is gone; a fresh queued row exists.
    const oldJobRow = db
      .prepare("SELECT id FROM jobs WHERE id=?")
      .get(jobId) as { id: string } | undefined;
    assert.equal(oldJobRow, undefined, "the revoked lease row was discarded");
    const newJobRows = db
      .prepare("SELECT id, status FROM jobs WHERE taskId=? ORDER BY id ASC")
      .all(taskId) as Array<{ id: string; status: string }>;
    assert.equal(newJobRows.length, 1);
    assert.equal(newJobRows[0]!.status, "queued");

    const resultCount = db
      .prepare("SELECT COUNT(*) AS n FROM task_results WHERE task_id=?")
      .get(taskId) as { n: number };
    assert.equal(resultCount.n, 0, "no task_results row");
    const escalatedEvts = db
      .prepare(
        "SELECT * FROM events WHERE type='task.escalated' AND \"taskId\"=?",
      )
      .all(taskId);
    assert.equal(escalatedEvts.length, 0, "no task.escalated event");

    // task.abandoned event with the runner-stored reason.
    const abandonedEvts = db
      .prepare(
        "SELECT * FROM events WHERE type='task.abandoned' AND \"taskId\"=?",
      )
      .all(taskId) as Array<{ id: string; payload: string | null }>;
    assert.equal(abandonedEvts.length, 1, "exactly one task.abandoned event");
    const payload = JSON.parse(abandonedEvts[0]!.payload ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(payload["reason"], "stuck on a slow tool");
  } finally {
    cleanup();
  }
});

test("(013 S2) candidate branch: runner revokes its lease → outcome 'abandoned', no task_results, no landing_candidates, task is requeued (S4)", async () => {
  const { db, taskId, jobId, cleanup } = setupRealDb();
  try {
    const runner = new SelfRevokingRunner(
      db,
      jobId,
      {
        outcome: "candidate",
        workspace: "/ws/cand",
        branch: "kanthord/cand",
        baseCommit: "BASE_CAND",
        candidateCommit: "CAND_COMMIT",
        summary: "changed work",
      },
      "stuck on a slow tool",
    );
    const repo = new SqliteTaskRepository(db);
    const queue = new SqliteJobQueue(db);
    const feed = new SqliteEventFeed(db);
    const uow = new SqliteUnitOfWork(db);
    const landing = new SqliteLandingRepository(db);
    const resolver: AgentRunnerResolver = { for: () => runner };

    // No repository binding → filesystem-bound; the candidate branch
    // normally completes directly. The fence must hold regardless.
    const uc = new RunNextTask(queue, repo, feed, uow, resolver, landing);
    const result = await uc.execute();

    assert.equal(
      result.outcome,
      "abandoned",
      `a revoked lease on a candidate run must short-circuit to "abandoned"; got: ${result.outcome}`,
    );

    // Task is requeued: running → pending.
    const taskRow = db
      .prepare("SELECT status FROM tasks WHERE id=?")
      .get(taskId) as { status: string } | undefined;
    assert.equal(
      taskRow?.status,
      "pending",
      "task must be requeued to pending — candidate must NOT land",
    );

    // Old revoked job row is gone; a fresh queued row exists.
    const oldJobRow = db
      .prepare("SELECT id FROM jobs WHERE id=?")
      .get(jobId) as { id: string } | undefined;
    assert.equal(oldJobRow, undefined, "the revoked lease row was discarded");
    const newJobRows = db
      .prepare("SELECT id, status FROM jobs WHERE taskId=? ORDER BY id ASC")
      .all(taskId) as Array<{ id: string; status: string }>;
    assert.equal(newJobRows.length, 1);
    assert.equal(newJobRows[0]!.status, "queued");

    // No task_results row, no landing_candidates row, no task.completed
    // or task.escalated event.
    const resultCount = db
      .prepare("SELECT COUNT(*) AS n FROM task_results WHERE task_id=?")
      .get(taskId) as { n: number };
    assert.equal(resultCount.n, 0, "no task_results row");

    const landingCount = db
      .prepare("SELECT COUNT(*) AS n FROM landing_candidates WHERE task_id=?")
      .get(taskId) as { n: number };
    assert.equal(
      landingCount.n,
      0,
      "no landing_candidates row for a revoked-lease candidate run",
    );

    const terminalEvts = db
      .prepare(
        "SELECT * FROM events WHERE \"taskId\"=? AND type IN ('task.completed','task.escalated')",
      )
      .all(taskId);
    assert.equal(
      terminalEvts.length,
      0,
      "no task.completed / task.escalated event for a revoked candidate run",
    );

    // task.abandoned event with the runner-stored reason.
    const abandonedEvts = db
      .prepare(
        "SELECT * FROM events WHERE type='task.abandoned' AND \"taskId\"=?",
      )
      .all(taskId) as Array<{ id: string; payload: string | null }>;
    assert.equal(abandonedEvts.length, 1, "exactly one task.abandoned event");
    const payload = JSON.parse(abandonedEvts[0]!.payload ?? "{}") as Record<
      string,
      unknown
    >;
    assert.equal(payload["reason"], "stuck on a slow tool");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Direct-guard tests — fake queue toggles isLeaseCurrent; the per-branch
// guard must throw and propagate. The use case's tx2 has no try/catch, so
// the StaleLeaseError must surface out of execute().
// ---------------------------------------------------------------------------

class TogglingRecordingJobQueue implements JobQueue {
  readonly finished: Array<{
    jobId: string;
    outcome: "completed" | "failed";
  }> = [];
  readonly discarded: string[] = [];
  readonly enqueued: string[] = [];
  readonly isLeaseCurrentCalls: LeaseToken[] = [];
  /** The pre-configured claim returned by claim(). */
  readonly #nextClaim: ClaimedJob | undefined;
  #nextIsLeaseCurrent = true;

  constructor(nextClaim: ClaimedJob | undefined) {
    this.#nextClaim = nextClaim;
  }

  claim(): ClaimedJob | undefined {
    const c = this.#nextClaim;
    return c;
  }

  finish(jobId: string, outcome: "completed" | "failed"): void {
    this.finished.push({ jobId, outcome });
  }

  discard(jobId: string): void {
    this.discarded.push(jobId);
  }

  enqueue(taskId: string): boolean {
    this.enqueued.push(taskId);
    return true;
  }

  listRunningJobs(): ClaimedJob[] {
    return [];
  }

  isLeaseCurrent(leaseToken: LeaseToken): boolean {
    this.isLeaseCurrentCalls.push(leaseToken);
    const result = this.#nextIsLeaseCurrent;
    this.#nextIsLeaseCurrent = false;
    return result;
  }

  listRunningJobsForTask(_taskId: string): RunningJob[] {
    return [];
  }

  // EPIC 013 Story 3 — `revoke` seam. Direct-guard tests do not exercise
  // the abandon path; default to `not_found` keeps a stray call debuggable.
  revoke(
    _leaseToken: string,
    _reason: string,
  ): "revoked" | "already_revoked" | "not_found" {
    return "not_found";
  }
}

class RecordingTaskStore {
  readonly saved: Task[] = [];
  readonly taskResults: TaskResultRow[] = [];
  readonly #task: Task;
  readonly #initiativeId: string;

  constructor(task: Task, initiativeId: string) {
    this.#task = task;
    this.#initiativeId = initiativeId;
  }

  get(_id: string): Task | undefined {
    return { ...this.#task };
  }
  save(task: Task): void {
    this.saved.push(task);
  }
  listByInitiative(_id: string): Task[] {
    return [{ ...this.#task }];
  }
  getInitiativeId(_id: string): string | undefined {
    return this.#initiativeId;
  }
  getTaskContext(_id: string): Record<string, string> {
    return {};
  }
  getRepositoryBranch(_id: string): string | undefined {
    return "main";
  }
  saveTaskResult(_id: string, row: TaskResultRow): void {
    this.taskResults.push(row);
  }
}

class RecordingEventFeedOnly implements EventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    this.events.push(event);
  }
  readAfter(_cursor: string, _limit?: number): Event[] {
    return [];
  }
}

class RecordingUnitOfWorkOnly implements UnitOfWork {
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

class FakeLanding implements LandingRepository {
  readonly saved: ChangeCandidate[] = [];
  saveCandidate(c: ChangeCandidate): void {
    this.saved.push(c);
  }
  getCandidate(_id: string): ChangeCandidate | undefined {
    return undefined;
  }
  updateCandidateState(_id: string, _state: CandidateState): void {}
  saveIntegration(_integration: Integration): void {}
  getIntegration(_id: string): Integration | undefined {
    return undefined;
  }
}

const INI_ID = "01JZZZZZZZZZZZZZZZZZZZINI2";
const JOB_ID = "01JZZZZZZZZZZZZZZZZZZZJOB2";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ2";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSK2";

const FENCE_TASK: Task = {
  id: TASK_ID,
  objectiveId: OBJ_ID,
  title: "fence-task",
  status: "pending",
  dependencies: [],
};

function scriptedRunner(result: TaskResult): AgentRunner {
  return {
    async run(
      _task: Task,
      _context: TaskContextBinding[],
      _provider: ResolvedProvider | undefined,
      _lease: LeaseObserver,
    ): Promise<TaskResult> {
      return result;
    },
  } as unknown as AgentRunner;
}

test("(013 S2) completed-branch guard: isLeaseCurrent toggles true→false → execute() rejects with StaleLeaseError, no writes", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new TogglingRecordingJobQueue(claimed);
  const store = new RecordingTaskStore(FENCE_TASK, INI_ID);
  const feed = new RecordingEventFeedOnly();
  const uow = new RecordingUnitOfWorkOnly();
  const resolver: AgentRunnerResolver = {
    for: () =>
      scriptedRunner({ outcome: "completed", summary: "would complete" }),
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute(),
    (err: unknown) => err instanceof StaleLeaseError,
    "a completed-branch guard must reject the use case with StaleLeaseError",
  );

  // The fence fired AT the branch — the tx2 top-level read returned true
  // and consumed the toggle, so the second call (the branch guard) saw
  // false and threw. Both calls were made; the run was not finished.
  // The tx1 `pending → running` save and the `task.started` event are
  // legitimate (the run did start before draining); the per-branch guard
  // ensures no tx2 write fires, so the FINAL state of the task stays
  // `running` and no terminal event was appended.
  assert.equal(
    queue.isLeaseCurrentCalls.length,
    2,
    "tx2 top-level read + branch guard: exactly 2 isLeaseCurrent calls",
  );
  assert.equal(
    queue.finished.length,
    0,
    "a stale-lease write must NOT call finish()",
  );
  // tx1's `pending → running` save is legitimate; the per-branch guard
  // prevents tx2 from advancing to `completed`.
  assert.equal(
    store.saved.length,
    1,
    "tx1 saves the running transition; tx2 must NOT save a completed transition",
  );
  assert.equal(
    store.saved[0]?.status,
    "running",
    "the saved task is the tx1 running transition (not a terminal state)",
  );
  assert.equal(store.taskResults.length, 0, "no saveTaskResult on stale lease");
  // tx1 emits `task.started`; tx2 must NOT append a terminal event.
  assert.equal(feed.events.length, 1, "tx1's task.started is the only event");
  assert.equal(
    feed.events[0]?.type,
    "task.started",
    "the only event is the tx1 task.started; no terminal event from tx2",
  );
});

test("(013 S2) failed-branch guard: isLeaseCurrent toggles true→false → execute() rejects with StaleLeaseError, no writes", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new TogglingRecordingJobQueue(claimed);
  const store = new RecordingTaskStore(FENCE_TASK, INI_ID);
  const feed = new RecordingEventFeedOnly();
  const uow = new RecordingUnitOfWorkOnly();
  const resolver: AgentRunnerResolver = {
    for: () => scriptedRunner({ outcome: "failed", reason: "would fail" }),
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute(),
    (err: unknown) => err instanceof StaleLeaseError,
    "a failed-branch guard must reject the use case with StaleLeaseError",
  );

  assert.equal(queue.isLeaseCurrentCalls.length, 2);
  assert.equal(queue.finished.length, 0);
  assert.equal(store.saved.length, 1, "tx1 saves the running transition");
  assert.equal(store.saved[0]?.status, "running");
  assert.equal(store.taskResults.length, 0);
  assert.equal(feed.events.length, 1, "tx1's task.started is the only event");
  assert.equal(feed.events[0]?.type, "task.started");
});

test("(013 S2) escalated-branch guard: isLeaseCurrent toggles true→false → execute() rejects with StaleLeaseError, no writes", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new TogglingRecordingJobQueue(claimed);
  const store = new RecordingTaskStore(FENCE_TASK, INI_ID);
  const feed = new RecordingEventFeedOnly();
  const uow = new RecordingUnitOfWorkOnly();
  const resolver: AgentRunnerResolver = {
    for: () =>
      scriptedRunner({
        outcome: "escalated",
        reason: "would escalate",
        summary: "needs human",
        workspace: "/ws",
        branch: "kanthord/x",
        baseCommit: "BASE",
      }),
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute(),
    (err: unknown) => err instanceof StaleLeaseError,
    "an escalated-branch guard must reject the use case with StaleLeaseError",
  );

  assert.equal(queue.isLeaseCurrentCalls.length, 2);
  assert.equal(queue.finished.length, 0);
  assert.equal(store.saved.length, 1, "tx1 saves the running transition");
  assert.equal(store.saved[0]?.status, "running");
  assert.equal(store.taskResults.length, 0);
  assert.equal(feed.events.length, 1, "tx1's task.started is the only event");
  assert.equal(feed.events[0]?.type, "task.started");
});

test("(013 S2) candidate-branch guard: isLeaseCurrent toggles true→false → execute() rejects with StaleLeaseError, no writes", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new TogglingRecordingJobQueue(claimed);
  const store = new RecordingTaskStore(FENCE_TASK, INI_ID);
  const feed = new RecordingEventFeedOnly();
  const uow = new RecordingUnitOfWorkOnly();
  const landing = new FakeLanding();
  const resolver: AgentRunnerResolver = {
    for: () =>
      scriptedRunner({
        outcome: "candidate",
        workspace: "/ws",
        branch: "kanthord/c",
        baseCommit: "BASE",
        candidateCommit: "CAND",
        summary: "would propose",
      }),
  };

  const uc = new RunNextTask(queue, store, feed, uow, resolver, landing);
  await assert.rejects(
    () => uc.execute(),
    (err: unknown) => err instanceof StaleLeaseError,
    "a candidate-branch guard must reject the use case with StaleLeaseError",
  );

  assert.equal(queue.isLeaseCurrentCalls.length, 2);
  assert.equal(queue.finished.length, 0);
  assert.equal(store.saved.length, 1, "tx1 saves the running transition");
  assert.equal(store.saved[0]?.status, "running");
  assert.equal(store.taskResults.length, 0);
  assert.equal(feed.events.length, 1, "tx1's task.started is the only event");
  assert.equal(feed.events[0]?.type, "task.started");
  assert.equal(landing.saved.length, 0, "no candidate saved on stale lease");
});
