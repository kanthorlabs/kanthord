# Story 001 - Harness on 2B Bricks

Epic: `.agent/plan/epics/030-phase2b-multi-repo-proof.md`

## Goal

The full Phase-1 harness suite runs green with every 2B brick substituted, and
the 2B-specific mechanics have named hermetic scenarios — the regression net
holds across the last brick swaps before the live proof.

## Acceptance Criteria

- The complete Epic 010 suite passes with: the real `tdd@1` workflow (Epic
  024), real git store (012), verb adapters on doubles (014/022), ring-2 fake
  (025), S3 double (021), fff fake (023) — fake clock and fault injection
  retained (phases.md 2B criterion: harness green on real components, fakes for
  clock/failure injection).
- Scenario `2b-multi-repo-handoff`: two repo slots, a publisher task's artifact
  exit gate → consumer entry gate hash-checked → two PRs created on the double,
  DAG-ordered (Epics 016+028+014 composed).
- Scenario `2b-deploy-soak-observed`: the deploy stage with real observer
  wiring passes a healthy soak and halts on a mid-soak failure (Epic 028
  composed through the scheduler).
- Scenario `2b-unclassified-artifact-change`: a changed contract artifact with
  no handler escalates, parks the consumer, and its interaction event carries
  the exclusion flag end-to-end.
- Scenario `2b-induced-silent-idle`: advancing the clock over a zero-task day
  produces the idle-warning ping content on the slack double.
- Zero network + zero credentials in the whole run (Epic 010 guard active over
  all new scenarios).

## Constraints

- Harness arranges fixtures and injects faults only; the reviewer-engineer pass
  confirms no duplicated production logic by inspecting the scenario diffs
  against a named checklist: imports are public seams only; no scheduling,
  lease, reconcile, gate-evaluation, or artifact-hash logic in harness files
  (Epic 019 review check, operationalized — debate finding).
- Composition gaps are fixed in owning modules, never in harness code; any
  seam change such a fix forces is an interface correction under the Epic 019
  protocol (decision record).

## Verification Gate

- `npm test` green including the new scenario files; `npm run typecheck`
  exits 0.

### Task T1 - Full suite on 2B bricks

**Input:** `src/harness/scenarios/2b-golden.test.ts`, `src/harness/**` (fixture
arrangement only)

**Action - RED:** Wire the full-suite run with the 2B brick set and assert the
Phase-1 end-to-end outcomes plus the real-workflow gate pair driving the golden
feature.

**Action - GREEN:** Fix exposed composition gaps in owning modules.

**Action - REFACTOR:** remove duplication in scenario arrangement only; record any forced interface correction per the Epic 019 protocol.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - The four named 2B scenarios

**Input:** `src/harness/scenarios/2b-multi-repo-handoff.test.ts`,
`src/harness/scenarios/2b-deploy-soak-observed.test.ts`,
`src/harness/scenarios/2b-unclassified-artifact-change.test.ts`,
`src/harness/scenarios/2b-induced-silent-idle.test.ts`, `src/harness/**`

**Action - RED:** Write the four named scenarios per the Story ACs.

**Action - GREEN:** Fix exposed composition gaps in owning modules.

**Action - REFACTOR:** remove duplication in scenario arrangement only; record any forced interface correction per the Epic 019 protocol.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
