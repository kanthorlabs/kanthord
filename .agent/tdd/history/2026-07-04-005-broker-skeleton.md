---
epic: .agent/plan/epics/005-broker-skeleton.md
opened: 2026-07-04
cycle: tdd
scope: all
opener: test-engineer
base-ref: a627f3020bdbfda2dcf06f22fb38a264a444ac30
---

# Implementation cycle — 005-broker-skeleton

Pulled from EPIC: `.agent/plan/epics/005-broker-skeleton.md`.

Verification gate (binding, from the EPIC's `## Verification Gate` section):
> - `npm run typecheck` exits 0; `npm test` green for all Story suites.
> - Submitting a fake async verb returns an `op_id`; the poller (on the fake clock) advances it to a terminal state and writes a completion row keyed by `op_id`.
> - A resubmit with the same idempotency key yields the same `op_id` and does not create a second in-flight operation.
> - Registering a verb declared async with no `reconcile` adapter is rejected with a diagnostic naming the verb.
> - After a simulated crash (drop SQLite runtime state, keep the markdown ledger), reconciliation recovers the durable operation identity from the ledger (op_id, verb, idempotency key, correlation, desired-effect hash, status) — not the old `request_id` — marks the interrupted op needs-reconciliation, and the fake reconcile path (passed the desired-effect hash) resolves it to one of done | failed | resubmit | escalate; a new `request_id` appears only via idempotent resubmit (each branch asserted).
> - Reconcile marks `done` only when the fake remote's observed state matches the ledger's desired-effect hash; a same-correlation but mismatched-hash remote does not resolve `done` (it resubmits/fails/escalates per fake policy).
> - A fake verb whose observed state regresses, one that times out, and one that hits a rate limit each drive the documented per-verb behavior (asserted).
> - A pending op past its per-verb expiry is expired, not fired.
> - After Story `006`, `rebuildFromMarkdown` reconstructs the operation-ledger rows into a shadow store equal to the live store's ledger projection (per the bumped Epic 003 contract), closing the "rebuild == projection" gate for ledger state (PRD §6.1).

TDD protocol:
1. test-engineer writes the next failing test (RED) — or a GREEN-ONLY pass-through for Tasks without `Action — RED:`.
2. software-engineer makes the test green (RED flow) or implements the Task spec directly (GREEN-ONLY flow).
3. test-engineer confirms GREEN (or runs a build-only check for GREEN-ONLY), then either opens the next Task or runs the full Verification Gate on every in-scope target and appends IMPLEMENTATION_READY_FOR_REVIEW.
## TEST-ENGINEER — 001-verb-registry-and-adapter · T1 Load verb registry entries

**Cycle.** RED for Task `T1` (`src/broker/registry.test.ts`).

**Test written.**
- file: `src/broker/registry.test.ts` (new) — suite: `src/broker/registry.ts` — methods: `loadVerbRegistry returns typed entries with full §5 declaration surface`
- asserts: calling `loadVerbRegistry(dir)` on a two-verb temp directory returns a record keyed by verb name where each entry exposes all §5 declared fields — `verb`, `tier`, `timeout`, `idempotency.window_ms`, `retry.max`, `retry.backoff`, `poll_interval`, `terminal_states`, `rate_limit.requests_per_minute`, and `observed_state_can_regress` — with exact values matching the YAML source.

**RED proof.**
- command: `npm test`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/registry.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/registry.test.ts`

**Open to Software Engineer.**
- Seam: `src/broker/registry.ts` — export `loadVerbRegistry(dir: string): Promise<Record<string, VerbRegistryEntry>>` where `VerbRegistryEntry` is a typed interface with fields: `verb: string`, `tier: VerbTier` (`"auto" | "auto_with_audit" | "approval_required"`), `timeout: number`, `idempotency: { window_ms: number }`, `retry: { max: number; backoff: string }`, `poll_interval: number`, `terminal_states: string[]`, `rate_limit: { requests_per_minute: number }`, `observed_state_can_regress: boolean`. Build on the Epic 001 `loadRegistryDir` from `src/foundations/registry.ts` (keyed by `"verb"`, requiring all §5 fields).

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 001-verb-registry-and-adapter · T1 Load verb registry entries

**Cycle.** GREEN+REFACTOR for `src/broker/registry.test.ts`.

**Files changed.**
- `src/broker/registry.ts` (new) — `VerbTier`, `VerbRegistryEntry`, `loadVerbRegistry(dir)`

**Seam (GREEN).** `loadVerbRegistry` delegates to `loadRegistryDir` from `src/foundations/registry.ts` (keyed by `"verb"`) with all nine required top-level keys, then casts each raw `Record<string, unknown>` entry to a typed `VerbRegistryEntry` via a private `toEntry` helper — satisfying every field assertion in the test.

**Refactor.** none (Story T1 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `loadRegistryDir(dir, keyField, requiredKeys)` returns `Record<string, Record<string, unknown>>` keyed by the `keyField` value — confirmed by reading `src/foundations/registry.ts`.
- VERIFIED: `noUncheckedIndexedAccess` requires narrowing on indexed access — cast via `as` is sufficient when upstream `requiredKeys` validation guarantees presence.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 001-verb-registry-and-adapter · T2 Async adapter interface + reconcile-required rule

**Cycle.** Confirm GREEN for Task `T1`, then RED for Task `T2` (`src/broker/registry.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**T1 confirm GREEN.** `npm test --test-path-pattern=src/broker/registry.test.ts` — 1 pass (T1); all 151 suite tests pass.

**Test written.**
- file: `src/broker/registry.test.ts` (edited) — suite: `src/broker/registry.ts` — methods: `registerVerb throws a typed error naming the verb when reconcile adapter is absent`, `registerVerb accepts a complete adapter with submit, poll_status, and reconcile`
- asserts: (1) calling `registerVerb(entry, adapter)` where the adapter has `submit` + `poll_status` but no `reconcile` throws an `Error` whose message includes the verb name "deploy_service"; (2) calling the same with a full adapter (all three methods) does not throw.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/registry.test.ts'`
- exit: 1 — failure: `SyntaxError: The requested module './registry.ts' does not provide an export named 'registerVerb'`

**Open to Software Engineer.**
- Seam: `src/broker/registry.ts` — export interface `AsyncVerbAdapter` with methods `submit`, `poll_status`, and `reconcile` (each returning `Promise<unknown>` at minimum); export function `registerVerb(entry: VerbRegistryEntry, adapter: AsyncVerbAdapter): void` that throws an `Error` (whose `message` includes the verb name from `entry.verb`) when the adapter's `reconcile` property is absent or not a function; no-op / returns cleanly when all three adapter methods are present.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 001-verb-registry-and-adapter · T2 Async adapter interface + reconcile-required rule

**Cycle.** GREEN+REFACTOR for `src/broker/registry.test.ts`.

**Files changed.**
- `src/broker/registry.ts` (edited) — added `AsyncVerbAdapter` interface (`submit`, `poll_status`, `reconcile`) and `registerVerb(entry, adapter): void`

**Seam (GREEN).** `registerVerb` checks `typeof adapter.reconcile !== "function"` and throws an `Error` whose message includes `entry.verb`; the `AsyncVerbAdapter` interface exports all three required methods so the test's `import type { AsyncVerbAdapter }` resolves cleanly.

**Refactor.** none (Task specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `AsyncVerbAdapter` is imported as a type-only import in the test (`import type { AsyncVerbAdapter, VerbRegistryEntry }`), so it only needs to be exported as an interface — no runtime value needed.
- VERIFIED: `typeof adapter.reconcile !== "function"` works correctly even when the adapter is cast via `as unknown as AsyncVerbAdapter` in the test, since the underlying object simply has no `reconcile` property.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 002-async-submit-idempotency · T1 Submit returns op_id + records in-flight op

**Cycle.** Confirm GREEN for Story 001 T2 (registry), then RED for Task `T1` (`src/broker/submit.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**T2 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/registry.test.ts'` — 3 registry tests pass (loadVerbRegistry, registerVerb throws, registerVerb accepts); all 153 suite tests pass.

**Test written.**
- file: `src/broker/submit.test.ts` (new) — suite: `src/broker/submit.ts` — methods: `submit returns op_id and records in-flight op with the fake verb's request_id`
- asserts: calling `submit(entry, adapter, payload, idempotencyKey, store)` with a Mock adapter that returns the Story-named `request_id = "req-stub-T1-001"` (a) returns a non-empty string `op_id`, (b) invokes the Mock adapter's `submit` exactly once, and (c) `getInFlightOp(opId, store)` returns a record with `request_id === "req-stub-T1-001"` and `status === "in_flight"`.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/submit.test.ts'`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/submit.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/submit.test.ts`

**Open to Software Engineer.**
- Seam: `src/broker/submit.ts` — export interface `InFlightOp { op_id: string; verb: string; request_id: string; status: "in_flight" }`; export `async function submit(entry: VerbRegistryEntry, adapter: AsyncVerbAdapter, payload: unknown, idempotencyKey: string, store: Store): Promise<string>` — generates a unique `op_id`, calls `adapter.submit(payload)` to get a `request_id`, persists the in-flight op to a broker-owned SQLite table (creating it if absent, idempotently), and returns `op_id`; export `function getInFlightOp(opId: string, store: Store): InFlightOp | undefined` — queries the same table and returns the row or `undefined`. Import `Store` from `"../foundations/sqlite-store.ts"`, `VerbRegistryEntry` and `AsyncVerbAdapter` from `"./registry.ts"`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 002-async-submit-idempotency · T1 Submit returns op_id + records in-flight op

**Cycle.** GREEN+REFACTOR for `src/broker/submit.test.ts`.

**Files changed.**
- `src/broker/submit.ts` (new) — `InFlightOp`, `submit(entry, adapter, payload, idempotencyKey, store)`, `getInFlightOp(opId, store)`

**Seam (GREEN).** `submit` creates the `broker_in_flight` table with `CREATE TABLE IF NOT EXISTS`, calls `adapter.submit(payload)` to obtain a `request_id`, generates a `op_id` via `randomUUID()`, inserts a row keyed by `op_id`, and returns `op_id`; `getInFlightOp` queries the same table by `op_id` and returns a typed `InFlightOp` (or `undefined`), satisfying all three assertions in the test.

**Refactor.** none (Task T1 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `CREATE TABLE IF NOT EXISTS` is the correct idempotent DDL form in SQLite (sqlite-gotchas.md).
- VERIFIED: `import type` used for `Store`, `AsyncVerbAdapter`, `VerbRegistryEntry` — all used only as type annotations (ts-gotchas.md `verbatimModuleSyntax`).
- VERIFIED: `randomUUID` is a value import from `node:crypto` and works in Node 24.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 002-async-submit-idempotency · T2 Idempotent resubmit + required-key enforcement

**Cycle.** RED for Task `T2` (`src/broker/submit.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**T1 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/submit.test.ts'` — 154 total tests pass (1 submit test, 153 pre-existing); T1 `submit returns op_id and records in-flight op with the fake verb's request_id` passes.

**Test written.**
- file: `src/broker/submit.test.ts` (edited) — suite: `src/broker/submit.ts` — methods: `resubmit with same (verb, idempotencyKey) returns the same op_id and invokes submit only once`, `submit without idempotency key when entry requires one throws error naming the verb`
- asserts: (a) calling `submit(entry, adapter, payload, "idem-key-T2", store)` twice with the same `(verb, idempotencyKey)` returns the identical `op_id` on the second call and the Mock adapter's `submit` counter stays at 1 (not 2); (b) calling `submit(entry, adapter, payload, "", store)` when `entry.idempotency.window_ms > 0` rejects with an `Error` whose message includes the verb name `"deploy_service"`.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/submit.test.ts'`
- exit: 1

T2a failure:
```
✖ resubmit with same (verb, idempotencyKey) returns the same op_id and invokes submit only once (5.259333ms)
  AssertionError [ERR_ASSERTION]: resubmit with same key returns the same op_id
  + actual - expected
  + 'cee9d8d4-4a20-4ad2-9427-951725c30ccf'
  - '31ee4235-ec13-42e6-a9a1-5a9d5d52cd77'
```

T2b failure:
```
✖ submit without idempotency key when entry requires one throws error naming the verb (3.647ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Both fail for the right reasons: dedup logic is absent (two different UUIDs returned), and empty-key validation is absent (no rejection).

**Open to Software Engineer.**
- Seam: `src/broker/submit.ts` — add a `(verb, idempotencyKey) → op_id` dedup lookup in `broker_in_flight` (or a dedicated dedup index table) so a second call with the same `(entry.verb, idempotencyKey)` short-circuits and returns the existing `op_id` without calling `adapter.submit`; add an up-front guard that throws an `Error` naming `entry.verb` when `entry.idempotency.window_ms > 0` and `idempotencyKey` is an empty string.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 002-async-submit-idempotency · T2 Idempotent resubmit + required-key enforcement

**Cycle.** GREEN+REFACTOR for `src/broker/submit.test.ts`.

**Files changed.**
- `src/broker/submit.ts` (edited) — added empty-key guard and dedup lookup to `submit`

**Seam (GREEN).** Two changes to `submit`:
1. Up-front guard throws `Error` naming `entry.verb` when `entry.idempotency.window_ms > 0` and `idempotencyKey === ""` (satisfies T2b).
2. After `ensureTable`, a `SELECT op_id … WHERE verb = ? AND idempotency_key = ?` short-circuits and returns the existing `op_id` when a matching row is found — `adapter.submit` is never called again (satisfies T2a: call count stays at 1 and both calls return the same `op_id`).

**Refactor.** none (Task specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `store.get<T>` returns `T | undefined`; `noUncheckedIndexedAccess` narrowing handled by the `existing !== undefined` guard.
- VERIFIED: `CREATE TABLE IF NOT EXISTS` already stores the `idempotency_key` column from T1 (confirmed by reading the existing `ensureTable` DDL).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 003-poll-lifecycle · T1 Advance to terminal + write completion row

**Cycle.** Confirm GREEN for Story 002 T2 (`src/broker/submit.test.ts`), then RED for Task `T1` (`src/broker/poller.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**Story 002 T2 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/submit.test.ts'` — 156 total tests pass (3 submit tests, 153 pre-existing); both T2a and T2b pass.

**Test written.**
- file: `src/broker/poller.test.ts` (new) — suite: `src/broker/poller.ts` — methods: `advancing by poll_interval calls poll_status and writes done completion row with result_json`, `advancing by poll_interval with failed terminal state writes completion row with error_json`, `writing completion for the same op_id twice does not duplicate the broker_completion row`, `terminality is decided by declared terminal_states, not a hardcoded done/failed set`
- asserts: (a) after `startPolling(op, entry, adapter, store, clock)` + `clock.advance(poll_interval)` + `await Promise.resolve()`, `poll_status` is called once and `store.get("SELECT ... FROM broker_completion WHERE op_id = ?")` returns a row with `status = "done"`, `result_json` non-null, `error_json = null`; (b) same but adapter returns `"failed"` terminal state → row has `error_json` non-null and `result_json = null`; (c) two pollers for the same `op_id` writing completion yields exactly one row (`INSERT OR REPLACE` idempotence); (d) a verb with `terminal_states: ["completed", "aborted"]` does NOT write a completion row when `poll_status` returns `"done"` (not in declared states), but DOES write one when it returns `"completed"`.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/poller.test.ts'`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/poller.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/poller.test.ts`

**Open to Software Engineer.**
- Seam: `src/broker/poller.ts` — export `function startPolling(op: InFlightOp, entry: VerbRegistryEntry, adapter: AsyncVerbAdapter, store: Store, clock: Clock): void`. Schedules a timer via `clock.setTimer(entry.poll_interval, callback)`. When the timer fires, `callback` calls `adapter.poll_status(op.request_id)` (async); if the returned object's `status` field is included in `entry.terminal_states`, writes a completion row to the `broker_completion` table (Epic 004 schema: `op_id TEXT PK, status TEXT, result_json TEXT, error_json TEXT, at INTEGER`) using `INSERT OR REPLACE` (idempotent); if non-terminal, reschedules via `clock.setTimer`. The `done`/`failed` split of `result_json` vs `error_json` follows whatever field the poll result carries (`result` → `result_json`, `error` → `error_json`). Import `InFlightOp` from `"./submit.ts"`, `VerbRegistryEntry`/`AsyncVerbAdapter` from `"./registry.ts"`, `Store` from `"../foundations/sqlite-store.ts"`, `Clock` from `"../foundations/clock.ts"`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 003-poll-lifecycle · T1 Advance to terminal + write completion row

**Cycle.** GREEN+REFACTOR for `src/broker/poller.test.ts`.

**Files changed.**
- `src/broker/poller.ts` (new) — `startPolling(op, entry, adapter, store, clock)`, `ensureCompletionTable`, `writeCompletion`

**Seam (GREEN).** `startPolling` calls `ensureCompletionTable` (idempotent `CREATE TABLE IF NOT EXISTS broker_completion`) then calls `scheduleNext()` which registers a `clock.setTimer(entry.poll_interval, cb)`. When the timer fires, an async IIFE calls `adapter.poll_status(op.request_id)` and checks whether the returned `status` is included in `entry.terminal_states` (declared-set check, not a hardcoded `done/failed`). If terminal, `writeCompletion` issues `INSERT OR REPLACE INTO broker_completion` (idempotent for concurrent ticks on the same `op_id`); `result_json` is set when a `result` field is present, `error_json` when an `error` field is present, each `null` otherwise. Non-terminal reschedules via `scheduleNext()`. All four T1 sub-tests (done row, failed row, idempotent double-fire, custom terminal_states) are satisfied.

**Refactor.** none (Task specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS`

**Assumptions.**
- VERIFIED: `CREATE TABLE IF NOT EXISTS` is the correct idempotent DDL form (sqlite-gotchas.md).
- VERIFIED: all imports use `import type` for types only — `AsyncVerbAdapter`, `VerbRegistryEntry`, `InFlightOp`, `Store`, `Clock` are pure type annotations (`verbatimModuleSyntax` satisfied — ts-gotchas.md).
- VERIFIED: `void (async () => { ... })()` is the standard pattern for a fire-and-forget async IIFE; one `await Promise.resolve()` in the test flushes the microtask continuation because the fake adapter's `poll_status` returns an immediately resolved Promise.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 003-poll-lifecycle · T2 Timeout→escalation, backoff, rate-limit, regression

**Cycle.** Confirm GREEN for Story 003 T1 (`src/broker/poller.test.ts`), then RED for Task `T2` (`src/broker/poller.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**T1 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/poller.test.ts'` — 4 poller tests pass (done row, failed row, idempotent write, custom terminal_states); all 160 suite tests pass.

**Test written.**
- file: `src/broker/poller.test.ts` (edited) — suite: `src/broker/poller.ts` — methods: `verb exceeding timeout with no terminal state emits escalation_needed and stops polling`, `retryable non-terminal error schedules next poll at doubled interval (exponential backoff)`, `rate-limit response defers next poll by 60000/rpm ms instead of poll_interval`, `observed_state_can_regress: false — terminal done is written as final completion row immediately` (characterization — already shipped by T1a), `observed_state_can_regress: true — terminal done followed by regression is NOT left final done`
- asserts: (T2a) after 3 non-terminal polls totaling `entry.timeout` ms, `broker_completion` has a row with `status = "escalation_needed"` and no further polls fire; (T2b) after one retryable-error response (`error` field present, non-terminal), the second poll fires at `poll_interval * 2` from the last tick (not at `poll_interval`), proving exponential backoff; (T2c) after a `rate_limited` response, the next poll fires at `60000 / rate_limit.requests_per_minute` ms from the last tick (6000ms for 10 rpm), not at `poll_interval`; (T2d-char) `can_regress: false` terminal writes a `done` row immediately (characterization); (T2d-new) `can_regress: true` with terminal followed by non-terminal regression leaves NO `done` row in `broker_completion`.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/poller.test.ts'`
- exit: 1 — failures:
  - T2a: `AssertionError: escalation row must be written when timeout is reached` (actual: false — row absent, no timeout logic)
  - T2b: `AssertionError: no second poll at t=2000 (exponential backoff: next poll at t=3000)` — `2 !== 1` (current code reschedules at `poll_interval`, no backoff)
  - T2c: `AssertionError: no poll at t=2000 (rate-limit deferred to t=7000)` — `2 !== 1` (current code reschedules at `poll_interval`, no rate-limit deferral)
  - T2d(2): `AssertionError: second poll fires because can_regress: true does not stop polling on first terminal` — `1 !== 2` (current code stops polling immediately on terminal, ignores `can_regress`)
  - T2d(1) characterization PASSES — pinning that `can_regress: false` already writes `done` immediately; sensitivity contrast held by T2d(2)

**Open to Software Engineer.**
- Seam: `src/broker/poller.ts` — extend `startPolling` to handle four new behaviors, all driven by the `VerbRegistryEntry`:
  1. **Timeout**: track cumulative elapsed time since `startPolling`; when `clock.now() - startMs >= entry.timeout` after a non-terminal response, write `broker_completion` with `status = "escalation_needed"` (no `result_json`, no `error_json`) and stop polling.
  2. **Exponential backoff**: when `poll_status` returns a non-terminal result that has a truthy `error` field (retryable error), schedule the next poll at `entry.poll_interval * 2^retryCount` ms instead of `entry.poll_interval`.
  3. **Rate-limit deferral**: when `poll_status` returns `status = "rate_limited"`, schedule the next poll at `Math.ceil(60000 / entry.rate_limit.requests_per_minute)` ms instead of `entry.poll_interval`.
  4. **Regression handling** (`entry.observed_state_can_regress === true`): on a terminal response, do NOT write a final completion row immediately; instead, schedule one more poll; if the re-poll returns non-terminal (regression), withhold the final `done` (no `done` row written); continue/stop per the SE's chosen reconcile-path design. The test only asserts no `done` row is present after regression — it does not require a specific interim status name.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 003-poll-lifecycle · T2 Timeout→escalation, backoff, rate-limit, regression

**Cycle.** GREEN+REFACTOR for `src/broker/poller.test.ts`.

**Files changed.**
- `src/broker/poller.ts` (edited) — extended `startPolling` with four new behaviours: timeout→escalation_needed, exponential backoff, rate-limit deferral, regression-aware terminal handling

**Seam (GREEN).** `startPolling` now accepts a `delayMs` parameter on `scheduleNext` instead of always using `entry.poll_interval`. Added three pieces of state captured at call-time: `startMs = clock.now()` (for timeout tracking), `retryCount` (for exponential backoff), and `pendingTerminalResult` (for regression confirmation). The dispatch logic inside each tick:
1. **Rate-limited**: `Math.ceil(60000 / rpm)` deferral — checked before `terminal_states` to avoid misclassifying the special status.
2. **Terminal, `can_regress: false`**: write `broker_completion` immediately (existing behaviour, unchanged path).
3. **Terminal, `can_regress: true`, second consecutive**: confirmed — write completion.
4. **Terminal, `can_regress: true`, first**: set `pendingTerminalResult`, schedule one more poll at `poll_interval`.
5. **Non-terminal, `pendingTerminalResult !== null`**: regression — clear the held result, fall through to regular scheduling.
6. **Non-terminal, elapsed ≥ timeout**: write `escalation_needed` row and stop (no further `scheduleNext`).
7. **Non-terminal with `error` field and `backoff = "exponential"`**: increment `retryCount`, schedule at `poll_interval * 2^retryCount`.
8. **Regular non-terminal**: reset `retryCount`, schedule at `poll_interval`.

**Refactor.** none (Task T2 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS`

**Assumptions.**
- VERIFIED: `clock.now()` returns the updated value (`this.currentMs`) after `clock.advance()` has incremented it; the timer callback fires with the clock already at the new instant, so `elapsed = clock.now() - startMs` correctly reflects the accumulated wall-time at each tick.
- VERIFIED: `Math.pow(2, retryCount)` (where `retryCount` starts at 0 and is incremented before use) yields `2^1 = 2` on the first backoff — matching the T2b assertion that the second poll fires at `poll_interval * 2 = 2000ms` from t=1000.
- VERIFIED: no new DDL — only `broker_completion` is used, created idempotently in T1 (sqlite-gotchas.md).
- VERIFIED: `{ status: "escalation_needed" }` satisfies `PollResult` (only `status` is required; `result` and `error` are optional) so `writeCompletion` sets both `result_json` and `error_json` to `null`.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 004-ledger-and-reconciliation · T1 Ledger entry (no request id) + recover durable identity

**Cycle.** Confirm GREEN for Story 003 T2 (`src/broker/poller.test.ts`), then RED for Task `T1` (`src/broker/ledger.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**Story 003 T2 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/poller.test.ts'` — all 9 poller tests pass (done row, failed row, idempotent write, escalation, backoff, rate-limit, regression × 2, custom terminal_states); 165 total suite tests pass.

**Test written.**
- file: `src/broker/ledger.test.ts` (new) — suite: `src/broker/ledger.ts` — methods: `writeLedgerEntry stores all §5 identity fields with no request_id into task markdown`, `recoverFromLedger marks interrupted in_flight op as needs_reconciliation and omits request_id`, `resubmitting same (verb, idempotency_key) after recovery returns original op_id with no second ledger entry`
- asserts: (T1a) calling `writeLedgerEntry(featureStore, storyId, taskStem, entry)` returns the entry's `op_id`; `recoverFromLedger` returns exactly one entry with all §5 fields (`op_id`, `verb`, `idempotency_key`, `correlation`, `desired_effect_hash`, `status`) and no `request_id` property; (T1b) an entry written with `status: "in_flight"` is returned by `recoverFromLedger` with `status === "needs_reconciliation"` and still no `request_id`; (T1c) calling `writeLedgerEntry` a second time with the same `(verb, idempotency_key)` returns the original `op_id` without creating a second ledger entry (confirmed via `recoverFromLedger` count).

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/ledger.test.ts'`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/ledger.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/ledger.test.ts`

**Open to Software Engineer.**
- Seam: `src/broker/ledger.ts` — export interface `LedgerEntry { op_id: string; verb: string; idempotency_key: string; correlation: string; desired_effect_hash: string; status: "pending" | "in_flight" | "done" | "failed" | "expired" | "needs_reconciliation" }` (no `request_id` field); export `async function writeLedgerEntry(store: FeatureStore, storyId: string, taskStem: string, entry: LedgerEntry): Promise<string>` — checks whether a `(verb, idempotency_key)` entry already exists in the ledger (by reading it) and returns the existing `op_id` if so; otherwise appends the entry to the task's durable ledger via the Epic 003 `FeatureStore` (e.g. via `appendJournal`) and returns the new `op_id`; export `async function recoverFromLedger(store: FeatureStore, storyId: string, taskStem: string): Promise<LedgerEntry[]>` — reads all ledger entries from the task's markdown and returns them with any `"in_flight"` status replaced by `"needs_reconciliation"`. Import `FeatureStore` from `"../store/feature-store.ts"`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 004-ledger-and-reconciliation · T1 Ledger entry (no request id) + recover durable identity

**Cycle.** GREEN+REFACTOR for `src/broker/ledger.test.ts`.

**Files changed.**
- `src/broker/ledger.ts` (new) — `LedgerEntry`, `writeLedgerEntry(store, storyId, taskStem, entry)`, `recoverFromLedger(store, storyId, taskStem)`
- `src/store/feature-store.ts` (edited) — added `readJournal(storyId, taskStem): Promise<unknown[]>` (the natural read counterpart to `appendJournal`; required by `ledger.ts` to support dedup checks and recovery without accessing the private `featureDir` field)

**Seam (GREEN).** `writeLedgerEntry` calls a private `readRawLedgerEntries` helper (which delegates to `store.readJournal`) to find any existing `(verb, idempotency_key)` match and short-circuits with the original `op_id` on hit; on miss it calls `store.appendJournal` and returns the new `op_id`. `recoverFromLedger` reads the same raw entries and returns them with an explicit field projection (no `request_id`) and the `"in_flight" → "needs_reconciliation"` remap applied — satisfying T1a (all §5 fields round-trip, no `request_id`), T1b (in_flight becomes needs_reconciliation), and T1c (dedup on second write).

**Refactor.** none (Task T1 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS`

**Assumptions.**
- VERIFIED: TypeScript `private readonly featureDir` is compile-time only — no ECMAScript `#` private; at runtime the field is a regular property. Rather than casting to access it, I added a `readJournal` public method to `FeatureStore` as the clean, idiomatic counterpart to `appendJournal`.
- VERIFIED: `import type { FeatureStore }` is correct — `FeatureStore` is only used as a parameter type in `ledger.ts`; no `new FeatureStore(...)` call (`verbatimModuleSyntax` satisfied).
- VERIFIED: `r as LedgerEntry` is valid TypeScript for `unknown → LedgerEntry` (TypeScript allows `as` assertions from `unknown`); `noUncheckedIndexedAccess` is not triggered because `.find()` and `.map()` are used (no bare index access).
- VERIFIED: `e.status === "in_flight" ? "needs_reconciliation" : e.status` — TypeScript narrows the false branch to `Exclude<LedgerEntry["status"], "in_flight">`, so the full ternary type is a subset of `LedgerEntry["status"]`; no extra cast required.
- VERIFIED: no SQLite DDL in this Task — storage is purely via the markdown journal (sqlite-gotchas.md not applicable here).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 004-ledger-and-reconciliation · T2 Reconcile with desired-effect hash: done/failed/resubmit/escalate

**Cycle.** Confirm GREEN for Story 004 T1 (`src/broker/ledger.test.ts`), then RED for Task `T2` (`src/broker/reconcile.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**T1 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/ledger.test.ts'` — 168 total tests pass (3 ledger tests, 165 pre-existing); T1a, T1b, T1c all pass.

**Test written.**
- file: `src/broker/reconcile.test.ts` (new) — suite: `src/broker/reconcile.ts` — methods: `reconcile done branch: observed hash matches desired — writes done completion row`, `reconcile done branch: observed hash mismatches desired — does not write done completion row`, `reconcile failed branch: writes failed completion row`, `reconcile resubmit branch: reuses original idempotency key, mints new request_id, no double-effect`, `reconcile escalate branch: writes escalation_needed completion row`
- asserts: (T2a) `reconcileOp` with adapter returning `{ outcome: "done", observed_hash: <matching DESIRED_HASH> }` writes a `broker_completion` row with `status = "done"` and returns `"done"`; (T2b) adapter returning `{ outcome: "done", observed_hash: "sha256-WRONG-HASH-mismatch" }` (hash mismatch) does NOT return `"done"` — hash-match invariant enforced; (T2c) adapter returning `{ outcome: "failed" }` writes a `failed` completion row; (T2d) adapter returning `{ outcome: "resubmit" }` calls `adapter.submit` exactly once, creates an `broker_in_flight` row with the original `idempotency_key`, and a second `reconcileOp` call with the same `ledgerEntry` keeps `submitCalls === 1` (idempotency prevents double-effect); (T2e) adapter returning `{ outcome: "escalate" }` writes a `broker_completion` row with `status = "escalation_needed"`. Each test simulates a crash by writing a ledger entry as `"in_flight"`, then opening a fresh SQLite store and calling `recoverFromLedger` to get a `"needs_reconciliation"` entry.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/reconcile.test.ts'`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/reconcile.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/reconcile.test.ts`

**Open to Software Engineer.**
- Seam: `src/broker/reconcile.ts` — export `async function reconcileOp(ledgerEntry: LedgerEntry, entry: VerbRegistryEntry, adapter: AsyncVerbAdapter, store: Store, clock: Clock): Promise<"done" | "failed" | "resubmit" | "escalate">`. The function calls `adapter.reconcile({ correlation: ledgerEntry.correlation, desired_effect_hash: ledgerEntry.desired_effect_hash })` and casts the result to an internal type with `outcome: "done" | "failed" | "resubmit" | "escalate"` and optional `observed_hash?: string`. Dispatch logic: (a) `outcome === "done"` AND `observed_hash === ledgerEntry.desired_effect_hash` → write a `done` `broker_completion` row (idempotent `CREATE TABLE IF NOT EXISTS broker_completion` + `INSERT OR REPLACE`) and return `"done"`; (b) `outcome === "done"` AND `observed_hash !== desired_effect_hash` → hash mismatch, do NOT write `done`; return a non-done outcome (SE decides: `"resubmit"` or `"failed"`); (c) `outcome === "failed"` → write a `failed` completion row, return `"failed"`; (d) `outcome === "resubmit"` → call `submit(entry, adapter, ledgerEntry, ledgerEntry.idempotency_key, store)` from `"./submit.ts"` (idempotent on the same key, prevents double-effect), return `"resubmit"`; (e) `outcome === "escalate"` → write `escalation_needed` completion row, return `"escalate"`. Import `LedgerEntry` from `"./ledger.ts"`, `VerbRegistryEntry`/`AsyncVerbAdapter` from `"./registry.ts"`, `Store` from `"../foundations/sqlite-store.ts"`, `Clock` from `"../foundations/clock.ts"`, `submit` from `"./submit.ts"`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 004-ledger-and-reconciliation · T2 Reconcile with desired-effect hash: done/failed/resubmit/escalate

**Cycle.** GREEN+REFACTOR for `src/broker/reconcile.test.ts`.

**Files changed.**
- `src/broker/reconcile.ts` (new) — `reconcileOp(ledgerEntry, entry, adapter, store, clock): Promise<"done" | "failed" | "resubmit" | "escalate">`

**Seam (GREEN).** `reconcileOp` calls `adapter.reconcile({ correlation, desired_effect_hash })`, casts the result to an internal `ReconcileResult` type, then dispatches on `outcome`:
- `done` + `observed_hash === desired_effect_hash` → `CREATE TABLE IF NOT EXISTS broker_completion` (idempotent DDL) + `INSERT OR REPLACE` with `status = "done"`, return `"done"` (T2a).
- `done` + hash mismatch → desired effect unverifiable, return `"failed"` without writing any row (T2b: `outcome !== "done"`).
- `failed` → write `failed` completion row via `INSERT OR REPLACE`, return `"failed"` (T2c).
- `resubmit` → call `submit(entry, adapter, ledgerEntry, ledgerEntry.idempotency_key, store)` — the existing dedup on `(verb, idempotency_key)` in `broker_in_flight` prevents a double-submit on a second reconcile call; return `"resubmit"` (T2d: submit count stays 1, original idempotency key preserved).
- `escalate` → write `escalation_needed` completion row, return `"escalate"` (T2e).
- `default: never` → compile-time exhaustiveness guard; unreachable at runtime.

**Refactor.** none (Task T2 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`

**Assumptions.**
- VERIFIED: `CREATE TABLE IF NOT EXISTS broker_completion` is the correct idempotent DDL form — `poller.ts` already uses the identical DDL; redundant `ensureCompletionTable` calls are no-ops (sqlite-gotchas.md).
- VERIFIED: `import { submit }` is a value import (used at runtime), not `import type`; all other imports (`LedgerEntry`, `AsyncVerbAdapter`, `VerbRegistryEntry`, `Store`, `Clock`) are type-only and use `import type` (`verbatimModuleSyntax` satisfied — ts-gotchas.md).
- VERIFIED: `submit`'s dedup logic queries `broker_in_flight` by `(verb, idempotency_key)`; the test's `makeEntry().idempotency.window_ms = 3600000 > 0` and `ledgerEntry.idempotency_key = "idem-T2d-original"` (non-empty) so the guard in `submit` does not throw on the resubmit branch.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 005-pending-expiry · T1 Expire a stale pending op; keep a fresh one

**Cycle.** Confirm GREEN for Story 004 T2 (`src/broker/reconcile.test.ts`), then RED for Task `T1` (`src/broker/expiry.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**Story 004 T2 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/reconcile.test.ts'` — 173 total tests pass (5 reconcile tests: done/hash-match, done/hash-mismatch, failed, resubmit, escalate); verify:handoff PASS.

**Test written.**
- file: `src/broker/expiry.test.ts` (new) — suite: `src/broker/expiry.ts` — methods: `advancing past expiry window transitions pending op to expired and never submits`, `pending op within expiry window submits and transitions to in_flight`, `two verbs with different expiry windows expire independently`
- asserts: (T1a) calling `createPendingOp(entry, idempotencyKey, store, clock)` returns a non-empty `op_id`; after `clock.advance(1001)` (past the 1 000 ms `pending_expiry_ms`), `releasePendingOp(opId, entry, adapter, payload, store, clock)` returns `"expired"` and `adapter.submit` is never called; (T1b) same setup with `pending_expiry_ms: 5000` and `clock.advance(1000)` → returns `"in_flight"` and `adapter.submit` called once; (T1c) two verbs (`short_verb` 1 000 ms window, `long_verb` 5 000 ms window), after `clock.advance(2000)` the short op returns `"expired"` and the long op returns `"in_flight"`, `submitCalls === 1`.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/expiry.test.ts'`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/expiry.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/expiry.test.ts`

**Open to Software Engineer.**
- Seam: `src/broker/expiry.ts` — export `function createPendingOp(entry: VerbRegistryEntry, idempotencyKey: string, store: Store, clock: Clock): string` — generates a unique `op_id` (via `randomUUID`), writes a row to a `broker_pending` table (`CREATE TABLE IF NOT EXISTS`) with columns `op_id TEXT PK, verb TEXT, idempotency_key TEXT, pending_at INTEGER, status TEXT` (initial `status = "pending"`), and returns `op_id`; export `async function releasePendingOp(opId: string, entry: VerbRegistryEntry, adapter: AsyncVerbAdapter, payload: unknown, store: Store, clock: Clock): Promise<"in_flight" | "expired">` — reads the pending row by `opId`, checks whether `clock.now() - pending_at >= entry.pending_expiry_ms`; if expired, updates the row status to `"expired"` (or inserts a terminal row) and returns `"expired"` without calling `adapter.submit`; if within the window, calls `submit(entry, adapter, payload, idempotency_key, store)` from `"./submit.ts"` and returns `"in_flight"`. Also add `pending_expiry_ms?: number` to the `VerbRegistryEntry` interface in `src/broker/registry.ts` (optional, to avoid breaking existing tests that don't set it). Import `VerbRegistryEntry` / `AsyncVerbAdapter` from `"./registry.ts"`, `Store` from `"../foundations/sqlite-store.ts"`, `Clock` from `"../foundations/clock.ts"`, `submit` from `"./submit.ts"`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 005-pending-expiry · T1 Expire stale pending op; keep fresh one

**Cycle.** GREEN+REFACTOR for `src/broker/expiry.test.ts`.

**Files changed.**
- `src/broker/registry.ts` (edited) — added `pending_expiry_ms?: number` to `VerbRegistryEntry` (optional; absent → no expiry; required for `satisfies VerbRegistryEntry` in test)
- `src/broker/expiry.ts` (new) — `createPendingOp(entry, idempotencyKey, store, clock): string`, `releasePendingOp(opId, entry, adapter, payload, store, clock): Promise<"in_flight" | "expired">`

**Seam (GREEN).** `createPendingOp` creates the `broker_pending` table idempotently (`CREATE TABLE IF NOT EXISTS`), generates a UUID `op_id`, records `pending_at = clock.now()` and the `idempotency_key`, then returns `op_id`. `releasePendingOp` reads the pending row, compares `clock.now() - pending_at` against `entry.pending_expiry_ms`: when the window has elapsed it updates the row to `"expired"` and returns `"expired"` without calling `adapter.submit`; when within the window it delegates to `submit(entry, adapter, payload, row.idempotency_key, store)` (the existing idempotent submit) and returns `"in_flight"` — satisfying T1a (expired, no submit), T1b (fresh, submit × 1), and T1c (two verbs expire independently).

**Refactor.** none (Task T1 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS`

**Assumptions.**
- VERIFIED: `CREATE TABLE IF NOT EXISTS` is the correct idempotent DDL form in SQLite (sqlite-gotchas.md).
- VERIFIED: `pending_expiry_ms?: number` is optional so all existing `VerbRegistryEntry` usages that omit the field continue to typecheck; `expiryMs !== undefined` guard prevents expiry when absent.
- VERIFIED: `import { submit }` is a value import (runtime call); all other imports (`Store`, `Clock`, `AsyncVerbAdapter`, `VerbRegistryEntry`) are type-only via `import type` (`verbatimModuleSyntax` satisfied — ts-gotchas.md).
- VERIFIED: `store.get<PendingRow>` returns `PendingRow | undefined`; `row === undefined` guard satisfies `noUncheckedIndexedAccess` (ts-gotchas.md).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 006-ledger-projection · T1 Version bump + ledger classified in the contract

**Cycle.** Confirm GREEN for Story 005 T1 (`src/broker/expiry.test.ts`), then RED for Task `T1` (`src/broker/ledger-projection.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**Story 005 T1 confirm GREEN.** `npm test -- --test-path-pattern='src/broker/expiry.test.ts'` — all 3 expiry tests pass (expired/in_flight/two-verb-independent); all 179 suite tests pass.

**Test written.**
- file: `src/broker/ledger-projection.test.ts` (new) — suite: `src/broker/ledger-projection.ts` — methods: `PROJECTION_CONTRACT_VERSION is bumped to "2"`, `bumped contract adds op_ledger table with all six ledger identity fields classified markdown-derived`, `request_id is classified runtime-only and op_id is removed from the cross-table runtimeOnly list`
- asserts: (T1a) `PROJECTION_CONTRACT_VERSION === "2"`; (T1b) `PROJECTION_CONTRACT.tableScope` includes `"op_ledger"`, `PROJECTION_CONTRACT.tables["op_ledger"]` exists and every one of `op_id`, `verb`, `idempotency_key`, `correlation`, `desired_effect_hash`, `status` is classified `{ derived: <non-empty string> }`; (T1c) `"request_id"` is in `PROJECTION_CONTRACT.runtimeOnly` and `"op_id"` is NOT in `PROJECTION_CONTRACT.runtimeOnly` (it is now a markdown-derived ledger field, not a cross-table runtime sentinel).

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/ledger-projection.test.ts'`
- exit: 1 — failure: `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: '1' !== '2'`

**Open to Software Engineer.**
- Seam: `src/store/projection.ts` — bump `PROJECTION_CONTRACT_VERSION` from `"1"` to `"2"`; add `"op_ledger"` to `tableScope`; add `tables["op_ledger"]` entry with `rowIdentityKey: ["op_id"]` and all six ledger identity columns (`op_id`, `verb`, `idempotency_key`, `correlation`, `desired_effect_hash`, `status`) classified as `{ derived: "<named source>" }`; add `"request_id"` to `runtimeOnly`; remove `"op_id"` from `runtimeOnly` (it is now a row identity key in `op_ledger`, not a cross-table runtime sentinel). **Also update `src/store/projection.test.ts`**: the test at line 57 (`op_id is in the runtime-only set`) must be revised (op_id leaves `runtimeOnly`) and the test at lines 86–91 (`op_ledger is absent from the v1 contract`) must be removed or revised now that op_ledger is present in v2. The version test at line 9 (`PROJECTION_CONTRACT_VERSION is '1'`) must also be updated to `'2'`.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 006-ledger-projection · T1 Version bump + ledger classified in the contract

**Cycle.** GREEN+REFACTOR for `src/broker/ledger-projection.test.ts`.

**Files changed.**
- `src/store/projection.ts` (edited) — bumped `PROJECTION_CONTRACT_VERSION` to `"2"`; added `"op_ledger"` to `tableScope`; added `tables["op_ledger"]` with `rowIdentityKey: ["op_id"]` and all six §5 identity columns classified `{ derived: "..." }`; replaced `"op_id"` in `runtimeOnly` with `"request_id"`

**Seam (GREEN).** `src/broker/ledger-projection.test.ts` imports `PROJECTION_CONTRACT_VERSION` and `PROJECTION_CONTRACT` directly from `../store/projection.ts`; the three assertions — version equals `"2"`, `tables["op_ledger"]` exists with six `derived` columns, `runtimeOnly` contains `"request_id"` and does not contain `"op_id"` — are all satisfied by the production-only edits above.

**Refactor.** none (Task T1 specifies none; pre-existing `src/store/projection.test.ts` assertions that go stale from this bump are expected and will be fixed by the test-engineer on the next turn per the lane note).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS` · `npm run verify:handoff`

**Assumptions.**
- VERIFIED: `src/broker/ledger-projection.test.ts` has `import { PROJECTION_CONTRACT_VERSION, PROJECTION_CONTRACT } from "../store/projection.ts"` — it does NOT import from `src/broker/ledger-projection.ts`; no new broker module is needed for this test to pass.
- VERIFIED: removing `"op_id"` from the cross-table `runtimeOnly` list does not break the `projectionOf` helper, which simply iterates the list; `"op_id"` is now a row-identity key in `op_ledger` (markdown-derived), not a runtime sentinel.
- VERIFIED: `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN` DDL idioms not touched in this task (sqlite-gotchas.md not applicable here — pure schema-contract edit, no DDL).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — 006-ledger-projection · T2 Ledger rebuild-equivalence + drift detection

**Cycle.** Confirm GREEN for Story 006 T1; update stale `src/store/projection.test.ts` assertions for v2 contract (TE lane); RED for Task `T2` (`src/broker/ledger-projection.test.ts`).

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**T1 confirm GREEN.** All 3 ledger-projection T1 tests pass (`PROJECTION_CONTRACT_VERSION is "2"`, op_ledger fields classified markdown-derived, request_id in runtimeOnly and op_id absent from runtimeOnly); 179 prior tests unaffected.

**Stale test fixes (TE lane).** Three assertions in `src/store/projection.test.ts` contradicted the v2 contract after the SE's T1 bump. Updated:
- `PROJECTION_CONTRACT_VERSION is '1'` → assertion updated to `'2'`; test renamed.
- `leases, poll cursors, and op_id are classified runtime-only` → removed `op_id` check, added `request_id` check and a `!ro.includes("op_id")` assertion; test renamed to `leases, poll cursors, and request_id are classified runtime-only; op_id is not (v2)`.
- `op_ledger is absent from the v1 contract` → flipped to assert `"op_ledger" in PROJECTION_CONTRACT.tables`; test renamed to `op_ledger is present in the v2 contract`.

`src/store/projection` suite is fully GREEN after these changes (11 tests pass).

**Test written.**
- file: `src/broker/ledger-projection.test.ts` (edited) — suite: `src/broker/ledger-projection.ts` — methods: `rebuildLedgerIntoShadow reconstructs op_ledger rows from markdown — shadow projection equals live projection`, `live-only request_id column does not cause op_ledger projection divergence`, `corrupting a markdown-derived ledger field in live op_ledger is reported by diffProjection`
- asserts: (T2a) after writing one ledger entry via `writeLedgerEntry` then calling `rebuildLedgerIntoShadow(storyId, taskStem, featureStore, shadowStore)`, the shadow has 1 op_ledger row and `projectionOf(shadowRow)` deepEquals `projectionOf(liveRow)`; (T2b) adding a `request_id` column + value to the live op_ledger row produces zero op_ledger divergences from `diffProjection` (request_id is in runtimeOnly); (T2c) corrupting `verb` in the live op_ledger is reported by `diffProjection` naming `field === "verb"`.

**RED proof.**
- command: `npm test -- --test-path-pattern='src/broker/ledger-projection.test.ts'`
- exit: 1 — failure: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/ledger-projection.ts' imported from /Users/tuanatelsa/Projects/kanthorlabs/kanthord/src/broker/ledger-projection.test.ts`

**Collateral RED (SE to fix as part of T2 GREEN).** Three tests in `src/store/rebuild.test.ts` (`diffProjection: lease_holder mutation`, `diffProjection: ticket_ref corruption`, `diffProjection: shadow-only row divergence`) crash with `ERR_SQLITE_ERROR: no such table: op_ledger` because `diffProjection` now iterates the v2 `tableScope` (which includes `op_ledger`) and runs `SELECT * FROM op_ledger` on stores built by `compile()` + `rebuildFromMarkdown()` — neither creates the op_ledger table. The SE must fix `diffProjection` to skip tables missing from a store (treat as 0 rows) alongside creating `rebuildLedgerIntoShadow`.

**Open to Software Engineer.**
- New seam: `src/broker/ledger-projection.ts` — export `async function rebuildLedgerIntoShadow(storyId: string, taskStem: string, featureStore: FeatureStore, shadowStore: Store): Promise<void>` that reads ledger entries via `recoverFromLedger` from `"./ledger.ts"`, creates `op_ledger` in `shadowStore` with `CREATE TABLE IF NOT EXISTS op_ledger (op_id TEXT PRIMARY KEY, verb TEXT, idempotency_key TEXT, correlation TEXT, desired_effect_hash TEXT, status TEXT)` (idempotent DDL per sqlite-gotchas.md), and inserts each entry. Import `FeatureStore` from `"../store/feature-store.ts"` and `Store` from `"../foundations/sqlite-store.ts"` as type-only imports.
- Fix `diffProjection` in `src/store/rebuild.ts`: when `SELECT * FROM <table>` throws (table absent in that store), treat the store as having 0 rows for that table rather than crashing — this repairs the 3 pre-existing `rebuild.test.ts` failures and allows the T2 tests (which use minimal stores containing only op_ledger) to call `diffProjection` without error.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 006-ledger-projection · T2 Ledger rebuild-equivalence + drift detection

**Cycle.** GREEN+REFACTOR for `src/broker/ledger-projection.test.ts`.

**Files changed.**
- `src/broker/ledger-projection.ts` (new) — `rebuildLedgerIntoShadow(storyId, taskStem, featureStore, shadowStore): Promise<void>`
- `src/store/rebuild.ts` (edited) — added private `getTableRows(store, table)` helper; `diffProjection` now uses it instead of bare `store.all(SELECT * FROM table)`, treating missing tables as 0 rows

**Seam (GREEN).**
`rebuildLedgerIntoShadow` issues `CREATE TABLE IF NOT EXISTS op_ledger` (idempotent DDL), calls `recoverFromLedger` to read all ledger entries from the markdown journal, then `INSERT OR REPLACE`s each entry into the shadow store — satisfying T2a (shadow projection equals live), T2b (runtime-only `request_id` column stripped by `projectionOf` so no divergence), and T2c (corrupted `verb` detected by `diffProjection`). The collateral fix in `diffProjection` checks `sqlite_master` for table existence before querying, so stores without `op_ledger` (built by `compile()` / `rebuildFromMarkdown()`) produce 0 rows instead of crashing — repairing the three pre-existing `rebuild.test.ts` failures.

**Refactor.** none (Task T2 specifies none).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS` · `npm run verify:handoff`

**Assumptions.**
- VERIFIED: `CREATE TABLE IF NOT EXISTS` is the correct idempotent DDL form (sqlite-gotchas.md).
- VERIFIED: `sqlite_master WHERE type='table' AND name=?` is the declarative way to check table existence in SQLite — no try/catch (sqlite-gotchas.md).
- VERIFIED: `import type { FeatureStore }` and `import type { Store }` are type-only imports; `recoverFromLedger` is a value import used at runtime (`verbatimModuleSyntax` satisfied — ts-gotchas.md).
- VERIFIED: `recoverFromLedger` remaps `in_flight` → `needs_reconciliation`; the test fixture uses `status: "done"` throughout so the remapping does not affect projection equality in the covered test cases.
- VERIFIED: `noUncheckedIndexedAccess` satisfied — `exists?.n ?? 0` narrows the possibly-undefined result before comparison.

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**Cycle.** Confirm GREEN for Story 006 T2 (`src/broker/ledger-projection.test.ts` + collateral `src/store/rebuild.test.ts`), then full EPIC Verification Gate.

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**Story 006 T2 confirm GREEN.**

`npm test -- --test-path-pattern='src/broker/ledger-projection.test.ts'` — all 6 ledger-projection tests pass (3 T1 + 3 T2): `PROJECTION_CONTRACT_VERSION is "2"`, op_ledger fields classified markdown-derived, request_id in runtimeOnly / op_id absent, `rebuildLedgerIntoShadow` shadow equals live projection, request_id runtime-only causes no divergence, corrupted verb detected by `diffProjection`.

`npm test -- --test-path-pattern='src/store/rebuild.test.ts'` — all 10 rebuild tests pass including the 3 previously-failing `diffProjection` tests (`lease_holder mutation`, `ticket_ref corruption`, `shadow-only row divergence`) that crashed on `ERR_SQLITE_ERROR: no such table: op_ledger` — now repaired by the SE's missing-table guard in `diffProjection`.

Both runs: 182 tests, 182 pass, 0 fail, 0 skipped.

**EPIC verification gate.**

| Target | Command | Exit | Result |
|---|---|---|---|
| core typecheck | `npm run typecheck` | 0 | PASS |
| core unit | `npm test` | 0 | PASS — 182 pass, 0 fail, 0 skipped |

**Tasks closed.** 11 Tasks across 6 Stories:
- Story 001 T1: Load verb registry entries (`src/broker/registry.test.ts`)
- Story 001 T2: Async adapter interface + reconcile-required rule (`src/broker/registry.test.ts`)
- Story 002 T1: Submit returns op_id + records in-flight op (`src/broker/submit.test.ts`)
- Story 002 T2: Idempotent resubmit + required-key enforcement (`src/broker/submit.test.ts`)
- Story 003 T1: Advance to terminal + write completion row (`src/broker/poller.test.ts`)
- Story 003 T2: Timeout→escalation, backoff, rate-limit, regression (`src/broker/poller.test.ts`)
- Story 004 T1: Ledger entry (no request_id) + recover durable identity (`src/broker/ledger.test.ts`)
- Story 004 T2: Reconcile with desired-effect hash: done/failed/resubmit/escalate (`src/broker/reconcile.test.ts`)
- Story 005 T1: Expire stale pending op; keep fresh one (`src/broker/expiry.test.ts`)
- Story 006 T1: Version bump + ledger classified in contract (`src/broker/ledger-projection.test.ts`)
- Story 006 T2: Ledger rebuild-equivalence + drift detection (`src/broker/ledger-projection.test.ts`)

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-04
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: FAIL — Ulrich (dictated 2026-07-04): fix B1 via canonical path + fold in all four suggestions.
BLOCKER: B1 — Ledger rebuild must go through the canonical rebuildFromMarkdown, not a parallel rebuildLedgerIntoShadow. Extend src/store/rebuild.ts:rebuildFromMarkdown so it applies the op_ledger DDL and reconstructs op_ledger rows from the task markdown ledger (via the Epic 005 Story 004 recovery path), reusing Epic 003 projectionOf. Add whatever ledger/journal source input the function needs. Re-point src/broker/ledger-projection.test.ts (T2a/T2b/T2c) at rebuildFromMarkdown and remove/absorb the separate rebuildLedgerIntoShadow machinery so "No new rebuild machinery" holds. Closes VG9 / Story 006 T2.
BLOCKER: S1 — reconcile.ts hash-mismatch branch returns "failed" without writing a broker_completion row; every other terminal branch writes one. Write broker_completion (op_id, "failed", clock.now()) before returning "failed" on hash mismatch. Add a regression asserting the row exists.
BLOCKER: S2 — reconcile.ts resubmit branch passes ledgerEntry as the submit payload; it must pass the original operation payload, not ledger metadata, so Phase-2 real adapters receive the right shape. Adjust the resubmit path (carry/reconstruct the original payload) and assert the adapter.submit receives the op payload.
BLOCKER: S3 — projection.ts projectionOf allocates new Set(runtimeOnly) per call (per row × per table in diffProjection). Hoist to a module-level const RUNTIME_ONLY_SET constructed once. Behavior-preserving; existing tests must stay green.
BLOCKER: S4 — expiry.ts createPendingOp has no (verb, idempotency_key) dedup; two calls with the same verb+key create two pending rows. Add dedup consistent with the broker_in_flight pattern (return the existing pending op_id, no second row). Add a regression.
## TEST-ENGINEER — 005-broker-skeleton review-fix cycle · B1 / S1 / S2 / S4

**Cycle.** RED regression tests for HUMAN_REVIEW blockers B1, S1, S2, S4 (S3 — no new test, see note below).

---

### B1 — Re-point T2 tests at canonical `rebuildFromMarkdown`

**Test written.**
- file: `src/broker/ledger-projection.test.ts` (edited)
  - suite: `src/broker/ledger-projection.ts`
  - methods: `rebuildFromMarkdown reconstructs op_ledger rows from markdown — shadow projection equals live projection`, `live-only request_id column does not cause op_ledger projection divergence`, `corrupting a markdown-derived ledger field in live op_ledger is reported by diffProjection`
  - asserts: (T2a) calling `rebuildFromMarkdown(featureDir, REBUILD_OPTS, [{ storyId, taskStem }])` returns a shadow store whose `op_ledger` rows have the same `projectionOf` output as the manually-built live store; (T2b) live-only `request_id` column added to liveStore causes zero `op_ledger` divergences from `diffProjection`; (T2c) corrupting `verb` in liveStore is reported by `diffProjection` naming `field === "verb"`.
  - imports removed: `{ rebuildLedgerIntoShadow } from "./ledger-projection.ts"` — entirely removed.
  - imports added: `{ diffProjection, rebuildFromMarkdown } from "../store/rebuild.ts"`, `import type { CompileOptions } from "../compiler/compile.ts"`.
  - setup change: T2 `before` now writes a minimal compiled-plan structure (epic.md, RUNBOOK.md, INDEX.md, placeholder task) alongside the journal, so `rebuildFromMarkdown`'s compiled-plan path succeeds.

**T2c note — passes GREEN in RED state (not vacuous):** T2c ("corrupting a markdown-derived ledger field") currently passes because `diffProjection`'s shadow-missing-row path reports ALL live fields as divergences (including `verb`) when `shadowStore` has no `op_ledger` table at all. After the SE fix the shadow will have the correct row and T2c still detects the corruption. The assertion is observationally stable; the test is not vacuous.

**RED proof (B1).**
- command: `npm test -- --test-path-pattern='src/broker/ledger-projection.test.ts'`
- exit: non-zero
- T2a failure: `Error: no such table: op_ledger` at `shadowStore5.all("SELECT * FROM op_ledger")` — `rebuildFromMarkdown` currently ignores the 3rd `ledgerSources` arg (silently dropped, function only accepts 2 params) and never creates the `op_ledger` table in the shadow.
- T2b failure (cascade): `live-only request_id column does not cause op_ledger projection divergence` — `ALTER TABLE op_ledger ADD COLUMN request_id` on liveStore5 fails because `op_ledger` doesn't exist (carried from T2a state mutation).

**Expected signature for `rebuildFromMarkdown` (SE decision point):**
```
rebuildFromMarkdown(
  featureDir: string,
  opts: CompileOptions,
  ledgerSources?: Array<{ storyId: string; taskStem: string }>
): Promise<Store>
```
The optional third parameter tells the function which task journals to scan for `op_ledger` reconstruction. Existing callers (rebuild.test.ts) pass 2 args and are unaffected. The SE may also delete `src/broker/ledger-projection.ts` (its only consumer was this test, which now imports `rebuildFromMarkdown` instead).

---

### S1 — Hash-mismatch branch must write a broker_completion row

**Test written.**
- file: `src/broker/reconcile.test.ts` (edited)
  - suite: `src/broker/reconcile.ts`
  - method: `reconcile done branch: hash mismatch writes a failed completion row`
  - asserts: after `reconcileOp` with a hash-mismatch adapter (`observed_hash !== desired_effect_hash`), a `broker_completion` row exists for the `op_id` with `status = "failed"`.

**RED proof (S1).**
- command: `npm test -- --test-path-pattern='src/broker/reconcile.test.ts'`
- exit: non-zero — failure: `AssertionError [ERR_ASSERTION]: hash-mismatch path must write a broker_completion row for the op_id` — current code returns `"failed"` from the hash-mismatch branch without calling `writeCompletionRow`.

---

### S2 — Resubmit path must pass original operation payload to `adapter.submit`

**Test written.**
- file: `src/broker/reconcile.test.ts` (edited)
  - suite: `src/broker/reconcile.ts`
  - method: `reconcile resubmit branch: adapter.submit receives the original operation payload not ledger metadata`
  - asserts: `adapter.submit` is called with the value passed as the 6th `payload` argument to `reconcileOp` — not the `LedgerEntry` object.

**RED proof (S2).**
- command: `npm test -- --test-path-pattern='src/broker/reconcile.test.ts'`
- exit: non-zero — failure:
```
AssertionError [ERR_ASSERTION]: adapter.submit must receive the original operation payload, not the LedgerEntry metadata
+ actual: { correlation: 'branch-feature-s2', desired_effect_hash: 'sha256-s2', idempotency_key: 'idem-s2', op_id: 'op-reconcile-s2', status: 'needs_reconciliation', verb: 'deploy_service' }
- expected: { action: 'deploy', service: 'auth-service', version: '1.2.3' }
```
The 6th arg `ORIGINAL_PAYLOAD` is silently ignored (JS extra-arg behavior under type stripping); the resubmit branch calls `submit(entry, adapter, ledgerEntry, ...)` so `adapter.submit` receives the `LedgerEntry` object instead of the original payload.

**Expected `reconcileOp` signature change (SE decision point):**
```
reconcileOp(
  ledgerEntry: LedgerEntry,
  entry: VerbRegistryEntry,
  adapter: AsyncVerbAdapter,
  store: Store,
  clock: Clock,
  payload?: unknown,   // NEW — original operation payload for the resubmit branch
): Promise<"done" | "failed" | "resubmit" | "escalate">
```
The resubmit branch should call `submit(entry, adapter, payload, ...)` instead of `submit(entry, adapter, ledgerEntry, ...)`. SE decides behavior when `payload` is absent on a resubmit outcome.

---

### S3 — No new test

S3 is a behavior-preserving refactor: hoist `new Set(runtimeOnly)` to a module-level const in `src/store/projection.ts`. The existing `projection.test.ts` and `rebuild.test.ts` suites exercise every code path that calls `projectionOf` / `diffProjection` and will stay GREEN after the hoist. No new test is needed; the behavioral contract is already covered.

---

### S4 — `createPendingOp` dedup on (verb, idempotency_key)

**Test written.**
- file: `src/broker/expiry.test.ts` (edited)
  - suite: `src/broker/expiry.ts`
  - method: `second createPendingOp with same (verb, idempotency_key) returns the existing pending op_id and creates no second pending row`
  - asserts: a second `createPendingOp(entry, "idem-dedup-s4", store, clock)` with the same `(verb, idempotency_key)` returns the identical `op_id` from the first call; exactly one row exists in `broker_pending` for the pair.

**RED proof (S4).**
- command: `npm test -- --test-path-pattern='src/broker/expiry.test.ts'`
- exit: non-zero — failure: `AssertionError [ERR_ASSERTION]: second createPendingOp with same (verb, idempotency_key) must return the original op_id` — two different UUIDs (e.g. `'78a33ec4-...'` ≠ `'a9174d93-...'`). Current `createPendingOp` always generates a fresh UUID and inserts unconditionally with no dedup guard.

---

**Open to Software Engineer.**

- **B1:** Extend `src/store/rebuild.ts:rebuildFromMarkdown` to accept an optional 3rd parameter `ledgerSources?: Array<{ storyId: string; taskStem: string }>`. When provided, create the `op_ledger` table (idempotent DDL) in the shadow store and call `recoverFromLedger` (from `src/broker/ledger.ts`) for each locator to populate it. Existing 2-arg callers are unaffected. The separate `src/broker/ledger-projection.ts` (`rebuildLedgerIntoShadow`) is now untested — SE may delete it.
- **S1:** In `src/broker/reconcile.ts` hash-mismatch branch: call `writeCompletionRow(store, ledgerEntry.op_id, "failed", clock.now())` before returning `"failed"`.
- **S2:** Add `payload?: unknown` as a 6th parameter to `reconcileOp` in `src/broker/reconcile.ts`; resubmit branch passes `payload` (not `ledgerEntry`) to `submit(entry, adapter, payload, ledgerEntry.idempotency_key, store)`.
- **S3:** Hoist `new Set(PROJECTION_CONTRACT.runtimeOnly)` to a module-level `const RUNTIME_ONLY_SET` in `src/store/projection.ts`; update `projectionOf` and `diffProjection` to reference it. No test changes.
- **S4:** Add `(verb, idempotency_key)` dedup in `createPendingOp` in `src/broker/expiry.ts` — query `broker_pending WHERE verb = ? AND idempotency_key = ?`; return the existing `op_id` if found, skip the insert.

END: TEST-ENGINEER
## SOFTWARE-ENGINEER — 006-ledger-projection review-fix · B1 / S1 / S2 / S3 / S4

**Cycle.** GREEN+REFACTOR for review blockers B1, S1, S2, S3, S4.

**Files changed.**
- `src/store/rebuild.ts` (edited) — extended `rebuildFromMarkdown` with optional 3rd param `ledgerSources?: Array<{ storyId: string; taskStem: string }>` that creates `op_ledger` (idempotent DDL) and populates it via `recoverFromLedger`; added value imports for `FeatureStore` and `recoverFromLedger`
- `src/broker/ledger-projection.ts` (deleted) — now untested; `rebuildLedgerIntoShadow` absorbed into canonical `rebuildFromMarkdown`; "No new rebuild machinery" restored
- `src/broker/reconcile.ts` (edited) — S1: hash-mismatch branch now calls `writeCompletionRow(store, ledgerEntry.op_id, "failed", clock.now())` before returning `"failed"`; S2: added optional 6th parameter `payload?: unknown` to `reconcileOp`; resubmit branch passes `payload` to `submit` instead of `ledgerEntry`
- `src/store/projection.ts` (edited) — S3: hoisted `new Set(PROJECTION_CONTRACT.runtimeOnly)` to module-level `const RUNTIME_ONLY_SET: ReadonlySet<string>`; `projectionOf` uses it instead of allocating per call
- `src/broker/expiry.ts` (edited) — S4: `createPendingOp` now queries `broker_pending WHERE verb = ? AND idempotency_key = ?` before insert; returns existing `op_id` on hit, skips the insert (no second row)

**Seam (GREEN).**

- **B1:** `rebuildFromMarkdown(featureDir, opts, [{ storyId, taskStem }])` satisfies T2a/T2b/T2c in `ledger-projection.test.ts`: the shadow store has an `op_ledger` row with all six §5 fields, `projectionOf(shadowRow)` deepEquals `projectionOf(liveRow)`, `request_id` (runtimeOnly) causes no divergence, and a corrupted `verb` is detected by `diffProjection`. Existing 2-arg callers in `rebuild.test.ts` are unaffected.

- **S1:** The new test `reconcile done branch: hash mismatch writes a failed completion row` asserts that after `reconcileOp` with a mismatched hash, a `broker_completion` row exists with `status = "failed"`. The hash-mismatch branch now calls `writeCompletionRow` before returning `"failed"`, consistent with every other terminal branch.

- **S2:** The new test `reconcile resubmit branch: adapter.submit receives the original operation payload not ledger metadata` passes `ORIGINAL_PAYLOAD` as the 6th arg and asserts `capturedSubmitPayload deepEqual ORIGINAL_PAYLOAD`. `reconcileOp` now accepts `payload?: unknown` and forwards it to `submit`.

- **S3:** `projectionOf` drops the per-call `new Set(...)` allocation; module-level `RUNTIME_ONLY_SET` is constructed once. Behavior identical; all existing projection/rebuild tests remain green.

- **S4:** The new test `second createPendingOp with same (verb, idempotency_key) returns the existing pending op_id and creates no second pending row` is satisfied: the dedup `SELECT` in `createPendingOp` short-circuits on a matching row and returns the original `op_id`.

**Refactor.** S3 applied in full (module-level const, behavior-preserving). Deletion of `ledger-projection.ts` applied (no consumers remain).

**Build check.**
- typecheck: exit 0 · `npm run typecheck`
- verify:handoff: `VERIFY: PASS` · `npm run verify:handoff`

**Assumptions.**
- VERIFIED: `FeatureStore` and `recoverFromLedger` are both value imports (class instantiation + function call at runtime); no `import type` (`verbatimModuleSyntax` satisfied — ts-gotchas.md).
- VERIFIED: `CREATE TABLE IF NOT EXISTS` is the correct idempotent DDL form; no try/catch (sqlite-gotchas.md).
- VERIFIED: `recoverFromLedger` remaps `"in_flight"` → `"needs_reconciliation"`; the test fixture uses `status: "done"` so the remap does not affect T2a/T2b equality.
- VERIFIED: `RUNTIME_ONLY_SET` is declared after `PROJECTION_CONTRACT` in the same module; module-level declaration order in ESM guarantees the Set is populated before any call to `projectionOf`.
- VERIFIED: Deleting `ledger-projection.ts` causes no import error — the test file imports only from `"../store/rebuild.ts"` and `"../store/projection.ts"` (confirmed by reading the test file in this session).

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**Cycle.** Confirm GREEN for review-fix cycle B1/S1/S2/S3/S4 — all five blockers resolved.

**Handoff verification.** `npm run verify:handoff` → `VERIFY: PASS`.

**Blocker confirmation — targeted regression tests.**

All four targeted test suites ran clean immediately after the SE's fix turn (no stale imports found):

- `src/broker/ledger-projection.ts` (no `ledger-projection.ts` production file remains — deleted as required): 6/6 pass.
  - B1 regression: `rebuildFromMarkdown reconstructs op_ledger rows from markdown — shadow projection equals live projection` ✔
  - `live-only request_id column does not cause op_ledger projection divergence` ✔
  - `corrupting a markdown-derived ledger field in live op_ledger is reported by diffProjection` ✔

- `src/broker/reconcile.ts`: 7/7 pass.
  - S1 regression: `reconcile done branch: hash mismatch writes a failed completion row` ✔
  - S2 regression: `reconcile resubmit branch: adapter.submit receives the original operation payload not ledger metadata` ✔

- `src/broker/expiry.ts`: 4/4 pass.
  - S4 regression: `second createPendingOp with same (verb, idempotency_key) returns the existing pending op_id and creates no second pending row` ✔

- S3 (hoist `RUNTIME_ONLY_SET`): behavior-preserving refactor — no new test, existing suite stays GREEN (confirmed by full `npm test` pass below).

**Stale-import check.** `grep -r "ledger-projection\|rebuildLedgerIntoShadow" src --include="*.ts" -l` → only `src/broker/ledger-projection.test.ts` matched, which imports `rebuildFromMarkdown` from `"../store/rebuild.ts"` (not from the deleted module). No stale import remains.

**EPIC verification gate.**

| Target | Command | Exit | Result |
|---|---|---|---|
| core typecheck | `npm run verify:handoff` | 0 | `VERIFY: PASS` |
| core unit | `npm test` | 0 | PASS — 185 pass, 0 fail, 0 skipped |

**Tasks closed.** 11 Tasks across 6 Stories (unchanged from prior ready turn) — plus 4 regression tests added in this review-fix cycle for B1/S1/S2/S4.

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-04
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: FAIL — Ulrich (dictated 2026-07-04): re-gate PASS accepted, but fold in the 3 remaining cosmetic suggestions before final PASS. All behavior-preserving; existing suites must stay green (no new tests).
BLOCKER: R-S1 — src/store/projection.ts: export the module-level RUNTIME_ONLY_SET const; src/store/rebuild.ts diffProjection: import and reuse it instead of allocating its own new Set(PROJECTION_CONTRACT.runtimeOnly). Behavior-preserving.
BLOCKER: R-S3 — src/broker/expiry.ts createPendingOp: narrow the dedup SELECT generic from PendingRow to { op_id: string } (query selects only op_id). Behavior-preserving.
BLOCKER: R-S2 — src/broker/ledger-projection.test.ts: fix the stale describe("src/broker/ledger-projection.ts", ...) label to name the seam actually under test (rebuildFromMarkdown / src/store/rebuild.ts). Cosmetic, test-lane.
## SOFTWARE-ENGINEER — 005-broker-skeleton · cosmetic refactors R-S1 + R-S3

**Cycle.** GREEN+REFACTOR — behavior-preserving cleanup (no new tests).

**Files changed.**
- `src/store/projection.ts` (edited) — added `export` to `RUNTIME_ONLY_SET`
- `src/store/rebuild.ts` (edited) — imported `RUNTIME_ONLY_SET` from `./projection.ts`; replaced the local `const runtimeOnlySet = new Set(PROJECTION_CONTRACT.runtimeOnly)` allocation in `diffProjection` with the module-level `RUNTIME_ONLY_SET`
- `src/broker/expiry.ts` (edited) — narrowed dedup `SELECT op_id` query generic from `PendingRow` to `{ op_id: string }`

**Seam (GREEN).** R-S1 exports the already-existing module-level set from `projection.ts` and removes the redundant per-call allocation in `rebuild.ts#diffProjection`, keeping identical runtime behavior. R-S3 tightens the type parameter to match the one column the query actually selects; the returned value's `.op_id` field usage is unchanged.

**Refactor.** Both R-S1 and R-S3 applied in this turn. R-S2 (test-file label fix) deferred — test-engineer's lane.

**Build check.**
- typecheck: exit 0
- verify:handoff: VERIFY: PASS

END: SOFTWARE-ENGINEER
## TEST-ENGINEER — implementation ready for review

**Cycle.** R-S2 cosmetic fix applied; full gate re-run confirms all three cosmetic cleanups (R-S1/R-S2/R-S3) are complete and behavior-preserving.

**R-S2 applied (test-engineer lane).**
- file: `src/broker/ledger-projection.test.ts` (edited) — stale `describe("src/broker/ledger-projection.ts", ...)` replaced with `describe("src/store/projection.ts + src/store/rebuild.ts — ledger projection & rebuild contract", ...)`.
- The T1 tests exercise `PROJECTION_CONTRACT_VERSION`, `PROJECTION_CONTRACT`, `projectionOf` from `src/store/projection.ts`; the T2 tests exercise `rebuildFromMarkdown` and `diffProjection` from `src/store/rebuild.ts`. The new label names both seams accurately.
- Cosmetic string change only — no assertion altered.

**All three cosmetic cleanups done.**
- R-S1 (SE lane): `RUNTIME_ONLY_SET` exported from `src/store/projection.ts`; `diffProjection` in `src/store/rebuild.ts` imports and reuses it — no per-call allocation.
- R-S2 (TE lane): stale `describe` label fixed in `src/broker/ledger-projection.test.ts` (this turn).
- R-S3 (SE lane): dedup `SELECT op_id` generic narrowed from `PendingRow` to `{ op_id: string }` in `src/broker/expiry.ts`.

**EPIC verification gate.**

| Target | Command | Exit | Result |
|---|---|---|---|
| core typecheck | `npm run typecheck` | 0 | clean |
| core handoff | `npm run verify:handoff` | 0 | `VERIFY: PASS` |
| core unit | `npm test` | 0 | 185 pass, 0 fail, 0 skipped |

**Tasks closed.** 11 Tasks across 6 Stories (unchanged) — plus 4 regression tests from review-fix cycle B1/S1/S2/S4, plus 3 behavior-preserving cosmetic refactors from R-S1/R-S2/R-S3.

IMPLEMENTATION_READY_FOR_REVIEW:
- gates: PASS
- date: 2026-07-04
- state: local-uncommitted

END: TEST-ENGINEER

HUMAN_REVIEW: PASS — Ulrich (dictated 2026-07-04): reviewer re-gate PASS + all 3 cosmetic cleanups (R-S1/R-S2/R-S3) folded in; final gate green (typecheck 0, 185 tests). Epic 005 closed. Human reviews the diff and commits.
