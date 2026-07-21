# Story 1 — A1 (keystone): `ApproveTask` persists candidate lifecycle state

Epic: `.agent/plan/epics/007.8-approve-persists-candidate-state.md`

## Goal

`approve task` lands (or conflicts) on a repo-bound candidate but **never writes
the `landing_candidates.state`** — the row stays `pending` forever, for both a
clean land and a conflict. Because `get conflict` (`get-conflict.ts:81`) and
`retry` (`retry-task.ts:87`) both gate on `state === 'conflict'`, the entire
007.6 recovery loop is a dead end via `approve`, and a completed task's candidate
row misreports `pending`. This story makes `ApproveTask` persist the candidate
state as the **last observed approve outcome**, mirroring what the `integrate()`
path already does (`src/landing/git.ts:223` conflict, `:240` landed).

The four outcomes of the preview/CAS loop in `ApproveTask.execute`
(`src/app/task/approve-task.ts`) map to exactly these writes:

| Outcome                                  | Where (approve-task.ts)                        | Candidate state write  |
| ---------------------------------------- | ---------------------------------------------- | ---------------------- |
| preview → conflict                       | conflict `return` (~:267)                      | `conflict`             |
| `landPreviewed` succeeds                 | falls through `break` → completion txn (~:312) | `landed`               |
| CAS mismatch (`LandingCASMismatchError`) | re-preview branch (~:302)                      | none — loop            |
| retries exhausted → `target_moved`       | early `return` (~:256)                         | none — stays `pending` |

## Contract (tests assert this)

- **Conflict outcome.** In the `previewOutcome.kind === "conflict"` branch,
  `ApproveTask` calls `landingRepo.updateCandidateState(candidate.id,
"conflict")` **in the same `UnitOfWork` transaction** as the existing
  `task.conflict` event append (today that append is not wrapped in a
  transaction — wrap both together). The task stays `awaiting_confirmation`; the
  returned outcome is still `{ kind: "conflict", taskId, conflictFiles }`.
  - After this, `getCandidateByTask(taskId).state === "conflict"`, so
    `get conflict` and `retry` (which read that state) succeed.
- **Landed outcome.** On a successful land (the loop `break`), inside the
  existing completion `this.#uow.transaction(...)` (~:312, which already saves
  the result, transitions the task to `completed`, and appends
  `task.approved` / `task.completed`), `ApproveTask` calls
  `landingRepo.updateCandidateState(candidate.id, "landed")`.
  - Only when a **persisted** candidate exists (`hasPersistedCandidate`); a
    legacy/no-row candidate (`#legacyCandidate`) or a non-repo-bound approve has
    no row to update and must not throw. Capture the persisted candidate id in a
    scope that reaches the completion transaction (the `candidate` binding at
    `:193` is local to the repo-bound block).
- **CAS mismatch.** A `LandingCASMismatchError` that re-previews and then lands
  writes `landed` **once**, at the end — never `conflict`, and never a premature
  `landed` before the CAS actually advances the ref.
- **`target_moved`.** When `casRetries` hits `MAX_CAS_RETRIES` and the outcome is
  `{ kind: "target_moved" }`, **no** `updateCandidateState` call is made — the
  candidate stays `pending` (contention is not a conflict; mislabeling it would
  push the human into a needless rebuild).
- The test asserts on the **exact candidate id** approve loaded (via a fake
  `LandingRepository` that records `(id, state)` calls) — not merely "some state
  update happened". A fake that ignores the id is too weak (debate S3).

## Constraints

- **No new landing path, no structural unification** with `integrate()`. This is
  two placed `updateCandidateState` calls on the existing preview/CAS path —
  mirror the states `integrate()` already writes. (Non-goal: merging the paths.)
- Atomicity: the conflict-state write rides the same transaction as the
  `task.conflict` event; the landed-state write rides the existing completion
  transaction. No loose write that can leave state and events inconsistent
  (debate B6).
- Surgical: do not change the returned `ApproveOutcome` shapes, the readiness
  re-scan, the CAS retry cap, or the `target_moved` semantics. Do not touch
  `get-conflict.ts` / `retry-task.ts` — they already read the state correctly;
  this story is what makes their guard satisfiable.
- `state='conflict'` is the last persisted approve **decision**, not an eternal
  git fact — `get conflict` re-previews live, so no staleness handling is needed
  here (a since-mergeable candidate simply reports no conflict on the next
  `get conflict` / `approve`).

## Verification Gate

- `node --test src/app/task/approve-task.test.ts` — drive `ApproveTask.execute`
  with a fake `LandingRepository` (records `updateCandidateState` calls) and a
  fake landing port scripted per outcome:
  - conflict preview → records `(candidateId, "conflict")`; asserted written in
    the same transaction as `task.conflict` (e.g. both visible only after commit
    via the fake UoW); task remains `awaiting_confirmation`.
  - mergeable preview + successful `landPreviewed` → records
    `(candidateId, "landed")`; task `completed`.
  - one `LandingCASMismatchError` then success → exactly one `"landed"` write,
    no `"conflict"` write.
  - exhausted retries → outcome `target_moved`, **zero** `updateCandidateState`
    calls.
  - non-repo-bound / legacy-candidate approve → no `updateCandidateState` call,
    no throw (regression guard).
- `npm run verify` (typecheck + test + verify:handoff + lint + db status) exits 0.
- Contributes the durable `conflict` and `landed` state assertions the epic's
  end-to-end `Proof:` reads from SQLite.
