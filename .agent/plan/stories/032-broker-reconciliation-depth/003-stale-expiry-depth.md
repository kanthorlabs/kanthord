# Story 003 - Stale-Expiry Depth

Epic: `.agent/plan/epics/032-broker-reconciliation-depth.md`

## Goal

Pending-op expiry is correct across downtime and never races reconciliation:
a stale op that never fired expires before it can fire, an op that might have
fired is reconciled instead of expired, and an expired op discovered to have
real external effects escalates with evidence.

## Acceptance Criteria

- A `pending` op whose per-verb expiry window elapsed **while the daemon was
  down** is marked `expired` during restart recovery **before** the submit
  path runs — the double records zero submit calls for it (PRD §5: a
  3-day-old pending op must not fire surprisingly).
- **Submit-intent marker** (debate finding — the dangerous crash window is
  "locally pending, externally maybe-fired"): the ledger records
  `submit_started` durably **before** the adapter's submit call; recovery
  treats a `pending` op carrying `submit_started` as ambiguous ⇒
  `needs_reconciliation`, never the expiry sweep — only pending ops with no
  submit intent are expiry-eligible (asserted with a crash injected between
  the marker write and the adapter call).
- Expiry never touches `needs_reconciliation`: an op in that state whose
  window has elapsed stays `needs_reconciliation` until its reconcile path
  resolves it (precedence asserted with both orderings on the fake clock).
- An op that was `in_flight` at crash is reconciled (Epic 005 path), never
  expired, regardless of elapsed time.
- Reconcile discovering a real external effect correlated to an op previously
  marked `expired` parks it `needs_reconciliation` and raises an inbox
  escalation carrying the desired-effect hash, the correlation key, and the
  observed external state; the **human response resolves it** to `done` (the
  world is in the desired state) or `failed` — never a silent automatic
  terminal (debate finding — auto-`failed` could fail a workflow whose
  desired effect exists; the anomaly is journaled either way, and this is the
  one sanctioned terminal transition out of `expired`).
- `expired` ops never wake a blocked task as success: the dependent task's
  `blocked_on` resolution surfaces the expiry as a failure outcome (Epic 004
  park/resume contract).
- Expiry sweep results are journaled per op (op id, verb, window, swept-at).

## Constraints

- Extend the Epic 005 expiry story's sweep and the restart recovery ordering
  in the Epic 009 boot path — recovery order: ledger rebuild → reconcile
  marking → expiry sweep (this ordering is the mechanism under test; PRD §5).
- Fake clock; doubles; temp stores (hermetic).

## Verification Gate

- `npm test` green for `src/broker/expiry-depth.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Downtime expiry + precedence

**Input:** `src/broker/expiry.ts`, `src/daemon/boot.ts`,
`src/broker/expiry-depth.test.ts`

**Action - RED:** Write tests: (a) pending op past its window at restart is
`expired` with zero submit calls on the double; (b) `needs_reconciliation`
op past its window is untouched by the sweep (both orderings); (c) in-flight
op at crash reconciles regardless of elapsed time; (d) sweep journal entries
carry op id/verb/window/swept-at; (e) a crash between the `submit_started`
marker and the adapter call recovers to `needs_reconciliation`, not
`expired` (the ambiguity window closed).

**Action - GREEN:** Implement the recovery-ordered sweep (ledger rebuild →
reconcile marking → expiry) in the boot path.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Fired-but-expired discovery + dependent wake

**Input:** `src/broker/reconcile.ts`, `src/broker/expiry.ts`,
`src/broker/expiry-depth.test.ts`

**Action - RED:** Write tests: (a) reconcile finding a correlated external
effect behind an `expired` op parks it `needs_reconciliation` with the
evidence-carrying escalation; the human resolution to `done` and to `failed`
each terminalize with the anomaly journaled; (b) a task `blocked_on` an op
that expires receives a failure outcome, not success, on its resume.

**Action - GREEN:** Implement the fired-but-expired reconcile branch and the
expiry→blocked-task failure propagation.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
