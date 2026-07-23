# Story B — `publish repository` CLI + use case

Epic: `.agent/plan/epics/007.13-repository-publication.md`
Depends on: Story A (port + adapter), Story C (publication storage).

## Change

Use case `src/app/repository/publish-repository.ts` — `class PublishRepository`,
`execute({ repositoryId, branch }): Promise<PublishOutcome>`:

- Resolve the repository resource (`getResource(repositoryId)` →
  `remoteUrl/branch/auth/path`); reject non-repository / not-found with a typed
  error.
- `homeDir` via `resolveHomeDir` (`src/composition.ts:391-397`).
- Landed local head: `git --git-dir=<homeDir> rev-parse refs/heads/<branch>`
  (reuse `resolveTargetOID`, `src/landing/git.ts:357-359`).
- `expectedRemoteOID` from publication state (Story C).
- Call `RepositoryPublisher.publish(...)` (Story A).
  - success → persist `published@<remoteOID>` (Story C); success outcome.
  - `PublishDivergedError` → persist `diverged` (record remote OID); non-zero
    outcome. Never force.
  - `PublishAuthError` / other → clear message (read-only / branch-protected /
    ssh / fork); non-zero, no state corruption.

CLI `src/apps/cli/commands/publish/repository.ts` + group
`src/apps/cli/commands/publish.ts`, registered in `src/apps/cli/index.ts` (mirror
`land`): `--repository <id>` + `--branch <b>` (both required). Output
(`src/apps/cli/resource.ts:87-95`): success → `stdout:[<remoteOID>]`,
`stderr:["repository published: <id> -> <remoteOID>"]`; divergence/failure →
`stdout:[]`, friendly stderr, non-zero exit. Add `publishRepository` to
`CliDeps` (`src/apps/cli/deps.ts`).

## Constraints

- Human-gated; no automatic push on approve/land.
- Use case calls the port + publication store, never `git` directly.

## Verify

- `node --test src/app/repository/publish-repository.test.ts` (fake publisher +
  store):
  - success → publisher called with landed head + last-known remote OID; state
    `published@<remoteOID>`; success outcome.
  - `PublishDivergedError` → state `diverged`; non-zero; no force retry.
  - unknown/non-repository id → typed error, no push.
- `node --test` CLI wiring: flags parse; success prints `<remoteOID>` on stdout +
  friendly stderr; divergence exits non-zero.
- `npm run verify` exits 0.
- Proof A / D command wiring.
