# Story 002 - Lifecycle Scenarios

Epic: `.agent/plan/epics/010-harness-scenario-suite.md`

## Goal

The mandated lifecycle scenario tests on the harness: lease expiry + heartbeat
timeout, crash/restart with ledger reconciliation, compaction respawn
(respawn-equivalence), and dirty-plan recompile with generation pinning — each a
named, deterministic scenario with an observable pass/fail assertion.

## Acceptance Criteria

- **Lease expiry + heartbeat timeout:** a task holds a lease, its heartbeat lapses,
  the fake clock advances past expiry, the lease is reclaimed, and a waiting task then
  dispatches — asserted on the fake clock (PRD §7.7; Epic 004).
- **Kill/restart respawn-equivalence (distinct from compaction):** a daemon
  kill-and-restart (Epic 009 boot) reproduces the pending-task set, lease ownership,
  current phase, and injected STATE **field-by-field** — the phases.md success
  criterion, which is a separate scenario from compaction respawn (debate finding).
- **Crash/restart + ledger reconciliation:** with an in-flight fake broker op, that
  same kill-and-restart recovers durable op identity from the ledger, marks it
  needs-reconciliation, and the reconcile path resolves it against the fake remote
  (PRD §7.7, §5; Epic 005/009).
- **Fake-broker failure / timeout / regression:** the harness can inject each fake
  broker mode, and a named scenario proves each is handled — a failed op writes a
  failed completion, a timed-out op emits escalation-needed, and a regressing op is not
  left final-`done` (PRD §7.7 — the fake broker models success/failure/timeout/
  regression; debate finding — name these, don't just claim them).
- **Compaction respawn (respawn-equivalence):** crossing the fake compaction threshold
  mid-task checkpoints, respawns, and the post-respawn four fields equal the
  pre-respawn values, asserted **field-by-field** (PRD §7.7; Epic 006).
- **Dirty-plan recompile + generation pinning:** editing a covered plan file marks the
  plan dirty, halts new dispatch, a recompile mints `G+1`, and a task already running
  under `G` keeps its stamp while a halted task dispatches under `G+1` (PRD §7.1.1 §7;
  Epic 004).
- Each scenario is named and its pass/fail is a concrete assertion (phases.md guiding
  rule — gate criteria are named scenarios, not judgment calls).

## Constraints

- Each scenario drives the **same** harness kit (Story 001) — no bespoke setup per
  scenario beyond the injected fault (lease lapse, crash, threshold, plan edit) (PRD
  §7.7).
- All timing is the fake clock; all external effects the fake broker (PRD §7.7).
- These scenarios **exercise** the mechanisms owned by Epics 004/005/006/009; they add
  no new production mechanism (composition only).

## Verification Gate

- `npm test` green for `src/harness/lifecycle.test.ts` (all four scenarios).

### Task T1 - Lease expiry + kill/restart (equivalence + ledger reconciliation)

**Input:** `src/harness/lifecycle.ts`, `src/harness/lifecycle.test.ts`

**Action - RED:** Write the lease-expiry+heartbeat scenario (lapse → reclaim → waiter
dispatches); and the kill/restart scenario (with an in-flight op) asserting **both**
the field-by-field respawn-equivalence (pending set, lease ownership, phase, injected
STATE) **and** ledger reconciliation (recover durable op identity → reconcile against
fake remote).

**Action - GREEN:** Compose the harness + injected faults to realize both scenarios
(no new mechanism; wire existing seams).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Compaction respawn + dirty-plan generation scenarios

**Input:** `src/harness/lifecycle.ts`, `src/harness/lifecycle.test.ts`

**Action - RED:** Write the compaction-respawn scenario (threshold → checkpoint →
respawn → field-by-field equivalence) and the dirty-plan scenario (edit → halt new
dispatch → recompile `G+1` → running `G` keeps stamp) on the harness.

**Action - GREEN:** Compose the harness + injected faults to realize both scenarios.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T3 - Fake-broker failure / timeout / regression injection

**Input:** `src/harness/lifecycle.ts`, `src/harness/lifecycle.test.ts`

**Action - RED:** Write three named scenarios injecting each fake broker mode: a
**failed** op writes a failed completion; a **timed-out** op emits escalation-needed
(no terminal); a **regressing** op (with `observed_state_can_regress: true`) is not
left final-`done`. Assert each on the fake clock.

**Action - GREEN:** Drive the fake broker (Epic 005) modes through the harness poller;
no new mechanism.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
