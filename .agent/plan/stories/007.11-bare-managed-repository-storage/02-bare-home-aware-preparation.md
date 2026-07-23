# Story B — bare-home-aware workspace preparation

Epic: `.agent/plan/epics/007.11-bare-managed-repository-storage.md`
Pair with Story A.

## Change

In `LocalWorkspaceManager` (`src/workspace/local.ts`):

- Remove the bare-rejection throw at `:473-477`; a `{ kind: "bare" }` inspection
  is now the **normal** home shape. A non-bare `root-checkout` at the home path
  becomes the _unexpected_ shape → route to Story D (leave a clear
  `WorkspacePreparationError` placeholder; never silently accept it).
- Retarget the fetch/CAS advance block (`:525-591`) at the bare git dir:
  `git --git-dir=<home> fetch origin`, compare
  `git --git-dir=<home> rev-parse refs/heads/<branch>` vs
  `refs/remotes/origin/<branch>`, fast-forward-advance `refs/heads/<branch>` via
  `git --git-dir=<home> update-ref` under the lock (`acquireLock`, `:290-317`).
  Preserve `DivergenceError` / `FetchError` / cached-policy handling
  (`:540-589`).
- Keep origin validation (`:503-511`) reading the bare config
  (`git --git-dir=<home> remote get-url origin`).
- Per-task clone (`:617-676`) is unchanged — a bare repo is a valid clone source.
  (Initiative-level `--no-hardlinks` clone is EPIC 007.12, not here.)

## Constraints

- Keep `git-error` / empty-dir / `not-a-repo` handling (`:468-496`).
- No change to `WorkspaceManager` port signature (`src/workspace/port.ts:9-18`).

## Verify

- `node --test src/workspace/local.test.ts`:
  - `prepare()` on a bare home (from Story A) succeeds, returns a usable
    `Workspace`.
  - after the remote advances, a second `prepare()` fast-forwards
    `refs/heads/<branch>` in the bare home.
  - diverged remote still raises `DivergenceError`.
  - per-task clone is a non-bare checkout of `kanthord/<taskId>` whose
    `baseCommit` == the bare home branch tip.
- `npm run verify` exits 0.
- Enables the Proof daemon run (precondition for Proof B / C).
