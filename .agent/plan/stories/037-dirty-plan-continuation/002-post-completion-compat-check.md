# Story 002 - Post-Completion Compatibility Check

Epic: `.agent/plan/epics/037-dirty-plan-continuation.md`

## Goal

A task that finished against a superseded generation cannot merge until its
plan-level definition is proven unchanged against the latest generation —
continuation stays an optimization, never a safety hole.

## Acceptance Criteria

- A task completing under a superseded `G` enters `awaiting_compat_check`,
  and the transition is **one durable unit**: the completion record, the
  pending-check entry, and the merge block are written together — at no
  observable point (including across a crash in the window) is the merge
  approval available before the check passes (debate finding); a task
  completing under the latest generation is untouched by this story (both
  asserted).
- **Merge-effectiveness, not UI availability, is gated** (debate finding): a
  `github.merge` approval already issued or pending before the generation
  was superseded is suspended by the transition — no prior approval, queued
  op, or cached availability can merge until the check passes (asserted by
  pre-issuing an approval, then superseding).
- The check compares, between the task's pinned `G` and a **snapshotted
  candidate latest generation**: its node definition, its dependency set,
  its consumed artifact references (publisher id + declared contract path +
  expected hash — debate finding: hashes alone miss publisher-definition
  changes), its ACs, and the feature-level invariants (debate finding — the
  epic Acceptance case must be caught here too, not only by Story 001's
  park) — via the Epic 033 seam's verdict between the two generations.
- Before unblocking merge, the check re-validates its candidate is **still**
  the latest generation; if a newer one appeared meanwhile, the check re-runs
  against it (debate finding — "latest" is a moving target).
- Pass ⇒ the task's `github.merge` approval unblocks; the pass is journaled
  with both generation ids.
- Fail ⇒ a rework escalation carrying the definition diff as evidence; the
  merge approval stays blocked; a human rework response routes the task into
  the Epic 033 re-open path.
- The check runs automatically when the completion and the newer generation
  exist in either order (complete-then-recompile and recompile-then-complete
  both asserted).
- Restart between completion and check neither loses the pending check nor
  double-runs it, and the merge stays blocked across the crash window
  (durable, asserted).
- Named harness scenario `p3-continuation-compat` covers keep + park + compat
  pass + compat fail in one deterministic run (composes Story 001).

## Constraints

- Merge blocking rides the Epic 022 `github.merge` approval mechanics — the
  check gates the approval's availability, it does not add a new tier
  (PRD §7.1.1: "before its PR may merge").
- Node-level comparison via the Epic 033 seam (one implementation).
- Scenario name `p3-continuation-compat` is load-bearing for Epic 042
  Story 001.

## Verification Gate

- `npm test` green for `src/scheduler/compat-check.test.ts` and
  `src/harness/scenarios/p3-continuation-compat.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - The check + merge gating

**Input:** `src/scheduler/compat-check.ts`, `src/scheduler/compat-check.test.ts`

**Action - RED:** Write tests: (a) superseded-completion enters
`awaiting_compat_check` as one durable unit (merge never observable as
available in the window, including across a crash); (b) unchanged definition
⇒ pass, journal with both generations, merge unblocked; (c) changed
dependency ⇒ fail, diff-carrying rework escalation, merge stays blocked,
rework response re-opens; changed feature invariant ⇒ fail; (d) both
orderings trigger the check; (e) restart durability (no loss, no double-run,
merge blocked throughout); (f) a pre-issued merge approval is suspended by
supersession; (g) a newer generation appearing mid-check forces a re-run
against it.

**Action - GREEN:** Implement the durable check and its merge-approval gate.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - `p3-continuation-compat` scenario

**Input:** `src/harness/scenarios/p3-continuation-compat.test.ts`,
`src/harness/**` (fixture arrangement only)

**Action - RED:** Write the named scenario: one feature where a mid-run edit
keeps one task (which then compat-passes and merges) and parks another, and a
second edit makes a kept task compat-fail into rework — ordered journal
assertions across the run.

**Action - GREEN:** Fix composition/wiring gaps the scenario exposes in the
owning modules (never in harness code — Epic 010 anti-reimplementation rule).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
