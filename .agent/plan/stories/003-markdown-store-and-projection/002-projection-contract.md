# Story 002 - Versioned Projection Contract

Epic: `.agent/plan/epics/003-markdown-store-and-projection.md`

## Goal

A single, versioned specification of the markdown→SQLite projection: which SQLite
fields are derived from markdown (and how) versus which are runtime-only and have no
markdown source. This is the contract `rebuildFromMarkdown` (Story 003), Epic 005's
ledger slot, and Phase-2A `kanthord verify` all read.

## Acceptance Criteria

- The contract is an **exported structured object** (table → column →
  `{ derived: <source> }` or `{ runtimeOnly: true }`), consumable programmatically by
  Epic 005 and Phase-2A `kanthord verify` without reverse-engineering tests — not
  merely a doc comment (PRD §6.1 — a documented, versioned contract).
- It enumerates, for the compiled-plan tables (Epic 002 schema) and the node-status
  field, each column as `markdown-derived` (with its named source: file/frontmatter
  field or the compiler) or `runtime-only` (PRD §6.1).
- The runtime-only set explicitly includes leases, poll cursors, and
  `op_id → request_id` maps (PRD §6.1 — no markdown source).
- **Status write-through invariant (stated explicitly):** node `status` is
  markdown-derived because the daemon updates status **by writing frontmatter**
  (single writer) and the SQLite projection follows; the daemon never mutates SQLite
  status without a markdown write. The contract documents this — if it were false the
  contract would be lying (debate finding; PRD §6.1–6.2).
- The contract exposes a `PROJECTION_CONTRACT_VERSION` constant; a test asserts its
  current value (a value fixed by this design is an AC — authoring.md).
- The contract defines **deterministic comparison rules** so equality is not
  implementation-defined: row identity keys (`plan_node` by `id`, `plan_edge` by
  `(from,to,kind)`, etc.), order-independent row comparison, table scope (which
  tables are in the projection), null/default handling, and canonicalization of any
  nested-JSON/`semantics` field (debate finding).
- Given a live-store row, `projectionOf(row)` returns only the markdown-derived
  fields, so two rows differing only in a runtime-only field project equal.
- The operation-ledger projection is **explicitly excluded from v1** and documented
  as a future contract section; Epic 005 **bumps** `PROJECTION_CONTRACT_VERSION` when
  it adds ledger rows. v1 does not reserve-and-assert a ledger slot (debate finding —
  a reserved-but-unvalidated slot creates false confidence).

## Constraints

- The projection is a **documented, versioned contract**, not an ad-hoc diff — a
  divergence is judged against it, and schema evolution is migration-aware (PRD
  §6.1). The contract lives as code (the field map + version) plus a doc comment.
- The contract names the source of every derived field so the diff "is not an
  argument" (PRD §6.1).
- No severity levels here — the contract classifies derived vs runtime-only only;
  warn/repairable/fatal is Phase 3 (Epic 003 Non-Goals).

## Verification Gate

- `npm test` green for `src/store/projection.test.ts`.

### Task T1 - Field classification + version constant

**Input:** `src/store/projection.ts`, `src/store/projection.test.ts`

**Action - RED:** Write a test asserting: (a) `PROJECTION_CONTRACT_VERSION` equals
its fixed value; (b) each compiled-plan column and the node-status field is
classified `markdown-derived` (with a named source) or `runtime-only`; (c) leases,
poll cursors, and `op_id → request_id` are `runtime-only`; (d) the exported contract
object declares row-identity keys and table scope; (e) the contract has **no**
ledger table in v1 (documented future section only).

**Action - GREEN:** Implement the exported projection contract object (per the Epic
002 schema section) with the version constant, the classification, row-identity
keys, table scope, and comparison rules. No ledger entry in v1.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - projectionOf drops runtime-only fields

**Input:** `src/store/projection.ts`, `src/store/projection.test.ts`

**Action - RED:** Write a test that two rows identical except for a runtime-only
field (a lease holder) produce **equal** `projectionOf` results, while rows
differing in a markdown-derived field (node status) produce **unequal** results.

**Action - GREEN:** Implement `projectionOf(row)` returning only the
markdown-derived fields per the contract.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
