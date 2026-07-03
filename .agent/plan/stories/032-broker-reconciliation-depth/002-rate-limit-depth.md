# Story 002 - Rate-Limit Depth

Epic: `.agent/plan/epics/032-broker-reconciliation-depth.md`

## Goal

A rate-limited response is a distinct signal with its own per-verb backoff —
it never consumes the failure-retry budget, never terminalizes an op, and
escalates only after its own exhaustion window.

## Acceptance Criteria

- Every registered verb declares its rate-limit **schedule and exhaustion
  window** in the registry; **recognition** of a limit is adapter-owned per
  the Epic 014/022 taxonomies (debate finding — registry declares policy,
  adapters own recognition; the yaml never describes wire-level detection) —
  a missing schedule/window declaration fails registry load naming the verb.
- Rate-limit backoff does **not** suspend the verb's overall timeout clock
  (debate finding — PRD §5 timeout+escalation still applies): an op that is
  rate-limited past its per-verb timeout follows the verb's declared
  timeout+escalation path; the exhaustion window can only be shorter than or
  equal to the timeout (validated at registry load).
- A rate-limited **submit** re-schedules on the rate-limit backoff; the op
  stays `pending`; the failure-retry budget is untouched (asserted by
  exhausting rate-limits first, then counting the full failure budget still
  available).
- A rate-limited **poll** stretches that op's next poll per the schedule; the
  op stays `in_flight`; the broker applies **no global throttle** — another
  op's scheduled cadence is not modified by this op's backoff (asserted with
  two ops on the fake clock; debate finding — this claims broker behavior
  only, not provider reality: provider-side coupling across ops of one
  integration is out of scope, per the Epic Non-Goals).
- A rate-limited **reconcile** retries reconciliation on the schedule; the op
  stays `needs_reconciliation` (never silently terminal).
- Rate-limiting continuing past the verb's exhaustion window raises an inbox
  escalation naming the verb and window; the op remains non-terminal and
  resumes when the double stops limiting.
- A retry fired after the backoff reuses the same idempotency key (no
  double-submit under rate-limit, asserted on the double's call log).

## Constraints

- Rate-limit classification lives in the per-verb adapters (Epics 014/022
  taxonomy: retryable / terminal / escalate gains the rate-limited class) —
  the broker core sees a classified signal, not raw HTTP (Epic 005 seam).
- Fake clock only; doubles only; no live API in this story (Epic 032 gate).

## Verification Gate

- `npm test` green for `src/broker/rate-limit.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Classification + budget separation

**Input:** `src/broker/rate-limit.ts`, `src/broker/registry.ts`,
`src/broker/submit.ts`, `src/broker/rate-limit.test.ts`

**Action - RED:** Write tests: (a) registry load rejects a verb missing
rate-limit declarations; (b) rate-limited submit stays `pending`, reschedules
on the declared schedule, failure budget intact afterwards (count-asserted);
(c) the post-backoff retry carries the same idempotency key.

**Action - GREEN:** Add the rate-limited signal class and the separate backoff
scheduling to submit, driven by the registry declaration.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Poll/reconcile stretch + exhaustion escalation

**Input:** `src/broker/rate-limit.ts`, `src/broker/poller.ts`,
`src/broker/reconcile.ts`, `src/broker/rate-limit.test.ts`

**Action - RED:** Write tests: (a) rate-limited poll stretches only that op's
cadence (two-op fixture); (b) rate-limited reconcile retries on schedule,
stays `needs_reconciliation`; (c) limiting past the exhaustion window raises
the escalation naming verb + window, op non-terminal; (d) the op resumes and
completes once the double stops limiting; (e) rate-limiting past the
per-verb timeout follows the timeout+escalation path (the timeout clock never
paused); a window > timeout is a registry load error.

**Action - GREEN:** Wire the rate-limit schedule into poller and reconcile
paths with the exhaustion-window escalation.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
