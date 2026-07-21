# Story 5 — S5: recovery candidate re-enters the gate

Epic: `.agent/plan/epics/007.6-guided-conflict-resolution.md`

## Goal

S3 rebuilds a conflicted task on a clean latest base with the guided note + the
marker-free context. S4 makes approve predict-before-mutate and land the previewed
tree. This story closes the loop: the **rebuilt** candidate produced by the
recovery run is itself put through the S4 `preview` gate before it can land —
there is **no blind land** of the recovery output. A rebuild that now
fast-forwards or cleanly merges lands through the exact same S4 CAS path; a rebuild
that still conflicts re-enters `awaiting_confirmation` with a fresh conflict
candidate (the loop can repeat). This is what makes 007.6 safe by construction:
every candidate that reaches the canonical branch — first attempt or Nth recovery —
passed the same predict gate.

## Contract (tests assert this)

- After a recovery run (007.5: `retry task` re-queued the task, the daemon re-ran
  the agent on the fresh base and produced a new proposal candidate), approving
  that recovery candidate goes through `ApproveTask`'s S4 `preview` path — **not**
  a direct `land()`. Assert the recovery candidate is **previewed** (the fake
  landing's `preview` is invoked for it) before any branch mutation.
- A recovery candidate that predicts `fast-forward` or `mergeable` lands through
  the same S4 atomic-CAS path (branch advanced via `update-ref …
<expectedOld=targetOID>`; on `mergeable`, tree === previewed `treeOID`).
- A recovery candidate that predicts `conflict` again returns the typed `conflict`
  outcome with zero mutation and retains a fresh `state="conflict"` candidate — the
  predict→explain→guide→rebuild loop can run again (no special-casing of "second
  time"; the Nth attempt uses the identical gate).
- No new lifecycle state, no "recovery mode" flag on the land path: S5 asserts a
  property of the **existing** S4 flow applied to a recovery-produced candidate,
  not a new code path.

## Constraints

- S5 introduces little or no new production code beyond wiring — it is primarily a
  **test** that the S4 gate is unconditional (every approve previews first,
  including the recovery-produced candidate). If S4 was written to preview
  unconditionally, S5 may be green with only its regression test; if any
  "first-attempt-only" shortcut exists, remove it so recovery candidates are not
  landed blind.
- Reuse the S4 land-the-previewed-tree path verbatim for recovery candidates — do
  NOT fork a second landing routine for recovery.
- Hermetic: fake landing with a scripted `preview` sequence
  (conflict → recovery candidate → mergeable) drives the loop; no real git,
  no model (the fake agent is not base-aware — per 007.5, the clean-merge and
  conflict-rebuild-to-`completed` proof lives in the real-model E2E, Appendix B).

## Verification Gate

- `node --test src/app/task/approve-task.test.ts`:
  - A recovery candidate (a fresh candidate row after a `retry`) approved →
    `preview` is called for it before any land/CAS; a scripted `mergeable` predict
    lands it via the S4 CAS path and marks the task `completed`.
  - A recovery candidate that re-predicts `conflict` → typed `conflict`, zero
    mutation, fresh `state="conflict"` candidate retained (loop can repeat).
  - Regression: no approve path lands a candidate without first calling `preview`
    (assert the fake records a `preview` call preceding every `land`/CAS).
- `npm run typecheck` 0; `npm run lint` clean; `npm run verify` green (the epic's
  full Verification Gate).
