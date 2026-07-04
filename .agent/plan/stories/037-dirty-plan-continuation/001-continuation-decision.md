# Story 001 - Continuation Decision

Epic: `.agent/plan/epics/037-dirty-plan-continuation.md`

## Goal

On a dirty-plan recompile, each running task is deterministically kept or
parked by the Epic 033 affected-set seam — fail-closed, journaled, with the
conservative fallbacks intact.

## Acceptance Criteria

- On recompile to `G+1`, a running task continues under `G` **only** when the
  seam's verdict is `unaffected` — which by the seam contract means the full
  §7.1.1 envelope is untouched: its node, its dependency closure, its ACs,
  its consumed artifacts' publishers, and the feature-level invariants
  (debate finding — the keep rule is the envelope, not "node text
  unchanged"); the journal records the keep decision with the seam's
  evidence (which sets were checked).
- **Every non-`unaffected` verdict parks**: `changed`, `downstream`,
  `invalidated`, `added`, `removed`, a missing verdict, and a seam error each
  park the task for rebase (the Epic 033 Story 002 marker + path) — the full
  verdict list is enumerated in the test, so a future verdict cannot be
  silently ignorable (debate finding); the journal records the park reason.
- The four §7.1.1 park triggers each asserted as separate cases against a
  running task: its node edited; a dependency edited; a consumed artifact's
  publisher edited; the epic Acceptance section edited (the `invalidated`
  verdict case).
- Any seam error or indeterminate result parks the task (fail-closed,
  asserted with an injected seam fault).
- Dirty still halts **new** dispatch, and a failed recompile still halts the
  whole feature — the Epic 004 baseline behaviors are re-asserted unchanged
  in this suite (regression pins).

## Constraints

- The decision consumes the exported affected-set **verdict contract** from
  Epic 033 (`src/replan/affected-set.ts`) — the same contract the re-open
  path uses; reimplementing the classification anywhere is a review blocker
  (Epic 037 anchor: one implementation; debate finding — the requirement is
  the shared contract, not a particular import site).
- Continuation applies to running tasks only; pending tasks always wait for
  the recompiled generation (PRD §7.1.1).

## Verification Gate

- `npm test` green for `src/scheduler/continuation.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Keep/park decision

**Input:** `src/scheduler/continuation.ts`, `src/scheduler/generation.ts`,
`src/scheduler/continuation.test.ts`

**Action - RED:** Write tests: (a) unaffected running task continues under
`G` to completion, keep decision journaled with evidence; (b) the four park
triggers as separate cases with journaled reasons; (c) injected seam fault ⇒
park (fail-closed); (d) regression pins: dirty halts new dispatch; failed
recompile halts the feature.

**Action - GREEN:** Implement the keep/park decision in the recompile path,
driven by the affected-set seam.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0; the suite imports
the seam module (no local re-derivation — reviewer check).
