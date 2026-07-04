# Story 005 - Per-Verb Pending Expiry

Epic: `.agent/plan/epics/005-broker-skeleton.md`

## Goal

A `pending` operation (created but not yet submitted to the remote — per the Epic's
state model) that has sat past its verb's expiry window is moved to `expired` rather
than fired, so a stale request (e.g. a 3-day-old pending `jira.create` awaiting
approval) never acts surprisingly.

## Acceptance Criteria

- Expiry applies to the `pending` state only (pre-submit); an op whose `pending` age
  (against the fake clock) exceeds its verb's expiry window transitions to `expired`
  and is **never** submitted/fired (PRD §5 — pending requests expire per-verb; Epic
  state model).
- A `pending` op within its window still transitions to `in_flight` (submits) when
  released/approved; an already-`in_flight` op is out of scope for pending expiry
  (its lifetime is governed by `timeout`, Story 003).
- Expiry is per-verb (two verbs with different windows expire independently), read
  from the verb registry entry (PRD §5).
- An `expired` op is surfaced as a terminal `expired` state (auditable), not silently
  dropped.

## Constraints

- Expiry window is a per-verb registry value, not a global constant (PRD §5).
- Evaluated against the injected Epic 001 clock; tests advance the fake clock past
  expiry with no real waiting.
- Expiry acts on the `pending`→`expired` transition (pre-submit), distinct from the
  poller's `in_flight` `timeout` (Story 003) — the two are different windows on
  different states (debate finding — define what "pending" means).

## Verification Gate

- `npm test` green for `src/broker/expiry.test.ts` on the fake clock.

### Task T1 - Expire a stale pending op; keep a fresh one

**Input:** `src/broker/expiry.ts`, `src/broker/expiry.test.ts`

**Action - RED:** Write tests on the fake clock: (a) advancing past a verb's expiry
window transitions its `pending` op to `expired` and it is never submitted; (b) a
`pending` op within the window still submits (→ `in_flight`) when released; (c) two
verbs with different windows expire independently.

**Action - GREEN:** Implement the per-verb `pending`→`expired` transition (registry
window vs `pending` age on the clock), evaluated before submit.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
