# Story 003 - `blocked_on: op_id` Park & Resume

Epic: `.agent/plan/epics/004-dag-scheduler-and-leases.md`

## Goal

The scheduler-owned park/resume transition for async broker ops: a task records
`blocked_on: op_id`, is not dispatched while that op is in-flight, and is
re-dispatched only when the op's completion row appears — with the result injected
into the fresh dispatch. The session never holds a request id or polls.

## Acceptance Criteria

- Setting a task's `blocked_on: op_id` moves it out of the dispatchable set even if
  its dependency gates and leases are otherwise satisfied (PRD §7.3 — awaiting an op
  is a scheduler-owned transition, not a live wait).
- The task is re-dispatchable only once a **completion row** for that `op_id` exists
  in SQLite (the same sink the scheduler reads) (PRD §5, §7.3 — one wake-up
  mechanism).
- On re-dispatch, the op's completion result is made available to the task's fresh
  dispatch context (PRD §7.3 — result injected into the fresh spawn).
- A task parked on `op_id` releases its session (no request id / no poll loop held
  by the task) — modeled here as: the parked task holds no runtime handle beyond the
  durable `blocked_on` value (PRD §3.2, §7.3).
- **Parking releases the task's capability leases; resume reacquires them before
  dispatch** (debate finding — "session torn down" is false if a parked task keeps
  leases, and expiry-based reclaim would make a normal async wait look like a crash).
  A parked task therefore does not block unrelated tasks on its leases.
- `blocked_on` is a **single** nullable field and exactly **one** completion row is
  consumed on resume — the row model enforces the single-op scope; there is no
  array/list semantics (debate finding — bound the scope in the schema, not prose).
- Clearing `blocked_on` (op complete) and re-dispatch happens within a poll pass on
  the fake clock, no real waiting.

## The completion-row contract (owned here; Epic 005 broker writes to it)

This Story **defines and creates** the `broker_completion` table — the shared write
contract Epic 005's broker writes and this scheduler reads (debate finding — the
writer needs a stable output contract, not just a read shape):

- Columns: `op_id` (PRIMARY KEY — uniqueness key, one completion per op),
  `status` (`done` | `failed`), `result_json` (payload; null on failure),
  `error_json` (failure encoding; null on success), `at`.
- **Idempotent write:** writing a completion for an existing `op_id` is a no-op /
  upsert, never a duplicate row (a reconcile + a late poll must not double-write).
- **`blocked_on` clears** when a `broker_completion` row for the task's `blocked_on`
  op_id exists; resume reads `result_json`/`error_json` from it.

Epic 005 Story 003 asserts its writes conform to this schema.

## Constraints

- `blocked_on` is durable state on the task row; the wake-up is the SQLite
  completion row appearing — no callbacks, no second wake path (PRD §5, §7.3).
- The completion row is written by a **fake** broker in tests (Story-named Mock
  values); the real broker/ledger is Epic 005 (Epic 004 Non-Goals).
- Semantics for multiple concurrent ops per task and cancellation/supersession are
  declared per workflow (PRD §7.3) — **out of scope** here; the single nullable
  `blocked_on` field structurally enforces the single-op park/resume path.
- Lease release-on-park / reacquire-on-resume uses the Story 002 `LeaseManager`
  (park calls `release`, resume calls `acquire` before dispatch).

## Verification Gate

- `npm test` green for `src/scheduler/blocked-on.test.ts`.

### Task T1 - Park removes task from dispatch until completion row appears

**Input:** `src/scheduler/blocked-on.ts`, `src/scheduler/blocked-on.test.ts`

**Action - RED:** Write a test: a task holding leases with satisfied gates but
`blocked_on: op-1` is not dispatchable; parking it **released** its leases (a
different task can now acquire the same capability); after a fake completion row for
`op-1` is written, the task **reacquires** its leases and becomes dispatchable with
the result retrievable for its dispatch context.

**Action - GREEN:** Add the `broker_completion` migration (schema above, `op_id`
PRIMARY KEY, idempotent upsert). Implement `park(taskId, opId)` (set the single
`blocked_on`, `release` leases) and extend the dispatch predicate to exclude parked
tasks unless a `broker_completion` row for their `blocked_on` op exists; on resume
`acquire` leases and expose `result_json`/`error_json`.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Parked task holds no runtime handle

**Input:** `src/scheduler/blocked-on.ts`, `src/scheduler/blocked-on.test.ts`

**Action - RED:** Write a test asserting a parked task's persisted state is only the
durable `blocked_on` value (no request id, no live poller reference stored on the
task) — i.e. reconstructing the task from its row alone is sufficient to resume.

**Action - GREEN:** Ensure `park` stores only `blocked_on` durably and resume reads
solely from the row + completion row.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
