# Story 002 - Control Verbs

Epic: `.agent/plan/epics/026-control-plane-api.md`

## Goal

The four control actions — sign-off, halt, re-planning diff approval, budget
override — act only through existing seams, are journaled with actors, and the
override is rate-limited and captured as an interaction.

## Acceptance Criteria

- `plan.signOff(featureId)` runs the Epic 002 compile: invalid ⇒ the
  planner-vocabulary diagnostics returned verbatim; valid ⇒ compiled, generation
  stamped, sign-off journaled with actor.
- `task.halt` / `feature.halt` park the target through Epic 004 transitions,
  journaled; halting an already-halted target is a typed conflict; a halted
  task is not re-dispatched until resumed (existing inbox `resume` covers
  resumption).
- `plan.approveReplan(diff)` applies the authored-file edit set atomically
  through the store (one plan-class commit), recompiles to `G+1`, and re-opens
  exactly the gates of affected downstream tasks — an unaffected parallel task's
  gate stays closed (PRD §7.5 fixture asserted). Hardening (debate finding):
  paths outside the feature dir's covered plan files — traversal, symlinks,
  generated files — are rejected typed; the diff carries its **base
  generation** and a live-generation mismatch is a typed conflict; a failed
  recompile rolls the store back to the pre-apply commit (atomicity asserted).
- `budget.override(taskId, amount, reason)` above the configured rate limit or
  per-day cap is rejected; an accepted override is per-task, one-shot, expires
  with the task, and requires the reason (debate finding — scoped, no ratchet);
  it raises the ceiling, annotates the ledger, and emits a typed interaction
  event with actor + amount + reason (PRD §4 — sole ring-1 exception).
- Every control call requires the auth context (Story 003) and an actor; all
  four are journaled.

## Constraints

- No control logic in the RPC layer — routing to Epic 002/004/012/013 seams
  only (Epic 017 pattern).
- The re-plan diff format is the authored-file edit set (path + new content) —
  the compiled plan is never edited (PRD §7.1.1 §7).

## Verification Gate

- `npm test` green for `src/rpc/control-verbs.test.ts`.

### Task T1 - Sign-off + halt

**Input:** `src/rpc/control-verbs.ts`, `src/rpc/control-verbs.test.ts`

**Action - RED:** Write tests: (a) sign-off invalid ⇒ verbatim diagnostics;
valid ⇒ generation stamped + journaled; (b) halt parks + journals; double-halt
⇒ conflict; halted task stays undispatched.

**Action - GREEN:** Implement the two methods over Epic 002/004 seams.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Re-plan approval + budget override

**Input:** `src/rpc/control-verbs.ts`, `src/rpc/control-verbs.test.ts`

**Action - RED:** Write tests: (a) approve-replan applies the edit set as one
plan commit, mints `G+1`, re-opens only affected gates; (b) traversal/symlink/
out-of-feature paths rejected typed; base-generation mismatch ⇒ conflict; a
failing recompile rolls back to the pre-apply commit; (c) override rate-limit
and per-day-cap rejection; accepted override (with reason) raises the ceiling
one-shot, expires with the task, ledger annotation + interaction event.

**Action - GREEN:** Implement both methods over store/compiler/ledger seams
with the hardening guards.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
