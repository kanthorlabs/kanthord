# Story A — initiative branch + brokered isolated clone

Epic: `.agent/plan/epics/007.12-initiative-branch-workflow.md`
Depends on: Story D (initiative `building` state).

## Change

Add initiative-scoped provisioning (daemon-only). Today provisioning is per-task
(`src/agent-runner/pi.ts:440-443` → `LocalWorkspaceManager` clones per `taskId`,
`src/workspace/local.ts:608-676`).

- Create `refs/heads/kanthord/init/<initId>` in the bare home from the
  integration tip (`refs/heads/<branch>`, default `main`) under the home lock
  (`acquireLock`, `local.ts:290-317`). Idempotent (reuse if exists).
  `resolveHomeDir(repoId)` at `src/composition.ts:391-397`.
- Clone it isolated:
  `git clone --no-hardlinks --single-branch --branch kanthord/init/<initId> <home> <dir>`
  then `git -C <dir> remote remove origin`.
  - `--no-hardlinks` mandatory. After: `git -C <dir> config --get
remote.origin.url` must be empty.
  - `<dir>` per-initiative (e.g. `join(root, "init", initId)`), wiped on
    re-provision.
- Add `prepareInitiative(initId, repo): Promise<Workspace>` to `WorkspaceManager`
  (`src/workspace/port.ts:9-18`), returning
  `{ dir, branch: "kanthord/init/<initId>", baseCommit }`. Keep per-task
  `prepare()` working.
- Persist the clone `dir` on the initiative (new column, migration = next
  contiguous version; extend `InitiativeRepository`, `src/storage/port.ts:70-97`)
  so `get initiative` (Story F) exposes it as `workspace`.

## Constraints

- Only the daemon creates the branch + clone; agents never write the home.
- Reuse `buildGitEnv` (`local.ts:84-129`) / `GIT_CONFIG` (`:36-43`) / lock
  helpers. Don't alter the per-task clone in this story.
- No git worktrees.

## Verify

- `node --test src/workspace/local.test.ts` (bare `file://` home):
  - `prepareInitiative` creates the branch at the integration tip; clone is a
    real checkout on `kanthord/init/<initId>`, has **no** origin, `.git/objects`
    not hardlinked to home; re-run idempotent.
- `node --test` initiative storage: clone path round-trips.
- `npm run verify` exits 0.
- Proof A / A2 (branch in home; `get initiative --json` workspace clone has no
  origin).
