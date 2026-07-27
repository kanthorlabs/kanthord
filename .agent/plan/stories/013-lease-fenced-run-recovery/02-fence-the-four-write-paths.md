# Story 2 — Fence the four write paths

Epic: `.agent/plan/epics/013-lease-fenced-run-recovery.md`
Depends on: Story 1 (the `LeaseToken`, `isLeaseCurrent`, `StaleLeaseError` surface).

## Change

### 1. `src/queue/sqlite.ts` — `finish` becomes lease-guarded

Replace `finish` (lines 47-49):

```ts
  finish(jobId: string, outcome: "completed" | "failed"): void {
    const result = this.#db
      .prepare(
        "UPDATE jobs SET status=? WHERE id=? AND status='running' AND revoked=0",
      )
      .run(outcome, jobId);
    if (result.changes === 0) throw new StaleLeaseError(jobId);
  }
```

Import `StaleLeaseError` (a value import, not `import type`) from `./port.ts`.

Update the port doc for `finish` (`src/queue/port.ts:33-36`) to state: _throws `StaleLeaseError` when `jobId` does not name a `running`, non-revoked job row._

`discard` (lines 51-53) is **not** changed: it is keyed on `id`, so a write from lease A can never touch lease B's row. Story 2's test asserts that property; it does not add a guard.

### 2. `src/app/task/run-next-task.ts` — the fence inside tx2

Add a private helper after `#enqueueNewlyReady` (which ends at line 183):

```ts
  /** Story 013-2 — fence: refuse a write from a lease that is no longer current. */
  #assertLeaseCurrent(leaseToken: string): void {
    if (!this.#queue.isLeaseCurrent(leaseToken)) {
      throw new StaleLeaseError(leaseToken);
    }
  }
```

Import `StaleLeaseError` from `../../queue/port.ts` (value import).

Widen the tx2 outcome variable at lines 378-379 and the `RunResult` outcome union at lines 61-72 to include `"abandoned"`:

```ts
let resultOutcome:
  "completed" | "failed" | "escalated" | "candidate" | "abandoned" = "failed";
```

```ts
type RunResult =
  | { outcome: "idle" }
  | {
      outcome:
        | "skipped"
        | "completed"
        | "failed"
        | "escalated"
        | "candidate"
        | "abandoned";
      taskId: string;
      failovers?: number;
    };
```

Make the **first statement inside tx2** (immediately after `this.#uow.transaction(() => {` at line 380) the lease read, with an early return:

```ts
// Story 013-2 — a run whose lease was revoked writes nothing here.
if (!this.#queue.isLeaseCurrent(jobId)) {
  resultOutcome = "abandoned";
  return;
}
```

Story 4 fills this branch with the requeue + `task.abandoned` append. In this story it is a bare early return: no task save, no `finish`, no `saveTaskResult`, no event.

Insert `this.#assertLeaseCurrent(jobId);` as the first statement of each of the five outcome branches, i.e. immediately after:

- line 381 `if (completedResult !== undefined) {` — guards task completion + terminal event + result row
- line 404 `} else if (escalatedResult !== undefined) {` — guards the `awaiting_confirmation` save + `task.escalated` + result row
- line 448 (candidate branch, the "no repo binding / workspace binding" arm that completes directly)
- line 471 (candidate branch, the proposal arm)
- line 510 `} else {` (the failure branch) — guards the `failed` save + `task.failed` + result row

Because tx2 runs under `BEGIN IMMEDIATE` (`src/storage/sqlite/sqlite-unit-of-work.ts:19`) and the lease read above is in the same transaction, the guards cannot fire in the single-daemon path — they are the hermetic fence the epic requires, and they must be individually reachable from tests that construct a revoked lease directly.

## Constraints

- The guard must throw **before** any write in its branch, so a rollback leaves zero rows.
- Do not catch `StaleLeaseError` anywhere in `run-next-task.ts`. The `isLeaseCurrent` early return at the top of tx2 is the only production path a revoked lease takes; a thrown `StaleLeaseError` is a real invariant violation and must surface.
- Do not change `discard`, `enqueue`, `claim`, or `listRunningJobs`.
- `finish`'s new throw must not break the 5 existing `finish` call sites (`run-next-task.ts:385, 410, 451, 495, 514`) — each is now preceded by `#assertLeaseCurrent`, and each runs on a `running`, non-revoked row.

## Verify

- `node --test src/queue/sqlite.test.ts` — add, using `makeTempDb()` + `seedTask(db)`:
  - `finish` on a claimed job still sets `status='completed'` / `'failed'` (existing tests at lines 351 and 373 must keep passing).
  - `finish` throws `StaleLeaseError` for an unknown id; for a `queued` job's id; for an already-`finish`ed job's id; and for a running row with `revoked=1`.
  - When `finish` throws, `SELECT status FROM jobs WHERE id=?` is unchanged (zero rows written).
  - **Late write from lease A cannot touch lease B's row**: claim job A for task 1, `discard(A)`, `enqueue` + `claim` job B for task 1; then assert `finish(A, "completed")` throws `StaleLeaseError`, `discard(A)` leaves B's row present with `status='running'`, and `isLeaseCurrent(B)` is still `true`.
- New file `src/app/task/lease-fence.test.ts` — **real SQLite**, following the `src/app/task/result-persistence.test.ts` convention (`mkdtempSync` + `openDatabase` + `migrate(db, MIGRATIONS)` + real `Sqlite*` adapters + `SqliteUnitOfWork`). One test per fenced write path; each drives a full `RunNextTask.execute()` with a scripted runner and revokes the lease _before_ tx2 by having the runner's `run()` execute `UPDATE jobs SET revoked=1 WHERE id=?` on the claimed row, then return the scripted outcome:
  - runner returns `completed` → `execute()` resolves to `{ outcome: "abandoned", taskId }`; `tasks.status` is still `running`; **zero** rows in `task_results`; **no** `task.completed` row in `events`; the `jobs` row is still `status='running'`.
  - runner returns `failed` → same assertions, plus **no** `task.failed` row in `events`.
  - runner returns `escalated` → same assertions, plus **no** `task.escalated` row in `events`.
  - runner returns `candidate` → same assertions, plus no `landing_candidates` row for the task.
  - Direct-guard tests: build `RunNextTask` with a queue fake whose `isLeaseCurrent` returns `true` on the tx2 top-level read and `false` on the branch guard, and assert `execute()` rejects with `StaleLeaseError` — once per branch (completed, failed, escalated, candidate) — and that no task save, no `finish`, no `saveTaskResult` and no event append was recorded.
- `node --test src/app/task/run-next-task.test.ts src/app/task/result-persistence.test.ts src/app/task/failure-semantics.test.ts src/app/task/escalation-persistence.test.ts src/app/task/execution-consistency.test.ts` — all existing tests still pass (regression guard: the happy path is unaffected).
- `npm run verify` exits 0.
- Proof: delivers phase **D** (`D ok: the abandoned run never completed, failed, or wrote a result`). Phase D cannot be observed until Story 3 revokes a real lease.
