# Story 004 - Phase-Boundary Source-Drift Hook

Epic: `.agent/plan/epics/006-workflow-and-agent-session.md`

## Goal

The workflow half of §6.3 drift detection: at each phase-boundary transition, re-hash
the source-of-truth against the clone-on-sign-off snapshot (Epic 002) and, on drift,
signal the human while the task keeps working. (Epic 010 only runs the end-to-end
scenario over this mechanism.)

## Acceptance Criteria

- On a workflow phase-boundary transition (`currentPhase()` advance), the hook
  re-fetches the source via the injected source-provider seam and re-hashes it,
  comparing against the node's clone-on-sign-off `content_hash` (Epic 002) (PRD §6.3 —
  re-hash at every phase boundary).
- On a **matching** hash, no drift event is produced.
- On a **differing** hash, a human-signal escalation event is recorded **and the task
  is not halted** — it keeps working unless separately halted (PRD §6.3 — signal, keep
  working unless halted).
- The re-hash happens at **every** phase boundary, not only at completion (PRD §6.3 —
  a day-1 change must be caught early, not after wasted days).
- The mechanism only **reads + hashes** the source; it pushes nothing outward (PRD
  §6.3 — sync is one-directional and shallow).

## Constraints

- The source-provider is the same injected seam Epic 002 uses at sign-off (a fake in
  Phase 1 returning content by ticket ref); no real Jira/GitHub, no network (PRD §6.3;
  phases.md Phase 1).
- The hook fires on the Epic 006 Story 001 phase-transition; the signal is an
  escalation event (jsonl, Epic 001), the same shape as other escalations (PRD §6.3).
- Phase-1 scope is **detection + signal only**; the re-plan/handling flow is Phase 3
  (phases.md Phase 3 — ticket-drift handling).

## Verification Gate

- `npm test` green for `src/workflow/drift-hook.test.ts`.

### Task T1 - Re-hash at phase boundary; signal on drift, keep working

**Input:** `src/workflow/drift-hook.ts`, `src/workflow/drift-hook.test.ts`

**Action - RED:** Write tests: (a) a phase-boundary transition with an unchanged
source produces no drift event; (b) a transition with a changed source records a
human-signal escalation event and the task remains non-halted; (c) the re-hash fires
on each phase boundary, not only at the final phase.

**Action - GREEN:** Implement the phase-boundary drift hook: on `currentPhase()`
advance, re-fetch+re-hash via the source-provider seam, compare to the Epic 002
snapshot, and emit a signal escalation on mismatch without halting.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
