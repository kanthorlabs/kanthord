# Story 002 - resolve identity with per-slot override

Epic: `.agent/plan/epics/019.17-committer-identity-config.md`

## Goal

A resolver returns the effective committer identity for a task's repo: a per-slot
`committer` override wins over the global default; with neither, the result is a
typed "unconfigured". This is the precedence the confirm-on-add UI (2B/3) will later
drive.

## Acceptance Criteria

- The repo slot schema accepts an optional `committer: { name, email }` (a slot yaml
  without it stays valid — backward compatible).
- Resolution returns the **slot `committer`** when the slot defines it, regardless of
  the global default.
- Resolution returns the **global default** when the slot has no `committer` but a
  global identity is configured.
- Resolution returns a typed **unconfigured** result when neither the slot nor the
  global config provides an identity (so callers can escalate rather than commit
  anonymously).

## Constraints

- **Precedence is slot override → global default → unconfigured** (Ulrich decision
  2026-07-13).
- **Slot schema extension** — add optional `committer` to `RepoSlot`
  (`src/slots/repo-slot.ts`) and its yaml parse/validation; an absent field is not an
  error.
- **Reuse Story 001** — the global default comes from `loadCommitterIdentity`; do not
  introduce a second global store.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the ACs below pass; existing slot
  tests pass; guard green.

### Task T1 - optional committer on the repo slot

**Input:** `src/slots/repo-slot.ts`, `src/slots/repo-slot.test.ts`

**Action - RED:** a test asserts a slot yaml with a `committer:` block parses into a
`RepoSlot` whose `committer` is `{ name, email }`, and a slot yaml without it parses
with `committer` undefined (still valid). Fails today (`committer` not on the type /
not parsed).

**Action - GREEN:** add optional `committer?: { name: string; email: string }` to
`RepoSlot` and parse/validate it from the yaml; absent → `undefined`, no error.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/slots/repo-slot.test.ts` green.

### Task T2 - resolve effective identity (slot → global → unconfigured)

**Input:** `src/config/committer-identity.ts`,
`src/config/committer-identity.test.ts`

**Action - RED:** a hermetic test asserts `resolveCommitterIdentity({ slotCommitter,
globalIdentity })` returns: (a) the slot committer when present (even if a global is
also present); (b) the global identity when slot committer is absent; (c) a typed
unconfigured result (e.g. `{ configured: false }` or `undefined`) when both are
absent. Fails today (`resolveCommitterIdentity` absent).

**Action - GREEN:** add `resolveCommitterIdentity` implementing the precedence over
the inputs (pure function; the caller supplies the slot committer and the loaded
global identity).

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/config/committer-identity.test.ts` green.
