## TEST-ENGINEER — 027-web-dashboard · live E2E gate expansion

**Cycle.** RED for Epic 027 live Playwright coverage (`clients/web/e2e/features.spec.ts`, `clients/web/e2e/operations.spec.ts`, `clients/web/e2e/plan-flows.spec.ts`).
**Test written.**
- files: `clients/web/e2e/features.spec.ts` (edited) — asserts feature-read Connect requests are authenticated same-origin TLS HTTP 200 responses; on iPhone, the body does not overflow and the budget ledger scrolls within an `overflow-x: auto` ancestor.
- file: `clients/web/e2e/operations.spec.ts` (new) — asserts live Broker, Slots, Budgets, and Ops golden values and the `pass` verify result without invoking a budget override.
- file: `clients/web/e2e/plan-flows.spec.ts` (new) — asserts project-isolated valid sign-off generation, confirmed halt actor, and pending-replan reopened task result.
**UI locators (web variant: the SE-owned locator registry clients/web/src/locators.ts).**
- Existing `locators.features`, `locators.broker`, `locators.slots`, `locators.budgets`, `locators.daemonOps`, `locators.detailPage`, `locators.planFlows`, and `locators.confirmDialog` only; no new locator is required.
**RED proof.**
- command: `npm run e2e:web`
- exit: 1 — failure: `getByTestId('features-list-link-e2e-plan-signoff-desktop')` and the analogous desktop/mobile halt and replan fixture links were not found.
- passing coverage: operations, network inspection, and iPhone overflow checks pass; 25 passed, 1 skipped, 6 failed.
**Open to Software Engineer.**
- No new production seam: these E2E tests import only the existing locator registry and use the existing `ConfirmActionDialog` locators for halt confirmation.

OPEN: human — the maintainer-owned E2E fixture lacks the six documented control features: `e2e-plan-signoff-{desktop,mobile}`, `e2e-plan-halt-{desktop,mobile}`, and `e2e-plan-replan-{desktop,mobile}`. The expected sign-off generation is `2`; halt task IDs are `e2e-plan-halt-{desktop,mobile}/001-control/T1-running`; replan reopened IDs are `e2e-plan-replan-{desktop,mobile}/001-control/T1-reopened`.
ATTEMPT-FAILED: live-e2e-plan-flows — the required isolated control fixture IDs are not seeded.

END: TEST-ENGINEER
