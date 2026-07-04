# Story 003 - Compaction Threshold

Epic: `.agent/plan/epics/016-real-agent-sessions.md`

## Goal

When the session's real context-size signal crosses the per-model configured
fraction of the model window, the daemon runs checkpoint → teardown → respawn
through the identical Phase-1 respawn path.

## Acceptance Criteria

- Per-model compaction config (`window`, `compaction_threshold` as a fraction)
  loads from daemon config; a model with no entry falls back to the configured
  system default; the threshold is data, never a code constant (PRD §3.2 —
  per-model config, not a constant).
- With `{ window: 100_000, compaction_threshold: 0.55 }`, a context-size signal
  of 55_001 triggers compaction; **55_000 and below does not** — "crosses" means
  strictly greater than window×threshold, equality asserted (debate finding).
- Compaction runs `checkpoint()` (STATE rewritten through the store), tears the
  session down, and respawns; the three triggers (threshold, task-boundary,
  crash) produce **behaviorally identical respawns** — same journal event shape,
  lease ownership, pending-task state, and injected context (behavior
  equivalence is the AC; the shared-coordinator mechanism is a Constraint —
  debate finding).
- After a compaction respawn, respawn-equivalence holds (pending-task set, lease
  ownership, phase, injected STATE — Epic 006 field list).
- A compaction event with task id, model, signal value, and threshold is
  journaled.

## Constraints

- The context-size signal is read from the pi surface per the SU3 findings; in
  tests it is a Mock reporting Story-named values (PROFILE.md).
- Mechanism constraint: all three respawn triggers route through the single
  Epic 006 coordinator (PRD §3.2 same-code-path rule) — kept as a constraint;
  the ACs assert the observable equivalence.
- The time-based session cap (PRD §3.2 backstop) is **not** built here — 2A
  proof does not need it; noted for Phase 3 hardening.

## Verification Gate

- `npm test` green for `src/agent/compaction.test.ts`.

### Task T1 - Threshold config + boundary trigger

**Input:** `src/agent/compaction.ts`, `src/agent/compaction.test.ts`

**Action - RED:** Write tests: (a) per-model config loads, missing model uses
system default; (b) signal at 55_001/100k with 0.55 triggers; 55_000 and 54_999
do not (equality case explicit); (c) the compaction event is journaled with
signal + threshold.

**Action - GREEN:** Implement threshold evaluation over the mocked signal wired
to the session adapter's monitoring point.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - One respawn path + equivalence

**Input:** `src/agent/compaction.ts`, `src/agent/compaction.test.ts`

**Action - RED:** Write tests: (a) threshold-, task-boundary-, and crash-
triggered respawns produce identical observable effects (journal event shape,
lease ownership, pending-task state, injected context) on the same fixture;
(b) after a compaction respawn the Epic 006 equivalence fields all match.

**Action - GREEN:** Wire the trigger to the Epic 006 coordinator; no new respawn
logic.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
