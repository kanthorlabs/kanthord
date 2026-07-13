# Story 003 - task leaves running

Epic: `.agent/plan/epics/019.16-deliver-the-agents-work.md`

## Goal

In the no-workflow live path a delivered task must not strand at `running`. After
the daemon delivers a session (push + create_pr submitted), the task transitions to
a non-running, non-dispatchable delivered state; when the PR is observed merged the
existing path marks it `complete`.

## Acceptance Criteria

- After `tick()` delivers a session (the delivery block at `run-loop.ts:518-542`
  submits push + create_pr for the task), the task's status is **not** `running` —
  it is set to `"delivering"`. This holds when `deps.workflow` is absent (the live
  path).
- A `"delivering"` task is **not re-dispatched** — `dispatchable()` selects only
  `status = 'pending'` (`dispatch.ts:112`), so the delivered task is never re-run.
- When the task's create_pr op reaches `merged` in `broker_completion`, the existing
  observe-merge path (`run-loop.ts:549-556`) sets the task `complete`. A
  `"delivering"` task therefore ends at `complete` after merge — no change to that
  path.
- A cleanly completed session that delivered **nothing** (no worktree changes →
  `commitsAhead` = 0 → no delivery) and has no workflow is **not** forced to
  `"delivering"` (there is nothing to merge); its handling is unchanged by this
  story.

## Constraints

- **Transition only on successful delivery** — set `"delivering"` inside/after the
  delivery block, gated on the same clean-session + `commitsAhead > 0` condition, so
  only an actually-delivered task leaves `running` this way. Do not introduce a
  `Workflow` gate engine (Epic Non-Goal).
- **`"delivering"` is non-dispatchable by construction** — it is any value other
  than `'pending'`; `dispatchable()` already filters to `'pending'` only, so no
  scheduler change is needed.
- **Reuse `setTaskStatus`** (`scheduler/dispatch.ts`) — the same seam the run-loop
  already uses for `running`/`parked`/`pending`.
- **Observe-merge untouched** — the daemon never merges; it only observes the
  `broker_completion` `merged` state (Epic Non-Goal).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  run-loop tests (including observe-merge → `complete`) pass; guard green.

### Task T1 - delivered task transitions to "delivering", then complete on merge

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic run-loop test drives a `tick()` for a task whose
session completed cleanly with `commitsAhead > 0` and `deps.workflow` unset, and
asserts the task status after the tick is `"delivering"` (not `"running"`). A second
assertion: after a `broker_completion` row for the task's create_pr op is written
with `status = "merged"`, the next `tick()` sets the task `complete`. A third case:
a clean session with `commitsAhead = 0` (nothing delivered) does **not** set
`"delivering"`. Fails today (delivered task stays `running`).

**Action - GREEN:** in `tick()`, when the delivery block has submitted push +
create_pr for a task (clean session, `commitsAhead > 0`, `deps.workflow`
undefined), call `setTaskStatus(store, task.id, "delivering")`. Leave the
observe-merge block (`run-loop.ts:549-556`) unchanged — it already flips the task to
`complete` on merge and to escalation on `closed`.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
