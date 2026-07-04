# Story 003 - Poll Lifecycle & Completion into SQLite

Epic: `.agent/plan/epics/005-broker-skeleton.md`

## Goal

The broker poller advances in-flight operations on the fake clock at each verb's
declared interval, drives them through `poll_status` to a terminal state, and writes
the completion row into SQLite — the same sink the scheduler reads — with backoff,
timeout→escalation, rate-limit, and observed-state-regression all handled per the
verb declaration.

## Acceptance Criteria

- Advancing the fake clock by a verb's poll interval calls the fake verb's
  `poll_status` once per interval; a verb reaching a terminal `done` state writes a
  completion row keyed by `op_id` with the result (PRD §5 — poller advances at
  per-verb intervals, writes completion into SQLite).
- The completion row is written to the **Epic 004 completion-row table** the
  scheduler reads, so a parked task's `blocked_on` clears (PRD §5, §7.3 — one
  wake-up mechanism). *(Table owned by Epic 004 Story 003; this Story writes to it.)*
- A verb reaching a terminal `failed` state writes a completion row marked failed
  (PRD §5 terminal states).
- The poller decides "terminal" using the verb's **declared** `terminal_states`
  (Story 001), not a hardcoded `done|failed` set (debate finding).
- A completion write conforms to the Epic 004 `broker_completion` schema (`op_id`
  PK, `status`, `result_json`/`error_json`, `at`) and is idempotent — a re-write for
  the same `op_id` does not duplicate the row (debate finding — assert conformance).
- A verb that exceeds its `timeout` with no terminal state emits a broker
  **escalation-needed** state/event and stops polling — the broker's own concern
  only, not ring-1/notification/approval (PRD §5; Epic 005 escalation boundary).
- Between polls, retryable non-terminal errors back off per the verb's declared
  `retry` backoff (observable: poll spacing grows on the fake clock) (PRD §5).
- A verb that hits a rate limit defers its next poll per the verb's declared
  `rate_limit` behavior instead of hammering (PRD §5).
- **Observed-state regression, two testable classes** (debate finding): for a verb
  with `observed_state_can_regress: false`, a terminal completion is final; for one
  with `observed_state_can_regress: true`, a `poll_status` regression
  (terminal→non-terminal) does **not** leave a final `done` — the completion is
  withheld/marked regressable pending reconcile confirmation.

## Constraints

- Completion detection is **poll-only**; no webhook/inbound path (PRD §5; Epic 005
  Non-Goals). The poller is driven by the injected Epic 001 clock so tests advance
  time deterministically with no real waiting.
- The completion sink is SQLite (the scheduler's read source), not a callback (PRD
  §5 — one wake-up mechanism).
- Per-verb interval/backoff/timeout/rate-limit come from the verb registry entry
  (Story 001), not hardcoded (PRD §5).

## Verification Gate

- `npm test` green for `src/broker/poller.test.ts` on the fake clock.

### Task T1 - Advance to terminal + write completion row

**Input:** `src/broker/poller.ts`, `src/broker/poller.test.ts`

**Action - RED:** Write tests on the fake clock: advancing by the verb's declared
`poll_interval` calls `poll_status`; a fake verb reaching a declared terminal state
`done` writes a `broker_completion` row (Epic 004 schema) keyed by `op_id` with
`result_json`; `failed` writes a row with `error_json`; a second write for the same
`op_id` does not duplicate the row (idempotent conformance); terminality is decided
by the declared `terminal_states`, not a hardcoded set.

**Action - GREEN:** Implement the poller: per in-flight op, on each declared interval
call `poll_status`, and on a declared terminal state write the completion row
idempotently to the Epic 004 table.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Timeout→escalation, backoff, rate-limit, regression

**Input:** `src/broker/poller.ts`, `src/broker/poller.test.ts`

**Action - RED:** Write tests on the fake clock: (a) a verb never reaching terminal
past its `timeout` emits a broker escalation-needed state and stops polling; (b) a
retryable non-terminal error backs off (assert increasing poll spacing per declared
backoff); (c) a rate-limit response defers the next poll per declared `rate_limit`;
(d) a `observed_state_can_regress: false` verb's terminal `done` is final, while a
`observed_state_can_regress: true` verb reporting a regression is **not** left final
`done` (marked regressable / withheld).

**Action - GREEN:** Add timeout→escalation-needed, backoff spacing, rate-limit
deferral, and the two-class regression handling, all driven by the verb registry
declaration.

**Action - REFACTOR:** Extract the next-poll-time computation into a named helper;
otherwise `none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
