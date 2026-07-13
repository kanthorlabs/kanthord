# Story 003 - resolve the review escalation on terminal

Epic: `.agent/plan/epics/019.18-pr-merge-escalation-and-polling.md`

## Goal

When a delivered task's PR reaches a terminal state (merged or closed), the open
"PR ready" review escalation raised at delivery (Story 001) is resolved, so the
inbox does not accumulate stale review requests for PRs that are already done.

## Acceptance Criteria

- After the poller records a **merged** outcome and the task becomes `complete`, the
  task's `review_requested` inbox item is no longer `open` (it is resolved/closed).
- After a **closed-unmerged** outcome, the task's `review_requested` inbox item is
  likewise resolved (the closed-unmerged escalation is a separate item; the review
  request itself is not left dangling).
- While the PR is still open, the `review_requested` item remains `open`.

## Constraints

- **Reuse the inbox lifecycle** — resolve the item through the existing inbox
  status-update path (`src/inbox/inbox.ts`); the review item is keyed to the task
  (deterministic id from Story 001) so it can be located without a new index.
- **Drive from the terminal transition** — resolve at the same point the
  observe-merge block marks the task `complete` / escalates
  (`src/daemon/run-loop.ts:549-556`), so resolution and terminal transition stay in
  lockstep.
- No change to how the terminal state is detected (Story 002 owns that).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing inbox /
  run-loop tests pass; guard green.

### Task T1 - resolve the review item when the PR is terminal

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a run-loop test raises a `review_requested` item for a `delivering`
task (Story 001), then drives the observe-merge block with a `merged` completion and
asserts the task is `complete` **and** the task's `review_requested` inbox item is no
longer `open`; a second case with a `closed` completion asserts the review item is
also resolved. Fails today (the review item is never resolved).

**Action - GREEN:** in the observe-merge block, when a tracked create_pr op reaches a
terminal completion (merged or closed), resolve the task's `review_requested` inbox
item via the inbox status-update path, alongside the existing complete/escalate
transition.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
