# Story 002 - Artifact Byte-Diff Gate

Epic: `.agent/plan/epics/028-deploy-observers-and-artifacts.md`

## Goal

Contract artifacts gate on content hashes of the authored source: publish
snapshots + hashes, consume compares, and any change without a semantic handler
escalates `unclassified-artifact-change`, parks the consumer, and stays out of
the automation metric.

## Acceptance Criteria

- Publishing an artifact output snapshots the **authored source file** (the
  `contracts/` copy — never generated output) with its content hash into the
  artifact registry (PRD §7.2 — kill generator noise at the root).
- A consumer entry gate passes when the published hash matches the consumed
  expectation (Epic 006 Story 005 mechanics on the real store).
- A re-published artifact with changed bytes fails the consumer gate; with no
  semantic handler registered, an `unclassified-artifact-change` escalation
  fires carrying a byte-diff summary (changed line counts/hunks — size-capped
  and secret-scanned before storage, debate finding), and the consumer parks
  per the Epic 028 lifecycle: durable blocked state; human accepts-new-hash
  (expected hash updates, gate re-evaluates) or halts; a further change while
  parked appends evidence to the same item (each transition asserted; PRD
  §7.2).
- The resulting interaction event carries
  `excluded_from_automation_metric: true`, and the Epic 029 aggregation
  reports it outside the headline (PRD §2 — composed with Epic 017 Story 003
  and asserted at the reporting seam; debate finding).
- An unchanged artifact re-publish (same hash) passes silently.
- The handler-registry lookup (`format → handler | none`) exists with a
  **default-empty registry** — none for every format is the asserted MVP
  config, not a hardcode; registering a handler later is config against this
  interface (PRD §10 extension family seam named, not built; debate finding —
  the seam is real, its content is empty).

## Constraints

- Hashing/snapshot through the Epic 012 store (plan-class vs operational-class
  per the artifact's role — snapshots are operational); diff summary computed
  on demand, not stored.
- No format parsing of any kind (byte level only — MVP stance).

## Verification Gate

- `npm test` green for `src/artifacts/byte-diff-gate.test.ts`.

### Task T1 - Snapshot, hash, gate pass/fail

**Input:** `src/artifacts/byte-diff-gate.ts`, `src/artifacts/byte-diff-gate.test.ts`

**Action - RED:** Write tests: (a) publish snapshots the authored source with
hash; (b) matching hash ⇒ consumer gate passes; (c) changed bytes ⇒ gate fails;
(d) same-hash re-publish ⇒ silent pass.

**Action - GREEN:** Implement snapshot + hash + gate over the Epic 006/012
seams.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Unclassified-change escalation + metric exclusion

**Input:** `src/artifacts/byte-diff-gate.ts`, `src/artifacts/byte-diff-gate.test.ts`

**Action - RED:** Write tests: (a) a changed artifact with no handler escalates
`unclassified-artifact-change` with a capped, scanned byte-diff summary and
parks the consumer durably; (b) accept-new-hash re-opens the gate; halt keeps
it parked-halted; a second change while parked appends to the same item;
(c) the interaction event carries the exclusion flag and the Epic 029
aggregation seam reports it outside the headline; (d) the default-empty handler
registry returns none per its interface.

**Action - GREEN:** Implement the escalation path + parked lifecycle +
exclusion propagation.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
