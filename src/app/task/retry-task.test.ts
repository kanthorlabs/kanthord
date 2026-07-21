import { test } from "node:test";
import assert from "node:assert/strict";
import { RetryTask, TaskNotRetryableError } from "./retry-task.ts";
import type { ConflictCandidateStore } from "./retry-task.ts";
import type { JobQueue, ClaimedJob } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";
import type { UnitOfWork } from "../../storage/port.ts";
import type { Event } from "../../domain/event.ts";
import type { Task } from "../../domain/task.ts";
import { UnknownReferenceError, WrongTypeReferenceError } from "../errors.ts";
import type { ChangeCandidate, CandidateState } from "../../domain/landing.ts";

// ---------------------------------------------------------------------------
// Narrow interfaces the use case depends on
// ---------------------------------------------------------------------------

interface TaskStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

interface KindResolver {
  resolveKind(id: string): string | undefined;
}

// ---------------------------------------------------------------------------
// Fakes / Mocks
// ---------------------------------------------------------------------------

class SimpleTaskStore implements TaskStore {
  readonly saved: Task[] = [];
  readonly #tasks: Map<string, Task>;

  constructor(tasks: Task[]) {
    this.#tasks = new Map(tasks.map((t) => [t.id, t]));
  }

  get(id: string): Task | undefined {
    return this.#tasks.get(id);
  }

  save(task: Task): void {
    this.#tasks.set(task.id, task);
    this.saved.push(task);
  }
}

class RecordingJobQueue implements JobQueue {
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

class MockKindResolver implements KindResolver {
  readonly #kind: string | undefined;

  constructor(kind: string | undefined) {
    this.#kind = kind;
  }

  resolveKind(_id: string): string | undefined {
    return this.#kind;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OBJ_ID = "01JZZZZZZZZZZZZZZZZZZZOBJ9";
const TASK_ID = "01JZZZZZZZZZZZZZZZZZZZTS90";

function makeTask(status: Task["status"]): Task {
  return {
    id: TASK_ID,
    objectiveId: OBJ_ID,
    title: "some task",
    status,
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("RetryTask execute resets a failed task to pending enqueues it and emits task.ready", async () => {
  const store = new SimpleTaskStore([makeTask("failed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await uc.execute({ taskId: TASK_ID });

  // task reset to pending
  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]!.status, "pending");

  // task enqueued
  assert.deepEqual(queue.enqueued, [TASK_ID]);

  // task.ready event emitted
  assert.equal(feed.events.length, 1);
  assert.equal(feed.events[0]!.type, "task.ready");
  assert.equal(feed.events[0]!.taskId, TASK_ID);
});

test("RetryTask execute a pending task throws TaskNotRetryableError and writes nothing", async () => {
  const store = new SimpleTaskStore([makeTask("pending")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).taskId === TASK_ID &&
      (err as TaskNotRetryableError).status === "pending",
  );
  assert.equal(store.saved.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RetryTask execute a running task throws TaskNotRetryableError and writes nothing", async () => {
  const store = new SimpleTaskStore([makeTask("running")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).status === "running",
  );
  assert.equal(store.saved.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RetryTask execute a completed task throws TaskNotRetryableError and writes nothing", async () => {
  const store = new SimpleTaskStore([makeTask("completed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).status === "completed",
  );
  assert.equal(store.saved.length, 0);
  assert.equal(queue.enqueued.length, 0);
  assert.equal(feed.events.length, 0);
});

test("RetryTask execute throws UnknownReferenceError for unknown id", async () => {
  const store = new SimpleTaskStore([]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver(undefined);

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: "no-such" }),
    (err: unknown) => err instanceof UnknownReferenceError,
  );
});

test("RetryTask execute throws WrongTypeReferenceError for non-task id", async () => {
  const store = new SimpleTaskStore([]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("initiative");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await assert.rejects(
    () => uc.execute({ taskId: "some-initiative-id" }),
    (err: unknown) => err instanceof WrongTypeReferenceError,
  );
});

test("RetryTask execute wraps writes in exactly one transaction", async () => {
  const store = new SimpleTaskStore([makeTask("failed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await uc.execute({ taskId: TASK_ID });

  assert.equal(uow.txCount, 1, "must use exactly one transaction");
});

// ---------------------------------------------------------------------------
// S2 — conflict-candidate recovery path (007.5)
// ---------------------------------------------------------------------------

class FakeConflictCandidateStore implements ConflictCandidateStore {
  readonly #candidates: Map<string, ChangeCandidate>;
  readonly updatedStates: Array<{ id: string; state: CandidateState }> = [];
  readonly savedSnapshots: Array<{
    taskId: string;
    candidateOID: string;
    targetOID: string;
    conflictContext: string;
  }> = [];

  constructor(candidates: ChangeCandidate[]) {
    this.#candidates = new Map(candidates.map((c) => [c.taskId ?? "", c]));
  }

  getCandidateByTask(taskId: string): ChangeCandidate | undefined {
    return this.#candidates.get(taskId);
  }

  updateCandidateState(id: string, state: CandidateState): void {
    this.updatedStates.push({ id, state });
    for (const [key, cand] of this.#candidates) {
      if (cand.id === id) {
        this.#candidates.set(key, { ...cand, state });
      }
    }
  }

  // S3 seam — not yet on ConflictCandidateStore interface; added once SE implements.
  // The test asserts this is called during conflict recovery; RED today (never called).
  saveConflictSnapshot(
    taskId: string,
    snapshot: {
      candidateOID: string;
      targetOID: string;
      conflictContext: string;
    },
  ): void {
    this.savedSnapshots.push({ taskId, ...snapshot });
  }
}

const CONFLICT_CAND_ID = "01JZZZZZZZZZZZZZZZZZZZCNFL";

function makeConflictCandidate(): ChangeCandidate {
  return {
    id: CONFLICT_CAND_ID,
    taskId: TASK_ID,
    repoId: "01JZZZZZZZZZZZZZZZZZZZRPOX",
    baseSHA: "deadbeef",
    candidateSHA: "cafebabe",
    ref: `kanthord/${TASK_ID}`,
    target: "main",
    state: "conflict",
  };
}

function makeFreshCandidate(): ChangeCandidate {
  return {
    id: "01JZZZZZZZZZZZZZZZZZZZCNFP",
    taskId: TASK_ID,
    repoId: "01JZZZZZZZZZZZZZZZZZZZRPOX",
    baseSHA: "deadbeef",
    candidateSHA: "cafebabe",
    ref: `kanthord/${TASK_ID}`,
    target: "main",
    state: "pending",
  };
}

test("RetryTask execute awaiting_confirmation task with conflict-state candidate transitions to pending emits task.ready without task.rejected", async () => {
  const store = new SimpleTaskStore([makeTask("awaiting_confirmation")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");
  const candidateStore = new FakeConflictCandidateStore([
    makeConflictCandidate(),
  ]);

  const uc = new RetryTask(store, queue, feed, uow, resolver, candidateStore);
  await uc.execute({ taskId: TASK_ID });

  assert.equal(store.saved.length, 1, "task must be saved once");
  assert.equal(
    store.saved[0]!.status,
    "pending",
    "task must transition to pending",
  );

  assert.deepEqual(queue.enqueued, [TASK_ID], "task must be enqueued");

  const eventTypes = feed.events.map((e) => e.type);
  assert.ok(eventTypes.includes("task.ready"), "must emit task.ready");
  assert.ok(
    !eventTypes.includes("task.rejected"),
    `must NOT emit task.rejected; got events: ${JSON.stringify(eventTypes)}`,
  );
});

test("RetryTask execute awaiting_confirmation task with conflict-state candidate supersedes the stale conflict candidate", async () => {
  const store = new SimpleTaskStore([makeTask("awaiting_confirmation")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");
  const candidateStore = new FakeConflictCandidateStore([
    makeConflictCandidate(),
  ]);

  const uc = new RetryTask(store, queue, feed, uow, resolver, candidateStore);
  await uc.execute({ taskId: TASK_ID });

  // After retry, the stale conflict candidate must no longer be in "conflict" state
  // so that the next approve does not reload the old conflicted SHA.
  const afterState = candidateStore.getCandidateByTask(TASK_ID)?.state;
  assert.notEqual(
    afterState,
    "conflict",
    `stale candidate must be superseded; got state: ${afterState}`,
  );
});

test("RetryTask execute awaiting_confirmation task with fresh pending-state candidate throws TaskNotRetryableError", async () => {
  // Characterization: retrying an unreviewed (never-approved) candidate is
  // meaningless; the error must survive the new conflict-aware path.
  const store = new SimpleTaskStore([makeTask("awaiting_confirmation")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");
  const candidateStore = new FakeConflictCandidateStore([makeFreshCandidate()]);

  const uc = new RetryTask(store, queue, feed, uow, resolver, candidateStore);

  await assert.rejects(
    () => uc.execute({ taskId: TASK_ID }),
    (err: unknown) =>
      err instanceof TaskNotRetryableError &&
      (err as TaskNotRetryableError).status === "awaiting_confirmation",
  );
  assert.equal(store.saved.length, 0, "no state saved on error");
  assert.equal(queue.enqueued.length, 0, "nothing enqueued on error");
  assert.equal(feed.events.length, 0, "no events on error");
});

// ---------------------------------------------------------------------------
// S3 (007.6) — note + conflict snapshot on conflict recovery
// ---------------------------------------------------------------------------

test("(S3-retry-note-persist) RetryTask S3 conflict recovery with note 'keep both handlers': note persisted on saved task; no task.rejected event", async () => {
  const store = new SimpleTaskStore([makeTask("awaiting_confirmation")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");
  const candidateStore = new FakeConflictCandidateStore([
    makeConflictCandidate(),
  ]);

  const uc = new RetryTask(store, queue, feed, uow, resolver, candidateStore);
  // note is a new optional field — RED: execute currently only accepts { taskId }
  await uc.execute({
    taskId: TASK_ID,
    note: "keep both handlers",
  } as Parameters<typeof uc.execute>[0]);

  assert.equal(store.saved.length, 1, "task must be saved once");
  // Observe the note via a typed cast — S4 pre-adjust: Task index signature will be
  // removed; cast to Task & { note?: string } so this compiles without it.
  const saved = store.saved[0] as Task & { note?: string };
  assert.equal(
    saved.note,
    "keep both handlers",
    "note must be persisted on the saved task so it surfaces in get task --json",
  );

  const eventTypes = feed.events.map((e) => e.type);
  assert.ok(
    !eventTypes.includes("task.rejected"),
    `must NOT emit task.rejected on conflict recovery; got: ${JSON.stringify(eventTypes)}`,
  );
});

test("(S3-retry-snapshot) RetryTask S3 conflict recovery records conflict snapshot {candidateOID, targetOID, conflictContext} with no conflict markers", async () => {
  const store = new SimpleTaskStore([makeTask("awaiting_confirmation")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  // Candidate with pre-stored targetOID and marker-free conflictContext (set during approve/S4)
  const candidateWithContext: ChangeCandidate = {
    ...makeConflictCandidate(),
    targetOID: "aabb1122ff00aabb1122ff00aabb1122ff00dead",
    conflictContext:
      "target: const x = 'home-version';\ncandidate: const x = 'ws-version';",
  };
  const candidateStore = new FakeConflictCandidateStore([candidateWithContext]);

  const uc = new RetryTask(store, queue, feed, uow, resolver, candidateStore);
  await uc.execute({
    taskId: TASK_ID,
    note: "keep both handlers",
  } as Parameters<typeof uc.execute>[0]);

  // RED: saveConflictSnapshot is never called today (not on ConflictCandidateStore yet)
  assert.equal(
    candidateStore.savedSnapshots.length,
    1,
    "one conflict snapshot must be recorded on the recovery attempt",
  );
  const snap = candidateStore.savedSnapshots[0]!;
  assert.equal(
    snap.candidateOID,
    CONFLICT_CAND_ID.length > 0 ? "cafebabe" : "",
    "candidateOID must equal the conflict candidate's SHA (cafebabe)",
  );
  assert.equal(
    snap.targetOID,
    "aabb1122ff00aabb1122ff00aabb1122ff00dead",
    "targetOID must be read from the pre-stored candidate field",
  );
  assert.ok(
    !snap.conflictContext.includes("<<<<<<<"),
    "conflictContext must not contain <<<<<<< conflict markers (marker-free invariant)",
  );
  assert.ok(
    !snap.conflictContext.includes(">>>>>>>"),
    "conflictContext must not contain >>>>>>> conflict markers (marker-free invariant)",
  );
});

test("(S2-note-cleared-on-noteless-retry) RetryTask S2 conflict-recovery retry with no note must clear a previously-set note (regression)", async () => {
  // Scenario: first conflict-recovery retry passed note:"X" → task now has note:"X"
  // and re-enters awaiting_confirmation on the next conflict.  A second
  // conflict-recovery retry issued WITHOUT a note must CLEAR note (set to null/
  // absent) — stale note must not persist into the saved task.
  const taskWithStaleNote: Task = {
    ...makeTask("awaiting_confirmation"),
    note: "X",
  };
  const store = new SimpleTaskStore([taskWithStaleNote]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");
  const candidateStore = new FakeConflictCandidateStore([
    makeConflictCandidate(),
  ]);

  const uc = new RetryTask(store, queue, feed, uow, resolver, candidateStore);
  // No note supplied — the stale note must be cleared
  await uc.execute({ taskId: TASK_ID });

  assert.equal(store.saved.length, 1, "task must be saved once");
  const saved = store.saved[0] as Task & { note?: string | null };
  assert.ok(
    saved.note == null,
    `note must be null/absent after a no-note retry; got: ${JSON.stringify(saved.note)}`,
  );
});

test("(S3-retry-failed-regression) RetryTask S3 failed-retry transitions to pending (regression): no conflict snapshot", async () => {
  const store = new SimpleTaskStore([makeTask("failed")]);
  const queue = new RecordingJobQueue();
  const feed = new RecordingEventFeed();
  const uow = new RecordingUnitOfWork();
  const resolver = new MockKindResolver("task");

  // No candidateStore for the failed path — regression guard that it still works
  const uc = new RetryTask(store, queue, feed, uow, resolver);
  await uc.execute({ taskId: TASK_ID });

  assert.equal(
    store.saved[0]!.status,
    "pending",
    "failed task must still transition to pending (regression)",
  );
  assert.deepEqual(
    queue.enqueued,
    [TASK_ID],
    "task must be enqueued (regression)",
  );
});
