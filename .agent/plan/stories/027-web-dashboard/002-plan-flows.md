# Story 002 - Plan Flows: Sign-Off, Halt, Re-Planning Diff Approval

Epic: `.agent/plan/epics/027-web-dashboard.md`

## Goal

The three plan control flows driven from the dashboard — sign-off, halt, and
re-planning diff approval — each with its error/conflict states rendered.

## Acceptance Criteria

- Sign-off on a valid plan shows the compile result and stamped generation;
  sign-off on an invalid plan renders the Epic 002 planner-vocabulary
  diagnostics **verbatim** (the Epic 026 contract — the UI adds no rewording).
- Halt on a running feature/task shows the parked result with the acting
  user; a second halt renders the typed conflict from the API (Epic 026 gate
  — never a generic error toast).
- Re-planning diff approval renders the authored-file diff and its declared
  base generation; approve applies and shows the re-opened gates; a
  base-generation mismatch renders the typed conflict without applying
  (PRD §7.5; Epic 026 `plan.approveReplan` hardening).
- Every flow invokes only the authenticated Epic 026 control verbs — no other
  call path exists in the components (asserted on the fake client: exactly
  the expected method invoked).

## Constraints

- Pure client of Epic 026 via the generated Connect-Web client; component
  tests hermetic against a fake of it (PROFILE web variant).
- Selection only via `web/src/locators.ts` (PROFILE UI locator contract).
- UI composition, tokens, state rendering, and locator placement follow the
  repo-root `DESIGN.md` (design implementation contract; design-system
  amendment 2026-07-03). A missing primitive/token is a DESIGN.md §P2
  escalation — never a hand-rolled clone; a shared composite not named in a
  Task Input needs an authoring update first (debate finding — no blanket
  component-dir grants).
- No E2E in this story — the epic gate run's full `npm run e2e:web` covers
  the live path (PROFILE — `web e2e` is story-gated and gate-run).

## Verification Gate

- `npm run test:web` green for `web/src/plan-flows/**`.

### Task T1 - Sign-off flow

**Input:** `web/src/plan-flows/SignOff.tsx`,
`web/src/plan-flows/SignOff.test.tsx`, `web/src/locators.ts`

**Action - RED:** Component tests: valid-plan fixture ⇒ compile result +
generation rendered; invalid-plan fixture ⇒ each diagnostic string rendered
verbatim; the fake client saw exactly the sign-off method.

**Action - GREEN:** Implement the sign-off flow component.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T2 - Halt flow

**Input:** `web/src/plan-flows/Halt.tsx`, `web/src/plan-flows/Halt.test.tsx`,
`web/src/locators.ts`, `web/src/components/ConfirmActionDialog.tsx`,
`web/src/components/ConfirmActionDialog.test.tsx` (the DESIGN §7
destructive-confirm composite this flow introduces; later stories consume it
without re-declaring it)

**Action - RED:** Component tests: halt on a running fixture task ⇒ parked
state + actor rendered; the typed second-halt conflict fixture ⇒ the conflict
rendered as such (type surfaced, not a generic failure).

**Action - GREEN:** Implement the halt flow component.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.

### Task T3 - Re-planning diff approval

**Input:** `web/src/plan-flows/ReplanApproval.tsx`,
`web/src/plan-flows/ReplanApproval.test.tsx`, `web/src/locators.ts`

**Action - RED:** Component tests: the diff + base generation render from the
fixture; approve invokes the approval method and renders the re-opened gates;
a generation-mismatch conflict fixture renders the typed conflict and no
apply happened (fake client asserts no second call).

**Action - GREEN:** Implement the re-planning approval component.

**Action - REFACTOR:** none.

**Verify:** `npm run test:web` green; `npm run typecheck:web` exits 0.
