# Story 06 — Retry & failure semantics

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

Failure is stable and recovery is explicit: a failed task stays failed and
blocks its dependents; the daemon moves on; `retry task <id>` resets a
failed task to `pending` and re-enqueues it.

## Acceptance Criteria

- `app/task/retry-task.ts` — `RetryTask.execute({ taskId })`:
  - id must resolve to `task` (`resolveKind`) — else the EPIC 004 named
    errors;
  - status must be `failed` — else `TaskNotRetryableError { taskId,
    status }` (use-case guard; see index);
  - in one transaction: `transitionTask(task, 'pending')`
    (**`failed→pending` — index B1, resolved**), save, `enqueue` (its
    dependencies completed before it first ran and were locked since —
    ready by construction), append `task.ready` on insert.
- Handler `runRetryTask` for `retry task <id>` (positional): exit 0,
  stderr `task re-queued: <id>`; non-failed task or bad reference →
  exit 1, one `error:` line.
- Failure-semantics regression (integration, real temp DB + `FakeRunner
  { failTaskIds }`): graph A→B (B depends on A), C independent; run until
  idle with A scripted to fail → A `failed` (+ `task.failed` with reason),
  B still `pending` and never enqueued, C `completed` (the daemon moved
  on); then `RetryTask(A)` + run until idle → A and B `completed`.

## Constraints

- No retry budget / max attempts — a human decides each retry (nothing in
  the epic asks for auto-retry).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — RetryTask use case + CLI

**Requires:** S02-T4 (`enqueue`); EPIC 002 S004-T1 (`failed→pending` edge,
amended per index B1); EPIC 004 S02 (`resolveKind`), S01 (command table).

**Input:** `src/app/task/retry-task.ts` (new) + test;
`src/apps/cli/task.ts` (extend) + test.

**Action — RED:** hermetic tests: (a) a failed task → `pending`, enqueued,
one `task.ready`; (b) a `pending`/`running`/`completed` task →
`TaskNotRetryableError` naming the status, nothing written; (c) handler
lines/exit codes per AC. Fails today: module does not exist.

**Action — GREEN:** implement + register `retry task` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** explicit human-driven retry end to end.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — failure-semantics regression (integration)

**Requires:** S06-T1; S03-T2; S02 (real adapters).

**Input:** `src/app/task/failure-semantics.test.ts` (new).

**Action — RED:** the A/B/C scenario from the AC, asserted step by step
(statuses, queue contents, the `task.failed` payload reason, the
post-retry completion). Fails today: test does not exist.

**Action — GREEN:** none expected; fix what it flushes out.

**Action — REFACTOR:** none.

**Output:** failed-stays-failed / dependents-blocked / daemon-moves-on /
retry-unblocks as one regression test.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
