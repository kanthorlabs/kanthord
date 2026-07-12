# Story 001 - walkFeature returns an empty walk on an absent dir

Epic: `.agent/plan/epics/019.11-walkfeature-absent-dir.md`

## Goal

`walkFeature` treats a non-existent feature dir like an empty one — returns an
empty walk instead of throwing ENOENT — so the daemon idles on a repo with no
authored features.

## Acceptance Criteria

- `walkFeature(<path that does not exist>)` resolves to the **same empty walk
  shape** that `walkFeature(<existing empty dir>)` returns (empty story groups),
  without throwing.
- `walkFeature(<existing dir>)` behavior is unchanged: real story dirs are still
  walked; a malformed digit-prefixed story dir still throws `GrammarError`.
- Only a missing top-level feature dir is tolerated; a readdir failure that is not
  ENOENT (e.g. a permission error) still propagates.

## Constraints

- **ENOENT-only tolerance on the top-level `readdir`** — catch only
  `code === "ENOENT"` on the feature dir's own `readdir`; do not blanket-swallow
  errors, and do not change the per-story `readdir` behavior.
- **No new walk semantics** — an absent dir maps to the existing empty-dir result.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — absent-dir + empty-dir +
  malformed-dir tests pass; guard green.

### Task T1 - tolerate an absent feature dir

**Input:** `src/compiler/grammar.ts`, `src/compiler/grammar.test.ts`

**Action - RED:** add a hermetic test: `walkFeature("<tmp>/does-not-exist")`
resolves to an empty walk deep-equal to `walkFeature(<a freshly-created empty
dir>)` (no throw). Keep/confirm: an empty existing dir returns empty groups; a dir
with a malformed digit-prefixed story dir still throws `GrammarError`.

**Action - GREEN:** in `grammar.ts walkFeature`, wrap the top-level `readdir(dir)`
so an `ENOENT` yields the empty-walk result (treat entries as `[]`); re-throw any
non-ENOENT error.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/compiler/grammar.test.ts` green.
