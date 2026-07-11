# Story 003 - per-model-call / account record

Epic: `.agent/plan/epics/019.5-task-audit-timeline.md`

## Goal

Record every model call with **which account/model served it** and its outcome, so a
multi-account failure answers "which account, which call, why." Fed by the Story 001
session-event stream. Defines the typed provider-error taxonomy shared with Epic 043.

## Acceptance Criteria

- Each model call emits a durable record `{task_id, attempt, session_id, account_id,
  model, tokens_in, tokens_out, cost, latency_ms, stop_reason, typed_error?}` that joins
  the task timeline (Story 002) by `correlation_id`.
- `account_id` is the account resolved by Epic 019.4's durable binding; two attempts of one
  task on two different accounts produce per-call records attributed to the correct
  `account_id`.
- A failed model call records a **typed** error from the taxonomy `rate_limited |
  quota_exhausted | auth_failed | transient | fatal` (mapped from the session-event error
  / assistant `errorMessage`), not a raw string; an unmappable error is `fatal` with the
  raw detail in a bounded payload.
- No secret (token/key) appears in any per-call record or its logs (custody redaction).

## Constraints

- **Fed by Story 001** — the per-call data comes from the session-event stream's
  `model_call` events (usage/stop-reason/error). What is observable is bounded by the
  Story 001 spike result; if pi does not expose per-call account/usage, this story is
  scoped to what is observable and the gap is a Findings entry.
- **Typed provider-error taxonomy is defined here** and is the shared contract Epic 043's
  switch triggers consume (Decision Anchor). It is a closed enum with a documented mapping
  from provider/pi errors.
- **Account attribution via 019.4** — `account_id` comes from the durable per-task binding
  (`src/agent/account-binding.ts`), never re-derived; the agent env stays credential-free.
- **Redaction** — reuse the keyring redaction invariant; records carry account **id**, not
  credential.

## Verification Gate

- `npm test` green for the per-call suite; typecheck 0; zero-network guard green.
- Per-call record shape, correct `account_id` across two accounts, the typed-error mapping
  (each taxonomy value + the unmappable→`fatal` case), and redaction are asserted against a
  scripted session-event double.

### Task T1 - per-model-call record joined to the timeline

**Input:** `src/metrics/model-call-log.ts`, `src/metrics/model-call-log.test.ts`,
`src/store/schema.ts`

**Action - RED:** a scripted `model_call` event (with usage + account) produces a per-call
record with the full shape, carrying the run's `account_id` and joining the timeline by
`correlation_id`; a second attempt on a different account attributes to that account.

**Action - GREEN:** implement the per-call record store (DDL in `initSchema`) fed from the
Story 001 event stream, attributing `account_id` from the 019.4 binding.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/model-call-log.test.ts` — T1 cases green.

### Task T2 - typed provider-error taxonomy + mapping

**Input:** `src/metrics/provider-error.ts`, `src/metrics/provider-error.test.ts`,
`src/metrics/model-call-log.ts`

**Action - RED:** tests assert each raw provider/pi error maps to the correct taxonomy
value (`rate_limited | quota_exhausted | auth_failed | transient | fatal`), an unmappable
error → `fatal` with bounded raw detail, and that no secret leaks into the record.

**Action - GREEN:** implement the closed taxonomy + the mapping from session-event errors /
assistant `errorMessage`; wire it into the per-call record.

**Action - REFACTOR:** none.

**Verify:** `node --test src/metrics/provider-error.test.ts` — T2 cases green.
