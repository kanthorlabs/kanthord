# EPIC 007.13 — Repository publication — stories

Epic: `.agent/plan/epics/007.13-repository-publication.md`
**Prereq: EPIC 007.12** (publishes the initiative branch).

`publish repository --repository <id> --branch <b>` pushes the landed branch to
the remote, fast-forward-only; a diverged remote fails loudly (no force).
Publication has its own persisted, queryable state.

## Dispatch order

**A → C → B → D.** A (push adapter) is the core; C (storage + read view) before
B's persistence write; B wires the use case + CLI; D is docs.

## Stories

- A — publish port + git adapter → `01-publish-port-git-adapter.md`
- B — `publish repository` CLI + use case → `02-publish-repository-cli-usecase.md`
- C — persisted publication state → `03-persisted-publication-state.md`
- D — delivery-contract docs → `04-delivery-contract-docs.md`

## Facts (needed for implementation)

- No `src/publication/`, `src/scm/`, `src/credential/`, or `repositories` table.
  Repos are `resources` rows (`src/storage/sqlite/migrations.ts:25-32`, remote
  cols v7 `:169-171`). `get repository` = `get resource --id` (`RepositoryView`,
  `src/app/resource/resource-view.ts:23-32`).
- No `git push` anywhere — push adapter is new.
- GIT_ASKPASS plumbing to reuse: `buildGitEnv` (`src/workspace/local.ts:84-129`,
  temp token + askpass script + `cleanup()`). **`resolveCredential` is never
  wired in production** (`LocalWorkspaceManager` built with `{root, lockDir}`
  only, `src/composition.ts:424-427`) — Story A must wire a resolver for push.
- Capability template to mirror: `src/landing/` (`port.ts` + `git.ts`; typed
  error `LandingCASMismatchError` carrying an OID → model `PublishDivergedError`
  on it, `src/landing/port.ts:57-65`).
- Read landed head: `git rev-parse refs/heads/<branch>` (`resolveTargetOID`,
  `src/landing/git.ts:357-359`).
- Migrations contiguous (`src/storage/sqlite/migrate.ts:47-55`) — next free
  version, don't hard-code.
- CLI group wiring: mirror `land` (`src/apps/cli/index.ts:54,82`,
  `commands/land.ts`, `commands/land/repository.ts`). Output contract:
  id-on-stdout / friendly-on-stderr (`src/apps/cli/resource.ts:87-95`).
