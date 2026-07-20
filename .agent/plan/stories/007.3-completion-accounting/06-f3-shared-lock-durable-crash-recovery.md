# Story 6 — F3: shared lock, durable candidate storage, crash recovery

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

Three durability gaps remain after Story 5:

1. **No shared lock.** `LocalWorkspaceManager` is built with `{ root }` only
   (`composition.ts:277`) — no `lockDir` — so workspace prepare and landing do
   NOT share the single C2 per-repo lock; concurrent prepare + approve can race
   on the canonical branch.
2. **Candidate objects are not durable.** Retry **wipes** the task workspace
   (`workspace/local.ts:459-460`), and the candidate commit lives on the
   `kanthord/<taskId>` branch of that clone — so after a retry the commit
   `approve` needs to land is gone.
3. **Crash recovery is incomplete.** The adapter advances git before recording
   final DB state (`landing/git.ts:145-182` then `:214-224`); on a crash-retry
   the already-landed check (`:109-127`) returns without reconciling the
   candidate/integration rows, and `saveCandidate`'s `ON CONFLICT(id) DO NOTHING`
   (`storage/sqlite/landing.ts:24`) leaves the row stuck at `pending`.

This story wires the shared lock, makes the candidate commit durable across a
workspace wipe, and makes re-approve fully reconcile the DB against the current
canonical SHA.

## Locked behaviour

- **Shared lock:** `LocalWorkspaceManager` receives the same `lockDir` the
  landing adapter uses (`dirname(dbPath)`), so prepare-fetch-CAS and landing
  serialize on `<lockDir>/<repoId>-<branch>.lock`.
- **Durable candidate:** at candidate creation, the proposal commit is made
  reachable from the canonical **home** repo (push the task branch / a
  `refs/kanthord/candidates/<candidateId>` ref into the home mirror) so
  `land(homeDir, candidate)` can resolve `candidateSHA` even after the workspace
  is wiped. The durable ref is created in the same flow that persists the
  candidate (coordinated with Story 4); Story 6 owns the home-side ref.
- **Crash-idempotent re-approve reconciles:** when `land` hits `already-landed`
  (`git.ts:109-127`), it MUST still (a) `updateCandidateState(id, "landed")` and
  (b) `saveIntegration({ candidateId, outcome, canonicalSHA, … })` before
  returning — never leave a `pending` row / missing integration for a
  successfully-landed commit. A re-approve after a full success is a no-op that
  returns `already-landed` and re-asserts the rows.

## Constraints

- Reuse the existing lock mechanism (`landing/git.ts:44-73` acquire, `:227-235`
  release) — do NOT add a second lock scheme. The lock covers the full landing
  op (record → git → update state → release).
- `saveCandidate` staying `ON CONFLICT(id) DO NOTHING` is fine **because** state
  reconciliation now happens via `updateCandidateState`, not re-insert — but the
  already-landed path must call it. Do not change `saveIntegration` (already an
  upsert).
- The durable home-side ref must not collide across tasks (key it by
  `candidateId` or the task branch). Clean-up of superseded candidate refs is out
  of scope (small leak acceptable; note it).
- No schema change (`landing_candidates`/`landing_integrations`/`repo_locks`
  already exist).

## Verification Gate

`node --test src/landing/git.test.ts` green (durability + crash-idempotent +
cross-process lock contention); a workspace-manager test proves the shared
`lockDir` is used; an end-to-end-ish test (real git, fake agent) proves
run→wipe→approve still lands; `npm run typecheck` 0; lint clean.

---

### Task T1 — wire the shared lock into `LocalWorkspaceManager`

**Requires:** Story 5.

**Input:** `src/composition.ts`, `src/workspace/local.ts`,
`src/workspace/local.test.ts`.

**Action — RED:** (a) a wiring test asserting `LocalWorkspaceManager` in
`buildDeps` is constructed with a `lockDir` equal to the landing adapter's
`lockDir` (`dirname(dbPath)`); (b) a contention test: a prepare-fetch and a land
on the same repo+branch serialize on the shared lock file (one waits; both
complete; no orphan `.lock` left). Fails today: `{ root }` only.

**Action — GREEN:** pass `lockDir` into `new LocalWorkspaceManager({ root,
lockDir })` at `composition.ts:277`; ensure prepare acquires the shared lock for
its fetch+CAS section.

**Action — REFACTOR:** none.

**Output:** prepare and landing share one per-repo+branch lock.

**Verify:** `node --test src/workspace/local.test.ts` green; typecheck 0.

---

### Task T2 — durable candidate commit across the retry wipe

**Requires:** Story 4, T1.

**Input:** the candidate-creation flow (`run-next-task.ts` / the runner’s
finalize + `workspace/local.ts`), `src/landing/git.test.ts` (or a new
durability test), plus any home-mirror helper.

**Action — RED:** a real-git test: create a candidate (proposal commit on the
task branch), then **wipe** the task workspace (simulate retry via
`prepareFromRepository` again), then `land(homeDir, candidate)` — assert the
candidate `candidateSHA` is still reachable from the home mirror and the land
succeeds. Fails today: after the wipe, `candidateSHA` is unreachable.

**Action — GREEN:** on candidate creation, push the proposal commit (task branch
or `refs/kanthord/candidates/<candidateId>`) into the canonical home mirror
before the workspace can be wiped, under the shared lock.

**Action — REFACTOR:** none.

**Output:** the candidate commit survives a workspace wipe; approve-after-retry
lands.

**Verify:** the durability test green; typecheck 0; lint clean.

---

### Task T3 — reconcile rows on already-landed / crash-retry

**Requires:** T2.

**Input:** `src/landing/git.ts`, `src/landing/git.test.ts`.

**Action — RED:** (a) simulate a crash **after** the git mutation but **before**
`updateCandidateState`/`saveIntegration` (`git.ts:214-224`); re-call `land` with
the same candidate → it hits `already-landed`, and the test asserts the candidate
row is now `landed` and an integration row exists with the correct
`canonicalSHA`/`outcome`; (b) a re-approve of a fully-landed candidate returns
`already-landed` and re-asserts the same rows (idempotent no-op). Fails today:
the already-landed path returns without touching the DB rows.

**Action — GREEN:** in the `already-landed` branch (`git.ts:109-127`), call
`updateCandidateState(id, "landed")` and `saveIntegration(...)` (deriving the
outcome from ancestry — ff vs merge) before returning.

**Action — REFACTOR:** extract a `#reconcileLanded(candidate, canonicalSHA)`
helper shared by the success path and the already-landed path.

**Output:** DB state always reflects a landed commit; crash-retry is fully
idempotent.

**Verify:** `node --test src/landing/git.test.ts` green; typecheck 0; lint clean.
