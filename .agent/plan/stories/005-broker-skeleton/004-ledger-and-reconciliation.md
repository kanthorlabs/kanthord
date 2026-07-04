# Story 004 - Durable Operation Ledger & Crash Reconciliation

Epic: `.agent/plan/epics/005-broker-skeleton.md`

## Goal

Every async operation records a durable **operation-identity** ledger entry in the
task's markdown; on restart the broker recovers those durable identities (never the
ephemeral request id), marks interrupted operations needs-reconciliation, and drives
each through its verb's reconcile path — using the ledger's desired-effect hash — to
a terminal resolution, minting a new request id only via an idempotent resubmit.

## Acceptance Criteria

- Submitting an async op writes a durable ledger entry into the task's markdown with
  `op_id`, verb, `idempotency_key`, external correlation (branch/issue/deploy-env),
  desired-effect hash, and status — and **no `request_id`** (PRD §5, §6.1 — request
  ids are ephemeral and never synced).
- **Recovery recovers durable identity, not the request map** (debate finding; PRD
  §6.1): after dropping the SQLite runtime rows and keeping the markdown,
  `recoverFromLedger` reconstructs each op's durable identity + status; it does
  **not** resurrect the old `request_id`. The runtime request map is absent until
  reconciliation decides an outcome.
- An op that was `in_flight` with no completion row is marked
  **needs_reconciliation** on recovery (PRD §5).
- Each verb's `reconcile` is passed the ledger's **correlation key and
  desired-effect hash**; it queries the fake remote and resolves to exactly one of
  **done** | **failed** | **resubmit** | **escalate** — one test per branch (PRD §5).
- Reconcile returns **done only when observed remote state matches the desired-effect
  hash**; a same-correlation but **mismatched** desired-effect hash does not resolve
  `done` — it resubmits / fails / escalates per fake policy (debate finding — the
  hash is behavioral, not decorative).
- A `resubmit` outcome reuses the original idempotency key and mints a **new**
  request id (idempotent, no double-effect) (PRD §5).
- **Idempotency survives SQLite loss via the ledger** (debate finding): after
  recovery, resubmitting the same `(verb, idempotency_key)` resolves to the original
  `op_id` and creates no second ledger entry.

## Constraints

- The ledger lives in the task's markdown, written through the Epic 003 single-writer
  store; SQLite is the rebuildable derived state (PRD §5, §6.1).
- Reconciliation is a state machine over the Epic's state model:
  `in_flight →(crash) needs_reconciliation → (done|failed|resubmit|escalate)`; a verb
  with no reconcile path could not have registered async (Story 001), so every
  reconcilable op has a path (PRD §5).
- The old ephemeral `request_id` is **never trusted** across a crash — that is the
  whole point of reconciliation querying real remote state (PRD §5, §6.1).
- The "remote state" is a fake the test scripts (matching / mismatching the
  desired-effect hash, or each outcome) — fake broker per phases.md Phase 1.

## Verification Gate

- `npm test` green for `src/broker/reconcile.test.ts`, including a simulated crash
  (drop SQLite runtime rows, keep markdown ledger) for each reconcile outcome and the
  hash-match / hash-mismatch cases.

### Task T1 - Ledger entry (no request id) + recover durable identity

**Input:** `src/broker/ledger.ts`, `src/broker/ledger.test.ts`

**Action - RED:** Write tests: (a) submitting an async op writes a ledger entry with
all PRD §5 identity fields and **no** `request_id` into the task markdown; (b) after
dropping SQLite runtime rows and keeping the ledger, `recoverFromLedger`
reconstructs each op's durable identity + status **without** an old `request_id`, and
an interrupted `in_flight` op is marked `needs_reconciliation`; (c) resubmitting the
same `(verb, idempotency_key)` after recovery returns the original `op_id` with no
second ledger entry.

**Action - GREEN:** Implement `writeLedgerEntry` (via Epic 003 store, no request id)
and `recoverFromLedger` reconstructing durable identity + status and the
`(verb, idempotency_key) → op_id` dedup from the ledger.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Reconcile with desired-effect hash: done/failed/resubmit/escalate

**Input:** `src/broker/reconcile.ts`, `src/broker/reconcile.test.ts`

**Action - RED:** Write a test simulating a crash (in-flight op, dropped SQLite rows,
markdown ledger intact): after `recoverFromLedger` the op is `needs_reconciliation`;
then a fake verb `reconcile` (passed the correlation key + desired-effect hash) is
scripted to each branch: **done** only when observed matches the desired-effect hash;
a **mismatched** hash does **not** resolve `done`; **failed**; **resubmit** (assert
original idempotency key reused, a new request id minted, no double-effect); and
**escalate** (assert a broker escalation-needed event).

**Action - GREEN:** Implement the reconcile state machine calling the verb's
`reconcile` with correlation + desired-effect hash and applying the resolved outcome
(write completion only on hash-matched done; mark failed; resubmit idempotently;
emit escalation-needed).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
