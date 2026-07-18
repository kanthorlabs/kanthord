/**
 * Story 07 T1 — tx2 escalated branch (RunNextTask side effects)
 *
 * Tests (a), (b), (d) — hermetic in-memory fakes, no real SQLite.
 *
 * (a) RunNextTask with escalated runner result → task awaiting_confirmation,
 *     job finished, task.escalated event with correct payload, task_results row
 *     written with commitSha null.
 * (b) Dependent stays pending and is not enqueued after parent escalates.
 * (d) After escalated tx2, RecoverInterruptedTasks finds no running job and
 *     leaves the task as awaiting_confirmation (crash-safe).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { RunNextTask } from "./run-next-task.ts";
import { RecoverInterruptedTasks } from "./recover-interrupted-tasks.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork, TaskResultRow } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";
import type {
  AgentRunner,
  AgentRunnerResolver,
  TaskContextBinding,
  TaskResult,
} from "../../agent-runner/port.ts";

// ---------------------------------------------------------------------------
// Narrow structural interface matching RunNextTask's internal TaskStore
// ---------------------------------------------------------------------------

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
  getTaskContext(taskId: string): Record<string, string>;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class SimpleTaskStore implements TaskStore {
  readonly saved: Task[] = [];
  readonly savedResults: Array<{ taskId: string; row: TaskResultRow }> = [];
  readonly #tasks: Map<string, Task>;
  readonly #initiativeId: string;

  constructor(tasks: Task[], initiativeId: string) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#initiativeId = initiativeId;
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

  getTaskContext(_taskId: string): Record<string, string> {
    return {};
  }

  saveTaskResult(taskId: string, row: TaskResultRow): void {
    this.savedResults.push({ taskId, row });
  }
}

/**
 * Smart queue: claim() marks the job as running; finish()/discard() removes it.
 * listRunningJobs() reflects live state — used by RecoverInterruptedTasks.
 */
class SmartJobQueue implements JobQueue {
  readonly finished: Array<{
    jobId: string;
    outcome: "completed" | "failed";
  }> = [];
  readonly discarded: string[] = [];
  readonly enqueued: string[] = [];
  readonly #running: Map<string, ClaimedJob> = new Map();
  #nextClaim: ClaimedJob | undefined;

  constructor(nextClaim: ClaimedJob | undefined) {
    this.#nextClaim = nextClaim;
  }

  claim(): ClaimedJob | undefined {
    const c = this.#nextClaim;
    this.#nextClaim = undefined;
    if (c !== undefined) this.#running.set(c.id, c);
    return c;
  }

  finish(jobId: string, outcome: "completed" | "failed"): void {
    this.finished.push({ jobId, outcome });
    this.#running.delete(jobId);
  }

  discard(jobId: string): void {
    this.discarded.push(jobId);
    this.#running.delete(jobId);
  }

  enqueue(taskId: string): boolean {
    this.enqueued.push(taskId);
    return true;
  }

  listRunningJobs(): ClaimedJob[] {
    return [...this.#running.values()];
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
  transaction<T>(fn: () => T): T {
    return fn();
  }
}

/** Runner that returns an escalated result with all required fields. */
class EscalatedRunner implements AgentRunner {
  async run(_task: Task, _context: TaskContextBinding[]): Promise<TaskResult> {
    return {
      outcome: "escalated",
      reason: "needs human review",
      summary: "I made a change but want review",
      workspace: "/tmp/workspace/task-a",
      branch: "kanthord/task-a",
      baseCommit: "abc123",
      proposalCommit: "def456",
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INI_ID = "01JZZZZZZZZZZZZZZZZZZZINI1";
const JOB_ID = "01JZZZZZZZZZZZZZZZZZZZJOB1";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ1";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTSK1";
const CHILD_ID = "01JZZZZZZZZZZZZZZZZZZZTSK2";

const TASK_PARENT: Task = {
  id: TASK_ID,
  objectiveId: OBJ_ID,
  title: "parent task",
  status: "pending",
  dependencies: [],
};

const TASK_CHILD: Task = {
  id: CHILD_ID,
  objectiveId: OBJ_ID,
  title: "child task",
  status: "pending",
  dependencies: [TASK_ID],
};

// ---------------------------------------------------------------------------
// (a) tx2 escalated branch: awaiting_confirmation status, event, result row
// ---------------------------------------------------------------------------

test("(a) RunNextTask tx2 escalated: awaiting_confirmation, task.escalated event, result row commitSha null", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new SmartJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_PARENT }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver: AgentRunnerResolver = { for: () => new EscalatedRunner() };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await uc.execute();

  // Task must be awaiting_confirmation (not failed or completed)
  const lastSaved = store.saved[store.saved.length - 1];
  assert.ok(lastSaved !== undefined, "task must have been saved");
  assert.equal(
    lastSaved.status,
    "awaiting_confirmation",
    `task must be awaiting_confirmation after escalated result; got: ${lastSaved.status}`,
  );

  // Job must be finished (escalation finishes the job, not leaves it running)
  assert.equal(queue.finished.length, 1, "job must be finished exactly once");

  // task.escalated event must be emitted with the correct payload
  const escalatedEvents = feed.events.filter(
    (e) => e.type === "task.escalated",
  );
  assert.equal(escalatedEvents.length, 1, "exactly one task.escalated event");
  const ev = escalatedEvents[0]!;
  assert.equal(ev.taskId, TASK_ID, "event must name the correct task");
  assert.equal(
    ev.payload?.["reason"],
    "needs human review",
    "reason must be in event payload",
  );
  assert.equal(
    ev.payload?.["baseCommit"],
    "abc123",
    "baseCommit must be in event payload",
  );
  assert.equal(
    ev.payload?.["summary"],
    "I made a change but want review",
    "summary must be in event payload",
  );
  assert.equal(
    ev.payload?.["proposalCommit"],
    "def456",
    "proposalCommit must be in event payload",
  );

  // task_results row must be written with commitSha null
  assert.equal(
    store.savedResults.length,
    1,
    "saveTaskResult must be called exactly once",
  );
  const saved = store.savedResults[0];
  assert.ok(saved !== undefined, "saved result entry must exist");
  const row = saved.row;
  assert.equal(
    row.commitSha,
    null,
    "commitSha must be null for escalated result (not yet approved)",
  );
  assert.equal(row.workspace, "/tmp/workspace/task-a", "workspace saved");
  assert.equal(row.branch, "kanthord/task-a", "branch saved");
  assert.equal(row.baseCommit, "abc123", "baseCommit saved");
  assert.equal(row.proposalCommit, "def456", "proposalCommit saved");
  assert.equal(row.reason, "needs human review", "reason saved");
  assert.equal(row.summary, "I made a change but want review", "summary saved");
});

// ---------------------------------------------------------------------------
// (b) dependent stays pending, unenqueued (characterization)
//
// Note: today the parent is incorrectly set to `failed` (not `awaiting_confirmation`),
// so this test fails because `lastSaved.status === "failed"` is not
// `"awaiting_confirmation"`. After T1 GREEN, the parent will be correctly set
// to `awaiting_confirmation` and the child will not be enqueued.
// ---------------------------------------------------------------------------

test("(b) RunNextTask tx2 escalated: parent awaiting_confirmation, dependent stays pending and unenqueued", async () => {
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new SmartJobQueue(claimed);
  const store = new SimpleTaskStore(
    [{ ...TASK_PARENT }, { ...TASK_CHILD }],
    INI_ID,
  );
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver: AgentRunnerResolver = { for: () => new EscalatedRunner() };

  const uc = new RunNextTask(queue, store, feed, uow, resolver);
  await uc.execute();

  // Parent must be awaiting_confirmation (fails today — parent is failed)
  const lastSaved = store.saved[store.saved.length - 1];
  assert.ok(lastSaved !== undefined, "parent must have been saved");
  assert.equal(
    lastSaved.status,
    "awaiting_confirmation",
    `parent must be awaiting_confirmation; got: ${lastSaved.status}`,
  );

  // Child task must NOT be enqueued (escalated parent does not unblock dependents)
  assert.ok(
    !queue.enqueued.includes(CHILD_ID),
    `child must not be enqueued; enqueued: ${JSON.stringify(queue.enqueued)}`,
  );

  // No task.ready event for child
  const readyForChild = feed.events.filter(
    (e) => e.type === "task.ready" && e.taskId === CHILD_ID,
  );
  assert.equal(
    readyForChild.length,
    0,
    "no task.ready event for child after escalated parent",
  );
});

// ---------------------------------------------------------------------------
// (d) crash recovery: after escalated tx2, no running job remains
// ---------------------------------------------------------------------------

test("(d) after escalated tx2, RecoverInterruptedTasks does not reset task to pending", async () => {
  // Step 1: Run task through RunNextTask; runner escalates it.
  // tx2 must finish the job so no running job remains.
  const claimed: ClaimedJob = { id: JOB_ID, taskId: TASK_ID };
  const queue = new SmartJobQueue(claimed);
  const store = new SimpleTaskStore([{ ...TASK_PARENT }], INI_ID);
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver: AgentRunnerResolver = { for: () => new EscalatedRunner() };

  await new RunNextTask(queue, store, feed, uow, resolver).execute();

  // After tx2: job must be finished (not running) — proves crash safety
  const runningAfterTx2 = queue.listRunningJobs();
  assert.equal(
    runningAfterTx2.length,
    0,
    `no running jobs must remain after escalated tx2; still running: ${JSON.stringify(runningAfterTx2)}`,
  );

  // Step 2: Simulate daemon restart — RecoverInterruptedTasks should find
  // no running job and leave the task as awaiting_confirmation.
  const recoverUC = new RecoverInterruptedTasks(queue, store, feed, uow);
  const recovered = recoverUC.execute();

  assert.deepEqual(
    recovered,
    [],
    "nothing recovered — escalated task has no running job after tx2",
  );

  // Task must still be awaiting_confirmation (not reset to pending by recovery)
  const currentTask = store.saved[store.saved.length - 1];
  assert.ok(currentTask !== undefined, "task must have been saved");
  assert.equal(
    currentTask.status,
    "awaiting_confirmation",
    `task must remain awaiting_confirmation after recovery; got: ${currentTask.status}`,
  );
});
