# Story 007 - Per-Feature Summary View

Epic: `.agent/plan/epics/027-web-dashboard.md`

## Goal

The per-feature metrics summary surface: the "4 human interactions, $11"
headline with the by-type breakdown, the separately-reported excluded count,
and cost — rendering the Epic 029 Story 002 read method (review B4: phases.md
2B D9 puts this in the web client and Epic 030 LP3 gates it
dashboard-exclusively, so this surface is gate-critical, not optional).

## Acceptance Criteria

- For the Epic 029 fixture shape (headline 4, by-confirmed-type breakdown of
  the included 4, `excluded: 1`, cost $11), the view renders the headline in
  the PRD's "4 human interactions, $11" form, the breakdown, and the excluded
  count **separately from the headline** (never summed in — the Epic 029
  contract).
- A feature with no events renders the **explicit empty summary** (zeros),
  matching Epic 029's empty response — this is the only "degraded render":
  it covers absent **data**; an unavailable or failing summary **method**
  renders a distinct error state and is a defect (review B4 — the earlier
  "optional render" note is superseded).
- The view is reachable from the feature drill-down (Story 001), so Epic 030
  LP3's reconciliation check can be driven entirely from the dashboard.

## Constraints

- Pure client of the Epic 026 read method that serves the Epic 029 Story 002
  summary; component tests hermetic against the fake generated client
  (PROFILE web variant). Rendering only — aggregation is server-owned
  (Epic 029 — "dashboard rendering belongs to Epic 027").
- The concrete method binding and response type come from the **Epic 020 SU6
  descriptor** (via the maintainer-generated Connect-Web client), and the
  test fixture is the **documented example shape Epic 029's tests assert
  against** — not an invented shape (debate finding — the 027/029 handoff
  must be pinned to the two contracts that already exist, or the earlier
  contradiction just moves).
- Selection only via `clients/web/src/locators.ts` (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants).
- E2E is thin and story-gated (debate finding — this surface is Epic 030
  LP3-critical; it must not first meet the live daemon at the epic gate run).

## Verification Gate

- `npm run test:web` green for `clients/web/src/metrics/**`; `npm run e2e:web` green
  for `clients/web/e2e/feature-summary.spec.ts`.

### Task T1 - Summary rendering

**Input:** `clients/web/src/metrics/FeatureSummary.tsx`,
`clients/web/src/metrics/FeatureSummary.test.tsx`, `clients/web/src/locators.ts`

**Action - RED:** Component tests: the documented Epic 029 example-shape
fixture renders headline "4 human interactions, $11", the included-type
breakdown, and `excluded: 1` outside the headline; the empty-summary fixture
renders explicit zeros; a failing-method fake renders the error state (not
the empty state); the view mounts from the Story 001 drill-down route.

**Action - GREEN:** Implement the summary view over the generated client
seam.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - E2E: live summary from the drill-down

**Input:** `clients/web/e2e/feature-summary.spec.ts`

**Action - RED:** Playwright spec on the pre-flight daemon: navigate from the
golden fixture feature's drill-down to its summary and assert the headline,
breakdown, and separately-reported excluded count match the daemon-served
values (the path Epic 030 LP3 will drive).

**Action - GREEN:** none — GREEN-only; coverage owned by T1 (fixes under its
inputs).

**Action - REFACTOR:** none.

**Verify:** `npm run e2e:web` green for `clients/web/e2e/feature-summary.spec.ts`
(story-gated per PROFILE).
