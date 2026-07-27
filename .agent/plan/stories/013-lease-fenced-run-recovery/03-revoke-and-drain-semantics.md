# Story 3 — Revoke + drain semantics

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`
Depends on: Story 1, Story 2 (the tx2 `abandoned` branch already exists as an early return).

## Change

### 1. `src/queue/port.ts` — revocation is a queue operation

Add to `JobQueue` (after `listRunningJobsForTask`, added in Story 1):

```ts
  /**
   * Revoke the lease of a `running` job, recording the operator's reason.
   * `"revoked"`         — this call revoked it.
   * `"already_revoked"` — it was already revoked; `reason` is NOT overwritten.
   * `"not_found"`       — no `running` job row with that id.
   */
  revoke(
    leaseToken: LeaseToken,
    reason: string,
  ): "revoked" | "already_revoked" | "not_found";
```

### 2. `src/queue/sqlite.ts` — implement `revoke`

```ts
  revoke(
    leaseToken: string,
    reason: string,
  ): "revoked" | "already_revoked" | "not_found" {
    const updated = this.#db
      .prepare(
        "UPDATE jobs SET revoked=1, revokeReason=? WHERE id=? AND status='running' AND revoked=0",
      )
      .run(reason, leaseToken);
    if (updated.changes > 0) return "revoked";
    const row = this.#db
      .prepare("SELECT revoked FROM jobs WHERE id=? AND status='running'")
      .get(leaseToken) as { revoked: number } | undefined;
    if (row === undefined) return "not_found";
    return "already_revoked";
  }
```

### 3. `src/agent-runner/port.ts` — the `abandoned` result arm

Add a fifth arm to the `TaskResult` union (after the `candidate` arm, which ends at line 67):

```ts
  /**
   * EPIC 013 — the run's lease was revoked and it drained at a turn boundary.
   * Carries no payload: a drained run has no outcome to persist.
   */
  | { outcome: "abandoned" };
```

### 4. `src/agent-runner/fake.ts` — `FakeRunner` observes revocation

Rename the 4th parameter from `_lease` to `lease` and insert as the first statement after `this.calls.push(...)` (line 28):

```ts
if (!lease.isCurrent()) return { outcome: "abandoned" };
```

### 5. `src/agent-runner/pi.ts` — wire the `beforeToolCall` seam

`beforeToolCall` is **not** wired today (`grep -rn beforeToolCall src` returns nothing). This story attaches it for the first time. The pi contract (`node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:13`, `dist/types.d.ts:40-44`) is:

```ts
beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal)
  => Promise<BeforeToolCallResult | undefined>;
// BeforeToolCallResult = { block?: boolean; reason?: string }
```

Returning `{ block: true }` blocks that one tool call but does **not** stop the loop, so the hook must also abort — mirroring the existing turn-budget abort at `pi.ts:632-635`.

a. Immediately **before** the outer `try {` at `pi.ts:521`, declare:

```ts
// EPIC 013 Story 3 — drain state, declared outside the try so the
// catch-all at the end of #doRun can report `abandoned` too.
let leaseRevoked = false;
let agentRef: Agent | undefined;
```

b. Replace the `Agent` construction at `pi.ts:595-598`:

```ts
const agent = new Agent({
  streamFn,
  getApiKey: () => session.getApiKey(),
  // EPIC 013 Story 3 — drain at the next turn boundary. This hook is the
  // last point before a tool executes; a revoked lease stops the loop
  // here, so no further tool call is started.
  beforeToolCall: async () => {
    if (lease.isCurrent()) return undefined;
    leaseRevoked = true;
    agentRef?.abort();
    return { block: true, reason: "lease revoked: run abandoned" };
  },
});
agentRef = agent;
```

c. Immediately after `await agent.waitForIdle();` (`pi.ts:640`) and **before** the `budgetExceeded` check at `pi.ts:643`:

```ts
// Story 013-3 — a drained run reports `abandoned`, never `failed`.
if (leaseRevoked) return { outcome: "abandoned" };
```

d. In the catch-all at `pi.ts:802-805`, as the first statement of the `catch`:

```ts
if (leaseRevoked) return { outcome: "abandoned" };
```

e. `#doRun` gains `lease: LeaseObserver` as its 6th parameter (declaration `pi.ts:429-435`, call `pi.ts:388-394`) — Story 1 already threaded it; this story consumes it.

### 6. `src/app/task/run-next-task.ts` — route the `abandoned` result

- Add an accumulator beside the others (after `let attempts = 0;` at line 268):

  ```ts
  let abandoned = false;
  ```

- In the result dispatch at lines 362-370, add an explicit arm **before** the `else`:

  ```ts
  if (result.outcome === "completed") {
    completedResult = result;
  } else if (result.outcome === "escalated") {
    escalatedResult = result;
  } else if (result.outcome === "failed") {
    failReason = result.reason;
  } else if (result.outcome === "abandoned") {
    abandoned = true;
  } else {
    candidateResult = result;
  }
  ```

  (The new union arm makes the bare `else` a type error until this arm exists — that is the intended enumeration.)

- Change the tx2 top-of-transaction condition added in Story 2 to:

  ```ts
  if (abandoned || !this.#queue.isLeaseCurrent(jobId)) {
    resultOutcome = "abandoned";
    return;
  }
  ```

### 7. New file `src/app/task/abandon-task.ts`

```ts
export class TaskNotAbandonableError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;
  constructor(taskId: string, status: TaskStatus) {
    super(`task ${taskId} is not abandonable (status: ${status})`);
    this.name = "TaskNotAbandonableError";
    this.taskId = taskId;
    this.status = status;
  }
}

export class NoRunningJobError extends Error {
  readonly taskId: string;
  constructor(taskId: string) {
    super(`task ${taskId} has no running job to abandon`);
    this.name = "NoRunningJobError";
    this.taskId = taskId;
  }
}

export class AmbiguousRunningJobError extends Error {
  readonly taskId: string;
  readonly count: number;
  constructor(taskId: string, count: number) {
    super(
      `task ${taskId} has ${count} running jobs; refusing to guess which to abandon`,
    );
    this.name = "AmbiguousRunningJobError";
    this.taskId = taskId;
    this.count = count;
  }
}

export type AbandonOutcome = {
  outcome: "abandoning" | "already_abandoning";
  taskId: string;
};

interface TaskStore {
  get(id: string): Task | undefined;
}

export class AbandonTask {
  // ctor(store: TaskStore, queue: JobQueue, uow: UnitOfWork)
  execute({
    taskId,
    reason,
  }: {
    taskId: string;
    reason: string;
  }): AbandonOutcome;
}
```

`execute` body, in exactly this order, inside a single `this.#uow.transaction(...)`:

1. `const task = this.#store.get(taskId)`; `undefined` → `throw new UnknownReferenceError("task", taskId)` (imported from `../errors.ts`, as `get-task.ts:4` does).
2. `task.status !== "running"` → `throw new TaskNotAbandonableError(taskId, task.status)`.
3. `const jobs = this.#queue.listRunningJobsForTask(taskId)`.
4. `jobs.length === 0` → `throw new NoRunningJobError(taskId)`.
5. `jobs.length > 1` → `throw new AmbiguousRunningJobError(taskId, jobs.length)`.
6. `jobs[0].revoked === true` → `return { outcome: "already_abandoning", taskId }` (no write, no event, reason not overwritten).
7. `this.#queue.revoke(jobs[0].id, reason)`; `return { outcome: "abandoning", taskId }`.

Follow the error-class shape convention of `src/app/task/retry-task.ts:10-20`.

### 8. `src/composition.ts` — wire the use case

After `retryTask` (built at `composition.ts:399-406`) add:

```ts
const abandonTask = new AbandonTask(
  { get: (id) => taskRepository.get(id) },
  jobQueue,
  unitOfWork,
);
```

Arrow wrapper, per AGENTS.md "Wiring". Add `abandonTask` to the returned bundle beside `rejectTask` (`composition.ts:889`). The CLI surface is Story 6.

## Constraints

- `abandoning` is a marker, not a status. Do **not** add to `TASK_STATUSES` (`src/domain/task.ts:4-11`) and do **not** touch `LEGAL_TRANSITIONS` (`src/domain/task.ts:97-109`) or the `tasks.status` CHECK.
- Revocation writes only to `jobs.revoked` / `jobs.revokeReason`. It never changes `tasks.status` and never appends an event.
- The `beforeToolCall` hook must never throw — it returns `{ block: true, reason }`.
- Do not add any timer, poller, or process-kill path. Revocation is observed only at the `beforeToolCall` boundary.
- `RunDaemon` needs no change: `"abandoned"` is neither `"idle"` nor `"failed"`, so `run-daemon.ts:156`, `:163`, `:168`, `:174-184`, `:190` all behave correctly and the daemon keeps polling.
- Do not persist the revoke reason anywhere but `jobs.revokeReason`; Story 4 reads it from there.

## Verify

- `node --test src/queue/sqlite.test.ts` — `revoke` returns `"revoked"` on a claimed job and sets `revoked=1` + `revokeReason`; returns `"already_revoked"` on a second call and leaves the **first** reason in place; returns `"not_found"` for an unknown id, for a `queued` job's id, and for a `finish`ed job's id. After `revoke`, `isLeaseCurrent` is `false` while `SELECT status` is still `'running'`.
- New file `src/app/task/abandon-task.test.ts` — fakes only, following the `src/app/task/recover-interrupted-tasks.test.ts` convention (`SimpleTaskStore`, `RecordingJobQueue`, `RecordingUnitOfWork`). One test per numbered step above:
  - unknown task → rejects with `UnknownReferenceError`.
  - task `pending` / `completed` / `failed` / `awaiting_confirmation` / `discarded` → rejects with `TaskNotAbandonableError` whose `message` contains the **actual** status.
  - `running` task with zero running jobs → `NoRunningJobError`.
  - `running` task with two running jobs → `AmbiguousRunningJobError` with `count === 2`, and `revoke` was **not** called.
  - `running` task with one non-revoked job → `{ outcome: "abandoning", taskId }`, and `revoke` recorded exactly `(jobId, reason)`.
  - `running` task with an already-revoked job → `{ outcome: "already_abandoning", taskId }`, `revoke` **not** called, no event appended (idempotency).
  - the whole body runs inside one transaction (`uow.txCount === 1`).
- `node --test src/agent-runner/pi.test.ts` — add, using the file's existing `makeRunner` / `makeSessionFactory` helpers (`pi.test.ts:177-224`) and a scripted multi-turn session (three `bash` tool-call turns then a text turn):
  - lease current throughout → the run reaches the text turn and returns a non-`abandoned` outcome (regression guard).
  - a lease observer that returns `true` for the first `isCurrent()` call and `false` afterwards → `run()` resolves to `{ outcome: "abandoned" }`, and the count of `tool_execution_start` events observed is exactly **1** (it stopped at the next boundary and started no further tool call).
  - the drained run's `agent.finished` emit carries `outcome: "abandoned"` (assert via the `emit` option).
- `node --test src/agent-runner/fake.test.ts` — `FakeRunner.run` with a lease whose `isCurrent()` is `false` returns `{ outcome: "abandoned" }` and does not consult `failTaskIds` / `failTransient`.
- `node --test src/app/task/run-next-task.test.ts` — a scripted runner returning `{ outcome: "abandoned" }` makes `execute()` resolve to `{ outcome: "abandoned", taskId }`; the task is **not** saved, `finish` was **not** called, no `saveTaskResult`, and no event was appended.
- `npm run verify` exits 0.
- Proof: with Story 6's CLI, delivers phase **B** (`B ok: lease revoked, run marked abandoning, daemon alive`) and the drain half of phase **C**.
