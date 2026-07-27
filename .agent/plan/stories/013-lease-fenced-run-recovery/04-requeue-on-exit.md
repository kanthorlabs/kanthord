# Story 4 — Requeue on exit

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`
Depends on: Story 3 (the tx2 `abandoned` branch), Story 5 (`task.abandoned` must be admitted by the `events.type` CHECK before this story appends it).

## Change

### 1. New file `src/app/task/requeue-running-task.ts` — extract the transition

The `running → pending` + discard + re-enqueue + `task.ready` transition currently lives inlined in `src/app/task/recover-interrupted-tasks.ts:38-44`. Extract it **verbatim** into a shared function (the `src/app/objective/settle-objectives.ts` → `settleObjective` module is the precedent for a plain exported function in `app/`):

```ts
import type { Task } from "../../domain/task.ts";
import { transitionTask } from "../../domain/task.ts";
import { newEvent } from "../../domain/event.ts";
import type { ClaimedJob, JobQueue } from "../../queue/port.ts";
import type { EventFeed } from "../../events/port.ts";

export interface RequeueStore {
  get(id: string): Task | undefined;
  save(task: Task): void;
}

/**
 * Move a `running` task back to `pending`, drop its job row, and re-enqueue it.
 * Appends `task.ready` only when the re-enqueue inserted a new queued row.
 * Returns that insert result. Caller must already be inside a transaction.
 */
export function requeueRunningTask(
  job: ClaimedJob,
  deps: { store: RequeueStore; queue: JobQueue; feed: EventFeed },
): boolean {
  const task = deps.store.get(job.taskId);
  if (task === undefined) return false;
  const pending = transitionTask(task, "pending");
  deps.store.save(pending);
  deps.queue.discard(job.id);
  const inserted = deps.queue.enqueue(job.taskId);
  if (inserted) {
    deps.feed.append(newEvent("task.ready", { taskId: job.taskId }));
  }
  return inserted;
}
```

### 2. `src/app/task/recover-interrupted-tasks.ts` — reuse it

Replace the loop body (lines 35-46) with:

```ts
for (const job of runningJobs) {
  if (this.#store.get(job.taskId) === undefined) continue;
  requeueRunningTask(job, {
    store: this.#store,
    queue: this.#queue,
    feed: this.#feed,
  });
  recovered.push(job.taskId);
}
```

Behaviour is unchanged: same statement order, same `task.ready`-only-if-inserted rule, same `recovered` contents. Remove the now-unused `transitionTask` / `newEvent` imports (lines 2-3) if nothing else in the file uses them.

### 3. `src/app/task/run-next-task.ts` — fill the tx2 `abandoned` branch

Replace the Story-3 early return at the top of tx2 with:

```ts
// EPIC 013 Story 4 — a revoked run drains, then hands the task back.
if (abandoned || !this.#queue.isLeaseCurrent(jobId)) {
  resultOutcome = "abandoned";
  // Read the reason BEFORE requeueing — requeue discards the job row.
  const revokedJob = this.#queue
    .listRunningJobsForTask(taskId)
    .find((j) => j.id === jobId);
  const reason = revokedJob?.revokeReason ?? "";
  requeueRunningTask(
    { id: jobId, taskId },
    { store: this.#store, queue: this.#queue, feed: this.#feed },
  );
  this.#feed.append(
    newEvent("task.abandoned", { taskId, payload: { reason } }),
  );
  return;
}
```

Import `requeueRunningTask` from `./requeue-running-task.ts`.

Event order inside tx2 is pinned: `task.ready` (only when the re-enqueue inserted) then `task.abandoned`, always exactly one `task.abandoned` per drained run.

## Constraints

- `task.abandoned` is appended **unconditionally** in this branch; `task.ready` keeps its "only if inserted" rule. Do not fold `task.abandoned` into `requeueRunningTask`.
- Read `listRunningJobsForTask` before `requeueRunningTask`; afterwards the row is gone and the reason is unrecoverable.
- `transitionTask(task, "pending")` from `running` is already legal (`src/domain/task.ts:102`). Do not add a transition.
- `RecoverInterruptedTasks`'s public behaviour must not change — its three tests plus `src/app/task/execution-consistency.test.ts:184,235,325`, `src/app/task/escalation-persistence.test.ts:340` and `src/app/task/live-mutation.test.ts:121` are the regression guard.
- Do not write a `task_results` row, do not call `finish`, and do not append `task.failed` on this path.
- The requeued job is a **new** `jobs` row, so the next claim gets a new lease token. Nothing else needs to change for that.

## Verify

- New file `src/app/task/requeue-running-task.test.ts` — fakes only (convention: `src/app/task/recover-interrupted-tasks.test.ts:1-99`):
  - a `running` task → saved as `pending`, `discard(job.id)` recorded, `enqueue(taskId)` recorded, exactly one `task.ready` event, returns `true`.
  - a queue fake whose `enqueue` returns `false` → no `task.ready` event, returns `false`, task still saved as `pending`.
  - a task the store does not know → returns `false`, nothing saved, nothing discarded, nothing enqueued.
- `node --test src/app/task/recover-interrupted-tasks.test.ts` — the three existing tests pass unchanged (extraction is behaviour-preserving).
- `node --test src/app/task/run-next-task.test.ts` — add, with a scripted runner returning `{ outcome: "abandoned" }` and a queue fake whose `listRunningJobsForTask(taskId)` returns `[{ id: JOB_ID, taskId, revoked: true, revokeReason: "stuck" }]`:
  - `execute()` resolves to `{ outcome: "abandoned", taskId }`.
  - the task was saved with status `pending`.
  - `discarded === [JOB_ID]` and `enqueued === [taskId]`.
  - the appended events, in order, are `task.started`, `task.ready`, `task.abandoned`; the `task.abandoned` payload is `{ reason: "stuck" }`.
  - **no** `task.completed`, `task.failed` or `task.escalated` event; `finish` was never called; `saveTaskResult` was never called.
  - with `revokeReason: null`, the payload is `{ reason: "" }`.
  - the same assertions hold when the runner returns `{ outcome: "completed", ... }` but `isLeaseCurrent(jobId)` is `false` (the "run finished before it noticed" path).
- `node --test src/app/task/lease-fence.test.ts` — update the Story-2 real-SQLite expectations: the task is now `pending` (not `running`) after tx2, the `jobs` row for the revoked lease is gone, a fresh `queued` row exists for the task, `task_results` is still empty, and a `task.abandoned` row exists in `events`.
- `node --test src/app/task/execution-consistency.test.ts src/app/task/escalation-persistence.test.ts src/app/task/live-mutation.test.ts` — pass unchanged.
- `npm run verify` exits 0.
- Proof: delivers phase **C** (`C ok: run drained, task requeued, abandonment recorded with its reason`) and phase **E** (`E ok: the requeued task ran to completion under a new lease, same live daemon`).
