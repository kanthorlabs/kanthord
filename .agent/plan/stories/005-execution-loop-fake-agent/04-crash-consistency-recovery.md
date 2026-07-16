# Story 04 — Crash consistency & startup recovery

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

The stated recovery rule exists and is proven against real SQLite: every
loop write is atomic (a crash can never half-record a step), a task left
`running` by a dead daemon is reset and re-queued on startup, and a
restarted daemon's readiness re-scan duplicates nothing.

## Acceptance Criteria

- `app/task/recover-interrupted-tasks.ts` —
  `RecoverInterruptedTasks.execute(): string[]` (recovered task ids). In
  one transaction, for every job from `listRunningJobs()`: load the task,
  `transitionTask(task, 'pending')` (**the `running→pending` recovery
  edge — index B1, resolved**), save, `discard` the job (index decision
  D1 — operational queue, event-stream audit), `enqueue` (→ `task.ready`
  event on insert). Dependencies cannot have changed while the task was
  non-pending (EPIC 002 guard), so the task is still ready by
  construction.
- Atomicity proven on a real temp DB: a throw injected between the writes
  of tx2 rolls back all of them (task status, job status, event count all
  unchanged).
- Crash simulation proven on a real temp DB: manufacture the exact
  between-tx1-and-tx2 state (task `running`, job `running`, `task.started`
  appended), run recovery + the loop, and the task completes with no
  duplicate jobs and no duplicate events beyond the legitimate second
  `task.ready`/`task.started` pair from the re-run (an observable
  restart — by design).

## Constraints

- Recovery runs once at daemon startup (story 07 wires it), before the
  first scan. Single daemon process is assumed (epic non-goal).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — RecoverInterruptedTasks

**Requires:** S02-T4 (`listRunningJobs`, `discard`, `enqueue`); EPIC 002
S004-T1 (`running→pending` edge, amended per index B1).

**Input:** `src/app/task/recover-interrupted-tasks.ts` (new) + test (new).

**Action — RED:** hermetic tests: (a) one running job + running task →
task reset to `pending`, job discarded, re-enqueued, one `task.ready`
appended; (b) no running jobs → no-op, `[]`; (c) all inside one
`transaction`. Fails today: module does not exist.

**Action — GREEN:** implement per the AC.

**Action — REFACTOR:** none.

**Output:** the stated recovery rule as a use case.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — atomicity + restart proofs on real SQLite

**Requires:** S04-T1; S03-T2; S02-T2/T3/T4.

**Input:** `src/app/task/execution-consistency.test.ts` (new — integration
test wiring real SQLite adapters + `FakeRunner` on a temp DB).

**Action — RED:** (a) **rollback:** inject an `EventFeed.append` that
throws inside tx2 → after the failed `RunNextTask.execute`, the task is
still `running`, the job still `running`, no `task.completed` event — then
recovery + a clean re-run completes it; (b) **crash restart:** manufacture
the post-tx1 state, run `RecoverInterruptedTasks` + the scan/claim cycle
until idle → all tasks `completed`, no duplicate jobs, and a further scan
appends zero events; (c) **idempotent re-scan:** two consecutive
recovery+scan rounds on a settled DB write nothing. Fails today: test does
not exist.

**Action — GREEN:** none expected — this task proves S02–S04 compose; fix
whatever it flushes out.

**Action — REFACTOR:** none.

**Output:** the crash-consistency story of the epic as regression tests
against real SQLite.

**Verify:** `npm test` green (all three groups); `npm run typecheck`
exit 0.
