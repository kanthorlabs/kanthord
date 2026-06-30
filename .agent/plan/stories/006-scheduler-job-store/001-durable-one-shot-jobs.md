# Story 001 - Durable One-Shot Jobs

Epic: `.agent/plan/epics/006-scheduler-job-store.md`

## Goal
Core can enqueue one-shot jobs durably, claim them atomically before running, recover after restart, and catch up jobs that became due while Core was down.

## Acceptance Criteria
- Jobs move through exact states `queued -> claimed -> running -> {done | failed | cancelled}`.
- Terminal states are final and terminal jobs are never re-run.
- Enqueue persists the job before the call returns.
- After restart, non-terminal jobs are recovered from disk.
- A job scheduled for time T while Core is down fires on next startup/reload when due.
- Runtime atomically claims `queued -> claimed` before running.
- The same job cannot be claimed twice.
- On startup, `claimed` and `running` jobs from the dead prior single-process instance are reclaimed to `queued`.
- Reclaimed jobs replay with their persisted `callId`.
- A queued or claimed job can transition to `cancelled` in the store and will not run.
- A timed job does not fire before its scheduled time; exact latency is not guaranteed.
- v1 jobs are one-shot.

## Constraints
- In-process timer plus file-based durable job store (D5, B5).
- No Bree, PQueue, or Redis.
- Job records persist through Epic 002 atomic write, lock, and `version`.
- Claim/reclaim uses the Epic 002 lock.
- File layout is the engineer's choice.

## Verification Gate
- `npm run typecheck`
- `npm test`

### Task 006-RED - Durable job store tests

**Input:** `packages/core/src/**/*.test.ts` or the scheduler package test home.

**Action - RED:** Add `node:test` coverage for the state machine, terminal finality, enqueue persistence, restart recovery/reclaim, due-on-restart catch-up, duplicate claim prevention, queued cancellation, and future jobs not firing early with a fake/short clock.

**Action - GREEN:** none - RED only.

**Action - REFACTOR:** none.

**Verify:** `npm test` fails because the durable job store is missing.

### Task 006-GREEN - Scheduler and durable store

**Input:** `packages/core/src/**` or the scheduler package source home.

**Action - RED:** none - opened by Task `006-RED`.

**Action - GREEN:** Implement one-shot scheduling, durable persistence, claim/reclaim, catch-up, and cancellation so the Story ACs pass.

**Action - REFACTOR:** Keep timer behavior separate from durable state transitions.

**Verify:** `npm run typecheck && npm test` exits 0.
