# Story 001 - Features List & Drill-Down

Epic: `.agent/plan/epics/027-web-dashboard.md`

## Goal

The features surface: the list of features and the per-feature drill-down
(live task status, DAG progress, in-flight broker ops, STATE/JOURNAL views),
plus the authenticated-client baseline — an unauthenticated session renders no
surface.

## Acceptance Criteria

- The features list renders one row per feature from the API (id, name,
  status, phase), and an explicit empty state when the daemon has none.
- The drill-down for a feature shows: stories/tasks with live status, DAG
  progress, in-flight broker operations, and the STATE/JOURNAL views —
  values matching the API responses field-by-field on the golden fixture
  (phases.md 2B D6 surface list).
- Plan-file content in the drill-down is **visibly read-only**: no edit
  affordance exists anywhere on the surface (phases.md — "out by design").
- An unauthenticated session renders no feature data — the UI shows the
  auth-required state instead of any surface (Epic 026 auth; the server
  rejects, the client renders that rejection, never a cached surface).
- E2E: against the pre-flight daemon seeded with the golden fixture, the list
  and drill-down render live data over the authenticated TLS connection; an
  unauthenticated session reaches no surface (epic gate criterion "auth
  behavior from the client").

## Constraints

- Pure client of the Epic 026 API via the maintainer-generated Connect-Web
  client; component tests run hermetic against a fake of that client
  (PROFILE web variant; SU7 decision b).
- Selection only via the locator registry `clients/web/src/locators.ts`; a missing
  locator is added by the SE in GREEN (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants).
- E2E consumes the pre-flight env (ports via environment) and never boots
  resources itself (PROFILE pre-flight contract).

## Verification Gate

- `npm run test:web` green for `clients/web/src/features/**`; `npm run e2e:web` green
  for `clients/web/e2e/features.spec.ts`.

### Task T1 - Features list + empty state

**Input:** `clients/web/src/features/FeatureList.tsx`,
`clients/web/src/features/FeatureList.test.tsx`, `clients/web/src/locators.ts`,
`clients/web/src/components/status/FeatureStatusBadge.tsx`,
`clients/web/src/components/status/FeatureStatusBadge.test.tsx` (the DESIGN §4 domain
badge this surface introduces)

**Action - RED:** Component test: a fake-client fixture with three features
renders three rows (id, name, status, phase asserted); an empty fixture
renders the explicit empty state; selection via registry locators only.

**Action - GREEN:** Implement the list component over the generated client
seam; add the locators the test names.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Drill-down views

**Input:** `clients/web/src/features/FeatureDetail.tsx`,
`clients/web/src/features/FeatureDetail.test.tsx`, `clients/web/src/locators.ts`,
`clients/web/src/components/status/TaskStatusBadge.tsx`,
`clients/web/src/components/status/TaskStatusBadge.test.tsx`,
`clients/web/src/components/templates/DetailPage.tsx`,
`clients/web/src/components/templates/DetailPage.test.tsx` (the DESIGN §4 badge and
§6 template this surface introduces)

**Action - RED:** Component tests: the drill-down renders task statuses, DAG
progress, in-flight ops, and STATE/JOURNAL views from the fake-client golden
fixture (values asserted field-by-field); the plan view exposes no edit
affordance (no editable element or save control present).

**Action - GREEN:** Implement the drill-down components; read-only rendering
for plan content.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T3 - E2E: live render + auth baseline

**Input:** `clients/web/e2e/features.spec.ts`

**Action - RED:** Playwright spec against the pre-flight daemon: list +
drill-down render golden-fixture data over the authenticated TLS path; an
unauthenticated session renders the auth-required state and no feature data.

**Action - GREEN:** none — GREEN-only coverage is owned by T1/T2 components;
if the spec fails on a missing surface the SE fixes the component under T1/T2
inputs.

**Action - REFACTOR:** none.

**Verify:** `npm run e2e:web` green for `clients/web/e2e/features.spec.ts` (story-gated
per PROFILE).
