# Story 002 - Per-Feature Summary

Epic: `.agent/plan/epics/029-deadman-ping-and-feature-metrics.md`

## Goal

A per-feature summary — interaction count with by-type breakdown and total cost
— aggregated on demand from the interaction events and the ledger, served over
the control-plane API.

## Acceptance Criteria

- For a fixture feature with 5 interaction events — `approval`×2,
  `correction`×1, `clarification`×1 included, plus 1 flagged excluded — and a
  net ledger cost of $11, the summary returns: **headline 4** (the included
  count — flagged interactions never poison the headline, debate finding), the
  by-confirmed-type breakdown of the included 4, `excluded: 1` reported
  separately (never silently dropped), and cost $11 (the PRD's "4 human
  interactions, $11" shape).
- Cost = the Epic 013 **net cumulative total** per task, summed over the
  feature's tasks — a reservation superseded by its final reconcile counts
  once (debate finding — no additive double-count).
- A feature with no events/ledger returns an explicit empty summary (zeros, not
  an error).
- The summary is computed on read from the event log + ledger — no stored
  aggregate to drift (division of truth; PRD §6.1); acceptable at MVP
  single-user scale, revisited in Phase 3 if reads grow hot (debate finding —
  tradeoff stated).
- The response matches a documented example shape (asserted); serving is an
  Epic 026 read method — dashboard **rendering belongs to Epic 027** and is
  not gated here (debate finding — no straddle).

## Constraints

- Read-only aggregation; jsonl events + ledger are the sources (Epic 017
  seams); no new tables.

## Verification Gate

- `npm test` green for `src/metrics/feature-summary.test.ts`.

### Task T1 - Aggregation + API read

**Input:** `src/metrics/feature-summary.ts`, `src/metrics/feature-summary.test.ts`

**Action - RED:** Write tests: (a) the 5-event fixture returns headline 4 /
included breakdown / excluded 1 / net $11 matching the example shape; (b) a
reservation-then-reconcile task counts once; (c) empty feature ⇒ explicit
zeros; (d) the Epic 026 read method serves it; (e) zero writes during
aggregation.

**Action - GREEN:** Implement the aggregation over event + ledger seams and the
read method.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
