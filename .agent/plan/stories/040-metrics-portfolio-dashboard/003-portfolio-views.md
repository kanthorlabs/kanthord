# Story 003 - Portfolio Views (web)

Epic: `.agent/plan/epics/040-metrics-portfolio-dashboard.md`

## Goal

The portfolio and the rubber-stamp analysis are readable where every other
control-plane view lives — the dashboard grows the views, no separate tool.

## Acceptance Criteria

- A portfolio view renders the per-feature table (all derivable metrics;
  `unknown` rendered as unknown; manual fields visibly marked as
  annotated-or-absent with their provenance, never rendered as zero) and at
  least one cross-feature trend rendering (debate finding — scope aligned
  with the epic gate: one trend rendering, not one per series) — from
  fixture responses of the Story 001 read shape.
- The guard-metric warning renders prominently on the affected feature row
  when the flag is set in the response, absent otherwise (both asserted).
- A rubber-stamp view renders the candidate list: knob name, class, evidence
  counts and share per candidate; an empty candidate list renders an explicit
  "no candidates yet" state (both asserted).
- The excluded-interaction count is visible but visually separated from
  automation metrics (PRD §2 exclusion honesty).
- Every asserted element selects via locator-registry constants; all data
  arrives through the generated Connect-Web client (fake client in tests).

## Constraints

- Read-only views over the Epic 026 methods — the annotation control (Story
  001's method) is out of this story's scope; no writes from these views.
- Extends the Epic 027 dashboard shell/navigation — no new app or tool
  (phases.md Deliverable 5).
- Component tests on Vitest + fake client; no E2E named here.

## Verification Gate

- `npm run test:web` green for the portfolio view suites;
  `npm run typecheck:web` exits 0.

### Task T1 - Portfolio table + trends + guard

**Input:** `clients/web/src/portfolio/*.tsx`, `clients/web/src/locators.ts` (GREEN adds
missing locator constants), `clients/web/src/portfolio/*.test.tsx`

**Action - RED:** Write component tests: the table with derivable metrics and
marked manual fields; one trend rendering from a series fixture; guard
warning present/absent per fixture; excluded count separated.

**Action - GREEN:** Implement the portfolio components and locator constants.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Rubber-stamp view

**Input:** `clients/web/src/portfolio/rubber-stamp.tsx`, `clients/web/src/locators.ts`
(GREEN adds missing locator constants), `clients/web/src/portfolio/rubber-stamp.test.tsx`

**Action - RED:** Write component tests: the candidate list with knob/class/
evidence per fixture; the explicit empty state.

**Action - GREEN:** Implement the view.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
