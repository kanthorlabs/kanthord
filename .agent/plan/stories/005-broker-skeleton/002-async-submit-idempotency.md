# Story 002 - Async Submit & Idempotency

Epic: `.agent/plan/epics/005-broker-skeleton.md`

## Goal

Every broker call is async: `submit` returns an `op_id` immediately and records the
in-flight operation; a mutating call carries an idempotency key so a retry with the
same key resolves to the same operation instead of double-submitting.

## Acceptance Criteria

- `submit(verb, payload, idempotencyKey)` returns an `op_id` synchronously and marks
  an in-flight operation with a `request_id` from the fake verb's `submit` (PRD §5 —
  every call returns a request id, always async).
- Submitting the **same** `(verb, idempotencyKey)` again returns the **same** `op_id`
  and does **not** create a second in-flight operation or call the fake verb's
  `submit` twice (PRD §5 — idempotency keys; retries must not double-post).
- A mutating verb submitted **without** an idempotency key when its registry entry
  requires one is rejected with a diagnostic naming the verb (PRD §5 — idempotency
  required on mutating calls).
- The returned `op_id` is stable and usable as the `blocked_on` value a task parks on
  (PRD §7.3 — the scheduler parks on `op_id`).

## Constraints

- Async is normalized for **all** calls (even trivial ones) — the design accepts the
  extra roundtrip to keep one execution model (PRD §5; Trade-off #3).
- Idempotency dedup is keyed by `(verb, idempotencyKey)`; its **durable** source is
  the markdown ledger (Story 004), so the SQLite dedup index is rebuildable and the
  dedup survives a respawn / SQLite loss — not SQLite-only (debate finding; PRD §5
  durable identity, §6.1 rebuildable). The crash-survival test lives in Story 004 T1.
- The fake verb's `submit` is a hand-written Mock returning a Story-named
  `request_id` (PROFILE.md fake/mock style).

## Verification Gate

- `npm test` green for `src/broker/submit.test.ts`.

### Task T1 - Submit returns op_id + records in-flight op

**Input:** `src/broker/submit.ts`, `src/broker/submit.test.ts`

**Action - RED:** Write a test that `submit` returns an `op_id`, records one in-flight
operation with the fake verb's `request_id`, and that the `op_id` is retrievable.

**Action - GREEN:** Implement `submit(verb, payload, idempotencyKey)` calling the
adapter's `submit`, persisting the in-flight op with `op_id`/`request_id`.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Idempotent resubmit + required-key enforcement

**Input:** `src/broker/submit.ts`, `src/broker/submit.test.ts`

**Action - RED:** Write tests: (a) resubmitting the same `(verb, idempotencyKey)`
returns the same `op_id` and the fake `submit` is invoked only once; (b) a mutating
verb requiring idempotency submitted without a key throws a typed error naming the
verb.

**Action - GREEN:** Add persisted `(verb, idempotencyKey) → op_id` dedup and the
required-key check before submit.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
