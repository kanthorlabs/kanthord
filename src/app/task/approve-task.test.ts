/**
 * Story 07 T2 — ApproveTask use case
 *
 * Tests (a), (b), (c), (d), (j) from Story 07 AC.
 * Tests (a), (b), (d) use a real on-disk git workspace.
 * Tests (c), (j) use in-memory fakes only.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

import {
  ApproveTask,
  TaskNotAwaitingConfirmationError,
  ProposalMissingError,
} from "./approve-task.ts";
import { ProposalWorkspaceMissingError } from "../errors.ts";
import type { Task } from "../../domain/task.ts";
import type { TaskResultRow } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const execFile = promisify(execFileCb);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Real git fixture (shared by tests a, b, d)
// ---------------------------------------------------------------------------

let tmpRoot = "";
let seedCommit = "";
let proposalCommit = "";
const GIT_TASK_ID = "approve-git-t001";
const TASK_BRANCH = `kanthord/${GIT_TASK_ID}`;
const PROPOSAL_BRANCH = `kanthord/proposal/${GIT_TASK_ID}`;

before(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "kanthord-approve-"));
  await execFile("git", ["init", "-b", "main"], { cwd: tmpRoot });
  await execFile("git", ["config", "user.email", "test@localhost"], {
    cwd: tmpRoot,
  });
  await execFile("git", ["config", "user.name", "Test"], { cwd: tmpRoot });
  await writeFile(join(tmpRoot, "README.md"), "# seed");
  await execFile("git", ["add", "."], { cwd: tmpRoot });
  await execFile("git", ["commit", "-m", "initial"], { cwd: tmpRoot });
  seedCommit = await git(tmpRoot, "rev-parse", "HEAD");

  // Task branch at seedCommit
  await execFile("git", ["branch", TASK_BRANCH, seedCommit], { cwd: tmpRoot });

  // Create a proposal commit (agent change)
  await writeFile(join(tmpRoot, "agent-change.txt"), "agent added this");
  await execFile("git", ["add", "."], { cwd: tmpRoot });
  await execFile("git", ["commit", "-m", "kanthord: agent change"], {
    cwd: tmpRoot,
  });
  proposalCommit = await git(tmpRoot, "rev-parse", "HEAD");

  // Proposal branch at proposalCommit
  await execFile("git", ["branch", PROPOSAL_BRANCH, proposalCommit], {
    cwd: tmpRoot,
  });

  // Reset main back to seedCommit (task branch should still be at seedCommit)
  await execFile("git", ["reset", "--hard", seedCommit], { cwd: tmpRoot });
});

after(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

interface ApproveTaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
  getTaskResult(taskId: string): TaskResultRow | undefined;
  saveTaskResult(taskId: string, row: TaskResultRow): void;
  listByInitiative(initiativeId: string): Task[];
  getInitiativeId(taskId: string): string | undefined;
}

class MemStore implements ApproveTaskStore {
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

// Promote via real git: `git branch -f kanthord/<taskId> <proposalCommit>`
async function realPromote(
  dir: string,
  taskId: string,
  pc: string,
): Promise<void> {
  await execFile("git", ["branch", "-f", `kanthord/${taskId}`, pc], {
    cwd: dir,
  });
}

// Fixture ids
const INI_ID = "01JZZZZZZZZZZZZZZZZZZZINIAP";
const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJAN";
const CHILD_ID = "01JZZZZZZZZZZZZZZZZZZZCHILD";

// ---------------------------------------------------------------------------
// (a) happy path — real git
// ---------------------------------------------------------------------------

test("(a) approve task: kanthord/<id> points at proposal, result commit_sha set, task completed, events, dependent enqueued", async () => {
  const taskId = GIT_TASK_ID;
  const parentTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "agent task",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const childTask: Task = {
    id: CHILD_ID,
    objectiveId: OBJ_ID,
    title: "child task",
    status: "pending",
    dependencies: [taskId],
  };
  const existingResult: TaskResultRow = {
    workspace: tmpRoot,
    branch: TASK_BRANCH,
    baseCommit: seedCommit,
    proposalCommit,
    commitSha: null,
    summary: "added agent-change.txt",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };

  const store = new MemStore(
    [parentTask, childTask],
    new Map([[taskId, existingResult]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();

  const uc = new ApproveTask(store, queue, feed, uow, realPromote);
  await uc.execute({ taskId });

  // task branch must point at proposalCommit after promotion
  const newHead = await git(tmpRoot, "rev-parse", TASK_BRANCH);
  assert.equal(
    newHead,
    proposalCommit,
    `kanthord/${taskId} must point to proposalCommit after approve`,
  );

  // task status = completed
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(last.status, "completed", "task status must be completed");

  // result row commit_sha = proposalCommit
  assert.ok(store.savedResults.length > 0, "saveTaskResult must be called");
  assert.equal(
    store.savedResults[store.savedResults.length - 1]!.row.commitSha,
    proposalCommit,
    "result commit_sha must equal proposalCommit",
  );

  // task.approved event
  const approvedEvents = feed.events.filter((e) => e.type === "task.approved");
  assert.equal(approvedEvents.length, 1, "one task.approved event");

  // task.completed event
  const completedEvents = feed.events.filter(
    (e) => e.type === "task.completed",
  );
  assert.equal(completedEvents.length, 1, "one task.completed event");

  // child task enqueued (its dependency is now completed → ready)
  assert.ok(
    queue.enqueued.includes(CHILD_ID),
    `child task must be enqueued; enqueued: ${JSON.stringify(queue.enqueued)}`,
  );
});

// ---------------------------------------------------------------------------
// (b) re-approve → idempotent no-op
// ---------------------------------------------------------------------------

test("(b) re-approve already-completed task with commit_sha=proposalCommit → no-op success", async () => {
  const taskId = GIT_TASK_ID;
  const alreadyCompleted: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "agent task",
    status: "completed",
    dependencies: [],
  };
  const completedResult: TaskResultRow = {
    workspace: tmpRoot,
    branch: TASK_BRANCH,
    baseCommit: seedCommit,
    proposalCommit,
    commitSha: proposalCommit, // already approved
    summary: "done",
    reason: null,
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };

  const store = new MemStore(
    [alreadyCompleted],
    new Map([[taskId, completedResult]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  let promoteCallCount = 0;
  const noop = async (_d: string, _t: string, _p: string) => {
    promoteCallCount++;
  };

  const uc = new ApproveTask(store, queue, feed, uow, noop);
  // Must not throw
  await uc.execute({ taskId });

  assert.equal(promoteCallCount, 0, "promote must not be called on re-approve");
  assert.equal(
    store.savedTasks.length,
    0,
    "no task save on idempotent re-approve",
  );
  assert.equal(feed.events.length, 0, "no events on idempotent re-approve");
});

// ---------------------------------------------------------------------------
// (c) approve on pending → TaskNotAwaitingConfirmationError
// ---------------------------------------------------------------------------

test("(c) approve on pending task → TaskNotAwaitingConfirmationError", async () => {
  const taskId = "01JZZZZZZZZZZZZZZZZZZZPEND1";
  const pendingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "pending task",
    status: "pending",
    dependencies: [],
  };

  const store = new MemStore([pendingTask], new Map(), INI_ID);
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noop = async (_d: string, _t: string, _p: string) => {};

  const uc = new ApproveTask(store, queue, feed, uow, noop);
  await assert.rejects(
    () => uc.execute({ taskId }),
    (err: unknown) => {
      assert.ok(
        err instanceof TaskNotAwaitingConfirmationError,
        `must be TaskNotAwaitingConfirmationError; got: ${(err as Error).constructor.name}`,
      );
      assert.equal(
        (err as TaskNotAwaitingConfirmationError).taskId,
        taskId,
        "err.taskId must match",
      );
      assert.equal(
        (err as TaskNotAwaitingConfirmationError).status,
        "pending",
        "err.status must be the current status",
      );
      return true;
    },
    "approve on pending must throw TaskNotAwaitingConfirmationError",
  );
});

// ---------------------------------------------------------------------------
// (d) deleted / non-existent proposal ref → ProposalMissingError
// ---------------------------------------------------------------------------

test("(d) deleted proposal branch → ProposalMissingError, task stays awaiting_confirmation", async () => {
  // Use a separate temp workspace for isolation
  const wsDir = await mkdtemp(join(tmpdir(), "kanthord-approve-d-"));
  try {
    await execFile("git", ["init", "-b", "main"], { cwd: wsDir });
    await execFile("git", ["config", "user.email", "test@localhost"], {
      cwd: wsDir,
    });
    await execFile("git", ["config", "user.name", "Test"], { cwd: wsDir });
    await writeFile(join(wsDir, "README.md"), "# init");
    await execFile("git", ["add", "."], { cwd: wsDir });
    await execFile("git", ["commit", "-m", "init"], { cwd: wsDir });
    const seedSha = await git(wsDir, "rev-parse", "HEAD");

    // fakePropCommit does NOT exist in the repo
    const fakePropCommit = "0000000000000000000000000000000000000001";
    const taskId = "deleted-prop-task-001";

    const awaitingTask: Task = {
      id: taskId,
      objectiveId: OBJ_ID,
      title: "awaiting task",
      status: "awaiting_confirmation",
      dependencies: [],
    };
    const resultRow: TaskResultRow = {
      workspace: wsDir,
      branch: `kanthord/${taskId}`,
      baseCommit: seedSha,
      proposalCommit: fakePropCommit,
      commitSha: null,
      summary: "agent change",
      reason: "needs review",
      rejectionResolution: null,
      rejectionReason: null,
      evidence: null,
    };

    const store = new MemStore(
      [awaitingTask],
      new Map([[taskId, resultRow]]),
      INI_ID,
    );
    const queue = new MemQueue();
    const feed = new MemFeed();
    const uow = new MemUow();

    const uc = new ApproveTask(store, queue, feed, uow, realPromote);
    await assert.rejects(
      () => uc.execute({ taskId }),
      (err: unknown) => {
        assert.ok(
          err instanceof ProposalMissingError,
          `must throw ProposalMissingError; got: ${(err as Error).constructor.name}`,
        );
        return true;
      },
      "non-existent proposalCommit must throw ProposalMissingError",
    );

    // Task must NOT have been transitioned to completed
    const completedSaves = store.savedTasks.filter(
      (t) => t.status === "completed",
    );
    assert.equal(
      completedSaves.length,
      0,
      "task must not be saved as completed when proposal is missing",
    );
  } finally {
    await rm(wsDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (j) NULL-proposal approval → completed, commit_sha null, no promotion
// ---------------------------------------------------------------------------

test("(j) NULL-proposal escalation approval → completed, no commit_sha, no promotion", async () => {
  const taskId = "01JZZZZZZZZZZZZZZZZZZZNOPRP";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "clarification task",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const resultRow: TaskResultRow = {
    workspace: "/tmp/some-ws",
    branch: `kanthord/${taskId}`,
    baseCommit: "abc123",
    proposalCommit: null, // no-change escalation
    commitSha: null,
    summary: "asked a clarification question",
    reason: "clarification needed",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, resultRow]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  let promoteCallCount = 0;
  const noop = async (_d: string, _t: string, _p: string) => {
    promoteCallCount++;
  };

  const uc = new ApproveTask(store, queue, feed, uow, noop);
  await uc.execute({ taskId });

  assert.equal(
    promoteCallCount,
    0,
    "promote must not be called for NULL-proposal escalation",
  );

  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(last.status, "completed", "task must be completed");

  assert.ok(store.savedResults.length > 0, "saveTaskResult must be called");
  const savedRow = store.savedResults[store.savedResults.length - 1]!.row;
  assert.equal(
    savedRow.commitSha,
    null,
    "commit_sha must remain null for NULL-proposal approval",
  );
});

// ---------------------------------------------------------------------------
// (S2 regression) proposalCommit set but workspace null → explicit DB-integrity error
// ---------------------------------------------------------------------------

test("(S2 regression) escalated task with proposalCommit set but workspace null throws a clear DB-integrity error naming the task", async () => {
  const taskId = "01JZZZZZZZZZZZZZZZZZZZS2REG";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "escalated task",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const resultRow: TaskResultRow = {
    workspace: null, // DB has no workspace path
    branch: `kanthord/${taskId}`,
    baseCommit: "abc123",
    proposalCommit: "def456", // proposalCommit IS set
    commitSha: null,
    summary: "agent escalated",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, resultRow]]),
    INI_ID,
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  let promoteCallCount = 0;
  const noop = async (_d: string, _t: string, _p: string) => {
    promoteCallCount++;
  };

  const uc = new ApproveTask(store, queue, feed, uow, noop);
  await assert.rejects(
    () => uc.execute({ taskId }),
    (err: unknown) => {
      assert.ok(
        !(err instanceof ProposalMissingError),
        `must NOT be ProposalMissingError; got: ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
      assert.ok(
        err instanceof ProposalWorkspaceMissingError,
        `must be ProposalWorkspaceMissingError; got: ${(err as Error).constructor.name}: ${(err as Error).message}`,
      );
      assert.ok(
        (err as Error).message.includes(taskId),
        `error message must name the task; got: ${(err as Error).message}`,
      );
      return true;
    },
    "workspace=null + proposalCommit set must throw a clear DB-integrity error naming the task",
  );

  assert.equal(
    promoteCallCount,
    0,
    "promote must NOT be called when workspace is null",
  );
});
