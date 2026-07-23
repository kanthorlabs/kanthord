# Story C — approval reinvalidation (hard safety invariant)

Epic: `.agent/plan/epics/007.14-deterministic-candidate-transplant.md`
Depends on: Story A/B.

## Change

- After a successful transplant, the task returns to `awaiting_confirmation` with
  the **new** candidate `state:"pending"` (`transitionTask`,
  `src/domain/task.ts:87-97`). A fresh `approve task` is required to land it.
- No code path lands a transplanted candidate on a pre-transplant approval.
  `ApproveTask` (`src/app/task/approve-task.ts`) lands the latest candidate via
  `getCandidateByTask` — the transplanted (newest) row is what a fresh approve
  targets; nothing auto-approves it.
- Optional (opt-in only, build only if cheap): approve-time auto-refresh
  returning `"candidate refreshed; approval still required"`. Never a silent
  rebase-and-land. Default: off.

## Verify

- `node --test`:
  - after transplant, task is `awaiting_confirmation` + candidate `pending`; a
    fresh `approve task` lands it.
  - no path lands the transplanted candidate without a fresh approve (a replayed
    pre-transplant approval does not land it).
- `npm run verify` exits 0.
- Proof C / C2.
