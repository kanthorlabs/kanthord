# Story 001 - commit the worktree changes

Epic: `.agent/plan/epics/019.16-deliver-the-agents-work.md`

## Goal

After a cleanly completed session that wrote files, the daemon stages and commits
the worktree changes onto the task branch through broker verbs, so
`commitsAhead(taskBranch, "main") > 0` and the existing delivery block fires. A
session that wrote nothing produces no commit. The agent never commits — the
daemon does, using broker verbs only (no ad-hoc shell-out).

## Acceptance Criteria

- A new broker verb adapter `git.add` (stage) runs `git add -A` (or `git add .`) in
  a given `cwd`; on success its `poll_status` returns `{ status: "done" }`. It
  follows the same submit → in-memory-state → poll_status → reconcile shape as the
  other `git-local.ts` adapters (including the `verifySetup` preflight gate: absent
  → `blocked-needs-setup`).
- After a cleanly completed session (`stopReason` absent) whose worktree contains
  **new/modified files on `taskBranch`**, `tick()` stages then commits those changes
  onto `taskBranch` in the **session worktree cwd** (`sessionWorktreePath`), so a
  subsequent `commitsAhead(taskBranch, "main")` returns **> 0**. The commit message
  is derived from the task id.
- After a cleanly completed session whose worktree has **no changes**, `tick()`
  makes **no commit** — `commitsAhead(taskBranch, "main")` stays `0` (the existing
  `git.commit` noop classification handles "nothing to commit").
- The stage + commit run **before** the delivery block's `commitsAhead` check
  (`run-loop.ts:518`), so a writing session flows straight into delivery in the same
  tick.

## Constraints

- **Broker verbs only** — stage via the new `git.add` verb adapter and commit via
  the existing `git.commit` verb adapter (`git-local.ts` `makeCommitAdapter`),
  submitted through the run-loop's `submitBrokerVerb` seam. Do not shell out to
  `git` directly from `run-loop.ts` (memory `lp-a1-delivery-gap`: "reuse broker
  verbs, don't shell out ad hoc").
- **New-file staging** — the agent's files are new/untracked, so staging must catch
  untracked files (`git add -A` / `git add .`), not `git commit -am`.
- **Worktree cwd** — stage + commit run in `sessionWorktreePath` (the worktree where
  the agent wrote and where `taskBranch` is checked out), so the commit lands on
  `taskBranch`. `commitsAhead` (in the main checkout) sees it because worktrees share
  the object db + refs.
- **Guarded, not unconditional** — the commit step runs only for a cleanly completed
  session (`stopReason` not `aborted`/`error`), mirroring the delivery block's guard.
- **`git.add` registered in the live adapter map** — add `"git.add"` to the
  `verbAdapters` record in `run-deps.ts` (via `makeMinimalEntry("git.add")`), so the
  live path has it available; the run-loop reads it from `deps.verbAdapters`.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing
  `git-local` / `run-loop` / `run-deps` tests pass; guard green.

### Task T1 - git.add (stage) broker verb adapter

**Input:** `src/broker/verbs/git-local.ts`, `src/broker/verbs/git-local.test.ts`

**Action - RED:** a hermetic test (temp git repo with an untracked file) builds
`makeAddAdapter({ gitBin: "git", verifySetup: <always-ok> })`, calls
`submit({ cwd })`, then `poll_status(requestId)` and asserts `{ status: "done" }`
and that the untracked file is now staged (`git diff --cached --name-only` lists
it). A second test asserts `makeAddAdapter({ gitBin: "git" })` (no `verifySetup`)
returns `blocked-needs-setup` from `submit`. Fails today (`makeAddAdapter` does not
exist).

**Action - GREEN:** add `makeAddAdapter` to `git-local.ts` mirroring
`makeBranchAdapter`/`makeCommitAdapter`: `verifySetup` gate, `runGit(["add", "-A"],
{ cwd, gitBin })`, per-`requestId` state, immediate `poll_status`, a re-run-safe
`reconcile` (staging is idempotent → `done`). Export a `GitAddInput = { cwd:
string }` type.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/broker/verbs/git-local.test.ts` green.

### Task T2 - tick() stages + commits a writing session onto taskBranch

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic run-loop test wires `deps.verbAdapters` with fake
`git.add` + `git.commit` adapters and a `commitsAhead` fake that returns `> 0` only
after a commit was submitted; it drives one `tick()` for a task whose session
completed cleanly with worktree changes, and asserts (a) the `git.add` adapter's
`submit` was called with the session worktree `cwd`, then (b) the `git.commit`
adapter's `submit` was called (message contains the task id), and (c) delivery ran
(`commitsAhead` observed `> 0`). A second case: a clean session with **no** worktree
changes → `git.commit` submit returns noop/`failed` and no delivery is triggered
(`commitsAhead` stays `0`). Fails today (no stage/commit step in `tick()`).

**Action - GREEN:** in `tick()`, after session end and before the delivery
`commitsAhead` check (`run-loop.ts:518`), when the session completed cleanly and
`deps.verbAdapters` has `git.add` + `git.commit`, submit `git.add { cwd:
sessionWorktreePath ?? featureDir }` then `git.commit { cwd: sessionWorktreePath ??
featureDir, message: "<task.id>" }` through the `submitBrokerVerb` seam. Leave the
existing delivery block to pick up the resulting `commitsAhead > 0`.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.

### Task T3 - live adapter map includes git.add

**Input:** `src/cli/run-deps.ts`, `src/cli/run-deps.test.ts`

**Action - RED:** a test on the async `buildRealDeps` path asserts the returned
`verbAdapters` record has a `"git.add"` entry (with an `entry` + `adapter`), in
addition to the existing `git.branch` / `git.commit` / `git.push` /
`github.create_pr`. Fails today (`git.add` absent).

**Action - GREEN:** in `run-deps.ts`, build `const addAdapter = makeAddAdapter({
gitBin: "git" })` and add `"git.add": { entry: makeMinimalEntry("git.add"), adapter:
addAdapter }` to the `verbAdapters` map. (The `verifySetup` wiring for these
adapters is Story 002 — here `git.add` is only registered.)

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/cli/run-deps.test.ts` green.
