# Story 001 - Verify Engine

Epic: `.agent/plan/epics/018-kanthord-verify-basic.md`

## Goal

Given a store root and a live database, the engine rebuilds a shadow store,
diffs the markdown-derived projection live-vs-shadow under the versioned
contract, and returns a typed divergence report.

## Acceptance Criteria

- A clean golden feature (compiled, untouched) yields an empty report.
- A markdown-derived live field mutated directly in SQLite (node status) yields
  one divergence entry: entity id, field name, live value, shadow value
  (PRD §6.1 — reporting divergences; "a diff is not an argument" needs exact
  values).
- A mutated runtime-only field (lease) yields no entry (contract exclusion).
- A divergent operation-ledger row is reported (Epic 005 Story 006 scope).
- The engine asserts the projection-contract version it was built for against
  the store's stamped version; a mismatch is a typed `contract-version-mismatch`
  error, not a diff.
- The diff's field coverage equals the contract's enumeration — asserted by
  comparing the set of fields the diff inspects against the contract's field
  list, so a stale enumeration under the same version cannot pass silently
  (debate finding).

## Constraints

- Composes `rebuildFromMarkdown` (Epic 003) and the diff over the contract's
  field enumeration — no second definition of "markdown-derived" (Epic 018
  anchor; one contract, PRD §6.1).
- The engine takes **readers for the live DB and the store**, plus an injected
  **ephemeral shadow-target factory** (create temp / destroy on finish) — the
  rebuild writes only there; the engine holds no write capability toward live
  state (debate finding — "read-only" and "rebuilds a shadow" reconciled
  explicitly).

## Verification Gate

- `npm test` green for `src/verify/engine.test.ts`.

### Task T1 - Rebuild + diff + report

**Input:** `src/verify/engine.ts`, `src/verify/engine.test.ts`

**Action - RED:** Write tests: (a) clean feature ⇒ empty report; (b) mutated
node status ⇒ one entry with entity/field/live/shadow; (c) mutated lease ⇒
empty; (d) mutated ledger row ⇒ reported.

**Action - GREEN:** Implement the engine composing rebuild + contract-driven
field diff into the typed report.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Contract-version guard

**Input:** `src/verify/engine.ts`, `src/verify/engine.test.ts`

**Action - RED:** Write a test that a store stamped with a different contract
version fails with typed `contract-version-mismatch` naming both versions, and
no diff is attempted.

**Action - GREEN:** Add the version assertion ahead of the diff.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
