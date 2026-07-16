# Story 09 — Live insert / re-arrange while running

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

Prove the epic's live-mutation contract as regression tests **through the
real `RunDaemon` loop** (debate finding — manually interleaving scans
would bypass the behavior under test): readiness is recomputed at claim
time and the loop re-scans every iteration, so EPIC 004 mutations made
while the daemon runs are honored on the next iteration.

## Acceptance Criteria

All on a real temp DB, driving `RunDaemon` (until-idle) with an
**instrumented runner** — a thin wrapper around `FakeRunner` whose
per-task callback performs the mutation *while the daemon is
mid-execution*, exactly like a concurrent CLI process (same DB
reads/writes; single event loop interleaving is equivalent here because
every loop decision reads the DB inside a transaction):

- **Insert while running:** during execution of task 1, the callback
  creates a new ready task (EPIC 004 `CreateTask`) → the same daemon run
  picks it up on a later iteration and completes it — before going idle.
- **Re-arrange while queued:** X and Y both enqueued and ready (no edge);
  during execution of another task, the callback adds X→Y
  (`AddDependency`, X still `pending`) → the claim of X's stale job
  **skips and discards** it (X never executes early); after Y completes,
  the loop's next scan re-enqueues X and it executes — exactly once
  overall.
- **No retro-blocking:** the callback attempting `AddDependency` against a
  `running` or `completed` task gets `DependenciesLockedError`
  (EPIC 002/004) and the run finishes unchanged.
- **Order:** in the re-arrange scenario the event stream shows Y's
  `task.completed` before X's `task.started`, and X has exactly one
  `task.started`.

## Constraints

- Pure test story: no production code expected; any behavior gap it finds
  is fixed in the owning module (S03/S07, most likely).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — live-mutation regression suite

**Requires:** S07-T1 (`RunDaemon`); S03-T1/T2; S04-T1; EPIC 004 S05
(`CreateTask`), S06 (`AddDependency`).

**Input:** `src/app/task/live-mutation.test.ts` (new — includes the
instrumented-runner test helper).

**Action — RED:** the four AC scenarios as ordered assertions (statuses,
job table contents, event stream). Fails today: test does not exist.

**Action — GREEN:** none expected; fix what it flushes out in place.

**Action — REFACTOR:** none.

**Output:** the claim-time-readiness + per-iteration-scan contract proven
against the real daemon loop.

**Verify:** `npm test` green (all four scenarios); `npm run typecheck`
exit 0.
