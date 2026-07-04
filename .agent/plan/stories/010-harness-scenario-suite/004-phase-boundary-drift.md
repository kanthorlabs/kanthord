# Story 004 - Phase-Boundary Drift Scenario

Epic: `.agent/plan/epics/010-harness-scenario-suite.md`

## Goal

The harness scenario proving the **pre-existing** §6.3 drift mechanism end-to-end:
clone-on-sign-off snapshot (Epic 002) + phase-boundary re-hash/signal hook (Epic 006)
detect a day-1 source change at the next phase boundary, signal the human, and keep
working. This Story adds **no** mechanism — it composes and asserts (debate finding —
the capstone must not deliver new product behavior).

## Acceptance Criteria

- On the harness, a multi-phase task snapshots its source at sign-off (Epic 002), the
  fake source is changed after phase 0, and the drift is detected at the **next**
  phase boundary (Epic 006 hook) — not deferred to completion — asserted on the fake
  clock (PRD §6.3; §7.7 mandated scenario).
- The detection records a human-signal escalation event and the task **keeps working**
  (non-halted) (PRD §6.3).
- An unchanged source across phase boundaries produces no drift event (control case).
- The scenario runs under the no-network guard (Story 001) with the fake source
  provider (no network).

## Constraints

- **No new mechanism here** — the snapshot lives in Epic 002 (clone-on-sign-off) and
  the re-hash/signal hook in Epic 006 (phase-boundary); this Story only arranges the
  fixture (fake source, phase advances, injected change) and asserts the outcome
  (debate finding — ownership is Epic 002/006, scenario is Epic 010).
- Uses the harness kit (Story 001) and the fake source provider; fake clock only.

## Verification Gate

- `npm test` green for `src/harness/source-drift.test.ts` on the fake clock.

### Task T1 - Day-1 change caught at next phase boundary (scenario)

**Input:** `src/harness/source-drift.ts`, `src/harness/source-drift.test.ts`

**Action - RED:** Write a harness scenario: a multi-phase task snapshots its source
(Epic 002), the fake source is changed after phase 0, and the Epic 006 phase-boundary
hook detects the drift at the **next** boundary — recording a human-signal escalation
and leaving the task non-halted; assert the unchanged-source control produces no
event. All on the fake clock, under the no-network guard.

**Action - GREEN:** Compose the harness (Story 001) + Epic 002 snapshot + Epic 006
drift hook + fake source provider to realize the scenario — **no** new detection logic
in this file.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
