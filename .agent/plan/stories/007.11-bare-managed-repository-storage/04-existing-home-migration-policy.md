# Story D — existing-home migration policy + docs

Epic: `.agent/plan/epics/007.11-bare-managed-repository-storage.md`
Depends on: Story A + B.

## Change

Story B routes a pre-existing **non-bare** `root-checkout` home to "unexpected".
Handle it here, in `prepareFromRepository` (`src/workspace/local.ts:462-513`).
Pick one policy:

- **Recommended — recreate-if-clean, else refuse.** If the non-bare home is
  kanthord-owned + clean (origin matches `remoteUrl`, `git status --porcelain`
  empty, no local-only branches), re-provision it as bare (remove old dir under
  the home lock, then Story A's `cloneIntoHome`). Otherwise throw
  `WorkspacePreparationError` naming the path and telling the operator to
  remove/recreate.
- **Alternative — always refuse** any non-bare home with that guidance error.

Rules:

- Never a silent `reset --hard` / blind delete.
- A bare home is untouched.
- Recreate branch runs under the home lock (`acquireLock`, `:290-317`) + atomic
  temp-then-`rename`.

Docs: add a short paragraph to `README.md` and `AGENTS.md` — the managed home is
a **bare kanthord cache**; read landed work via a fresh clone or
`git --git-dir=<home> show <ref>:<path>`.

## Verify

- `node --test src/workspace/local.test.ts`:
  - non-bare **clean** home → recreated bare (or refused, per chosen policy).
  - non-bare **dirty** home → refused; home not modified (dirty file still
    present).
  - bare home → untouched, succeeds.
- Docs mention the bare cache (grep-checkable).
- `npm run verify` exits 0.
