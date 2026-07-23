# Story C — object/ref-only landing (drop the checkout branch)

Epic: `.agent/plan/epics/007.11-bare-managed-repository-storage.md`

## Change

`GitRepositoryLanding.land()` (`src/landing/git.ts:95-261`) lands via the home
working tree (`git checkout` `:162-164`, `git merge` `:178-236`) — can't run on a
bare home. The object path already exists: `resolveTargetOID` (`:357-359`) →
`preview` (`:275-351`) → `landPreviewed` (`:371-448`, CAS `update-ref`), used by
`ApproveTask` (`src/app/task/approve-task.ts:246-321`). Its only remaining caller
of `land()` is the manual CLI.

- Reroute `runRepoLand` (`src/apps/cli/repo.ts:35-106`): replace
  `landing.land(homeDir, candidate)` at `:62` with
  `resolveTargetOID` → `preview` → `landPreviewed`, wrapped in the same
  `LandingCASMismatchError` re-preview retry loop as `approve-task.ts:246-321`.
  Existing outcome handling (`repo.ts:64-104`) maps onto `LandingResult.outcome`
  / `LandingConflictError` unchanged.
- Widen `CliRepositoryLanding` (`src/apps/cli/deps.ts:72`) to expose
  `resolveTargetOID` / `preview` / `landPreviewed`.
- Remove `land()` from `GitRepositoryLanding` and the `RepositoryLanding` port
  (`src/landing/port.ts:67-81`) once it has no caller. Keep `preview` /
  `landPreviewed` / `resolveTargetOID`. Do **not** remove `buildConflictContext`
  (`git.ts:457-461`, used by EPIC 007.6).

## Constraints

- Preserve `land repository` exit codes (0 ff/merge/already, 1 conflict) + output.
- Migrate any test exercising `land()` (`src/landing/git.test.ts`) onto the
  object path.

## Verify

- `node --test src/landing/git.test.ts`: ff + mergeable candidates land via
  `update-ref` on a bare home; conflict throws `LandingConflictError`.
- `node --test src/apps/cli/repo.test.ts`: `land repository` exit 0 on ff/merge,
  1 on conflict.
- `npm run verify` exits 0.
- Proof B / C / C2 (ref advances; file readable via `cat-file -e
refs/heads/main:<path>`; `status --porcelain` empty).
