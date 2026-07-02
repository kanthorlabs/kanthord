# Story 003 - Interaction Capture

Epic: `.agent/plan/epics/017-approval-surface-and-metrics.md`

## Goal

Every human response becomes a typed interaction metric event: the system
proposes a type from observable signals, the human's confirmed category is
recorded, and the event carries cost attribution — the raw material of the PRD §2
portfolio.

## Acceptance Criteria

- Each inbox response emits one interaction event (jsonl, append-only) with:
  item id, task/feature id, **proposed type**, **confirmed type** (required on
  every response — an explicit accept-of-proposal or an override; the
  accept-vs-override distinction is recorded; debate finding + PRD §2: the human
  confirms during the approval they are already doing), actor, timestamp, and
  cost-to-date (PRD §2; §8 — attribution).
- Cost-to-date is defined (debate finding): the task's cumulative Epic 013
  ledger total (reservations + final reconciles) at the response timestamp; a
  task with no ledger yields 0 with a `no-ledger` flag.
- The proposal comes from a deterministic signal map (PRD §2: which gate fired,
  whether files in scope were edited, whether plan/prompt changed): an approval
  of a tier verb proposes `approval`; a budget-breach escalation proposes
  `correction`; the map is data, asserted per entry.
- The confirmed type is the human's — a response without a category (accept or
  override) is a typed error at the RPC boundary; classification stays marked
  approximate, never authoritative (PRD §2).
- Events for items tagged `unclassified-artifact-change` carry
  `excluded_from_automation_metric: true` (PRD §2/§7.2 — byte-diff noise must
  not poison the metric).
- Events are queryable per feature (the Epic 029 summary and Phase-3 portfolio
  read this seam).

## Constraints

- Type vocabulary is the PRD §2 table as exact schema values: `approval`,
  `clarification`, `correction`, `rework`, `takeover`, `external` (the PRD's
  "external/blocker" row is ONE value, `external`, documented as "aka blocker" —
  debate finding: a schema cannot carry a slash) — a value outside it is a typed
  error.
- jsonl via the Epic 001 log seam; no aggregate computation here (capture only —
  Epic 017 Non-Goals).

## Verification Gate

- `npm test` green for `src/metrics/interaction-capture.test.ts`.

### Task T1 - Event emission + signal-map proposal

**Input:** `src/metrics/interaction-capture.ts`, `src/metrics/interaction-capture.test.ts`

**Action - RED:** Write tests: (a) an approval response emits an event with
proposed `approval`, the confirmed category with accept-vs-override recorded,
actor, and ledger cost-to-date; (b) a budget-breach escalation response proposes
`correction`; (c) a response without a category ⇒ typed error; (d) an
out-of-vocabulary type ⇒ typed error; (e) a task with no ledger ⇒ cost 0 +
`no-ledger` flag.

**Action - GREEN:** Implement the capture hooked to the respond path with the
data-driven signal map.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Exclusion tag + per-feature query

**Input:** `src/metrics/interaction-capture.ts`, `src/metrics/interaction-capture.test.ts`

**Action - RED:** Write tests: (a) an `unclassified-artifact-change` item's event
carries the exclusion flag; (b) events filter by feature id across two features.

**Action - GREEN:** Implement the flag propagation and the per-feature read
seam.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
