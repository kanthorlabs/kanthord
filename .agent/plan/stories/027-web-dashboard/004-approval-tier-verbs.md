# Story 004 - Approval-Tier Verb Buttons

Epic: `.agent/plan/epics/027-web-dashboard.md`

## Goal

Approval-tier verb actions from the dashboard — `github.merge` — including the
expired-item state. Carries the enforcement-observed E2E (ring-1 block +
approval-required parking, driven from the UI).

## Acceptance Criteria

- A parked approval-tier operation (`github.merge`) renders with its context
  and an approve action; approving invokes the Epic 026 approval method and
  the operation leaves the parked state (phases.md 2B D6 — approval-tier verb
  buttons).
- An **expired** parked item renders the expired state distinctly and its
  approve action is disabled — the UI never submits an approval for an
  expired item (Epic 017/026 expiry contract).
- E2E (enforcement observed — epic gate criterion): against the pre-flight
  daemon, (a) a ring-1-blocked action surfaces in the dashboard as a blocked
  escalation, and (b) an approval-required verb parks until approved from the
  dashboard, then proceeds — both driven from the UI, proving the dashboard
  observes server-side enforcement rather than claiming its own (debate
  finding carried from the epic draft).

## Constraints

- Pure client of Epic 026; component tests hermetic against the fake
  generated client (PROFILE web variant). The rings are enforced server-side
  only — no client-side gating logic beyond rendering states.
- Selection only via `clients/web/src/locators.ts` (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants).
- E2E consumes the pre-flight env; never boots resources itself (PROFILE).

## Verification Gate

- `npm run test:web` green for `clients/web/src/approvals/**`; `npm run e2e:web` green
  for `clients/web/e2e/enforcement-observed.spec.ts`.

### Task T1 - Approval buttons + expired state

**Input:** `clients/web/src/approvals/ApprovalActions.tsx`,
`clients/web/src/approvals/ApprovalActions.test.tsx`, `clients/web/src/locators.ts`,
`clients/web/src/components/status/ApprovalStateBadge.tsx`,
`clients/web/src/components/status/ApprovalStateBadge.test.tsx` (the DESIGN §4 domain
badge — parked/expired states — this surface introduces)

**Action - RED:** Component tests: a parked `github.merge` fixture renders
context + enabled approve; approving invokes exactly the approval method; an
expired fixture renders the expired state with approve disabled and no method
call possible.

**Action - GREEN:** Implement the approval-action component with the expired
rendering.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - E2E: enforcement observed from the UI

**Input:** `clients/web/e2e/enforcement-observed.spec.ts`

**Action - RED:** Playwright spec on the pre-flight daemon: induce the golden
fixture's ring-1-blocked action and assert it surfaces as a blocked
escalation in the dashboard; drive an approval-required `github.merge` —
parked until the dashboard approval, proceeding after.

**Action - GREEN:** none — GREEN-only; coverage owned by T1 and Story 003
components (fixes under their inputs).

**Action - REFACTOR:** none.

**Verify:** `npm run e2e:web` green for `clients/web/e2e/enforcement-observed.spec.ts`
(story-gated per PROFILE).
