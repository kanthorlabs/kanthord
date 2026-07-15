# Story 003 - Escalation/Approval Inbox & Typed Responses

Epic: `.agent/plan/epics/027-web-dashboard.md`

> **FOLDED IN (2026-07-15):**
> `.agent/plan/feedback/027-web-dashboard/honest-classification-and-diff-policy.md`
> (Inputs 1–2) and `.agent/plan/feedback/027-web-dashboard/daily-usage-operator-loop.md`
> Inputs 1–5 are folded into the ACs and Tasks below: low-friction inline
> classification confirm, scannable type-badge inbox with a distinct
> `unclassified-artifact-change` badge + deterministic sort + type filter,
> diff-pane evidence rendering, "Next open item" flow, stable per-item deep
> links with an explicit resolved/expired/missing state. Story 000 supplies
> the route foundation these deep links register on. See `toolchain-decision.md`.

## Goal

The escalation/approval inbox: items listed with their evidence rendered, and
responses that require a typed-category confirmation (accept/override — the
Epic 017 contract). Carries the 2A approval-flow re-validation E2E.

## Acceptance Criteria

- The inbox lists open escalations/approvals with their attached evidence
  rendered (phases.md 2B D6 — "inbox with evidence attached"; evidence is
  displayed content, never a bare reference the human must fetch elsewhere).
- **Scannable inbox (daily-usage Input 2):** each row carries a type/severity
  badge (DESIGN §4 domain vocabulary); the list has a stable deterministic
  default sort and a simple type filter; `unclassified-artifact-change` is
  noisy-by-design (§6.2.4) and renders a visually distinct badge so it never
  buries real escalations. No per-type section grouping in MVP.
- **Diff evidence (daily-usage Input 3):** evidence of diff type renders in
  the diff-pane pattern (the DESIGN §5 diff pane composite Story 002
  introduces) with file boundaries preserved and additions/deletions colored
  via semantic tokens — not a bare `<pre>` dump. Non-diff evidence renders as
  displayed content. Scope guard: no full code-review UI (no comments, no
  per-hunk actions).
- Responding requires the typed category confirmation per the Epic 017
  contract (accept the suggested type or override it); submitting without a
  category is blocked in the UI **and** a category-less response rejected by
  the API renders its typed error (belt and braces — the server owns the
  contract).
- **Low-friction classification confirm (honest-classification Input 1 +
  daily-usage Input 1):** the proposed interaction type renders **inline** on
  the respond control — "Accept suggested: <type>" is the primary action and
  "Override" is a deliberate secondary path (approval / clarification /
  correction / takeover). NO extra modal per response for the type confirm;
  the existing DESIGN §7 destructive-confirm rule for destructive verbs is
  untouched.
- **"Next open item" after a response (daily-usage Input 4):** on response
  success the UI shows a success state with "Next open item" as the primary
  action and "Back to inbox" as secondary; it NEVER auto-navigates. "Next" is
  deterministic — the next open item under the current sort/filter.
- A resolved item leaves the open list; the response (category, actor)
  is visible on the item's record.
- **Stable per-item deep link (daily-usage Input 5):** each inbox item has a
  stable URL (registered on the Story 000 route foundation); opening an item's
  deep link lands on that item. A resolved/expired/missing item at a deep link
  renders an explicit state — never a silent dump back to the list.
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
  component-dir grants). The diff-type evidence consumes the diff-pane
  composite Story 002 introduces (DESIGN §5); the inline classification
  confirm is not a destructive-confirm dialog (honest-classification Input 1
  — ceremony on every item trains rubber-stamping).
- **Diff-escalation policy from config (honest-classification Input 2):** the
  UI must not hardcode any assumption about which diffs escalate; it renders
  the escalation items the API returns. `escalate_all_diffs` stays fixed for
  MVP and is server-owned — no policy framework in the UI. (If the API needs a
  new field to convey policy, that routes as an Epic 026 API need, not a UI
  literal.)
- E2E consumes the pre-flight env; never boots resources itself (PROFILE).

## Verification Gate

- `npm run test:web` green for `clients/web/src/inbox/**`; `npm run e2e:web` green for
  `clients/web/e2e/inbox-approval-loop.spec.ts`.

### Task T1 - Inbox list + evidence rendering (scannable + diff pane + deep link)

**Input:** `clients/web/src/inbox/Inbox.tsx`, `clients/web/src/inbox/Inbox.test.tsx`,
`clients/web/src/inbox/InboxItemView.tsx`, `clients/web/src/inbox/InboxItemView.test.tsx`,
`clients/web/src/locators.ts`

**Action - RED:** Component tests: a fixture with open items renders each with
its evidence content; empty inbox renders the explicit empty state.
**Scannable (Input 2):** each row renders a type/severity badge; an
`unclassified-artifact-change` item renders the visually distinct badge; the
list applies the deterministic default sort; the type filter narrows the list.
**Diff evidence (Input 3):** a diff-type evidence fixture renders in the
diff-pane composite (file boundaries preserved, add/del via semantic tokens);
non-diff evidence renders as displayed content. **Deep link (Input 5):**
rendering `InboxItemView` at an item's route shows that item; a
resolved/expired/missing item id renders the explicit state (not a redirect to
the list).

**Action - GREEN:** Implement the inbox list (badges, sort, filter), the
item view with diff-pane evidence, and the deep-link item route + explicit
missing/resolved state. Register the item route on the Story 000 foundation.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Response flow (inline classification confirm + Next-open-item)

**Input:** `clients/web/src/inbox/Respond.tsx`, `clients/web/src/inbox/Respond.test.tsx`,
`clients/web/src/locators.ts`

**Action - RED:** Component tests: responding demands a category
(accept/override per Epic 017); submit without one is blocked client-side;
the API's typed rejection fixture renders as a typed error; a successful
response invokes the respond method with the confirmed category and the item
leaves the open list. **Inline confirm (Input 1):** the proposed type renders
inline with "Accept suggested: <type>" as the primary action and "Override" as
the secondary path — no extra modal for the type confirm. **Next-open-item
(Input 4):** on success the UI shows a success state with "Next open item"
(primary) and "Back to inbox" (secondary); it does not auto-navigate; "Next"
resolves to the next open item under the current sort/filter.

**Action - GREEN:** Implement the response flow with the inline classification
confirm and the post-success next-item state.

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
