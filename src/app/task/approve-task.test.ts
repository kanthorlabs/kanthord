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
  PreviewOutcome,
} from "../../landing/port.ts";
import {
  LandingConflictError,
  LandingCASMismatchError,
} from "../../landing/port.ts";

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
  readonly previewCalls: Array<{
    homeDir: string;
    candidate: LandingCandidate;
    targetOID: string;
  }> = [];
  readonly #result: LandingResult;
  readonly #throw: Error | undefined;
  readonly #previewOutcome: PreviewOutcome | undefined;

  constructor(
    result: LandingResult,
    throwErr?: Error,
    previewOutcome?: PreviewOutcome,
  ) {
    this.#result = result;
    this.#throw = throwErr;
    this.#previewOutcome = previewOutcome;
  }

  async land(
    homeDir: string,
    candidate: LandingCandidate,
  ): Promise<LandingResult> {
    this.calls.push({ homeDir, candidate });
    if (this.#throw !== undefined) throw this.#throw;
    return this.#result;
  }

  async preview(
    homeDir: string,
    candidate: LandingCandidate,
    targetOID: string,
  ): Promise<PreviewOutcome> {
    this.previewCalls.push({ homeDir, candidate, targetOID });
    if (this.#previewOutcome !== undefined) return this.#previewOutcome;
    return { kind: "fast-forward", candidateOID: candidate.candidateSHA };
  }

  async landPreviewed(
    _homeDir: string,
    _candidate: LandingCandidate,
    _previewOutcome: PreviewOutcome,
    _targetOID: string,
  ): Promise<LandingResult> {
    if (this.#throw !== undefined) throw this.#throw;
    return this.#result;
  }

  resolveTargetOID(_homeDir: string, _branch: string): string {
    return "0000000000000000000000000000000000000000";
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

// S3: a feed that throws when task.conflict is appended (simulates DB failure)
class ThrowingOnConflictFeed implements EventFeed {
  readonly events: Event[] = [];
  append(event: Event): void {
    if (event.type === "task.conflict") {
      throw new Error("DB constraint failed: CHECK events.type");
    }
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
    fakeLanding.previewCalls.length,
    1,
    "landing.preview must be called once for a task with repository context binding",
  );
  const call = fakeLanding.previewCalls[0]!;
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
  // Conflict detected via predict path: preview returns conflict, no land() call.
  const conflictPreviewOutcome: PreviewOutcome = {
    kind: "conflict",
    files: ["file.ts"],
    perFile: [
      {
        path: "file.ts",
        hunks: "<<<<<<< target\n=======\n>>>>>>> candidate",
      },
    ],
  };
  const fakeLanding = new FakeLanding(
    FAST_FORWARD_RESULT,
    undefined,
    conflictPreviewOutcome,
  );

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
    fakeLanding.previewCalls.length,
    1,
    "landing.preview must be called exactly once for a repository-bound task",
  );
  const call = fakeLanding.previewCalls[0]!;
  assert.equal(
    call.candidate.id,
    T3_STORED_ULID,
    "preview candidate id must be the persisted ULID, NOT `${taskId}-lc`",
  );
  assert.equal(
    call.candidate.target,
    T3_RELEASE,
    "preview candidate target must be the configured branch, NOT hardcoded 'main'",
  );
  assert.equal(
    call.homeDir,
    T3_HOME_DIR,
    "preview homeDir must come from homeDir(repoId), NOT result.workspace",
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

// ---------------------------------------------------------------------------
// Story S3 (007.4 F3) — discriminated approve outcomes
// ---------------------------------------------------------------------------

const S3_REPO_ID = "repo-s3-001";
const S3_BASE_SHA = "base333333333333333333333333333333333333";
const S3_CANDIDATE_SHA = "cand444444444444444444444444444444444444";
const S3_CANONICAL_SHA = S3_CANDIDATE_SHA; // fast-forward: canonical === candidate

function makeS3Result(): TaskResultRow {
  return {
    workspace: "/fake/ws",
    branch: "kanthord/s3-task",
    baseCommit: S3_BASE_SHA,
    proposalCommit: S3_CANDIDATE_SHA,
    commitSha: null,
    summary: "S3 task summary",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };
}

const S3_FF_RESULT: LandingResult = {
  candidate: {
    id: "lc-s3-ff",
    taskId: "s3-task",
    repoId: S3_REPO_ID,
    baseSHA: S3_BASE_SHA,
    candidateSHA: S3_CANDIDATE_SHA,
    ref: "kanthord/s3-task",
    target: "main",
    workspace: "/fake/ws",
  },
  outcome: { kind: "fast-forward" },
  canonicalSHA: S3_CANONICAL_SHA,
};

test("(S3-a) fast-forward landing returns { kind: 'approved', taskId, canonicalSHA }", async () => {
  const taskId = "s3-task-a";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "s3 task a",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeS3Result();
  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: S3_REPO_ID }]]),
  );
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const fakeLanding = new FakeLanding(S3_FF_RESULT);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    fakeLanding,
  );
  const outcome = (await uc.execute({ taskId })) as unknown;

  assert.equal(
    (outcome as { kind?: string } | undefined)?.kind,
    "approved",
    `execute() must return { kind: "approved" } discriminated outcome; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    (outcome as { taskId?: string } | undefined)?.taskId,
    taskId,
    "outcome.taskId must equal the approved task id",
  );
  assert.equal(
    (outcome as { canonicalSHA?: string } | undefined)?.canonicalSHA,
    S3_CANONICAL_SHA,
    "outcome.canonicalSHA must equal the landing result canonicalSHA",
  );
});

test("(S3-b) LandingConflictError returns { kind: 'conflict', taskId }; task stays awaiting_confirmation; task.conflict event recorded; no throw", async () => {
  const taskId = "s3-task-b";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "s3 task b",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeS3Result();
  // Conflict detected via predict path: preview returns conflict, no land() call.
  const conflictPreviewOutcome: PreviewOutcome = {
    kind: "conflict",
    files: ["src/main.ts"],
    perFile: [
      {
        path: "src/main.ts",
        hunks: "<<<<<<< target\n=======\n>>>>>>> candidate",
      },
    ],
  };
  const fakeLanding = new FakeLanding(
    S3_FF_RESULT,
    undefined,
    conflictPreviewOutcome,
  );

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: S3_REPO_ID }]]),
  );
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    fakeLanding,
  );

  let didThrow = false;
  let outcome: unknown;
  try {
    outcome = await uc.execute({ taskId });
  } catch (e) {
    didThrow = true;
    outcome = e;
  }

  assert.ok(
    !didThrow,
    `execute() must NOT throw on LandingConflictError; threw: ${outcome}`,
  );
  assert.equal(
    (outcome as { kind?: string } | undefined)?.kind,
    "conflict",
    `execute() must return { kind: "conflict" } discriminated outcome; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    (outcome as { taskId?: string } | undefined)?.taskId,
    taskId,
    "outcome.taskId must match the conflicting task",
  );

  // task.conflict event must have been recorded before returning the conflict outcome
  const conflictEvents = feed.events.filter((e) => e.type === "task.conflict");
  assert.equal(
    conflictEvents.length,
    1,
    "one task.conflict event must be recorded when returning conflict outcome",
  );

  // task must NOT have transitioned to completed
  assert.equal(
    store.savedTasks.filter((t) => t.status === "completed").length,
    0,
    "task must NOT be completed on conflict — must stay awaiting_confirmation",
  );
});

test("(S3-c) feed.append failure on task.conflict returns { kind: 'landing_failed' }, NOT approved, NOT a throw", async () => {
  const taskId = "s3-task-c";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "s3 task c",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeS3Result();
  const fakeCandidate: LandingCandidate = {
    id: "lc-s3-conflict-c",
    taskId,
    repoId: S3_REPO_ID,
    baseSHA: S3_BASE_SHA,
    candidateSHA: S3_CANDIDATE_SHA,
    ref: "kanthord/s3-task-c",
    target: "main",
    workspace: "/fake/ws",
  };
  const conflictErr = new LandingConflictError(fakeCandidate, ["src/main.ts"]);
  const fakeLanding = new FakeLanding(S3_FF_RESULT, conflictErr);

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: S3_REPO_ID }]]),
  );
  // ThrowingOnConflictFeed: throws when task.conflict event is appended
  const throwingFeed = new ThrowingOnConflictFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    throwingFeed,
    uow,
    noopPromote,
    fakeLanding,
  );

  let didThrow = false;
  let outcome: unknown;
  try {
    outcome = await uc.execute({ taskId });
  } catch (e) {
    didThrow = true;
    outcome = e;
  }

  assert.ok(
    !didThrow,
    `execute() must NOT throw when feed.append fails during conflict recording; threw: ${outcome}`,
  );
  assert.equal(
    (outcome as { kind?: string } | undefined)?.kind,
    "landing_failed",
    `feed.append failure on conflict must yield landing_failed, NOT approved; got: ${JSON.stringify(outcome)}`,
  );
});

test("(S3-d) generic landing error returns { kind: 'landing_failed', taskId, message, cause }; no throw", async () => {
  const taskId = "s3-task-d";
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "s3 task d",
    status: "awaiting_confirmation",
    dependencies: [],
  };
  const result = makeS3Result();
  const genericErr = new Error(
    "git fetch failed: Connection refused to git@github.com",
  );
  // FakeLanding throws a generic (non-LandingConflictError) error
  const fakeLanding = new FakeLanding(S3_FF_RESULT, genericErr);

  const store = new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: S3_REPO_ID }]]),
  );
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    fakeLanding,
  );

  let didThrow = false;
  let outcome: unknown;
  try {
    outcome = await uc.execute({ taskId });
  } catch (e) {
    didThrow = true;
    outcome = e;
  }

  assert.ok(
    !didThrow,
    `execute() must NOT throw on generic landing error (current behavior: throws); threw: ${outcome}`,
  );
  assert.equal(
    (outcome as { kind?: string } | undefined)?.kind,
    "landing_failed",
    `generic landing error must yield { kind: "landing_failed" }; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    typeof (outcome as { message?: unknown } | undefined)?.message,
    "string",
    "outcome.message must be a safe string for the user",
  );
  assert.ok(
    (outcome as { cause?: unknown } | undefined)?.cause === genericErr,
    "outcome.cause must be the original error retained for structured logging",
  );
  assert.equal(
    store.savedTasks.filter((t) => t.status === "completed").length,
    0,
    "task must NOT be saved as completed on generic landing failure",
  );
});

// ---------------------------------------------------------------------------
// S4 (007.6) — predict-before-mutate + land-the-previewed-tree via atomic CAS
// ---------------------------------------------------------------------------

// Error shape thrown by MockLandingS4.landPreviewed to signal a CAS mismatch.
// Extends LandingCASMismatchError so `instanceof LandingCASMismatchError` in
// ApproveTask correctly identifies it as a real CAS mismatch.
class MockCASMismatch extends LandingCASMismatchError {
  constructor(newTargetOID: string) {
    super(newTargetOID);
    this.name = "MockCASMismatch";
  }
}

/**
 * S4 mock landing — scripted `preview` + `landPreviewed`.
 * Tracks `land()` calls separately so conflict / no-mutation tests can assert
 * that the legacy mutating path was never invoked.
 * Also exposes `resolveTargetOID` as an extra method (not yet on the port
 * interface) for ApproveTask to call when it pins the target OID before preview.
 */
class MockLandingS4 implements RepositoryLanding {
  readonly landCalls: Array<{ homeDir: string; candidate: LandingCandidate }> =
    [];
  readonly previewCalls: Array<{
    homeDir: string;
    candidate: LandingCandidate;
    targetOID: string;
  }> = [];
  readonly landPreviewedCalls: Array<{
    homeDir: string;
    candidate: LandingCandidate;
    previewOutcome: PreviewOutcome;
    targetOID: string;
  }> = [];

  readonly #scriptedTargetOID: string;
  readonly #previewQueue: PreviewOutcome[];
  readonly #landPreviewedQueue: Array<LandingResult | Error>;

  constructor(
    scriptedTargetOID: string,
    previewQueue: PreviewOutcome[],
    landPreviewedQueue: Array<LandingResult | Error> = [],
  ) {
    this.#scriptedTargetOID = scriptedTargetOID;
    this.#previewQueue = [...previewQueue];
    this.#landPreviewedQueue = [...landPreviewedQueue];
  }

  // RepositoryLanding.land() — must be present (required method on the port)
  // but must NOT be called by the predict-before-mutate path.
  async land(
    homeDir: string,
    candidate: LandingCandidate,
  ): Promise<LandingResult> {
    this.landCalls.push({ homeDir, candidate });
    return {
      candidate,
      outcome: { kind: "fast-forward" },
      canonicalSHA: candidate.candidateSHA,
    };
  }

  // Scripted preview — shifts the next PreviewOutcome from the queue.
  async preview(
    homeDir: string,
    candidate: LandingCandidate,
    targetOID: string,
  ): Promise<PreviewOutcome> {
    this.previewCalls.push({ homeDir, candidate, targetOID });
    const next = this.#previewQueue.shift();
    if (next === undefined)
      throw new Error("MockLandingS4.preview: queue exhausted");
    return next;
  }

  // Scripted land-the-previewed-tree — shifts from the queue or throws.
  async landPreviewed(
    homeDir: string,
    candidate: LandingCandidate,
    previewOutcome: PreviewOutcome,
    targetOID: string,
  ): Promise<LandingResult> {
    this.landPreviewedCalls.push({
      homeDir,
      candidate,
      previewOutcome,
      targetOID,
    });
    const next = this.#landPreviewedQueue.shift();
    if (next === undefined)
      throw new Error("MockLandingS4.landPreviewed: queue exhausted");
    if (next instanceof Error) throw next;
    return next;
  }

  // Extra method (not yet on the port interface) — resolves the current branch
  // OID so ApproveTask can pin the targetOID before calling preview.
  resolveTargetOID(_homeDir: string, _branch: string): string {
    return this.#scriptedTargetOID;
  }
}

// S4 shared fixture constants (fake SHA-like 40-char strings)
const S4_REPO_ID = "repo-s4-007";
const S4_TARGET_BRANCH = "main";
const S4_HOME_DIR = "/fake/home/s4-007";
const S4_TARGET_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 40 chars
const S4_CANDIDATE_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; // 40 chars
const S4_BASE_OID = "cccccccccccccccccccccccccccccccccccccccc"; // 40 chars
const S4_TREE_OID = "dddddddddddddddddddddddddddddddddddddddd"; // 40 chars
const S4_MERGE_COMMIT = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // 40 chars
const S4_CAND_ULID = "01S4" + "Z".repeat(22); // 26-char ULID-shaped id

function makeS4LandingRepo(taskId: string): FakeLandingRepository {
  const candidate = newChangeCandidate({
    id: S4_CAND_ULID,
    taskId,
    repoId: S4_REPO_ID,
    baseSHA: S4_BASE_OID,
    candidateSHA: S4_CANDIDATE_OID,
    ref: `kanthord/${taskId}`,
    target: S4_TARGET_BRANCH,
  });
  return new FakeLandingRepository(candidate);
}

function makeS4Store(taskId: string): MemStore {
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "s4 task",
    status: "awaiting_confirmation" as const,
    dependencies: [],
  };
  const result: TaskResultRow = {
    workspace: "/fake/s4/ws",
    branch: `kanthord/${taskId}`,
    baseCommit: S4_BASE_OID,
    proposalCommit: S4_CANDIDATE_OID,
    commitSha: null,
    summary: "S4 summary",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };
  return new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: S4_REPO_ID }]]),
  );
}

test("(S4-conflict-no-mutation) predict conflict: execute returns {kind:conflict}; task.conflict appended; no mutating land call; task stays awaiting_confirmation", async () => {
  const taskId = "s4-conflict-001";
  const store = makeS4Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const mockLanding = new MockLandingS4(S4_TARGET_OID, [
    {
      kind: "conflict",
      files: ["src/todo.ts"],
      perFile: [
        {
          path: "src/todo.ts",
          hunks: "<<<<<<< target\n=======\n>>>>>>> candidate",
        },
      ],
    },
  ]);
  const fakeLandingRepo = makeS4LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S4_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  assert.equal(
    (outcome as { kind?: string }).kind,
    "conflict",
    `predict conflict: execute must return {kind:'conflict'}; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    feed.events.filter((e) => e.type === "task.conflict").length,
    1,
    "predict conflict: task.conflict event must be appended once",
  );
  assert.equal(
    mockLanding.landCalls.length,
    0,
    "predict conflict: legacy land() must NOT be called (zero mutation before conflict return)",
  );
  assert.equal(
    mockLanding.landPreviewedCalls.length,
    0,
    "predict conflict: landPreviewed() must NOT be called (no mutation on conflict)",
  );
  assert.equal(
    store.savedTasks.filter((t) => t.status === "completed").length,
    0,
    "predict conflict: task must NOT be saved as completed",
  );
});

test("(S4-ff-lands-via-CAS) predict fast-forward: landPreviewed called; canonicalSHA equals candidateOID; task completed", async () => {
  const taskId = "s4-ff-001";
  const store = makeS4Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const ffLandResult: LandingResult = {
    candidate: {
      id: S4_CAND_ULID,
      taskId,
      repoId: S4_REPO_ID,
      baseSHA: S4_BASE_OID,
      candidateSHA: S4_CANDIDATE_OID,
      ref: `kanthord/${taskId}`,
      target: S4_TARGET_BRANCH,
      workspace: "/fake/s4/ws",
    },
    outcome: { kind: "fast-forward" },
    canonicalSHA: S4_CANDIDATE_OID,
  };
  const mockLanding = new MockLandingS4(
    S4_TARGET_OID,
    [{ kind: "fast-forward", candidateOID: S4_CANDIDATE_OID }],
    [ffLandResult],
  );
  const fakeLandingRepo = makeS4LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S4_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  assert.equal(
    (outcome as { kind?: string }).kind,
    "approved",
    `predict ff: execute must return {kind:'approved'}; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    (outcome as { canonicalSHA?: string }).canonicalSHA,
    S4_CANDIDATE_OID,
    "predict ff: canonicalSHA must equal candidateOID",
  );
  assert.equal(
    mockLanding.landPreviewedCalls.length,
    1,
    "predict ff: landPreviewed must be called once (not legacy land())",
  );
  assert.equal(
    mockLanding.landCalls.length,
    0,
    "predict ff: legacy land() must NOT be called (CAS path only)",
  );
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(last.status, "completed", "predict ff: task must be completed");
});

test("(S4-mergeable-lands-previewed-tree) predict mergeable: landPreviewed called with previewed treeOID and expectedOld equals pinned targetOID; task completed", async () => {
  const taskId = "s4-merge-001";
  const store = makeS4Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};
  const mergeLandResult: LandingResult = {
    candidate: {
      id: S4_CAND_ULID,
      taskId,
      repoId: S4_REPO_ID,
      baseSHA: S4_BASE_OID,
      candidateSHA: S4_CANDIDATE_OID,
      ref: `kanthord/${taskId}`,
      target: S4_TARGET_BRANCH,
      workspace: "/fake/s4/ws",
    },
    outcome: { kind: "merge", mergeCommit: S4_MERGE_COMMIT },
    canonicalSHA: S4_MERGE_COMMIT,
  };
  const mockLanding = new MockLandingS4(
    S4_TARGET_OID,
    [{ kind: "mergeable", treeOID: S4_TREE_OID }],
    [mergeLandResult],
  );
  const fakeLandingRepo = makeS4LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S4_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  assert.equal(
    (outcome as { kind?: string }).kind,
    "approved",
    `predict mergeable: execute must return {kind:'approved'}; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    mockLanding.landPreviewedCalls.length,
    1,
    "predict mergeable: landPreviewed must be called once",
  );
  assert.equal(
    mockLanding.landCalls.length,
    0,
    "predict mergeable: legacy land() must NOT be called",
  );
  const lcall = mockLanding.landPreviewedCalls[0]!;
  assert.ok(
    lcall.previewOutcome.kind === "mergeable" &&
      lcall.previewOutcome.treeOID === S4_TREE_OID,
    `landPreviewed must receive the previewed treeOID (${S4_TREE_OID}); got previewOutcome: ${JSON.stringify(lcall.previewOutcome)}`,
  );
  assert.equal(
    lcall.targetOID,
    S4_TARGET_OID,
    "landPreviewed expectedOld must equal the pinned targetOID from preview",
  );
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(last !== undefined, "task must have been saved");
  assert.equal(
    last.status,
    "completed",
    "predict mergeable: task must be completed",
  );
});

test("(S4-target-moved-repreviews) CAS mismatch: preview re-called with new targetOID; after cap retries returns target_moved; land never called on wrong base", async () => {
  const taskId = "s4-cas-001";
  const store = makeS4Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  // Three consecutive CAS failures with successive new targetOIDs from each error
  const CAS_OID1 = "cas1" + "0".repeat(36);
  const CAS_OID2 = "cas2" + "0".repeat(36);
  const CAS_OID3 = "cas3" + "0".repeat(36);

  // Fill preview queue for initial attempt + up to 3 retries
  const previewQueue: PreviewOutcome[] = [
    { kind: "mergeable", treeOID: S4_TREE_OID },
    { kind: "mergeable", treeOID: S4_TREE_OID },
    { kind: "mergeable", treeOID: S4_TREE_OID },
    { kind: "mergeable", treeOID: S4_TREE_OID },
  ];
  const casQueue: Array<LandingResult | Error> = [
    new MockCASMismatch(CAS_OID1),
    new MockCASMismatch(CAS_OID2),
    new MockCASMismatch(CAS_OID3),
  ];
  const mockLanding = new MockLandingS4(S4_TARGET_OID, previewQueue, casQueue);
  const fakeLandingRepo = makeS4LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S4_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  assert.equal(
    (outcome as { kind?: string }).kind,
    "target_moved",
    `CAS retry cap: execute must return {kind:'target_moved'} after exhausting retries; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    (outcome as { taskId?: string }).taskId,
    taskId,
    "target_moved outcome must carry the taskId",
  );
  // Re-preview happened: the second preview call used the new targetOID from the first CAS error
  assert.ok(
    mockLanding.previewCalls.length >= 2,
    `CAS retry: preview must be called at least twice (initial + at least one re-preview); called ${mockLanding.previewCalls.length} times`,
  );
  assert.equal(
    mockLanding.previewCalls[1]!.targetOID,
    CAS_OID1,
    "re-preview must use the newTargetOID from the CAS mismatch error, not the original targetOID",
  );
  assert.equal(
    mockLanding.landCalls.length,
    0,
    "CAS retry: legacy land() must never be called (never land on wrong base)",
  );
  // Task must NOT be completed on target_moved
  assert.equal(
    store.savedTasks.filter((t) => t.status === "completed").length,
    0,
    "target_moved: task must NOT be saved as completed",
  );
});

// ---------------------------------------------------------------------------
// S5 — recovery candidate re-enters the gate (007.6)
//
// After a `retry task` the landing-repo returns a NEW candidate (the one
// produced by the recovery agent run). Approving it must go through the same
// S4 predict-before-mutate gate — no shortcut for "second-attempt" candidates.
// The MockLandingS4 class (above) is reused; S5 only varies the candidate IDs
// to signal "this is a recovery candidate produced after the original conflict".
// ---------------------------------------------------------------------------

// Recovery-candidate fixture constants (distinct from first-attempt OIDs)
const S5_REPO_ID = "repo-s5-007";
const S5_TARGET_BRANCH = "main";
const S5_HOME_DIR = "/fake/home/s5-007";
const S5_TARGET_OID = "5555555555555555555555555555555555555555"; // 40 chars
const S5_RECOVERY_CANDIDATE_OID = "6666666666666666666666666666666666666666"; // 40 chars
const S5_RECOVERY_BASE_OID = "7777777777777777777777777777777777777777"; // 40 chars
const S5_RECOVERY_TREE_OID = "8888888888888888888888888888888888888888"; // 40 chars
const S5_RECOVERY_MERGE_SHA = "9999999999999999999999999999999999999999"; // 40 chars
const S5_RECOVERY_ULID = "01S5RCVR" + "Z".repeat(18); // 26-char ULID-shaped id

/** Build the store + landing-repo for an S5 scenario with a recovery candidate. */
function makeS5Store(taskId: string): MemStore {
  const awaitingTask: Task = {
    id: taskId,
    objectiveId: OBJ_ID,
    title: "s5 recovery task",
    status: "awaiting_confirmation" as const,
    dependencies: [],
  };
  const result: TaskResultRow = {
    workspace: "/fake/s5/ws",
    branch: `kanthord/${taskId}`,
    baseCommit: S5_RECOVERY_BASE_OID, // latest main at retry time
    proposalCommit: S5_RECOVERY_CANDIDATE_OID,
    commitSha: null,
    summary: "S5 recovery run summary",
    reason: "needs review",
    rejectionResolution: null,
    rejectionReason: null,
    evidence: null,
  };
  return new MemStore(
    [awaitingTask],
    new Map([[taskId, result]]),
    INI_ID,
    new Map([[taskId, { repository: S5_REPO_ID }]]),
  );
}

function makeS5LandingRepo(taskId: string): FakeLandingRepository {
  // This candidate was produced by the recovery agent run on the clean latest base.
  const recoveryCandidate = newChangeCandidate({
    id: S5_RECOVERY_ULID,
    taskId,
    repoId: S5_REPO_ID,
    baseSHA: S5_RECOVERY_BASE_OID,
    candidateSHA: S5_RECOVERY_CANDIDATE_OID,
    ref: `kanthord/${taskId}`,
    target: S5_TARGET_BRANCH,
  });
  return new FakeLandingRepository(recoveryCandidate);
}

test("(S5-recovery-previewed-then-lands) recovery candidate: preview invoked before landPreviewed; scripted mergeable lands via CAS; task completed", async () => {
  const taskId = "s5-recovery-mergeable-001";
  const store = makeS5Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  // Script: preview → mergeable, landPreviewed → success
  const mockLanding = new MockLandingS4(
    S5_TARGET_OID,
    [{ kind: "mergeable", treeOID: S5_RECOVERY_TREE_OID }],
    [
      {
        candidate: {
          id: S5_RECOVERY_ULID,
          taskId,
          repoId: S5_REPO_ID,
          baseSHA: S5_RECOVERY_BASE_OID,
          candidateSHA: S5_RECOVERY_CANDIDATE_OID,
          ref: `kanthord/${taskId}`,
          target: S5_TARGET_BRANCH,
          workspace: "/fake/s5/ws",
        },
        outcome: { kind: "merge", mergeCommit: S5_RECOVERY_MERGE_SHA },
        canonicalSHA: S5_RECOVERY_MERGE_SHA,
      },
    ],
  );
  const fakeLandingRepo = makeS5LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S5_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  // preview must have been called for the recovery candidate
  assert.equal(
    mockLanding.previewCalls.length,
    1,
    "(S5-recovery-previewed-then-lands) recovery candidate: preview must be called once before landing",
  );
  assert.equal(
    mockLanding.previewCalls[0]!.candidate.id,
    S5_RECOVERY_ULID,
    "(S5-recovery-previewed-then-lands) preview must receive the recovery candidate (ULID from recovery run)",
  );

  // landPreviewed must have been called exactly once (S4 CAS path)
  assert.equal(
    mockLanding.landPreviewedCalls.length,
    1,
    "(S5-recovery-previewed-then-lands) landPreviewed must be called exactly once (S4 CAS path)",
  );
  // landPreviewed received the previewed treeOID from the same preview call
  assert.equal(
    (mockLanding.landPreviewedCalls[0]!.previewOutcome as { treeOID?: string })
      .treeOID,
    S5_RECOVERY_TREE_OID,
    "(S5-recovery-previewed-then-lands) landPreviewed treeOID must equal the one returned by preview",
  );

  // legacy land() must NOT have been called (not blind landing)
  assert.equal(
    mockLanding.landCalls.length,
    0,
    "(S5-recovery-previewed-then-lands) legacy land() must NOT be called — recovery candidate must not be landed blind",
  );

  // task must be completed
  const last = store.savedTasks[store.savedTasks.length - 1];
  assert.ok(
    last !== undefined,
    "(S5-recovery-previewed-then-lands) task must be saved",
  );
  assert.equal(
    last!.status,
    "completed",
    "(S5-recovery-previewed-then-lands) task must be completed after recovery candidate lands",
  );

  assert.equal(
    (outcome as { kind?: string }).kind,
    "approved",
    `(S5-recovery-previewed-then-lands) outcome must be approved; got: ${JSON.stringify(outcome)}`,
  );
});

test("(S5-recovery-re-conflict) recovery candidate re-predicts conflict: typed conflict outcome; zero mutation; landing unchanged", async () => {
  const taskId = "s5-recovery-conflict-001";
  const store = makeS5Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  // Script: recovery candidate still conflicts
  const mockLanding = new MockLandingS4(S5_TARGET_OID, [
    {
      kind: "conflict",
      files: ["src/api.ts"],
      perFile: [
        {
          path: "src/api.ts",
          hunks: "<<<<<<< target\n=======\n>>>>>>> candidate",
        },
      ],
    },
  ]);
  const fakeLandingRepo = makeS5LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S5_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  // outcome must be typed conflict
  assert.equal(
    (outcome as { kind?: string }).kind,
    "conflict",
    `(S5-recovery-re-conflict) recovery re-conflict: outcome must be {kind:'conflict'}; got: ${JSON.stringify(outcome)}`,
  );

  // preview was called for the recovery candidate
  assert.equal(
    mockLanding.previewCalls.length,
    1,
    "(S5-recovery-re-conflict) preview must be called once for re-conflicting recovery candidate",
  );

  // landPreviewed must NOT have been called (zero mutation)
  assert.equal(
    mockLanding.landPreviewedCalls.length,
    0,
    "(S5-recovery-re-conflict) landPreviewed must NOT be called on conflict (zero mutation)",
  );

  // legacy land() must NOT have been called either
  assert.equal(
    mockLanding.landCalls.length,
    0,
    "(S5-recovery-re-conflict) legacy land() must NOT be called (no mutation on re-conflict)",
  );

  // task.conflict event emitted
  assert.equal(
    feed.events.filter((e) => e.type === "task.conflict").length,
    1,
    "(S5-recovery-re-conflict) task.conflict event must be emitted for re-conflicting recovery candidate",
  );
});

// ---------------------------------------------------------------------------
// S3 regression — CAS duck-type misclassification
//
// ApproveTask detects CAS mismatch with `"newTargetOID" in casErr`.  A real
// non-CAS landing failure (e.g. storage error) that happens to carry a
// coincidental `newTargetOID` property on its Error object is misclassified as
// {kind:"target_moved"} instead of {kind:"landing_failed"}.
// Fix: use `casErr instanceof LandingCASMismatchError` (already exported from
// landing/port.ts).
// ---------------------------------------------------------------------------
test("(S3-non-cas-error-with-newTargetOID-is-landing-failed) landPreviewed throws plain error with newTargetOID field: outcome is landing_failed, not target_moved", async () => {
  const taskId = "s3-non-cas-001";
  const store = makeS4Store(taskId);
  const feed = new MemFeed();
  const uow = new MemUow();
  const noopPromote = async (_d: string, _t: string, _p: string) => {};

  // A plain landing error (NOT instanceof LandingCASMismatchError) that happens
  // to carry a newTargetOID field — duck-type check `"newTargetOID" in casErr`
  // misclassifies this as a CAS mismatch and returns target_moved.
  class NonCASLandingError extends Error {
    readonly newTargetOID: string; // coincidental field, not a CAS signal
    constructor() {
      super("internal storage error: disk full");
      this.name = "NonCASLandingError";
      this.newTargetOID = "ffffffffffffffffffffffffffffffffffffffff";
    }
  }

  // Fill preview queue with enough items for MAX_CAS_RETRIES (3) + initial attempt so
  // the misclassification plays out to {kind:"target_moved"} instead of throwing
  // "queue exhausted".  The duck-type check treats NonCASLandingError as CAS and
  // re-previews until the cap, returning target_moved.  After the fix (instanceof
  // check), the first catch immediately returns landing_failed.
  const mockLanding = new MockLandingS4(
    S4_TARGET_OID,
    [
      { kind: "fast-forward", candidateOID: S4_CANDIDATE_OID },
      { kind: "fast-forward", candidateOID: S4_CANDIDATE_OID },
      { kind: "fast-forward", candidateOID: S4_CANDIDATE_OID },
      { kind: "fast-forward", candidateOID: S4_CANDIDATE_OID },
    ],
    [
      new NonCASLandingError(), // first landPreviewed throws non-CAS error
      new NonCASLandingError(), // subsequent retries (duck-type re-previews) also fail
      new NonCASLandingError(),
    ],
  );
  const fakeLandingRepo = makeS4LandingRepo(taskId);

  const uc = new ApproveTask(
    store,
    new MemQueue(),
    feed,
    uow,
    noopPromote,
    mockLanding,
    fakeLandingRepo,
    undefined,
    () => S4_HOME_DIR,
  );

  const outcome = await uc.execute({ taskId });

  assert.notEqual(
    (outcome as { kind?: string }).kind,
    "target_moved",
    `non-CAS error with coincidental newTargetOID must NOT be misclassified as target_moved; got: ${JSON.stringify(outcome)}`,
  );
  assert.equal(
    (outcome as { kind?: string }).kind,
    "landing_failed",
    `non-CAS error with coincidental newTargetOID must surface as landing_failed; got: ${JSON.stringify(outcome)}`,
  );
});
