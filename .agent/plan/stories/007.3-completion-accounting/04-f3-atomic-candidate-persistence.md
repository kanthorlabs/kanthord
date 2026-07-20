# Story 4 — F3: atomic candidate persistence in RunNextTask

Epic: `.agent/plan/epics/007.3-completion-accounting.md`

## Goal

`RunNextTask` wraps the completion write in one transaction
(`src/app/task/run-next-task.ts:127-159`) but has no `candidate` arm: a changed
task takes the `completed` arm and always writes `baseCommit: null,
proposalCommit: null`, creating no landing candidate. This story adds a
`candidate` arm that, for a **repository-bound** task, persists a fresh candidate
row **and** the task transition **in the same transaction**, so a crash can never
leave a candidate-less `awaiting_confirmation`. A **filesystem-bound** changed
task (no canonical branch to land to) still `completed`s directly.

This closes the atomicity gap the debate found: today candidate rows are written
later, inside the git adapter (`landing/git.ts:129-143`), so a crash between the
task transition and the candidate write leaves an orphan `awaiting_confirmation`.

## Locked behaviour

Given a runner `TaskResult` (Story 3):

- `outcome: "candidate"` **and** the task has a `repository` context binding →
  in ONE `uow.transaction`:
  1. mint a **fresh ULID** candidate id (NOT `${taskId}-lc`);
  2. `landingRepository.saveCandidate(newChangeCandidate({ id, taskId, repoId,
baseSHA: result.baseCommit, candidateSHA: result.candidateCommit, ref:
result.branch, target: <repository resource's configured branch> }))`
     (state `pending`);
  3. `saveTaskResult(taskId, { …, baseCommit: result.baseCommit, proposalCommit:
result.candidateCommit, summary, evidence, … })`;
  4. `transitionTask(runningTask, "awaiting_confirmation")` + `store.save`;
  5. `queue.finish(jobId, "awaiting_confirmation")` (matching the existing
     escalated arm's finish state);
  6. append the same awaiting-confirmation event the `escalated` arm already
     appends.
- `outcome: "candidate"` **and** NO `repository` binding (filesystem) → take the
  `completed` path (commit recorded, no candidate row) — there is nothing to
  land.
- `outcome: "completed"` (verified no-change) → the existing `completed` arm,
  unchanged.

The candidate id identifies **this execution attempt**: a later retry mints a new
id, so a rejected+retried task never reuses a stale candidate.

## Constraints

- The candidate write MUST be inside the same `uow.transaction` as the task
  transition — no candidate persistence in the git adapter on this path
  (Story 5/6 read the pre-persisted candidate; the adapter stops minting it).
- `RunNextTask` gains a `LandingRepository` dependency (injected in
  `composition.ts`) and a `getCandidateByTask(taskId)`-style read is NOT needed
  here (creation only); target-branch resolution reads the repository resource
  via the existing store/resolver used for context.
- `target` = the repository resource's **configured branch** (the `branch` field
  restored by 007.1 D2) — never hardcoded `"main"`.
- Do NOT infer any of this from `task.agent`; branch only on the runner outcome +
  presence of a `repository` binding (the same check
  `approve-task.ts` already uses: `context["repository"] !== undefined`).
- No schema change (`landing_candidates` + `task_results` already suffice).

## Verification Gate

`node --test src/app/task/run-next-task.test.ts` green (fake agent + fake
`LandingRepository` + fake `UnitOfWork`); `npm run typecheck` 0; lint clean.

---

### Task T1 — `candidate` arm with atomic candidate persistence

**Requires:** Story 3 (the `candidate` outcome).

**Input:** `src/app/task/run-next-task.ts`,
`src/app/task/run-next-task.test.ts`, `src/composition.ts` (inject the landing
repository).

**Action — RED:** tests with a fake runner returning `candidate` and a fake
`LandingRepository`:
(a) a repository-bound task → task ends `awaiting_confirmation`; exactly one
candidate row saved with a ULID id (matches a ULID shape, `!== `${taskId}-lc``),
`baseSHA`/`candidateSHA` from the result, `target` = the bound repository's
configured branch, `state: "pending"`; `task_results` has non-null
`baseCommit`/`proposalCommit`;
(b) a filesystem-bound task (no `repository` binding) returning `candidate` →
task ends `completed`, NO candidate row saved;
(c) **atomicity**: a `UnitOfWork` fake that throws after the transition callback
body runs (simulating a crash committing the tx) leaves NO partial state — the
test asserts that either both the transition and the candidate row are present or
neither is (no candidate-less `awaiting_confirmation`);
(d) verified no-change (`outcome: "completed"`) still takes the completed arm.
Fails today: no `candidate` arm; changed → completed with null base/proposal.

**Action — GREEN:** add the `candidate` arm per the locked behaviour inside the
existing `uow.transaction`; inject `LandingRepository` into `RunNextTask` and
wire it in `composition.ts`; resolve the repository's configured branch for
`target`.

**Action — REFACTOR:** if the transaction body grows, extract a private
`#persistCandidate(...)` helper called inside the transaction (still one tx).

**Output:** a changed repository-bound task lands in `awaiting_confirmation` with
a durable, uniquely-identified candidate, atomically; filesystem-bound changed
tasks complete directly.

**Verify:** `node --test src/app/task/run-next-task.test.ts` green;
`npm run typecheck` 0; lint clean.
