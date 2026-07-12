# Story 003 - real commitsAhead seam

Epic: `.agent/plan/epics/019.8-assemble-live-run-entrypoint.md`

## Goal

Provide the real `commitsAhead(branch, base)` the Epic 019.7 delivery trigger
needs — counting commits on the task branch ahead of the base — so `tick()`
delivers only when the session actually produced commits. Today only a test mock
exists.

## Acceptance Criteria

- A `makeCommitsAhead({ cwd, runGit })` factory returns a function
  `commitsAhead(branch, base)` that resolves to the integer count of commits on
  `branch` not reachable from `base` (equivalent to `git rev-list --count
  base..branch`) evaluated in `cwd`.
- Zero commits ahead → `0`; N commits on the branch after base → `N`.
- A non-existent branch (or other git error) surfaces as a typed error, not a
  silent `0` (so delivery never fires on a bad ref, and never wrongly skips on a
  real one).

## Constraints

- **`git rev-list --count base..branch`** via the injected `runGit` seam — no
  reimplemented graph walk; the count is git's.
- **Injected `runGit`** so the hermetic test runs against a temp repo; no network.
- **Shape matches the Epic 019.7 `tick()` seam** — the returned function's
  signature is exactly what `tick()` calls (`commitsAhead(taskBranch, base)`), so
  Story 004 can drop it in without changing `tick()`.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — commitsAhead test passes on a
  temp repo; guard green.

### Task T1 - git-backed commitsAhead

**Input:** `src/daemon/commits-ahead.ts`, `src/daemon/commits-ahead.test.ts`

**Action - RED:** a hermetic test builds a temp git repo with a base branch, then
a task branch with 2 additional commits, and asserts `makeCommitsAhead({ cwd,
runGit })` returns a function where `commitsAhead(taskBranch, base)` === `2` and,
after no extra commits, a fresh branch off base === `0`; and that a non-existent
branch rejects with a typed error (not `0`).

**Action - GREEN:** implement `makeCommitsAhead` in `src/daemon/commits-ahead.ts`
running `git rev-list --count <base>..<branch>` via `runGit` and parsing the
integer; throw a typed error on git failure.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/commits-ahead.test.ts` green.
