# Story 001 - write-scope accepts worktree writes

Epic: `.agent/plan/epics/019.14-write-scope-worktree-writes.md`

## Goal

Make the ring-1 write-scope check authorise a write whose absolute worktree path
falls inside the task's `write_scope`, by comparing in the repo-relative frame and
treating `**` as the whole-repo sentinel — so the driven agent can save files in
its worktree instead of every write escalating.

## Acceptance Criteria

- Through `makeRing1HookAdapter` with a permissive role registry, `worktree` set
  to an absolute worktree path, and `writeScope: ["**"]`: a `write_file` call whose
  `path` resolves inside the worktree returns pass-through (allow) and fires **no**
  escalation.
- With `writeScope: ["src/foo"]` (a scoped, repo-relative prefix) and the same
  worktree: a write to a path inside `<worktree>/src/foo/…` is allowed, and a write
  to `<worktree>/other/…` is blocked with a `re-planning-signal` escalation.
- When no `worktree` is supplied, the write-scope check behaves exactly as before
  (the existing out-of-scope-write scenario still blocks and escalates).

## Constraints

- **Relativize inside `ring1PolicyChain`** (`role-path-policy.ts`): before calling
  `writeScopeCheck`, convert the canonical `effectivePath` (and the secondary path)
  to worktree-relative when `call.worktree` is set; a path outside the worktree or
  an absent worktree passes through unchanged. Use `node:path` `relative` — no new
  dependency (Principle 6). The role layer still evaluates on the absolute path.
- **`**` sentinel in `hook-binding.ts isPathInScope`**: a `write_scope` entry that
  normalizes to `**` authorises every path; other entries keep the existing
  repo-relative directory-prefix semantics (`normalizeScopePath` + `startsWith`).
- **No change to the role-policy glob engine, the tool surface, or `write-scope.ts`.**

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the three ACs pass; existing
  `hook-binding.test.ts`, `role-path-policy.test.ts`, and the
  `2a-out-of-scope-write` scenario tests pass; guard green.

### Task T1 - compare write-scope in the repo-relative frame with a `**` sentinel

**Input:** `src/ring1/role-path-policy.ts`, `src/ring1/hook-binding.ts`,
`src/ring1/hook-binding.test.ts`

**Action - RED:** in `hook-binding.test.ts`, add hermetic cases driving
`makeRing1HookAdapter` (permissive role allow `["**"]`, `worktree` = an absolute
temp/worktree path): (a) `write_file` to `<wt>/slugify.mjs` with `writeScope: ["**"]`
returns `undefined` and captures no escalation; (b) with `writeScope: ["src/foo"]`,
a write to `<wt>/src/foo/x.ts` is allowed and a write to `<wt>/other/y.ts` blocks
with a `re-planning-signal`. These fail today because the absolute path never
matches the repo-relative scope.

**Action - GREEN:** in `role-path-policy.ts ring1PolicyChain`, relativize the
effective (and secondary) path against `call.worktree` before `writeScopeCheck`
when the path is inside the worktree; in `hook-binding.ts isPathInScope`, treat a
scope entry normalizing to `**` as match-all.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/ring1/hook-binding.test.ts src/ring1/role-path-policy.test.ts` green.
