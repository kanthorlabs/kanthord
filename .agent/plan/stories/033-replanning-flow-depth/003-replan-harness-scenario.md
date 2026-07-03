# Story 003 - Replan Harness Scenario

Epic: `.agent/plan/epics/033-replanning-flow-depth.md`

## Goal

The whole §7.5 loop runs as one named, deterministic harness scenario under
`breaking_allowed` — the exercised path phases.md demands, plus the abort
path.

## Acceptance Criteria

- Named scenario `p3-replan-loop` passes on the harness with zero network:
  golden feature mid-run → a task raises the replan signal → new dispatch
  halts → the plan files are edited (a contract change breaking one consumer)
  → human approval via the control path → recompile mints `G+1` → the
  consumer re-opens `rework`, the untouched lane's task is undisturbed → the
  feature completes → the final journal contains the signal, approval,
  re-open, and completion events in order.
- The scenario runs under `contract_policy: breaking_allowed` (the MVP knob —
  the loop is a normal path, not an error path).
- The abort variant: the same setup with the human rejecting the diff resumes
  the feature under `G` and completes it unchanged (both variants in one
  suite).
- Kill-and-restart is injected at **each** transition point of the loop —
  after the signal, before the recompile, after `G+1` is minted, after the
  affected-set snapshot is persisted, mid-re-open application, and after the
  re-open journals — each reproducing the correct post-restart state (debate
  finding — a single crash point between approval and re-open was too narrow
  for the loop's riskiest transitions).

## Constraints

- Composed from the Epic 010 harness kit and this Epic's Stories 001/002 —
  no scenario-local reimplementation of any mechanism (Epic 010
  anti-reimplementation rule).
- Scenario name `p3-replan-loop` is load-bearing: Epic 042 Story 001 composes
  it by name.

## Verification Gate

- `npm test` green for `src/harness/scenarios/p3-replan-loop.test.ts`.

### Task T1 - The loop + abort + crash point

**Input:** `src/harness/scenarios/p3-replan-loop.test.ts`,
`src/harness/**` (fixture plan set for the replan feature only)

**Action - RED:** Write the scenario suite: (a) the full loop as named above
with ordered journal assertions; (b) the abort variant with unchanged
completion; (c) the kill-and-restart injections at each listed transition
point, asserting post-restart state.

**Action - GREEN:** Fix composition/wiring gaps the scenario exposes in the
owning modules from Stories 001/002 (each fix in its owning module, never in
harness code — Epic 010 anti-reimplementation rule).

**Action - REFACTOR:** none.

**Verify:** `npm test` green for the scenario file; the suite imports only
harness kit + public seams (anti-reimplementation check).
