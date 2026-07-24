# Story C — persisted, queryable publication state

Epic: `.agent/plan/epics/007.13-repository-publication.md`
Land storage + read view before/with Story B's write.

## Change

- **Storage.** Per-repository-target publication state: `unpublished`,
  `published` (with `remoteOID`), `diverged` (with observed `remoteOID`). Use a
  dedicated `publications` table keyed by `(repoId, branch)`. New migration at
  the **next contiguous version** (`src/storage/sqlite/migrate.ts:47-55`; don't
  hard-code). Plain `CREATE TABLE`, `user_version` guards.
- **Store port** (mirror `LandingRepository`, `src/storage/port.ts`):
  `getPublication(repoId, branch)`, `setPublication(repoId, branch, state)`. Wire
  the sqlite adapter in composition.
- **Read view.** Extend `RepositoryView` (`src/app/resource/resource-view.ts:23-32`,
  built `:86-98`) with:
  ```
  publication: { state: "unpublished" | "published" | "diverged";
                 remoteOID: string | null } | null
  ```
  Source from the publication store in `GetResource.execute`
  (`src/app/resource/get-resource.ts:16-22`). `--json`
  (`src/apps/cli/resource.ts:282-288`) flows it automatically; human block
  (`:290-301`) prints `publication: <state>[ @<remoteOID>]` when non-null.

## Constraints

- Read-only join here; Story B does the write.
- No publication field on the `Repository` domain entity
  (`src/domain/resource.ts:19-24`).
- Migration append-only + contiguous.

## Verify

- `node --test` publication store (real sqlite): set/get round-trips all three
  states; unknown target → `unpublished`/null.
- `node --test src/app/resource/get-resource.test.ts` (fake publication source):
  `published@<oid>` → `publication.state==="published"` + `remoteOID`, in
  `--json`; no row → `unpublished`/null.
- `node --test` migration: table exists; `validateSequence` passes.
- `npm run verify` exits 0.
- Proof C (`get resource --id <repo> --json` reports `publication{state=published,
remoteOID}`).

## Reconciliation with 007.12 (maintainer, 2026-07-24)

Under the shipped 007.12 objective-branch workflow, delivery publishes the
**initiative branch** `kanthord/init/<id>`, not the repo's configured branch
(`main`). So `GetResource` must NOT key the read on `view.branch` (that would
always miss the published init branch). Instead:

- **Store port** gains `getLatestPublication(repoId)` — the publication for the
  repo's most-recently-published branch (any branch), or `undefined` if none.
  sqlite adapter: `SELECT ... FROM publications WHERE repo_id = ? ORDER BY
rowid DESC LIMIT 1` (each branch publishes once in the flow, so rowid order is
  stable). `getPublication(repoId, branch)` stays for the publish use case's
  `expectedRemoteOID` read.
- **`GetResource.execute`** sources `view.publication` from
  `getLatestPublication(repo.id)` instead of `getPublication(id, view.branch)`.
- The `get-resource.test.ts` fake and the publication-store test cover
  `getLatestPublication` (latest-branch round-trip; no rows → null).
