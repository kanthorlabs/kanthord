## TEST-ENGINEER — 002-per-feature-summary · T1 aggregation and API read

**Cycle.** RED for Task `T1` (`src/metrics/feature-summary.test.ts`).
**Test written.**
- file: `src/metrics/feature-summary.test.ts` (new) — suite: `src/metrics/feature-summary.ts` — methods: `returns the documented per-feature shape without leaking another feature's events or ledger`, `uses a final reconcile once and sums net cost across the feature's tasks`, `returns exact explicit zeros for empty and unknown features`, `performs zero sqlite writes while aggregating a feature summary`
- file: `src/rpc/read-surfaces.test.ts` (edited) — method: `DaemonService descriptor exposes the GetFeatureSummary read method`
- asserts: the on-read response exactly contains the feature id, included headline and all six category keys, exclusion count, and net ledger cost without cross-feature leakage or writes.
**RED proof.**
- command: `npm test -- --test-name-pattern="feature summary|GetFeatureSummary"`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/metrics/feature-summary.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/metrics/feature-summary.test.ts`
- failure: `AssertionError [ERR_ASSERTION]: DaemonService must expose GetFeatureSummary as the getFeatureSummary read method`
**Open to Software Engineer.**
- `getFeatureSummary(featureId, { interactionLog, store })` from `src/metrics/feature-summary.ts`, returning `{ featureId, headline, byConfirmedType: { approval, clarification, correction, rework, takeover, external }, excluded, netCost }`.

OPEN: `GetFeatureSummary` is absent from the maintainer-generated `DaemonService` descriptor; proto and generated files are lane-forbidden, so a maintainer must add and regenerate this RPC before the serve-contract test can become green.

ATTEMPT-FAILED: T1 — the required generated `DaemonService.getFeatureSummary` descriptor method is absent and cannot be added in either engineering lane.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 002-per-feature-summary · T1 live-ledger precedence

**Cycle.** GREEN+REFACTOR for `src/metrics/feature-summary.test.ts`.
**Files changed.**
- `src/metrics/feature-summary.ts` (edited) — live `spend:${taskId}` ledger precedence
**Seam (GREEN).** Each feature task uses one finite live spend value when present; only an absent live row falls back to its legacy reservation/reconcile ledger.
**Refactor.** none.
**Build check.**
- `npm run typecheck`: exit 0 · log: `.agent/tdd/typecheck-029-002-b1.log`
**Assumptions.**
- VERIFIED: `interactionCost` selects `spend:${taskId}` before the unprefixed ledger — `src/daemon/status-server.ts:948-966`.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 002-per-feature-summary · T1 confirm GREEN

**Cycle.** Confirmed GREEN for Task `T1`.
**Handoff proof.** SE claimed `npm run typecheck` exit 0; independent `npm run verify:handoff` → `VERIFY: PASS`.
**Verification result.**
- `NODE_OPTIONS="--test-name-pattern=feature-summary|live summary" npm test` → exit 0; 180 pass, 0 fail.
- `npm test` → exit 0; 1187 pass, 0 fail.
- `npm run verify:handoff` → exit 0; `VERIFY: PASS`.

END: TEST-ENGINEER

## TEST-ENGINEER — build proof failed

**Cycle.** Blocked — software-engineer build verification failed.
**Verification result.** No `END: SOFTWARE-ENGINEER` handoff or claimed `npm run typecheck` artifact appears after the active RED turn.
**Action required.** SE must fix the build, run `npm run typecheck` with log output, verify, and resubmit.

END: TEST-ENGINEER

## SOFTWARE-ENGINEER — 002-per-feature-summary · T1 aggregation and API read

**Cycle.** GREEN+REFACTOR for `src/metrics/feature-summary.test.ts` and `src/daemon/control-plane-server.test.ts`.
**Files changed.**
- `src/metrics/feature-summary.ts` (new) — `getFeatureSummary(featureId, deps)` read-only aggregation seam
- `src/daemon/status-server.ts` (edited) — `DaemonService.getFeatureSummary` Connect handler
**Seam (GREEN).** The summary reads JSONL interactions and scheduler-selected task ledgers, while the handler projects that domain shape directly through the generated lower-camel RPC fields.
**Refactor.** none.
**Build check.**
- `npm run typecheck`: exit 0 · log: `.agent/tdd/typecheck-029-002.log`
**Assumptions.**
- VERIFIED: the generated response uses `featureId`, `headline`, `byConfirmedType`, `excluded`, and `netCost` — `src/generated/kanthord/v1/daemon_pb.d.ts`.

END: SOFTWARE-ENGINEER

## TEST-ENGINEER — 002-per-feature-summary · T1 live serve wiring

**Cycle.** RED for Task `T1` (`src/daemon/control-plane-server.test.ts`).
**Test written.**
- file: `src/daemon/control-plane-server.test.ts` (edited) — method: `getFeatureSummary — handler routes to the live summary with the generated response shape`
- asserts: a loopback Connect call returns the exact lower-camel generated summary projection with its feature id, one approval, all six numeric breakdown keys, zero exclusions, and the seeded $5 net cost.
**RED proof.**
- command: `npm test -- --test-name-pattern="getFeatureSummary — handler routes to the live summary with the generated response shape"`
- exit: 1 — failure: `Error [ConnectError]: [unimplemented] kanthord.v1.DaemonService.GetFeatureSummary is not implemented`
**Open to Software Engineer.**
- The `createStatusServer` `DaemonService.getFeatureSummary` handler reached by `client.getFeatureSummary({ featureId })`.

END: TEST-ENGINEER

## TEST-ENGINEER — 002-per-feature-summary · B1 live-ledger precedence

**Cycle.** RED regression for Task `T1` (`src/metrics/feature-summary.test.ts`).
**Test written.**
- file: `src/metrics/feature-summary.test.ts` (edited) — method: `prefers the live spend ledger over a conflicting legacy JSON ledger`
- asserts: a task with live `spend:${taskId}` cost 5 and legacy JSON cost 99 produces netCost 5 once.
**RED proof.**
- command: `NODE_OPTIONS="--test-name-pattern=live spend ledger" npm test`
- exit: 1 — failure: `AssertionError [ERR_ASSERTION]: the live spend ledger must take precedence over and not add the legacy JSON ledger` / `99 !== 5`
**Open to Software Engineer.**
- `getFeatureSummary(featureId, { interactionLog, store })` netCost response for a feature task with both live and legacy ledger rows.

END: TEST-ENGINEER
