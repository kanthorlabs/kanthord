# Story 005 - The Composed Scheduler Poll

Epic: `.agent/plan/epics/004-dag-scheduler-and-leases.md`

## Goal

One persisted-state poll pass that composes all four dispatch conditions — gates
pass, leases atomically acquirable, not parked, generation permits — and dispatches
exactly the tasks that satisfy all of them. This is the PRD §7.3 promise ("DAG
executor is a `WHERE` clause on the existing poll"), proven as combined behavior,
not four separately-tested parts.

## Acceptance Criteria

- `pollOnce(feature)` dispatches a task **iff** all hold: every dependency's exit
  gate passed (Story 001) **and** its leases were acquired atomically (Story 002)
  **and** it is not parked on an in-flight op (Story 003) **and** generation rules
  permit its dispatch (Story 004) (PRD §7.3 — gates ∧ lease-free).
- **Gate + lease collision in one pass:** two DAG-ready tasks that collide on a
  capability — one `pollOnce` acquires the lease for exactly one and dispatches it;
  the other stays pending; a later pass (after release) dispatches the loser. Proven
  in a single scheduler test, not by composing two library tests (debate finding).
- A poll pass is deterministic and idempotent over unchanged persisted state: two
  successive `pollOnce` calls with no state change dispatch the same set (no hidden
  timers/callbacks) (PRD §7.3 — persisted-state polling seam).
- Running the golden feature to completion through repeated `pollOnce` passes (with
  gates marked passed as tasks "finish", on the fake clock) reaches all-tasks-done in
  a DAG-valid, lease-respecting order.

## Constraints

- `pollOnce` is the single dispatch entry point; Stories 001–004 provide its
  sub-predicates and the lease/park/generation transitions it calls (PRD §7.3 — no
  new infrastructure, one poll).
- No real concurrency, clock, gates, or broker — the fake clock drives time and
  tests set gate/completion state directly (Epic 004 Non-Goals). Real wiring is Epic
  010's harness.
- The poll acquires leases as part of dispatching (atomic, Story 002) so a task is
  never "dispatched" without its leases.

## Verification Gate

- `npm test` green for `src/scheduler/poll.test.ts` including the collision and
  full-drain scenarios.

### Task T1 - Composed dispatch predicate + collision in one pass

**Input:** `src/scheduler/poll.ts`, `src/scheduler/poll.test.ts`

**Action - RED:** Write tests: (a) a task is dispatched only when gates ∧ lease ∧
not-parked ∧ generation-permits all hold — flip each condition false in turn and
assert non-dispatch; (b) two DAG-ready tasks colliding on a capability → one
`pollOnce` dispatches exactly one (acquiring the lease); after release, the next
pass dispatches the other.

**Action - GREEN:** Implement `pollOnce(feature)` composing the Story 001–004
predicates and acquiring leases atomically as it dispatches.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Full golden-feature drain, deterministic pass

**Input:** `src/scheduler/poll.ts`, `src/scheduler/poll.test.ts`

**Action - RED:** Write a test that drives the golden feature to all-done via
repeated `pollOnce` (marking each dispatched task's exit gate passed to simulate
completion), asserting the dispatch order is DAG-valid and lease-respecting; and
assert two `pollOnce` calls over unchanged state return the identical dispatch set.

**Action - GREEN:** Ensure `pollOnce` is a pure function of persisted state so the
drain is deterministic and idempotent per pass.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
