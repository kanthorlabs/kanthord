# Story 002 - run each task in its own worktree+branch

Epic: `.agent/plan/epics/019.8-assemble-live-run-entrypoint.md`

## Goal

`tick()` runs each dispatched task in its own worktree+branch off the local
checkout via the existing `dispatchWorktree`, and the session runs there — so the
agent's edits + commits land on an isolated task branch the broker can push.
`dispatchWorktree` (`src/slots/worktree.ts`) exists but has no live caller.

## Acceptance Criteria

- When `tick()` dispatches a task, it acquires a worktree+branch for that task via
  `dispatchWorktree` (branch name derived from the task id, worktree under the
  slot's worktrees base off the local checkout) before spawning the session, and
  spawns the session with that worktree as its working path.
- The task branch is the same branch the Epic 019.7 delivery pushes (the push
  input's branch = the worktree branch), so a committed session delivers the
  correct head.
- Worktree acquisition honors the slot's `max_concurrent_tasks` lease cap: when
  the cap is reached a task is left queued (not spawned) rather than erroring; a
  pre-existing foreign branch surfaces as the typed conflict, not a silent
  overwrite.
- When no worktrees base / local checkout is configured (e.g. existing hermetic
  tests without the live wiring), `tick()` behaves as before — the worktree step
  is active only on the live path.

## Constraints

- **Reuse `dispatchWorktree`** (`src/slots/worktree.ts`) unchanged — lease cap +
  branch sanitization + conflict detection are its existing contract.
- **Worktree path flows to the session** — the spawned session's working path is
  the acquired worktree (threaded into `spawnPiSession`'s worktree seam), so edits
  and commits occur on the task branch.
- **Backward compatible** — the worktree step is gated on the live wiring being
  present so existing `run-loop` tests (no worktrees base) are unaffected.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — worktree-dispatch test passes;
  existing run-loop + 2A scenarios unaffected; guard green.

### Task T1 - acquire a worktree per task and spawn the session in it

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic test provides `tick()` with a worktrees base + local
checkout (a temp git repo) and a recording `dispatchWorktree` seam, and asserts:
dispatching a task calls `dispatchWorktree` with the task id and the session is
spawned with the returned worktree path as its working path; the delivered push
branch equals the worktree branch; and when the injected lease cap is reached the
task is left queued (session not spawned). With no worktrees base configured,
`tick()` spawns as before (existing tests still green).

**Action - GREEN:** in `tick()` dispatch, when the live worktree wiring is present
(worktrees base + checkout on deps), call `dispatchWorktree` for the task, thread
the worktree path into `spawnPiSession`, and use its branch for delivery; respect
the queued (lease-capped) result; keep the no-wiring path unchanged.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green; 2A scenarios still green.
