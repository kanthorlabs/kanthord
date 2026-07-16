## SOFTWARE-ENGINEER — 033-replanning-flow-depth · durable proposal approval

**Cycle.** GREEN+REFACTOR for `src/replan/proposal.test.ts`, `src/daemon/control-plane-server.test.ts`, and web replan controls.
**Files changed.**
- `src/replan/proposal.ts` (new) — durable immutable proposal read/write APIs
- `src/store/schema.ts` (edited) — proposal schema bootstrap
- `src/daemon/status-server.ts` (edited) — pending-proposal read and stored approval path
- `clients/web/src/plan-flows/ReplanApproval.tsx` (edited) — proposal-backed approval request
- `clients/web/src/features/FeatureDetailContainer.tsx` (edited) — concurrent feature/proposal read
- `clients/web/src/features/FeatureDetail.tsx` (edited) — Controls tab
**Seam (GREEN).** Proposal approval reconstructs its diff from the pending durable row and marks that row approved only after `approveReplan()` resolves.
**Refactor.** none.
**Build check.**
- `npm run typecheck`: exit 2 · log: `.agent/tdd/typecheck-replan.log` · existing RED `read-surfaces.test.ts` imports absent `getPublicConfiguration`.
- `npm run typecheck:web`: exit 2 · log: `.agent/tdd/typecheck-web-replan.log` · existing RED freshness/configuration tests require missing production surfaces and locator entries.
- `npm run build:web`: exit 2 · log: `.agent/tdd/build-web-replan.log` · stopped by the same RED freshness/configuration TypeScript errors before Vite.
**Assumptions.**
- VERIFIED: generated Connect requests expose `proposalId` and generated proposal timestamps/generations are `bigint` — `src/generated/kanthord/v1/daemon_pb.d.ts`.

OPEN: Pre-existing RED core configuration and web freshness/configuration tests prevent the required typecheck/build artifacts from passing; their tests and production implementations were not changed.

END: SOFTWARE-ENGINEER
## SOFTWARE-ENGINEER — 027-web-dashboard · E2E fixture blockers

**Cycle.** GREEN+REFACTOR for `clients/web/e2e/features.spec.ts`.
**Files changed.**
- `scripts/web-e2e-preflight.mjs` (edited) — seeds the pending replan proposal and injects the safe public configuration fixture.
**Seam (GREEN).** The real pre-flight daemon now exposes a durable `feat-001` proposal at generation 1 and the declared public configuration.
**Refactor.** none.
**Build check.**
- `npm run build:web`: exit 0 · log: `.agent/tdd/build-web-e2e-fixture.log`
**Assumptions.**
- VERIFIED: proposal generation and rendered diff requirements — `clients/web/e2e/features.spec.ts`.
- VERIFIED: public declaration field values — `clients/web/src/daemon-ops/Configuration.test.tsx`.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — final blockers · RED regressions

**Cycle.** RED for direct final-blocker regressions (`src/rpc/control-verbs.test.ts`, `src/daemon/control-plane-server.test.ts`, and focused web plan/freshness tests).
**Test written.**
- files: `src/rpc/control-verbs.test.ts`, `src/daemon/control-plane-server.test.ts` (edited) — suites: `src/rpc/control-verbs.ts`, durable pending replan proposals — asserts ordered edited task IDs are returned and forwarded over Connect.
- files: `clients/web/src/plan-flows/SignOff.test.tsx`, `clients/web/src/plan-flows/Halt.test.tsx`, `clients/web/src/plan-flows/ReplanApproval.test.tsx`, `clients/web/src/components/PageFreshness.test.tsx` (edited) — asserts success callbacks fire once only on successful mutations, generic Connect/non-Connect replan failures render an inline destructive alert, and refresh shows then clears a spinner.
**UI locators (web variant: the SE-owned locator registry clients/web/src/locators.ts).**
- `locators.planFlows.replan.error` = `"plan-flows-replan-error"` — inline destructive approval failure alert.
- `locators.pageFreshness.spinner` = `"page-freshness-spinner"` — refresh-pending spinner.
**RED proof.**
- command: `npm test`
- exit: 1 — failure: `+ actual - expected` / `+ []` / `- [ 'pending-replan-task' ]`; and `+ undefined` / `- [ 'task-rp-a', 'task-rp-b' ]`.
- command: `npm run test:web -- "src/plan-flows/SignOff.test.tsx" "src/plan-flows/Halt.test.tsx" "src/plan-flows/ReplanApproval.test.tsx" "src/components/PageFreshness.test.tsx"`
- exit: 1 — failure: `expected "vi.fn()" to be called 1 times, but got 0 times`; `It looks like undefined was passed instead of a matcher`; generic approval failures also reject unhandled.
**Open to Software Engineer.**
- `approveReplan(diff, actor, deps)` result: `{ generation: number; reopenedTaskIds: string[] }`; the status-server Connect `approveReplan` response exposes the same ordered IDs.
- `SignOff`, `Halt`, and `ReplanApproval` props: optional `onSuccess?: () => void | Promise<void>` with the success-only contract above.
- `locators.planFlows.replan.error`, `locators.pageFreshness.spinner`; `ReplanApproval` generic-failure state and `PageFreshness` pending state.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 033-replanning-flow-depth · final blockers

**Cycle.** GREEN+REFACTOR for `src/rpc/control-verbs.test.ts`, `src/daemon/control-plane-server.test.ts`, and focused web plan/freshness tests.
**Files changed.**
- `src/rpc/control-verbs.ts` (edited) — `approveReplan()` returns ordered reopened task IDs for compiled, edited task files.
- `src/daemon/status-server.ts` (edited) — forwards reopened IDs for legacy and proposal-backed approvals.
- `clients/web/src/plan-flows/SignOff.tsx` (edited) — success-only refresh callback.
- `clients/web/src/plan-flows/Halt.tsx` (edited) — success-only refresh callback.
- `clients/web/src/plan-flows/ReplanApproval.tsx` (edited) — success callback and destructive generic-error alert.
- `clients/web/src/components/PageFreshness.tsx` (edited) — pending inline spinner.
- `clients/web/src/features/FeatureDetail.tsx` (edited) — passes the page refresh callback to all control mutations.
- `clients/web/src/locators.ts` (edited) — supplied the replan-error and freshness-spinner identifiers.
**Seam (GREEN).** Replan approval collects compiled task IDs in edit order as it resets their scheduler exit gates, and the page refetches only after a successful control mutation.
**Refactor.** none.
**Identifiers assigned.**
- `locators.planFlows.replan.error` = `"plan-flows-replan-error"` → destructive replan approval Alert in `clients/web/src/plan-flows/ReplanApproval.tsx`
- `locators.pageFreshness.spinner` = `"page-freshness-spinner"` → pending Loader2 in `clients/web/src/components/PageFreshness.tsx`
**Build check.**
- `npm run typecheck`: exit 0 · log: `.agent/tdd/typecheck-direct-final-blockers.log`
- `npm run typecheck:web`: exit 0 · log: `.agent/tdd/typecheck-web-direct-final-blockers.log`
- `npm run build:web`: exit 0 · log: `.agent/tdd/build-web-direct-final-blockers.log`
- `npm run verify:handoff`: VERIFY: PASS · log: `.agent/tdd/verify-handoff-direct-final-blockers.log`
- `npm run verify:handoff:web`: exit 0 · log: `.agent/tdd/verify-handoff-web-direct-final-blockers.log`
**Assumptions.**
- VERIFIED: identifier strings and focused assertions — `.agent/tdd/history/2026-07-15-033-replanning-flow-depth.md` TEST-ENGINEER turn.
- VERIFIED: `Loader2` is the established Lucide pending indicator — `clients/web/src/inbox/Respond.tsx`.

END: SOFTWARE-ENGINEER
