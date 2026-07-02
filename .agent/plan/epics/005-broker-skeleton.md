# 005 Broker Skeleton (fake, always-async)

## Outcome

The always-async broker seam: a yaml **verb registry** (one entry per verb with
tier/timeout/idempotency/retry), a typed **async-verb adapter** interface
(`submit`, `poll_status`, terminal states, `reconcile`), a **poll lifecycle** that
advances in-flight operations on the fake clock and writes completion into SQLite
(the sink the scheduler reads), **idempotency keys** on mutating calls, a **durable
operation ledger** in the task's markdown, and a **crash-reconciliation** state
machine that rebuilds runtime requests from the ledger and drives each interrupted
op to done | failed | resubmit | escalate. Everything runs against a **fake**
broker that models success / failure / timeout / regression — no real verb, no
network, no credentials.

## Decision Anchors

- PRD §5 — always async: every call returns a request id; completion is written
  into SQLite; the scheduler wakes the task (one wake-up mechanism).
- PRD §5 — completion detection is **poll-only**: each async verb declares a
  `poll_status` adapter; a broker poller advances in-flight ops at per-verb
  intervals and writes completion into SQLite. Each async verb declares `submit`,
  `poll_status`, terminal states, backoff, timeout + escalation, rate-limit
  behavior, and **whether observed state can regress**.
- PRD §5 — crash reconciliation via a **durable operation ledger** in synced
  markdown (`op_id`, verb, `idempotency_key`, external correlation, desired-effect
  hash, status); SQLite maps `op_id → request_id` and is rebuildable; **a verb with
  no reconcile path cannot be async**.
- PRD §5 — idempotency keys on every mutating call; pending requests **expire**
  per-verb; the verb registry's `tier` column is the approval matrix.
- phases.md Phase 1 Deliverable 3 — verb registry (yaml), always-async submit/poll
  lifecycle, idempotency keys, durable ledger entries in markdown, reconciliation
  state machine — all against the **fake** broker.

## Operation state model (fixed here; every Story references it)

Debate finding — an always-async broker needs an explicit state model so "pending
expiry" and "rebuild" mean something precise:

- `pending` — the op exists (ledger entry written, idempotency reserved) but has
  **not** been submitted to the remote yet (e.g. an `approval_required` verb awaiting
  approval, or a not-yet-dispatched op). **Expiry applies here** (a stale pending op
  must never fire — PRD §5). No `request_id` yet.
- `in_flight` — the adapter `submit` ran; a `request_id` exists (SQLite-only,
  ephemeral, never synced); the poller advances it.
- `done` / `failed` — terminal; a completion row is written.
- `expired` — a `pending` op past its per-verb window; terminal, never fired.
- `needs_reconciliation` — set on restart for an op that was `in_flight` with no
  completion row; its old `request_id` is **not trusted** (it was ephemeral).
  Reconcile drives it to `done` | `failed` | `resubmit` | `escalate`; a new
  `request_id` appears **only** through an idempotent `resubmit`.

## Stories

- `001-verb-registry-and-adapter.md` — load the yaml verb registry; the async-verb
  adapter interface; the rule "a verb with no reconcile path cannot be async."
- `002-async-submit-idempotency.md` — submit returns `op_id`/`request_id`;
  idempotency key on mutating calls; a retried submit with the same key does not
  double-submit.
- `003-poll-lifecycle.md` — the poller advances in-flight ops on the fake clock per
  per-verb interval; `poll_status` → terminal; completion written to SQLite; backoff,
  timeout→escalation, rate-limit, and observed-state-regression handling.
- `004-ledger-and-reconciliation.md` — durable ledger entry in task markdown;
  `op_id → request_id` rebuildable; on restart rebuild from ledger, mark interrupted
  ops needs-reconciliation, drive each to done | failed | resubmit | escalate.
- `005-pending-expiry.md` — pending requests expire per-verb (a 3-day-old pending op
  must not fire surprisingly).
- `006-ledger-projection.md` — bump `PROJECTION_CONTRACT_VERSION` to add the
  operation-ledger to the markdown→SQLite projection (Epic 003 reserved this) and
  assert ledger rebuild-equivalence: the ledger rebuilds from markdown into the shadow
  store equal to the live projection. *(Added per the Phase-1 comparison debate —
  closes gap B3: Epic 003 v1 excluded the ledger and deferred the bump to Epic 005,
  but no story owned it; the Phase-1 "rebuild == projection" gate must cover
  markdown-derived ledger state.)*

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- Submitting a fake async verb returns an `op_id`; the poller (on the fake clock)
  advances it to a terminal state and writes a completion row keyed by `op_id`.
- A resubmit with the same idempotency key yields the same `op_id` and does not
  create a second in-flight operation.
- Registering a verb declared async with no `reconcile` adapter is rejected with a
  diagnostic naming the verb.
- After a simulated crash (drop SQLite runtime state, keep the markdown ledger),
  reconciliation recovers the **durable operation identity** from the ledger (op_id,
  verb, idempotency key, correlation, desired-effect hash, status) — **not** the old
  `request_id` — marks the interrupted op needs-reconciliation, and the fake reconcile
  path (passed the desired-effect hash) resolves it to one of done | failed |
  resubmit | escalate; a new `request_id` appears only via idempotent resubmit (each
  branch asserted).
- Reconcile marks `done` **only** when the fake remote's observed state matches the
  ledger's desired-effect hash; a same-correlation but mismatched-hash remote does
  not resolve `done` (it resubmits/fails/escalates per fake policy).
- A fake verb whose observed state regresses, one that times out, and one that hits
  a rate limit each drive the documented per-verb behavior (asserted).
- A pending op past its per-verb expiry is expired, not fired.
- After Story `006`, `rebuildFromMarkdown` reconstructs the operation-ledger rows into
  a shadow store equal to the live store's ledger projection (per the bumped Epic 003
  contract), closing the "rebuild == projection" gate for ledger state (PRD §6.1).

## Dependencies

- **Epic 001** (SQLite store + migration, injectable clock, yaml registry loader,
  jsonl).
- **Epic 003** (markdown feature store — the durable ledger entries are written into
  the task's markdown through the single-writer store; and the projection contract +
  `rebuildFromMarkdown` that Story `006` extends).
- **Epic 004** (the completion-row table + `blocked_on` contract the scheduler reads;
  Epic 005 writes real completion rows to that same table — created by Epic 004
  Story 003). Cross-referenced, not duplicated.

## Non-Goals

- No **real** broker verbs (`git.*`, `github.create_pr`, …) and no network — those
  are Phase 2 (phases.md). Phase 1 ships the lifecycle + reconciliation machinery
  against fake verbs only.
- No webhooks / inbound network surface — completion detection is poll-only,
  webhooks explicitly deferred (PRD §5).
- No secret-pattern scan / budget breaker on outbound content — that is Epic 007
  (ring-1 seams); the broker calls the ring-1 seam but the enforcement lives there.
- No approval-tier *enforcement* UI — the `tier` column is loaded and exposed; ring-3
  approval is Epic 007 / Phase 2.
- **Escalation ownership boundary:** the broker only **emits an escalation-needed
  state/event** (on timeout, or an `escalate` reconcile outcome). It does **not** do
  ring-1 policy enforcement, notification, or approval routing — those are Epic 007 /
  Phase 2 (debate finding — timeout→escalation must not pull escalation workflow into
  the broker).

## Findings Out

- none as a TDD-task output. The verb-adapter interface + ledger-entry shape are
  documented in this Epic's stories and asserted by their tests; Epic 010 wires the
  fake broker into the harness.
