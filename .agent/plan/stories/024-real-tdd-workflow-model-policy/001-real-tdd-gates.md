# Story 001 - Real TDD Gates

Epic: `.agent/plan/epics/024-real-tdd-workflow-model-policy.md`

## Goal

The `tdd@1` workflow's gate pair judges real test runs: `failing_test_exists`
passes only when the task's test command actually fails, `tests_pass` passes
only when it is green — outcomes written to the same gate-status sink the
scheduler dispatches on.

## Acceptance Criteria

- The workflow implements the Epic 006 interface; the repo's test command comes
  from slot/workflow config (not hardcoded) and runs in the task's worktree.
- On a fixture repo with all tests green, `gateCheck(entry)` returns `fail`
  (TDD cannot start without a failing test — PRD §7.1.1 §8 gate pair); with a
  failing test present it returns `pass` — where "failing test" means the
  runner reports **≥1 executed test that failed an assertion**; a fixture repo
  whose suite exits nonzero from a syntax error / missing import returns
  `needs_human`, not `pass` (debate finding — broken infrastructure is not a
  valid RED).
- `gateCheck(exit)` returns `pass` only when the full command exits green; a
  failing suite returns `fail` with the failing test names attached as
  evidence.
- A crashed test command (missing script, spawn error, timeout) returns
  `needs_human` with the error — a gate never converts infrastructure failure
  into pass/fail (PRD §10 — `pass/fail/needs-human` is the full vocabulary).
- Gate outcomes land in the Epic 004 gate-status sink; the scheduler dispatches
  the downstream node only after the exit gate passes (composed assertion).

## Constraints

- Test commands execute through a spawn seam with the Epic 014 isolation rules
  (no ambient env, bounded by the per-verb-style timeout from config).
- The fake workflow remains untouched and in the harness (phases.md — fakes are
  permanent).

## Verification Gate

- `npm test` green for `src/workflow/tdd-gates.test.ts`.

### Task T1 - Entry gate on real runs

**Input:** `src/workflow/tdd-gates.ts`, `src/workflow/tdd-gates.test.ts`

**Action - RED:** Write tests on fixture repos: (a) all-green ⇒ entry `fail`;
(b) assertion-failing test ⇒ entry `pass`; (c) syntax-broken suite (nonzero,
zero executed tests) ⇒ `needs_human`; (d) spawn crash ⇒ `needs_human` with
error.

**Action - GREEN:** Implement the entry gate over the spawn seam + configured
command.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Exit gate + scheduler composition

**Input:** `src/workflow/tdd-gates.ts`, `src/workflow/tdd-gates.test.ts`

**Action - RED:** Write tests: (a) green suite ⇒ exit `pass`; red suite ⇒ `fail`
with failing names; (b) outcomes reach the gate-status sink and gate downstream
dispatch (Epic 004 composed).

**Action - GREEN:** Implement the exit gate + sink wiring.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
