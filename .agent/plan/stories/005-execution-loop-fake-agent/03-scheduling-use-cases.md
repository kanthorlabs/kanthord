# Story 03 — Scheduling use cases

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

The loop body as two hermetically testable use cases: `EnqueueReadyTasks`
(domain readiness → queue, exactly-once `task.ready`) and `RunNextTask`
(claim → stale check → execute → record → unblock dependents).

## Acceptance Criteria

- `app/task/enqueue-ready-tasks.ts` — `EnqueueReadyTasks.execute():
  string[]` (enqueued task ids). In **one transaction**: for every
  initiative from `listAllInitiatives()` with `paused = false`, run
  `readiness(listTasksByInitiative(id))`; for each `ready` node call
  `enqueue(taskId)`; **only when `enqueue` returned `true`** append a
  `task.ready` event. Re-running with nothing changed enqueues nothing and
  emits nothing.
- `app/task/run-next-task.ts` — `RunNextTask.execute(): Promise<
  { outcome: 'idle' } | { outcome: 'skipped' | 'completed' | 'failed';
  taskId: string }>`:
  - **tx1:** `claim()`; `undefined` → `idle`. Load the task, its context,
    and its initiative's task set (`getInitiativeId` +
    `listTasksByInitiative`); recompute `readiness`; if the claimed task
    is not `ready` → `discard(jobId)` → `skipped` (nothing else written).
    Else `transitionTask(task, 'running')`, save, append `task.started`.
  - Resolve the runner (`AgentRunnerResolver.for`); a
    `RunnerNotResolvableError` is recorded as a failure in tx2 (reason =
    error name + message) — the daemon survives.
  - `await runner.run(task, context)` — outside any transaction, wrapped
    in try/catch: **a rejected promise is recorded as a failure in tx2**
    with `reason` = error name + message (debate finding — EPIC 006's real
    runner will reject; the daemon must survive).
  - **tx2:** `completed` → `transitionTask('completed')` + save +
    `finish(jobId, 'completed')` + `task.completed` event + re-run
    readiness over the initiative and `enqueue` newly-ready dependents
    (each inserted → `task.ready` event). `failed` (returned, thrown, or
    unresolvable) → `transitionTask('failed')` + save +
    `finish(jobId, 'failed')` + `task.failed` event with
    `payload: { reason }`; no dependent enqueue.
- All tests hermetic: fake `JobQueue`/repositories/`EventFeed`/`UnitOfWork`
  (pass-through `transaction`), `FakeRunner` from S01.

## Constraints

- No use-case-calls-use-case: `RunNextTask` re-runs `readiness` + `enqueue`
  itself (shared logic lives in `domain/graph.ts`).
- Event ids come from `newEvent` (single writer) — ordering per EPIC 003.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — EnqueueReadyTasks

**Requires:** S02-T4 (`enqueue → boolean`); S05-T1's `listAllInitiatives`
is consumed as a **fake** here (hermetic) — no build-order inversion;
EPIC 002 S005-T2 (`readiness`), S006-T1 (`newEvent`).

**Input:** `src/app/task/enqueue-ready-tasks.ts` (new) + test (new).

**Action — RED:** hermetic tests on a diamond graph: (a) first run
enqueues exactly the ready pending tasks and appends one `task.ready` per
enqueued task; (b) an immediate second run enqueues nothing and appends
nothing (idempotence — fake `enqueue` returns `false`); (c) tasks of a
paused initiative are never enqueued; (d) blocked/running/completed/failed
tasks are never enqueued; (e) everything happens inside one `transaction`
call (fake UnitOfWork records invocations). Fails today: module does not
exist.

**Action — GREEN:** implement per the AC.

**Action — REFACTOR:** none.

**Output:** `EnqueueReadyTasks` — the idempotent readiness → queue scan.

**Verify:** `npm test` green (all five cases); `npm run typecheck` exit 0.

### Task T2 — RunNextTask

**Requires:** S03-T1 (conventions); S01-T2 (resolver); S02-T4 (queue
surface); EPIC 002 S004-T1 (`transitionTask`).

**Input:** `src/app/task/run-next-task.ts` (new) + test (new).

**Action — RED:** hermetic tests: (a) empty queue → `idle`, nothing
written; (b) happy path → task `completed`, job finished `completed`,
events `task.started` then `task.completed`, runner saw the task's context
bindings; (c) completing a task enqueues its now-ready dependent and emits
its `task.ready` (only for actually-inserted jobs); (d) scripted failure →
task `failed`, job `failed`, `task.failed` with
`payload.reason = 'scripted failure'`, dependent **not** enqueued;
(e) claimed task not ready (a dep was added after enqueue) → `skipped`,
job discarded, task still `pending`, no events, runner never called;
(f) an `ai_provider` binding → `failed` with the
`RunnerNotResolvableError` reason (no throw); (g) **a runner whose promise
rejects** → `failed` with the error's name+message as reason, job
`failed`, daemon-visible result (no throw); (h) tx1 and tx2 are two
`transaction` calls and the runner runs between them (fake UnitOfWork +
call-order assertions). Fails today: module does not exist.

**Action — GREEN:** implement per the AC.

**Action — REFACTOR:** none.

**Output:** `RunNextTask` — the complete claim→execute→record→unblock loop
body, total over runner misbehavior.

**Verify:** `npm test` green (all eight cases); `npm run typecheck` exit 0.
