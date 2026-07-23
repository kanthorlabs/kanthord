# Story A — deterministic transplant in the recovery use case

Epic: `.agent/plan/epics/007.14-deterministic-candidate-transplant.md`

## Change

In `RetryTask` (`src/app/task/retry-task.ts`, use case — not the CLI), on the
stale-`pending` path:

- Attempt a **3-way transplant** of the candidate commit onto the current base in
  an isolated workspace, reusing `src/landing/git.ts` machinery (`preview` /
  `merge-tree --write-tree` `:275-351`, `commit-tree` `:404`). Add a
  transplant/rebase-onto-base method to the landing (or a recovery) port if
  needed. No working-tree checkout.
- Zero textual conflicts → run the **existing verification gate** (same gate the
  candidate was approved under) in the isolated workspace.
  - gate green → new candidate commit (Story B persists identity) + append
    `candidate.transplanted` event (Story D type). **No model run.**
  - gate fail → fall back to the model rebuild path (`retry-task.ts:97-125`).
- Any textual conflict → fall back to the model rebuild path.
- Do **not** call `saveConflictSnapshot` (no-op on sqlite).

## Constraints

- Logic in the use case; reuse `src/landing/git.ts` — don't duplicate
  merge-tree/commit-tree.
- Same gate, no relaxation.
- A transplant failure/conflict leaves the task exactly as the model-rebuild path
  would (no partial candidate).

## Verify

- `node --test src/app/task/retry-task.test.ts` (fake transplant port + gate):
  - stale `pending`, non-overlapping change, gate green → new candidate,
    `candidate.transplanted` appended, no model enqueue / no `agent.finished`.
  - overlapping change → model rebuild (task→`pending`, enqueued, `task.ready`).
  - clean transplant but gate fails → model rebuild.
- `npm run verify` exits 0.
- Proof A / A2 / A3.
