# Story A — create a bare managed home

Epic: `.agent/plan/epics/007.11-bare-managed-repository-storage.md`

## Change

In `cloneIntoHome` (`src/workspace/local.ts:224-246`), the clone at `:232` is
`git clone <remoteUrl> <tmpPath>` (non-bare). Make it bare:

- Clone bare: `git clone --bare <remoteUrl> <tmpPath>`. Keep the existing
  clone-to-temp-then-atomic-`rename` shape (`:227-244`).
- Configure origin tracking so Story B's fetch/CAS has a layout to compare:
  `git --git-dir=<home> config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`
  then `git --git-dir=<home> fetch origin`.
- Result must have **both** `refs/heads/<branch>` and
  `refs/remotes/origin/<branch>`.

Do not touch `prepareFromRepository` dispatch, the per-task clone, or landing.
Do not add a schema/domain "bare" field.

## Constraints

- Keep the atomic temp-then-`rename` (a partial bare clone must never land at the
  home path).
- `execFile("git", …)` only; no new dependency.

## Verify

- `node --test src/workspace/local.test.ts`: fresh `prepare()` on an absent home →
  home is bare (`git rev-parse --is-bare-repository` == `true`), has
  `refs/heads/<branch>` + `refs/remotes/origin/<branch>`, no working-tree file at
  the home root. (Passes only with Story B — gate A+B together.)
- `npm run verify` exits 0.
- Proof A / A2.
