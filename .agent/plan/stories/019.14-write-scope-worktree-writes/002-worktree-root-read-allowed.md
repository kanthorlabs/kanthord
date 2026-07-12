# Story 002 - worktree-root read allowed

Epic: `.agent/plan/epics/019.14-write-scope-worktree-writes.md`

## Goal

Let the agent read/list the worktree root itself: the run-loop role registry
declares the bare worktree directory as an allow entry alongside `<wt>/**`, so an
`ls`/read of the workspace directory does not escalate `not-in-allowlist`.

## Acceptance Criteria

- When `tick()` dispatches a task with a per-task worktree, the ring-1 role
  registry it builds allows a read of the **bare worktree path** (`<worktree>` with
  no trailing slash), and still allows reads/writes of paths inside `<worktree>/…`.
- A read of a path outside the worktree still escalates `not-in-allowlist` (the
  allowlist is not widened beyond the worktree root and its subtree).

## Constraints

- **Additive allow entry** in `run-loop.ts` (~line 421): build the role read/write
  allow as `[wtRoot, wtRoot + "/**"]` where `wtRoot = sessionWorktreePath ?? featureDir`
  — do not replace the `<wt>/**` glob, add the bare root next to it.
- **No change to the glob engine or `makeRing1HookAdapter`.**

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the AC below passes; existing
  run-loop tests pass; guard green.

### Task T1 - allow a read of the bare worktree root

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic run-loop test drives `tick()` with a per-task
worktree and asserts (via the injected ring-1 seam / captured registry, mirroring
the Epic 019.13 worktree test) that the role read allowlist matches the bare
worktree path — i.e. a read of `<worktree>` itself is allowed while a read of a
sibling path outside the worktree is blocked. Fails today because the sole allow
glob `<wt>/**` does not match the bare `<wt>`.

**Action - GREEN:** in `run-loop.ts`, compute `wtRoot` once and pass
`allow: [wtRoot, wtRoot + "/**"]` to both the `read` and `write` dimensions of the
`agent` role registry.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
