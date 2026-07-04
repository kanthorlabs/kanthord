# Story 003 - Rebuild From Markdown & Projection Equivalence

Epic: `.agent/plan/epics/003-markdown-store-and-projection.md`

## Goal

Reconstruct the markdown-derived subset of the SQLite index from the markdown files
alone into a shadow store, and prove it equals the live store's projection when
runtime-only fields are ignored — the Phase-1 gate criterion for storage.

## Acceptance Criteria

- `rebuildFromMarkdown(featureDir) → shadowStore` produces a fresh shadow store
  holding the markdown-derived subset — the compiled-plan rows and node-status
  fields — derived from the markdown files alone (PRD §6.1 — queue rebuilds from
  frontmatter statuses). *(How it derives them — the pure `buildCorePlan` — is a
  Constraint, not this behavior AC.)*
- For a compiled golden feature, `projectionOf(shadow)` equals `projectionOf(live)`
  **field-by-field** (per the Story 002 contract) (phases.md gate — rebuild yields
  the same markdown-derived projection).
- Mutating a **runtime-only** field in the live store (e.g. assigning a lease holder)
  does **not** cause a projection divergence — the diff ignores it per the contract
  (PRD §6.1).
- Mutating a **markdown-derived** value in the live store without touching markdown
  (e.g. corrupting a node status directly in SQLite) **is** reported as a divergence
  by `diffProjection(live, shadow)`, naming the field (PRD §6.1 — the drift
  detector for the single-writer convention).
- `diffProjection` returns a structured list of divergences (empty when equal); it
  does not throw on divergence and assigns no severity (severity is Phase 3).

## Constraints

- Rebuild derives from truth by calling Epic 002's **pure** `buildCorePlan(fileSet)`
  (no store write, no validation side effects, no queue/runtime init), never by
  copying live rows or invoking the operational `compile` command (debate finding —
  depend on the pure derivation API). Reuses the writer's parser; the shared-bug
  blind spot is the logged, accepted limitation (PRD §6.1, Epic 003 Non-Goals).
- Comparison is via the Story 002 `projectionOf` so runtime-only fields are excluded
  by contract, not by ad-hoc field lists (PRD §6.1).
- Ledger rows are out of scope for this Story's rebuild (Epic 005 adds them); the
  diff covers the compiled plan + node status only (Epic 003 Non-Goals).

## Verification Gate

- `npm test` green for `src/store/rebuild.test.ts` on a compiled golden feature.

### Task T1 - Rebuild derived subset into a shadow store

**Input:** `src/store/rebuild.ts`, `src/store/rebuild.test.ts`

**Action - RED:** Write a test that compiles a golden feature into a live store,
calls `rebuildFromMarkdown` on the same feature dir into a shadow store, and asserts
`projectionOf(shadow)` equals `projectionOf(live)` field-by-field.

**Action - GREEN:** Implement `rebuildFromMarkdown` calling the pure
`buildCorePlan(fileSet)` + ingesting frontmatter statuses, writing the result into a
fresh shadow store.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - diffProjection ignores runtime-only, catches derived drift

**Input:** `src/store/rebuild.ts`, `src/store/rebuild.test.ts`

**Action - RED:** Write tests: (a) after assigning a lease (runtime-only) in the live
store, `diffProjection(live, shadow)` returns empty (no divergence); (b) after
corrupting a node status directly in the live SQLite, `diffProjection` returns a
divergence naming that field.

**Action - GREEN:** Implement `diffProjection(live, shadow)` comparing
`projectionOf` results and returning a structured divergence list (no throw, no
severity).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
