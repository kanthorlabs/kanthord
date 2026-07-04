# Story 003 - Escalation/Approval Inbox & Typed Responses

Epic: `.agent/plan/epics/027-web-dashboard.md`

## Goal

The escalation/approval inbox: items listed with their evidence rendered, and
responses that require a typed-category confirmation (accept/override — the
Epic 017 contract). Carries the 2A approval-flow re-validation E2E.

## Acceptance Criteria

- The inbox lists open escalations/approvals with their attached evidence
  rendered (phases.md 2B D6 — "inbox with evidence attached"; evidence is
  displayed content, never a bare reference the human must fetch elsewhere).
- Responding requires the typed category confirmation per the Epic 017
  contract (accept the suggested type or override it); submitting without a
  category is blocked in the UI **and** a category-less response rejected by
  the API renders its typed error (belt and braces — the server owns the
  contract).
- A resolved item leaves the open list; the response (category, actor)
  is visible on the item's record.
- E2E (2A re-validation — epic gate criterion): against the pre-flight
  daemon, drive the LP1-style loop end-to-end from the dashboard: list →
  open evidence → respond with a required category → the item resolves and
  the daemon state reflects it (phases.md — the 2A approval flow is
  re-validated through this dashboard).

## Constraints

- Pure client of Epic 026 (the inbox methods superset the 2A Epic 017
  surface); component tests hermetic against the fake generated client
  (PROFILE web variant).
- Selection only via `clients/web/src/locators.ts` (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants). The typed-category confirm consumes the
  `ConfirmActionDialog` composite Story 002 introduces.
- E2E consumes the pre-flight env; never boots resources itself (PROFILE).

## Verification Gate

- `npm run test:web` green for `clients/web/src/inbox/**`; `npm run e2e:web` green for
  `clients/web/e2e/inbox-approval-loop.spec.ts`.

### Task T1 - Inbox list + evidence rendering

**Input:** `clients/web/src/inbox/Inbox.tsx`, `clients/web/src/inbox/Inbox.test.tsx`,
`clients/web/src/locators.ts`

**Action - RED:** Component tests: a fixture with open items renders each with
its evidence content; empty inbox renders the explicit empty state.

**Action - GREEN:** Implement the inbox list + evidence rendering.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Typed-category response flow

**Input:** `clients/web/src/inbox/Respond.tsx`, `clients/web/src/inbox/Respond.test.tsx`,
`clients/web/src/locators.ts`

**Action - RED:** Component tests: responding demands a category
(accept/override per Epic 017); submit without one is blocked client-side;
the API's typed rejection fixture renders as a typed error; a successful
response invokes the respond method with the confirmed category and the item
leaves the open list.

**Action - GREEN:** Implement the response flow.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T3 - E2E: 2A approval-flow re-validation

**Input:** `clients/web/e2e/inbox-approval-loop.spec.ts`

**Action - RED:** Playwright spec: on the pre-flight daemon, an escalation
raised by the golden fixture is listed, its evidence opened, a
typed-category response submitted, and the resolution observed in the
daemon-backed view (the phases.md re-validation criterion).

**Action - GREEN:** none — GREEN-only; coverage owned by T1/T2 components
(fixes under their inputs).

**Action - REFACTOR:** none.

**Verify:** `npm run e2e:web` green for `clients/web/e2e/inbox-approval-loop.spec.ts`
(story-gated per PROFILE).
