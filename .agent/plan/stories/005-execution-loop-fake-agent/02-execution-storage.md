# Story 02 — Execution storage groundwork

Epic: `.agent/plan/epics/005-execution-loop-fake-agent.md`

## Goal

Everything the loop needs from storage before any use case exists:
migration 4 (`events.payload`, `initiatives.paused`), the domain event
payload, the `UnitOfWork` transaction port, and the `JobQueue` extensions
(boolean `enqueue`, paused-aware `claim`, `finish`, `discard`,
`listRunningJobs`). Initiative pause **storage methods** live in story 05
(debate finding — one concern per task).

## Locked DDL (migration 4, `execution-loop`)

```sql
ALTER TABLE events ADD COLUMN payload TEXT;
ALTER TABLE initiatives ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));
```

## Acceptance Criteria

- `src/domain/event.ts`: `Event` gains `payload?: Record<string, string>`;
  `newEvent(type, { taskId, payload? })` passes it through. No other domain
  change.
- `SqliteEventFeed` round-trips `payload` as JSON text; events without
  payload store NULL and read back without the key.
- `src/storage/port.ts` gains `UnitOfWork { transaction<T>(fn: () => T): T }`;
  `src/storage/sqlite/sqlite-unit-of-work.ts` implements it with
  `BEGIN IMMEDIATE` / `COMMIT`, `ROLLBACK` + rethrow on throw; nested
  `transaction()` throws.
- `JobQueue` port (`src/queue/port.ts`) extended per the capability map:
  `enqueue → boolean` (index B2, resolved), `finish(jobId,
  'completed'|'failed')`, `discard(jobId)` (DELETE), `listRunningJobs()`.
  `claim()` keeps its signature but the SQL now joins
  tasks→objectives→initiatives and skips `paused = 1` initiatives.
- `TaskRepository` gains `getInitiativeId(taskId)`
  (task→objective→initiative join).

## Constraints

- All adapters share one injected `DatabaseSync` (wired in `main.ts`), so
  `UnitOfWork.transaction` covers repo + queue + feed calls made inside
  `fn`.
- Migration 4 appends to `MIGRATIONS`; never edit migrations 1–3.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — domain event payload

**Requires:** EPIC 002 S006-T1 (`Event`, `newEvent`).

**Input:** `src/domain/event.ts`, `src/domain/event.test.ts`.

**Action — RED:** tests: (a) `newEvent('task.failed', { taskId, payload:
{ reason: 'x' } })` carries the payload; (b) `newEvent('task.ready',
{ taskId })` has no `payload` key; (c) existing assertions unchanged. Fails
today: `payload` not accepted.

**Action — GREEN:** add the optional field + pass-through.

**Action — REFACTOR:** none.

**Output:** `Event.payload?: Record<string, string>` in the domain.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — migration 4 + payload round-trip

**Requires:** S02-T1; EPIC 003 S002-T1 (migration 2), S005-T1
(`SqliteEventFeed`); EPIC 004 S05-T1 (migration 3).

**Input:** `src/storage/sqlite/migrations.ts` (append migration 4),
`src/storage/sqlite/migrations.test.ts` (extend), `src/events/sqlite.ts`,
`src/events/sqlite.test.ts` (extend).

**Action — RED:** temp-DB tests: (a) after `migrate`, version is 4;
`events` has a nullable `payload` column, `initiatives` has
`paused NOT NULL DEFAULT 0`; (b) `paused = 2` is rejected (CHECK);
(c) `append` of an event with `payload: { reason: 'boom' }` then
`readAfter('0')` returns the payload deep-equal; an event without payload
reads back without the key; (d) migration re-run applies nothing. Fails
today: migration 4 does not exist.

**Action — GREEN:** append migration `{ version: 4, name: 'execution-loop' }`
with the locked DDL; extend `SqliteEventFeed` to write/read the JSON
column.

**Action — REFACTOR:** none.

**Output:** migrated schema + payload-capable event feed.

**Verify:** `npm test` green (all four groups); `npm run typecheck` exit 0.

### Task T3 — UnitOfWork port + adapter

**Requires:** EPIC 003 S001-T1 (`openDatabase`).

**Input:** `src/storage/port.ts` (extend),
`src/storage/sqlite/sqlite-unit-of-work.ts` (new) + test (new).

**Action — RED:** temp-DB tests: (a) two INSERTs inside `transaction(fn)`
both persist; (b) if `fn` throws after the first INSERT, nothing persists
and the error propagates; (c) `transaction` inside `transaction` throws;
(d) after a rollback the connection is reusable (a following transaction
commits). Fails today: port/adapter do not exist.

**Action — GREEN:** implement `SqliteUnitOfWork` (`BEGIN IMMEDIATE` /
`COMMIT` / `ROLLBACK` + rethrow; an `inTransaction` flag for the nesting
guard).

**Action — REFACTOR:** none.

**Output:** `UnitOfWork` port + SQLite adapter making multi-adapter writes
atomic on the shared connection.

**Verify:** `npm test` green (all four cases); `npm run typecheck` exit 0.

### Task T4 — JobQueue extensions + paused-aware claim

**Requires:** S02-T2 (paused column); EPIC 003 S004-T1 (`SqliteJobQueue`),
S003 (`TaskRepository`).

**Input:** `src/queue/port.ts`, `src/queue/sqlite.ts`,
`src/queue/sqlite.test.ts` (extend); `src/storage/port.ts`,
`src/storage/sqlite/sqlite-task-repository.ts` + test (extend —
`getInitiativeId`).

**Action — RED:** temp-DB tests: (a) `enqueue` returns `true` on insert,
`false` on the idempotent no-op; (b) `finish(jobId, 'completed')` /
`'failed'` set the job status; (c) `discard(jobId)` deletes the row;
(d) `listRunningJobs()` returns exactly the `running` jobs; (e) with
`initiatives.paused = 1` set via SQL, `claim()` skips that initiative's
queued job while claiming others; with `paused = 0` again it is claimable;
(f) `getInitiativeId(taskId)` returns the owning initiative. Fails today:
methods do not exist.

**Action — GREEN:** implement the port methods; extend the claim UPDATE's
job-selection subquery with the tasks→objectives→initiatives join and
`i.paused = 0`.

**Action — REFACTOR:** none.

**Output:** the queue slice of the capability map + `getInitiativeId`.

**Verify:** `npm test` green (all six groups); `npm run typecheck` exit 0.
