# 006 Scheduler & Durable Job Store

## Outcome
Provide an in-process scheduler backed by a file-based durable job store so jobs survive restart and due jobs are caught up.

## Decision Anchors
- D5: file-based, in-process; no external broker.
- B5: scheduler enqueues durable jobs; runtime claims them.
- S3: explicit durable task states.
- §3 Scheduler & Queue.
- N1: single-writer, atomic write, lock.

## Stories
- `.agent/plan/stories/006-scheduler-job-store/001-durable-one-shot-jobs.md` - durable one-shot jobs, state machine, claim/reclaim, catch-up, cancellation.

## Verification Gate
- `npm run typecheck` exits 0.
- `npm test` exits 0.

## Dependencies
- Epic 001.
- Epic 002 for file-DB persistence and locks.
- Epic 009 pairs with crash-replay idempotency.

## Non-Goals
- No Bree, PQueue, Redis, external broker, or recurrence/cron.
- No cooperative abort of already-running jobs; that lands in Epic 009.

## Findings Out
- none
