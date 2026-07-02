# Story 002 - single_checkout Strategy

Epic: `.agent/plan/epics/021-s3-sync-single-checkout.md`

## Goal

A repo slot declared `strategy: single_checkout` serializes all tasks on one
slot-wide lease and parks/resumes via WIP commits: park commits the working
tree, resume restores it, and the WIP chain squashes before PR.

## Acceptance Criteria

- A slot yaml with `strategy: single_checkout` loads; `max_concurrent_tasks` is
  implied 1 and a conflicting explicit value is a typed config error (PRD §3.3).
- Two tasks on the slot serialize on the slot-wide lease (Epic 004 capability
  lease — one lease for the whole slot).
- Parking task A with a dirty working tree creates a commit
  `wip(<task-id>): checkpoint <ts>` on A's branch with **`add -A` semantics**
  (modified + deleted + untracked captured; ignored files excluded — asserted
  with one of each; debate finding) and leaves the checkout clean for task B.
- Resuming A checks out A's branch and applies `git reset --soft` to the WIP
  commit; restoration is **content-level** — file contents match the parked
  tree; the staged/unstaged split is not preserved (accepted + documented;
  debate finding).
- Before the PR push, **only WIP commits** squash — into the preceding real
  commit, or into one task-titled commit if only WIP commits exist; real
  commits are preserved (history asserted: no `wip(` message remains, real
  commit subjects intact; debate finding).
- Failure windows (debate finding): a park whose WIP commit fails ⇒ typed error
  + escalation, slot lease **kept** (no task B on a dirty tree); a resume onto
  a branch head that is not the recorded WIP sha ⇒ typed
  `branch-externally-modified` escalation, no reset performed.
- `git stash` is never invoked anywhere in the strategy (command-log assertion;
  PRD §3.3 — WIP commits are named, attributable, survive anything).

## Constraints

- All git operations go through the Epic 011 SU1 seam with its isolation rules
  (Epic 014 Story 001 constraint).
- The strategy implements the same slot interface as `worktree` (Epic 016) —
  the scheduler and session layers cannot tell strategies apart (PRD §3.3 —
  strategy is per-repo config).

## Verification Gate

- `npm test` green for `src/slots/single-checkout.test.ts`.

### Task T1 - Slot-wide lease + park with WIP commit

**Input:** `src/slots/single-checkout.ts`, `src/slots/single-checkout.test.ts`

**Action - RED:** Write tests: (a) the strategy loads, implied concurrency 1,
conflicting explicit value ⇒ typed error; (b) two tasks serialize on the slot
lease; (c) parking with a dirty tree (a modified, a deleted, an untracked, and
an ignored file) creates the `wip(<task>): checkpoint <ts>` commit capturing
the first three and excluding the ignored one, leaving a clean checkout;
(d) a park whose commit fails ⇒ typed error + escalation with the lease kept.

**Action - GREEN:** Implement the strategy behind the Epic 016 slot interface
(park path with `add -A` semantics and the failure guard).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Resume + pre-PR squash + no-stash

**Input:** `src/slots/single-checkout.ts`, `src/slots/single-checkout.test.ts`

**Action - RED:** Write tests: (a) resume restores the parked file contents via
checkout + `reset --soft`; (b) resume onto an externally-moved branch head ⇒
`branch-externally-modified` escalation, no reset; (c) the pre-PR squash
removes all `wip(` commits while preserving real commit subjects (both the
WIP-only and mixed-history cases); (d) the git command log contains no `stash`.

**Action - GREEN:** Implement resume (with the recorded-sha guard) and the
WIP-only squash.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
