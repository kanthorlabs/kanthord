# Story 005 - Broker & Repo-Slot Views

Epic: `.agent/plan/epics/027-web-dashboard.md`

## Goal

The read-only operational views: broker operations (in-flight / pending /
expiring, reconciliation status), the verb registry with tiers, and repo
slots (registered repos, strategy, held leases, active sessions).

## Acceptance Criteria

- The broker view renders in-flight, pending, and expiring operations with
  reconciliation status from the API fixture (phases.md 2B D6 — broker
  surface), each group distinctly identified.
- The verb registry renders read-only with each verb's tier
  (auto / auto-with-audit / approval); **no edit affordance exists** on the
  registry view (phases.md — yaml under git discipline, read-only by design).
- The repo-slots view renders registered repos with strategy, held leases,
  and active sessions from the fixture (phases.md 2B D6 — repo slots).
- Empty states are explicit for all three views (no blank panels).

## Constraints

- Pure client of Epic 026; component tests hermetic against the fake
  generated client (PROFILE web variant).
- Selection only via `web/src/locators.ts` (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants).
- No E2E in this story — read-only views are covered live by the epic
  gate run (PROFILE — story-gated E2E).

## Verification Gate

- `npm run test:web` green for `web/src/broker/**` and `web/src/slots/**`.

### Task T1 - Broker ops + verb registry views

**Input:** `web/src/broker/BrokerViews.tsx`,
`web/src/broker/BrokerViews.test.tsx`, `web/src/locators.ts`

**Action - RED:** Component tests: the ops fixture renders the three groups +
reconciliation status; the registry fixture renders verbs with tiers and
exposes no editable element; empty fixtures render explicit empty states.

**Action - GREEN:** Implement the broker views.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Repo-slots view

**Input:** `web/src/slots/RepoSlots.tsx`, `web/src/slots/RepoSlots.test.tsx`,
`web/src/locators.ts`

**Action - RED:** Component tests: the slots fixture renders repos with
strategy, held leases, and active sessions; empty fixture renders the
explicit empty state.

**Action - GREEN:** Implement the repo-slots view.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
