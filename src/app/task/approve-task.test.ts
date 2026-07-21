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
import type { TaskResultRow, LandingRepository } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { WorkspaceManager, Workspace } from "../../workspace/port.ts";
import {
  newChangeCandidate,
  type ChangeCandidate,
  type CandidateState,
  type Integration,
} from "../../domain/landing.ts";
import { buildDeps } from "../../composition.ts";
import type {
  RepositoryLanding,
  LandingCandidate,
  LandingResult,
} from "../../landing/port.ts";
import { LandingConflictError } from "../../landing/port.ts";

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
  /** Returns the resolved task context: resource-type → resource-id. */
  getTaskContext(taskId: string): Record<string, string>;
}

class MemStore implements ApproveTaskStore {
  readonly savedTasks: Task[] = [];
  readonly savedResults: Array<{ taskId: string; row: TaskResultRow }> = [];
  readonly #tasks: Map<string, Task>;
  readonly #results: Map<string, TaskResultRow>;
  readonly #initiativeId: string;
  readonly #contexts: Map<string, Record<string, string>>;

  constructor(
    tasks: Task[],
    results: Map<string, TaskResultRow>,
    initiativeId: string,
    contexts: Map<string, Record<string, string>> = new Map(),
  ) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
    this.#results = new Map(results);
    this.#initiativeId = initiativeId;
    this.#contexts = contexts;
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

  getTaskContext(taskId: string): Record<string, string> {
    return this.#contexts.get(taskId) ?? {};
  }
}

// ---------------------------------------------------------------------------
// FakeLanding — Story 11 T5
// ---------------------------------------------------------------------------

class FakeLanding implements RepositoryLanding {
  readonly calls: Array<{ homeDir: string; candidate: LandingCandidate }> = [];
  readonly #result: LandingResult;
  readonly #throw: Error | undefined;

  constructor(result: LandingResult, throwErr?: Error) {
    this.#result = result;
    this.#throw = throwErr;
  }

  async land(
    homeDir: string,
    candidate: LandingCandidate,
  ): Promise<LandingResult> {
    this.calls.push({ homeDir, candidate });
    if (this.#throw !== undefined) throw this.#throw;
    return this.#result;
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

// ---------------------------------------------------------------------------
// Story 11 T5 — RepositoryLanding integration
// ---------------------------------------------------------------------------

const T5_REPO_ID = "repo-t5-001";
const T5_BASE_SHA = "base000000000000000000000000000000000000";
const T5_CANDIDATE_SHA = "cand111111111111111111111111111111111111";
const T5_CANONICAL_SHA = T5_CANDIDATE_SHA; // fast-forward: canonical === candidate
const FAKE_HOME_DIR = "/fake/home/repo-t5-001";

function makeT5Result(proposalCommit: string): TaskResultRow {
  return {
    workspace: "/fake/ws",
    branch: "kanthord/t5-task",
    baseCommit: T5_BASE_SHA,
    proposalCommit,
    commitSha: null,
    summary: "T5 task summary",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };
}

const FAST_FORWARD_RESULT: LandingResult = {
  candidate: {
    id: "lc-t5-ff",
    taskId: "t5-task",
    repoId: T5_REPO_ID,
    baseSHA: T5_BASE_SHA,
    candidateSHA: T5_CANDIDATE_SHA,
    ref: "kanthord/t5-task",
    target: "main",
    workspace: "/fake/ws",
  },
  outcome: { kind: "fast-forward" },
  canonicalSHA: T5_CANONICAL_SHA,
};

test("(T5-a) ApproveTask with repository context binding calls landing.land with baseSHA from task_results and candidateSHA from proposalCommit", async () => {
  const taskId = "t5-task-a";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "t5 task a",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeT5Result(T5_CANDIDATE_SHA);

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: T5_REPO_ID }]]),
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const fakeLanding = new FakeLanding(FAST_FORWARD_RESULT);

  const uc = new ApproveTask(store, queue, feed, uow, noopPromote, fakeLanding);
  await uc.execute({ taskId });

  assert.equal(
    fakeLanding.calls.length,
    1,
    "landing.land must be called once for a task with repository context binding",
  );
  const call = fakeLanding.calls[0]!;
  assert.equal(
    call.candidate.baseSHA,
    T5_BASE_SHA,
    "candidate.baseSHA must match task_results.baseCommit",
  );
  assert.equal(
    call.candidate.candidateSHA,
    T5_CANDIDATE_SHA,
    "candidate.candidateSHA must match task_results.proposalCommit",
  );
});

test("(T5-b) after fast-forward land, task_results.base_commit is set to canonicalSHA", async () => {
  const taskId = "t5-task-b";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "t5 task b",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeT5Result(T5_CANDIDATE_SHA);

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: T5_REPO_ID }]]),
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const fakeLanding = new FakeLanding(FAST_FORWARD_RESULT);

  const uc = new ApproveTask(store, queue, feed, uow, noopPromote, fakeLanding);
  await uc.execute({ taskId });

  const savedResult = store.savedResults.find((r) => r.taskId === taskId);
  assert.ok(savedResult !== undefined, "saveTaskResult must have been called");
  assert.ok(
    savedResult.row.baseCommit !== null,
    "task_results.base_commit must not be null after fast-forward land (A7)",
  );
  assert.equal(
    savedResult.row.baseCommit,
    T5_CANONICAL_SHA,
    "task_results.base_commit must equal the canonicalSHA from the landing result",
  );
});

test("(T5-c) LandingConflictError from landing emits task.conflict event, task stays awaiting_confirmation, execute resolves without throw", async () => {
  const taskId = "t5-task-c";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "t5 task c",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeT5Result(T5_CANDIDATE_SHA);
  const fakeCandidate: LandingCandidate = {
    id: "lc-t5-conflict",
    taskId,
    repoId: T5_REPO_ID,
    baseSHA: T5_BASE_SHA,
    candidateSHA: T5_CANDIDATE_SHA,
    ref: "kanthord/t5-task-c",
    target: "main",
    workspace: "/fake/ws",
  };
  const conflictErr = new LandingConflictError(fakeCandidate, ["file.ts"]);
  // FakeLanding result is unused (throws instead)
  const fakeLanding = new FakeLanding(FAST_FORWARD_RESULT, conflictErr);

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: T5_REPO_ID }]]),
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  const uc = new ApproveTask(store, queue, feed, uow, noopPromote, fakeLanding);
  // Must NOT throw
  await uc.execute({ taskId });

  // task.conflict event must have been emitted
  const conflictEvents = feed.events.filter((e) => e.type === "task.conflict");
  assert.equal(
    conflictEvents.length,
    1,
    "one task.conflict event must be emitted on landing conflict",
  );

  // task must NOT have been saved as completed
  const completedSaves = store.savedTasks.filter(
    (t) => t.status === "completed",
  );
  assert.equal(
    completedSaves.length,
    0,
    "task must NOT be transitioned to completed when landing conflicts",
  );

  // task must still be awaiting_confirmation
  const stillAwaiting = store.savedTasks.filter(
    (t) => t.status === "awaiting_confirmation",
  );
  // NOTE: the task may not be saved at all (stays in awaiting_confirmation without a save),
  // or it may be saved as awaiting_confirmation — both are acceptable; what's NOT acceptable
  // is saving it as completed.
  assert.equal(
    completedSaves.length,
    0,
    "no completed transition on conflict (double-check)",
  );
});

test("(T5-d) task with no repository context binding skips landing and completes normally", async () => {
  const taskId = "t5-task-d";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "t5 task d — filesystem source",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeT5Result(T5_CANDIDATE_SHA);

  // context has no "repository" key → filesystem-sourced task
  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { filesystem: "fs-resource-id" }]]),
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const fakeLanding = new FakeLanding(FAST_FORWARD_RESULT);

  const uc = new ApproveTask(store, queue, feed, uow, noopPromote, fakeLanding);
  await uc.execute({ taskId });

  assert.equal(
    fakeLanding.calls.length,
    0,
    "landing.land must NOT be called for a task with no repository context binding",
  );

  // task must still complete normally
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "completed",
    "task without repository binding must still complete",
  );
});

// ---------------------------------------------------------------------------
// Story 05 T3 — correct ApproveTask landing
// (a) repository-bound: load persisted candidate (ULID id, configured target),
//     land via homeDir(repoId), record base_commit = canonicalSHA (A7)
// (b) filesystem-bound: never query the candidate store, never call landing
// (c) wiring: the real ApproveTask from buildDeps has a RepositoryLanding injected
// These fail today: ApproveTask hardcodes id `${taskId}-lc`, target "main",
// homeDir = result.workspace, has no LandingRepository/WorkspaceManager deps,
// and is constructed in composition WITHOUT a RepositoryLanding.
// ---------------------------------------------------------------------------

const T3_REPO_ID = "repo-t3-001";
const T3_STORED_ULID = "01J" + "Z".repeat(23); // 26-char ULID-shaped id
const T3_RELEASE = "release"; // repository's configured (non-main) branch
const T3_BASE_SHA = "base000000000000000000000000000000000000";
const T3_CANDIDATE_SHA = "cand222222222222222222222222222222222222";
const T3_HOME_DIR = `/fake/home/${T3_REPO_ID}`;

class FakeLandingRepository implements LandingRepository {
  getCandidateByTaskCallCount = 0;
  #candidate: ChangeCandidate | undefined;
  constructor(candidate: ChangeCandidate | undefined) {
    this.#candidate = candidate;
  }
  saveCandidate(_c: ChangeCandidate): void {}
  getCandidate(_id: string): ChangeCandidate | undefined {
    return undefined;
  }
  getCandidateByTask(_taskId: string): ChangeCandidate | undefined {
    this.getCandidateByTaskCallCount++;
    return this.#candidate;
  }
  updateCandidateState(_id: string, _state: CandidateState): void {}
  saveIntegration(_i: Integration): void {}
  getIntegration(_id: string): Integration | undefined {
    return undefined;
  }
}

class FakeWorkspaceManager implements WorkspaceManager {
  #homePath: string;
  constructor(homePath: string) {
    this.#homePath = homePath;
  }
  async prepare(_taskId: string, _source: unknown): Promise<Workspace> {
    return { dir: "/tmp/ws", branch: "main", baseCommit: "x" };
  }
  homeDir(_repoId: string): string {
    return this.#homePath;
  }
}

function makeT3Result(proposalCommit: string): TaskResultRow {
  return {
    workspace: "/fake/ws", // OLD code wrongly used this as homeDir
    branch: "kanthord/t3-task",
    baseCommit: T3_BASE_SHA,
    proposalCommit,
    commitSha: null,
    summary: "T3 task summary",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };
}

const T3_FF_RESULT: LandingResult = {
  candidate: {
    id: T3_STORED_ULID,
    taskId: "t3-task",
    repoId: T3_REPO_ID,
    baseSHA: T3_BASE_SHA,
    candidateSHA: T3_CANDIDATE_SHA,
    ref: "kanthord/t3-task",
    target: T3_RELEASE,
    workspace: T3_HOME_DIR,
  },
  outcome: { kind: "fast-forward" },
  canonicalSHA: T3_CANDIDATE_SHA,
};

test("(T3-a) repository-bound approve loads the persisted candidate (ULID id, configured target) and lands via homeDir(repoId); base_commit = canonicalSHA", async () => {
  const taskId = "t3-task-a";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "t3 task a",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeT3Result(T3_CANDIDATE_SHA);
  const storedCandidate = newChangeCandidate({
    id: T3_STORED_ULID,
    taskId,
    repoId: T3_REPO_ID,
    baseSHA: T3_BASE_SHA,
    candidateSHA: T3_CANDIDATE_SHA,
    ref: "kanthord/t3-task",
    target: T3_RELEASE,
  });

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: T3_REPO_ID }]]),
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const fakeLanding = new FakeLanding(T3_FF_RESULT);
  const fakeLandingRepo = new FakeLandingRepository(storedCandidate);
  const fakeWorkspace = new FakeWorkspaceManager(T3_HOME_DIR);

  const uc = new ApproveTask(
    store,
    queue,
    feed,
    uow,
    noopPromote,
    fakeLanding,
    fakeLandingRepo,
    fakeWorkspace,
  );
  await uc.execute({ taskId });

  assert.equal(
    fakeLanding.calls.length,
    1,
    "landing.land must be called exactly once for a repository-bound task",
  );
  const call = fakeLanding.calls[0]!;
  assert.equal(
    call.candidate.id,
    T3_STORED_ULID,
    "landed candidate id must be the persisted ULID, NOT `${taskId}-lc`",
  );
  assert.equal(
    call.candidate.target,
    T3_RELEASE,
    "landed candidate target must be the configured branch, NOT hardcoded 'main'",
  );
  assert.equal(
    call.homeDir,
    T3_HOME_DIR,
    "landing homeDir must come from homeDir(repoId), NOT result.workspace",
  );

  const savedResult = store.savedResults.find((r) => r.taskId === taskId);
  assert.ok(savedResult !== undefined, "saveTaskResult must have been called");
  assert.equal(
    savedResult.row.baseCommit,
    T3_CANDIDATE_SHA,
    "task_results.base_commit (A7) must equal the landing canonicalSHA",
  );
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "completed",
    "task must complete after a successful land",
  );
});

test("(T3-b) filesystem-bound approve does NOT query the candidate store and does NOT call landing", async () => {
  const taskId = "t3-task-b";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "t3 task b — filesystem source",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeT3Result(T3_CANDIDATE_SHA);
  // A candidate EXISTS in the store, but the task is filesystem-bound, so it
  // must be ignored — this proves the repository-binding gate, not just an
  // absent row.
  const storedCandidate = newChangeCandidate({
    id: T3_STORED_ULID,
    taskId,
    repoId: T3_REPO_ID,
    baseSHA: T3_BASE_SHA,
    candidateSHA: T3_CANDIDATE_SHA,
    ref: "kanthord/t3-task-b",
    target: T3_RELEASE,
  });

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { filesystem: "fs-resource-id" }]]),
  );
  const queue = new MemQueue();
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const fakeLanding = new FakeLanding(T3_FF_RESULT);
  const fakeLandingRepo = new FakeLandingRepository(storedCandidate);
  const fakeWorkspace = new FakeWorkspaceManager(T3_HOME_DIR);

  const uc = new ApproveTask(
    store,
    queue,
    feed,
    uow,
    noopPromote,
    fakeLanding,
    fakeLandingRepo,
    fakeWorkspace,
  );
  await uc.execute({ taskId });

  assert.equal(
    fakeLandingRepo.getCandidateByTaskCallCount,
    0,
    "filesystem-bound approve must NOT query the candidate store",
  );
  assert.equal(
    fakeLanding.calls.length,
    0,
    "landing.land must NOT be called for a filesystem-bound task",
  );
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "completed",
    "filesystem-bound task still completes without landing",
  );
});

test("(T3-c) architecture/wiring: the real ApproveTask from buildDeps is constructed WITH a RepositoryLanding injected", () => {
  const dbPath = join(tmpdir(), `kanthord-t3-wire-${Date.now()}.db`);
  const deps = buildDeps(dbPath);
  assert.ok(
    deps.approveTask.landing !== undefined,
    "buildDeps().approveTask must have a RepositoryLanding injected (landing must not be undefined)",
  );
});
