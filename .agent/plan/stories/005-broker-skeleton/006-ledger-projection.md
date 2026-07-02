# Story 006 - Operation-Ledger Projection

Epic: `.agent/plan/epics/005-broker-skeleton.md`

## Goal

Extend the markdown→SQLite projection contract to include the operation ledger (Epic
003 reserved this as a future section) and prove ledger rebuild-equivalence, so the
Phase-1 "rebuild SQLite from markdown == projection" gate covers markdown-derived
ledger state, not just the compiled plan + node status.

## Acceptance Criteria

- `PROJECTION_CONTRACT_VERSION` is **bumped**, and the contract now classifies the
  operation-ledger's markdown-derived fields (`op_id`, verb, `idempotency_key`,
  correlation, desired-effect hash, status) as `markdown-derived`, while the ephemeral
  `request_id` stays out (runtime-only / never synced) (PRD §5, §6.1; Epic 003 Story
  002 contract).
- `rebuildFromMarkdown` (Epic 003) reconstructs the ledger rows from the task markdown
  into the shadow store; `projectionOf(shadow)` equals `projectionOf(live)` for the
  ledger fields (PRD §6.1 — rebuild == markdown-derived projection).
- A live-only `request_id` (runtime) difference does **not** cause a ledger projection
  divergence (it is excluded by contract) (PRD §6.1).
- Corrupting a markdown-derived ledger field directly in live SQLite **is** reported
  by `diffProjection` as a divergence naming the field (Epic 003 drift detection).

## Constraints

- This Story **extends** the Epic 003 projection contract + `rebuildFromMarkdown`; it
  does not fork a second projection (Epic 003 owns the contract mechanism; this Story
  adds the ledger entry + version bump) (PRD §6.1).
- Ledger identity is durable in markdown; `request_id` is never projected (PRD §5,
  §6.1). Reuses the Epic 005 Story 004 ledger + Epic 003 `projectionOf`/`diffProjection`.
- No new rebuild machinery — the ledger is added to the existing derived-subset rebuild.

## Verification Gate

- `npm test` green for `src/broker/ledger-projection.test.ts`.

### Task T1 - Version bump + ledger classified in the contract

**Input:** `src/store/projection.ts`, `src/broker/ledger-projection.test.ts`

**Action - RED:** Write a test asserting `PROJECTION_CONTRACT_VERSION` is the new
value and the contract classifies the ledger identity fields `markdown-derived` and
`request_id` `runtime-only`.

**Action - GREEN:** Add the operation-ledger entry to the Epic 003 projection contract
object and bump the version constant.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Ledger rebuild-equivalence + drift detection

**Input:** `src/broker/ledger-projection.ts`, `src/broker/ledger-projection.test.ts`

**Action - RED:** Write a test that after writing ledger entries, `rebuildFromMarkdown`
yields a shadow whose ledger projection equals the live projection field-by-field; a
live-only `request_id` difference yields no divergence; and corrupting a
markdown-derived ledger field in live SQLite is reported by `diffProjection`.

**Action - GREEN:** Extend `rebuildFromMarkdown` to reconstruct ledger rows from the
markdown ledger into the shadow store (via the Epic 005 Story 004 recovery path),
comparable through the Epic 003 `projectionOf`.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
