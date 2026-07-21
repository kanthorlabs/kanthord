# Story 4 — S4: predict-before-mutate + land-the-previewed-tree via atomic CAS

Epic: `.agent/plan/epics/007.6-guided-conflict-resolution.md`

## Goal

This is the correctness core. Today `ApproveTask` (`src/app/task/approve-task.ts`)
lands by calling `RepositoryLanding.land()`, which runs a real `git merge` and
aborts on conflict — mutating the worktree/index before rollback, and (on a clean
merge) re-deriving the merged tree a second time. This story makes approve
**predict before it mutates**: it calls S1's `preview(candidate, targetOID)`
against a **pinned** target OID; a predicted conflict returns the typed `conflict`
outcome with **zero mutation**; a clean predict lands the **exact previewed tree**
via an atomic compare-and-swap `update-ref`. Because `merge-tree --write-tree`
already returned the merged tree OID, preview↔land parity is a **construction**
(the landed tree _is_ the previewed tree), not a tested assumption.

## Contract (tests assert this)

- `ApproveTask.execute` resolves the **pinned** `targetOID` once
  (`git rev-parse <branch>` on the home repo, or the port's read) and calls
  `preview(homeDir, candidate, targetOID)` (S1) **before** any mutation, for the
  repo-bound candidate-landing path (`isRepoBoundLanding`,
  `approve-task.ts:167-271`). The `#promote`/legacy paths are untouched.
- Dispatch on the `PreviewOutcome`:
  - `conflict` → return the typed `{ kind: "conflict", taskId, conflictFiles }`
    outcome (the existing shape, `approve-task.ts:29`) and append `task.conflict`
    — with **zero mutation**: the canonical branch OID, HEAD, index, and worktree
    are unchanged and **no** `git merge` / `git merge --abort` ran. The task stays
    `awaiting_confirmation` with its 007.5 durable `state="conflict"` candidate.
  - `fast-forward` → advance the branch to the candidate OID via
    `git update-ref refs/heads/<branch> <candidateOID> <expectedOld=targetOID>`
    (atomic CAS). `canonicalSHA = candidateOID`.
  - `mergeable` → build the merge commit **from the previewed `treeOID`** with
    parents `{ targetOID, candidateOID }` (`git commit-tree <treeOID> -p
<targetOID> -p <candidateOID>`), then advance the branch via the same
    `update-ref … <expectedOld=targetOID>` CAS. The landed commit's tree **equals**
    the previewed `treeOID` by construction. `canonicalSHA = <newCommit>`.
- **Target moved (CAS mismatch):** if `update-ref`'s `expectedOld` check fails —
  an external push or a concurrent land moved the branch between preview and land —
  **re-preview** against the new target OID and retry, up to a bounded cap
  (small constant, e.g. 3). After the cap, return a typed `target_moved` outcome
  (add `{ kind: "target_moved"; taskId }` to `ApproveOutcome`,
  `approve-task.ts:27-35`) — **never** a blind merge onto an unexpected base
  (debate B6/B7). The CLI maps `target_moved` to a clear message + exit 0
  (retryable), same bar as `conflict`.
- The land + persistence still run under the existing `uow.transaction`
  (`approve-task.ts:276`); on `conflict`/`target_moved` no completion transition
  happens (task not marked `completed`).

## Constraints

- `preview` is called with the **pinned** `targetOID`, and that **same** OID is
  the `expectedOld` in the CAS — this is what makes "land the tree I previewed"
  atomic. Do NOT re-resolve the branch name between preview and CAS.
- No second merge: on `mergeable`, land the previewed `treeOID` via
  `commit-tree` + `update-ref`; do not re-run `git merge`. No worktree merge
  state, so no `git merge --abort` on this path.
- The mutating `land()` conflict path (real `merge`/`--abort`,
  `git.ts:180-231`) must no longer run for approve — approve predicts first. If a
  new landing method is cleaner than overloading `land()`, add one (e.g.
  `landPreviewed(homeDir, candidate, previewOutcome, targetOID)`); keep the port
  minimal. Either way, a predicted conflict never calls a mutating git op.
- Reuse `LandingConflictError` / the typed outcomes already in
  `approve-task.ts`; extend `ApproveOutcome` only with `target_moved`.
- Hermetic unit tests use a fake `RepositoryLanding` (scripted `preview` +
  land-the-tree/CAS-fail); the real-git wiring is exercised by the S1/S4 real-git
  tests and the epic Proof.

## Verification Gate

- `node --test src/app/task/approve-task.test.ts` (fake landing):
  - `preview` → `conflict`: `execute` returns `{ kind: "conflict", … }`, appends
    `task.conflict`, marks the fake as **not** landed, performs **no** mutating
    land call; task not `completed`.
  - `preview` → `fast-forward`: lands via CAS to the candidate OID; task
    `completed`; `canonicalSHA === candidateOID`.
  - `preview` → `mergeable`: lands a commit whose tree === the previewed `treeOID`,
    parents `{target, candidate}`, via CAS with `expectedOld === targetOID`.
  - CAS `expectedOld` mismatch: re-previews against the new OID (assert `preview`
    called again with the new target), retries to the cap, then returns
    `{ kind: "target_moved", … }`; asserts it never landed onto the wrong base.
- `node --test src/landing/git.test.ts` — real git in temp: a `mergeable` predict
  lands a commit whose `git rev-parse <new>^{tree}` equals the `treeOID` from
  `preview`, parents are `{targetOID, candidateOID}`; a `fast-forward` predict
  advances the branch to the candidate OID; a stale `expectedOld` CAS fails and
  leaves the branch untouched.
- `node --test src/apps/cli/task.test.ts` — `target_moved` maps to a clear line,
  exit 0.
- `npm run typecheck` 0; `npm run lint` clean.
