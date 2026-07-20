# Story 5 — F3: correct ApproveTask landing

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

`ApproveTask` today cannot land: the real instance is built **without** a
`RepositoryLanding` (`composition.ts:233-239`), and even its landing block is
wrong — it passes `result.workspace` as `homeDir` (`approve-task.ts:127`, so
`git merge` runs in the task **clone**, not the canonical home), hardcodes
`target: "main"` (`:124`), and mints a fixed candidate id `${taskId}-lc`
(`:118`). This story makes `approve task` land the **pre-persisted** candidate
(Story 4) onto the repository's **configured branch** of its **canonical home**,
under compare-and-swap, and record the landed SHA as `base_commit` (A7). Only a
successful land transitions the task to `completed`.

## Locked behaviour

On `ApproveTask.execute(taskId)` for a repository-bound task:

1. Load the candidate for the task from `LandingRepository`
   (`getCandidateByTask(taskId)` — a new read method) instead of constructing
   `${taskId}-lc`. Its `id`, `baseSHA`, `candidateSHA`, `ref`, `target` come from
   the row Story 4 persisted.
2. Resolve `homeDir` = the repository's **canonical home directory** from the
   workspace manager (a `homeDir(repoId): string` accessor), NOT
   `result.workspace`.
3. `target` = `candidate.target` (the configured branch persisted in Story 4) —
   never hardcoded `"main"`.
4. Call `RepositoryLanding.land(homeDir, candidate)`; the adapter updates the
   **named target ref** under compare-and-swap against `baseSHA` (see Story 6 for
   the shared lock).
5. On success (`fast-forward | merge | already-landed`): persist the returned
   `canonicalSHA` as `task_results.base_commit` (A7), transition the task to
   `completed`, release dependents (existing readiness re-scan).
6. `LandingConflictError` → Story 7 (task stays `awaiting_confirmation`).
7. A filesystem-bound task (no `repository` binding) → complete without landing
   (existing behaviour), unchanged.

## Constraints

- Add a `getCandidateByTask(taskId: string): ChangeCandidate | undefined` to
  `LandingRepository` (query `landing_candidates` by `task_id`; if multiple, the
  latest by id — ULIDs sort by time). This is a storage-port method, **not** a
  schema change.
- Add `homeDir(repoId: string): string` to the workspace manager port +
  `LocalWorkspaceManager` (returns the canonical local mirror path it clones
  from). Story 6 owns making that mirror the shared-lock home; Story 5 only needs
  the path resolved (its real-git tests build the home dir directly).
- Fix the adapter's target handling (`landing/git.ts:145-182`): the merge must
  land on **`candidate.target`**, checked out / updated as the named ref under
  CAS on `baseSHA` — do not assume the checked-out HEAD equals `target`.
- Inject `repoLanding` into `ApproveTask` in `composition.ts` (add the 6th arg at
  `:233-239`); the adapter already exists at `:353-359`.
- No schema change. Real-git tests use `tmp` dirs; unit tests of `ApproveTask`
  use a `FakeLanding`.

## Verification Gate

`node --test src/app/task/approve-task.test.ts` green (fake landing: success →
completed + `base_commit` set; conflict → still awaiting);
`node --test src/landing/git.test.ts` green (real git: ff + merge land on the
**configured, non-`main`** branch of the home repo; CAS on the named target);
architecture/wiring test asserts the real `ApproveTask` is constructed WITH a
`RepositoryLanding`; `npm run typecheck` 0; lint clean.

---

### Task T1 — `getCandidateByTask` + `homeDir(repoId)` accessors

**Requires:** Story 4 (candidate rows exist).

**Input:** `src/storage/port.ts`, `src/storage/sqlite/landing.ts`,
`src/workspace/port.ts`, `src/workspace/local.ts`, and their tests.

**Action — RED:** (a) `SqliteLandingRepository.getCandidateByTask` returns the
row saved for a task (and the latest when two exist), `undefined` when none;
(b) `LocalWorkspaceManager.homeDir(repoId)` returns the canonical mirror path
(assert it is stable and distinct from a task workspace dir). Fails today:
neither method exists.

**Action — GREEN:** implement both. `getCandidateByTask` selects by `task_id`
ordered by `id` desc limit 1. `homeDir` returns the mirror path the manager
already derives for `prepareFromRepository`.

**Action — REFACTOR:** none.

**Output:** approve can find the candidate and the canonical home path.

**Verify:** `node --test src/storage/sqlite/landing.test.ts` +
`src/workspace/local.test.ts` green; typecheck 0.

---

### Task T2 — land on the configured branch of the home repo (adapter)

**Requires:** T1.

**Input:** `src/landing/git.ts`, `src/landing/git.test.ts`.

**Action — RED:** real-git tests in `tmp` dirs where the home repo's configured
branch is **not** `main` (e.g. `trunk`): (a) a candidate that is a fast-forward
of `trunk` lands with `outcome.kind === "fast-forward"` and `trunk` HEAD ==
`candidateSHA`; (b) a diverged candidate lands with `outcome.kind === "merge"`
and `trunk` is a merge commit; (c) the merge/ff updates the **named `target`
ref** even if it is not the checked-out branch; (d) a stale `baseSHA` (target
moved since the candidate was minted) is handled via CAS (either merges or
surfaces conflict per Story 7 — assert no silent overwrite of unrelated
commits). Fails today: `git merge` advances the checked-out HEAD assuming it is
`target`.

**Action — GREEN:** update `land()` so the ff/merge operates on `candidate.target`
as a named ref (check out or update-ref under CAS on `baseSHA`); resolve
`canonicalSHA` from `target` after the operation.

**Action — REFACTOR:** none.

**Output:** landing targets the configured branch correctly, under CAS.

**Verify:** `node --test src/landing/git.test.ts` green; typecheck 0; lint clean.

---

### Task T3 — rewire `ApproveTask` + wire composition + A7 `base_commit`

**Requires:** T1, T2, Story 4.

**Input:** `src/app/task/approve-task.ts`, `src/app/task/approve-task.test.ts`,
`src/composition.ts`, and an architecture/wiring test.

**Action — RED:** `ApproveTask` tests with a `FakeLanding`: (a) a repository-bound
task loads the persisted candidate (id is the stored ULID, NOT `${taskId}-lc`),
calls `land(homeDir, candidate)` with `homeDir` from `homeDir(repoId)` (NOT
`result.workspace`) and `candidate.target` (NOT `"main"`); on success the task is
`completed` and `task_results.base_commit` = the returned `canonicalSHA`;
(b) a filesystem-bound task completes without calling `land`; (c) a wiring test
asserting the real `ApproveTask` from `buildDeps` has a `RepositoryLanding`
injected. Fails today: `${taskId}-lc`, `"main"`, `result.workspace`, and no
injected landing.

**Action — GREEN:** rewrite the landing block in `approve-task.ts:109-139` to use
the loaded candidate + `homeDir(repoId)` + `candidate.target`; persist
`canonicalSHA` into `base_commit`; inject `repoLanding` into `ApproveTask` at
`composition.ts:233-239`.

**Action — REFACTOR:** none.

**Output:** `approve task` lands the candidate onto the correct home + branch and
records the SHA; A7 fixed.

**Verify:** `node --test src/app/task/approve-task.test.ts` green; the wiring test
green; `npm run typecheck` 0; lint clean.
