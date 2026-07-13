# Story 001 - global identity store

Epic: `.agent/plan/epics/019.17-committer-identity-config.md`

## Goal

A loader/store for the operator's global git committer identity (name + email)
persisted under the data root, so the daemon has a default identity to commit with.
A missing/absent config is a clear typed result, never a crash.

## Acceptance Criteria

- Writing a committer identity `{ name, email }` persists it under the data root as
  JSON, and a subsequent read returns exactly that `{ name, email }`.
- Reading when no identity has been configured returns a typed **absent** result
  (e.g. `undefined`), not a thrown error and not a partial/garbage object.
- A stored identity round-trips its exact `name` and `email` string values
  (including spaces / unicode) unchanged.

## Constraints

- **Under the data root** — the config file lives under `KANTHORD_DATA` resolved via
  `src/foundations/data-root.ts`, alongside the existing JSON config
  (`accounts.json`), as a new file (e.g. `committer.json`). Memory
  `kanthord-data-root-rule`.
- **Small injectable seam** — expose a loader/saver (e.g.
  `loadCommitterIdentity(dataRoot)` / `saveCommitterIdentity(dataRoot, identity)`)
  typed by a `CommitterIdentity { name: string; email: string }` interface the
  consumer defines; no module-level singletons (project DI idiom).
- **Not a secret** — name/email are not credentials; no 0600 mode requirement (unlike
  the PAT identity file).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; guard green.

### Task T1 - persist + load the global committer identity

**Input:** `src/config/committer-identity.ts` (new),
`src/config/committer-identity.test.ts` (new)

**Action - RED:** a hermetic test (temp dir as data root) asserts: (a)
`loadCommitterIdentity(dir)` returns `undefined` when no file exists; (b) after
`saveCommitterIdentity(dir, { name: "Ada Lovelace", email: "ada@example.com" })`,
`loadCommitterIdentity(dir)` returns exactly that object. Fails today (module
absent).

**Action - GREEN:** create `committer-identity.ts` exporting the
`CommitterIdentity` type plus `loadCommitterIdentity` / `saveCommitterIdentity` that
read/write a JSON file under the data root; return `undefined` on ENOENT; parse and
return `{ name, email }` otherwise.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/config/committer-identity.test.ts` green.
