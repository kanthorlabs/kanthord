# Story 001 - agent writes in its task worktree

Epic: `.agent/plan/epics/019.13-agent-workspace-and-model-log.md`

## Goal

Bind ring-1 to the actual task worktree and tell the agent its working directory
is that worktree, so the agent's file writes land in the worktree and pass ring-1
(instead of resolving against the feature dir and getting blocked).

## Acceptance Criteria

- When a task is dispatched with a per-task worktree, `tick()` builds the ring-1
  hook with `worktree` set to that **session worktree path** (not `featureDir`);
  when there is no worktree, it falls back to the prior value.
- The assembled session brief includes an explicit **working-directory block**
  naming the absolute worktree path and instructing the agent to create/edit files
  inside it (so the model writes to `<worktree>/…` paths that ring-1's worktree
  resolution accepts).
- Existing ring-1 wiring (role, write_scope, escalation) and the brief's other
  blocks are unchanged; a task with no worktree still spawns as before.

## Constraints

- **Ring-1 `worktree` = the session worktree** (`sessionWorktreePath`,
  Epic 019.8), passed to `makeRing1HookAdapter` — the hook already resolves
  relative paths against `worktree` (`hook-binding.ts:67`); this only corrects
  which dir it is.
- **Brief block is additive** — a new working-directory block in the assembled
  `systemPrompt` (spawnPiSession), not a rewrite of existing blocks; it states the
  absolute worktree path.
- **No tool-surface / ring-1 policy change** (Epic 015/019.1 own those).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the two assertions below pass;
  existing run-loop + pi-session tests pass; guard green.

### Task T1 - bind ring-1 to the session worktree

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic test drives `tick()` with a per-task worktree
(recording the args passed to `makeRing1HookAdapter` via an injected seam or by
asserting the ring-1 chain resolves a relative path against the worktree) and
asserts the ring-1 hook is built with `worktree` === the session worktree path,
not `featureDir`. Without a worktree, the fallback value is used.

**Action - GREEN:** in `run-loop.ts` (~line 433) pass `worktree: sessionWorktreePath
?? featureDir` to `makeRing1HookAdapter`.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.

### Task T2 - brief names the worktree working directory

**Input:** `src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`

**Action - RED:** a hermetic test asserts that when `spawnPiSession` is given a
`worktreePath`, the assembled `systemPrompt` passed to `spawnAgent` contains a
working-directory block naming that absolute path and instructing the agent to
write files inside it. When no `worktreePath`, no such block (or a neutral one) —
existing brief assertions unchanged.

**Action - GREEN:** in `pi-session.ts`, add a working-directory block to the
assembled brief when `worktreePath` is present, stating the absolute worktree path
as the workspace root.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/agent/pi-session.test.ts` green.
