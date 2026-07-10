# Story 000 - App Shell & Design Foundation

Epic: `.agent/plan/epics/027-web-dashboard.md`

> **STATUS: ACTIVE — HD-D decided 2026-07-03** (design-system amendment in
> `.agent/plan/feedback/027-web-dashboard/toolchain-decision.md`). This
> story dispatches **first** in the epic, after the SU7 bootstrap gate —
> Stories 001–007 mount into the shell it builds. Kept deliberately slim
> (debate finding — a broad foundation story becomes a speculative
> framework): only the shell, the tone vocabulary, the shared state
> components, and the one page template Story 001 immediately exercises.
> The DetailPage and OpsPage templates land with the stories that first use
> them (001 T2, 006 T2).

> **PENDING FOLD-IN (2026-07-10) — check before dispatch:**
> `.agent/plan/feedback/027-web-dashboard/daily-usage-operator-loop.md`
> Inputs 5 (route foundation + auth-redirect preservation) and 6 (Inbox nav
> badge + collapsed-shell indicator; needs the DESIGN §P4 amendment first)
> must be folded into this story's ACs at authoring time — not improvised
> mid-task.

## Goal

The product UI foundation every later story mounts into: the `AppShell` with
the six-area nav, the shared status tone vocabulary, the shared state
components (loading/empty/error), and the `ListPage` template with its state
slots — all proven hermetically. The SU7 bootstrap proves the toolchain
(shadcn init, tokens, one primitive through the pipeline); this story proves
the product foundation (debate finding — the two concerns stay in separate
gates).

## Acceptance Criteria

- The `AppShell` renders the nav with exactly the six areas — Features,
  Inbox, Broker, Slots, Budgets, Ops — plus a header region and a content
  region where a child surface mounts (DESIGN §6).
- The tone vocabulary maps each of the five tones (`neutral`, `info`,
  `success`, `warning`, `danger`) to its badge variant deterministically
  (DESIGN §4 — the visual layer only; domain mappings belong to later
  stories).
- The shared state components render the DESIGN §7 patterns: skeleton
  loading, explicit empty (caller-supplied wording), destructive-variant
  error — each selectable via registry locators.
- The `ListPage` template renders its title/toolbar/content slots and each
  state slot when driven (loading, empty, error), with no page-body
  horizontal scroll (DESIGN §6 overflow rule).
- At the phone-width media state the shell's nav stays reachable via the
  sidebar's mobile (off-canvas) behavior — all six areas selectable — and
  the content region stays usable (DESIGN §6; responsive decision
  2026-07-03).

## Constraints

- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). Composition uses only the bootstrap-vendored
  foundation set; a missing primitive/token is a DESIGN.md §P2 escalation.
- Component tests hermetic (no daemon, no fake-client data needed beyond
  placeholder children); selection only via `clients/web/src/locators.ts` (PROFILE
  UI locator contract).
- No E2E — the SU7 bootstrap hello-world already proves the pipeline/browser
  path; Story 001 carries the first real-surface E2E.

## Verification Gate

- `npm run test:web` green for `clients/web/src/components/**` and
  `clients/web/src/design/**`; `npm run typecheck:web` exits 0.

### Task T1 - Tone vocabulary + shared state components

**Input:** `clients/web/src/design/status.ts`, `clients/web/src/design/status.test.ts`,
`clients/web/src/components/DataStates.tsx`,
`clients/web/src/components/DataStates.test.tsx`, `clients/web/src/locators.ts`

**Action - RED:** Unit tests: each of the five tones maps to its badge
variant (exact values asserted). Component tests: the loading state renders
skeleton blocks, the empty state renders the supplied wording, the error
state renders the destructive alert — all selected via registry locators.

**Action - GREEN:** Implement the tone map and the state components over the
vendored primitives; add the locators the tests name.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - AppShell + nav

**Input:** `clients/web/src/components/AppShell.tsx`,
`clients/web/src/components/AppShell.test.tsx`, `clients/web/src/locators.ts`

**Action - RED:** Component tests: the shell renders the six nav areas (each
with a registry locator), the header region, and a placeholder child in the
content region; with the mobile media state driven (the matchMedia seam),
the nav opens via the mobile sidebar toggle (registry locator) and all six
areas remain selectable.

**Action - GREEN:** Implement `AppShell` over the vendored sidebar
primitives, keeping their built-in mobile behavior (DESIGN §6 — never a
hand-rolled drawer).

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T3 - ListPage template

**Input:** `clients/web/src/components/templates/ListPage.tsx`,
`clients/web/src/components/templates/ListPage.test.tsx`, `clients/web/src/locators.ts`

**Action - RED:** Component tests: title/toolbar/content slots render their
children; driving the loading/empty/error slot props renders the T1 state
components; the wide-content case scrolls inside the template container, not
the page body.

**Action - GREEN:** Implement the `ListPage` template composing `DataStates`.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
