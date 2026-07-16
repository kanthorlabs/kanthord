# Story 004 - job queue

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

## Goal

The queue capability exists behind a port: idempotent enqueue and the
atomic `UPDATE … RETURNING` claim, with the concurrency claim proven by
two real processes against the same database file — and the `SQLITE_BUSY`
policy decided and written down.

## Acceptance Criteria

- `src/queue/port.ts`: `JobQueue { enqueue(taskId: string): void;
  claim(): ClaimedJob | undefined }`, `ClaimedJob { id: string; taskId:
  string }`.
- Enqueue is idempotent **while queued**: re-enqueueing a task that
  already has a `queued` job is a no-op (partial unique index +
  `ON CONFLICT DO NOTHING`); after that job is claimed (`running`), a new
  enqueue creates a fresh `queued` job (EPIC 005 retry depends on this).
- Claim takes the oldest `queued` job by `ORDER BY id LIMIT 1` in one
  `UPDATE … SET status='running' … RETURNING id, taskId`; empty queue →
  `undefined`. Oldest-first relies on `newId` producing strictly
  increasing ids within one process (EPIC 002 S006 asserts this) —
  documented on the port, not sold as a general FIFO guarantee (debate
  finding).
- **`SQLITE_BUSY` policy (locked):** WAL, single writer; every connection
  sets `busy_timeout=5000` via `openDatabase`; an operation that still
  fails with `SQLITE_BUSY` throws — no silent retry in the adapter.
  Callers (the EPIC 005 daemon) decide retries. Recorded as a doc comment
  on the port.
- Two concurrent OS processes claiming from one DB file never
  double-claim: exactly one wins a single job, and over a batch the union
  of claims is exactly the enqueued set.

## Constraints

- Adapter `src/queue/sqlite.ts` (`SqliteJobQueue`), constructor-injected
  `DatabaseSync`, imports nothing from other capability directories. Job
  ids are ULIDs via `domain/entity.ts` `newId`.
- The concurrency proof runs real processes — `node:sqlite` is
  synchronous, so two connections on one event loop cannot interleave
  (epic debate finding).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - port + adapter, single connection

**Requires:** S002-T1 (schema: `jobs` + partial unique index).

**Input:** `src/queue/port.ts` (new), `src/queue/sqlite.ts` (new),
`src/queue/sqlite.test.ts` (new); consumes `newId`, `openDatabase`,
`MIGRATIONS` (test-side).

**Action - RED:** temp-DB tests (task rows seeded for FK): (a) `enqueue`
then `claim` returns `{ id, taskId }` and the job is `running`; (b)
`claim` on empty queue → `undefined`; (c) double `enqueue` of one task
leaves one `queued` job; (d) after claiming, `enqueue` of the same task
creates a new `queued` job; (e) two tasks enqueued in order are claimed
oldest-first. Fails today: module does not exist.

**Action - GREEN:** implement `SqliteJobQueue`
(`INSERT … ON CONFLICT DO NOTHING` targeting the partial index; the
locked `UPDATE … RETURNING` claim). Write the `SQLITE_BUSY` +
monotonic-id doc comments on the port.

**Action - REFACTOR:** none.

**Output:** `JobQueue`/`ClaimedJob` port + `SqliteJobQueue`.

**Verify:** `npm test` green (all five RED cases); `npm run typecheck`
exit 0.

### Task T2 - multi-process claim proof

**Requires:** S004-T1.

**Input:** `src/queue/claim-worker.test-helper.ts` (new — test-only child
script, name outside the `*.test.ts` glob), `src/queue/sqlite.test.ts`
(extend).

**Action - RED:** two cases. **Exact race (debate finding):** temp DB
with **one** queued job; spawn two child processes with a
`--wait-for <file>` barrier flag; the parent creates the barrier file
after both children report ready; each child attempts exactly one
`claim()` and prints `claimed <taskId>` or `empty`; assert exactly one
`claimed` and one `empty`. **Batch sweep:** 50 queued jobs; two children
loop `claim()` until `undefined`, printing one `taskId` per line; assert
both exit 0, output sets disjoint, union = the 50 enqueued ids, total
lines = 50. Fails today: helper does not exist.

**Action - GREEN:** implement the helper (open via `openDatabase`,
construct `SqliteJobQueue`, single-claim or claim-until-empty mode,
print, close).

**Action - REFACTOR:** none.

**Output:** the no-double-claim guarantee is a regression test against
real processes and one DB file.

**Verify:** `npm test` green; `npm run typecheck` exit 0. If the
import-boundary lint flags the helper (it imports `openDatabase`),
escalate to the maintainer (story 007 M1 owns the exemption) — do not
weaken the rule in-lane.
