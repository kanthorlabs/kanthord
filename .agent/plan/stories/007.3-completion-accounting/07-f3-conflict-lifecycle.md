# Story 7 — F3: conflict lifecycle

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

When landing a candidate hits a git conflict, the behaviour is under-defined:
`ApproveTask` emits `task.conflict` and returns with the task still
`awaiting_confirmation` (`approve-task.ts:132-135`), but the adapter never
persists a `conflict` integration row (`landing/git.ts:214-224` only writes
`fast-forward`/`merge`) and the merge may be left half-applied in the home repo.
This story defines and tests the full typed-conflict lifecycle, reusing the
existing `awaiting_confirmation` status (there is **no** `conflict` `TaskStatus`,
and none is added — `src/domain/task.ts:4-13`).

## Locked behaviour

On a conflict during `land`:

1. The adapter runs `git merge --abort` (leave the home repo's target branch
   exactly at its pre-attempt HEAD — no half-merge), then persists:
   `updateCandidateState(id, "conflict")` and `saveIntegration({ candidateId,
outcome: "conflict", canonicalSHA: <unchanged target HEAD>, conflictFiles })`.
2. It throws `LandingConflictError(candidate, conflictFiles)`.
3. `ApproveTask` catches it: emit `task.conflict` (payload includes
   `conflictFiles`), leave the task `awaiting_confirmation`, do NOT transition to
   `completed`, do NOT throw.
4. **Retry** = re-run the task (`awaiting_confirmation → pending`, existing legal
   transition) → a fresh candidate id on the next run.
5. **Rejection** = discard (`awaiting_confirmation → discarded`, existing legal
   transition); the candidate row stays `conflict` for the record.
6. **Repeated approval after conflict** = calling `approve task` again re-attempts
   `land` on the current candidate (target may have moved); it either lands now
   or re-emits `task.conflict`. No duplicate/partial state.

## Constraints

- `task.conflict` must be a valid event type — confirm it is in `EVENT_TYPES`
  (`src/domain/event.ts`); if 007.1's landing work did not add it, add it here.
- Reuse `LandingConflictError` and the `conflict` `LandingOutcome`/`integration`
  columns already shipped in migration 7 (`outcome CHECK … 'conflict'`,
  `conflict_files`) — no schema change.
- `git merge --abort` must run in the correct `homeDir` (Story 5) and only when a
  merge is actually in progress; never abort a clean tree.
- No new `TaskStatus`. The task stays `awaiting_confirmation` on conflict.

## Verification Gate

`node --test src/landing/git.test.ts` green (conflict → abort + `conflict`
integration row + `conflictFiles` + `LandingConflictError`);
`node --test src/app/task/approve-task.test.ts` green (conflict → task stays
`awaiting_confirmation`, `task.conflict` event with files, no throw; repeated
approve re-attempts); `npm run typecheck` 0; lint clean.

---

### Task T1 — adapter: abort + persist the conflict integration

**Requires:** Story 5, Story 6.

**Input:** `src/landing/git.ts`, `src/landing/git.test.ts`,
`src/storage/sqlite/landing.ts` (already supports the conflict columns).

**Action — RED:** a real-git test where the candidate conflicts with the target:
assert (a) after `land` throws `LandingConflictError`, the home target HEAD is
**unchanged** (merge aborted, no half-merge); (b) `getCandidate(id).state ===
"conflict"`; (c) an integration row exists with `outcome: "conflict"` and the
conflicting file(s) in `conflictFiles`; (d) `LandingConflictError.conflictFiles`
lists the same files. Fails today: conflict path leaves no rows and may leave a
half-merged tree.

**Action — GREEN:** in the merge-conflict branch, run `git merge --abort`, write
the `conflict` candidate state + integration row, then throw
`LandingConflictError`.

**Action — REFACTOR:** none.

**Output:** conflicts are durably recorded and the home repo is left clean.

**Verify:** `node --test src/landing/git.test.ts` green; typecheck 0; lint clean.

---

### Task T2 — approve: conflict keeps the task awaiting; repeated approve re-attempts

**Requires:** T1.

**Input:** `src/app/task/approve-task.ts`, `src/app/task/approve-task.test.ts`,
`src/domain/event.ts` (+ its test) if `task.conflict` is missing from
`EVENT_TYPES`.

**Action — RED:** tests with a `FakeLanding` that throws `LandingConflictError`:
(a) the task stays `awaiting_confirmation`, a `task.conflict` event is appended
with `conflictFiles`, and `execute` does NOT throw; (b) a second `approve task`
call re-invokes `land` on the same candidate (fake now returns `fast-forward`) →
task becomes `completed`; (c) if `task.conflict` was not a valid event type, a
domain-event test asserts it now is. Fails today: repeated-approval behaviour is
undefined; `conflictFiles` not surfaced.

**Action — GREEN:** ensure the catch block emits `task.conflict` with
`conflictFiles`, leaves the task awaiting, and returns; make `approve task`
re-loadable/re-attemptable on a `conflict`-state candidate; add `task.conflict`
to `EVENT_TYPES` if absent.

**Action — REFACTOR:** none.

**Output:** a defined, tested conflict lifecycle: abort → record → await →
retry/reject/re-approve.

**Verify:** `node --test src/app/task/approve-task.test.ts` +
`src/domain/event.test.ts` green; typecheck 0; lint clean.
