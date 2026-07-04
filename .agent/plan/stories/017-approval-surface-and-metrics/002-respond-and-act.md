# Story 002 - Respond & Act

Epic: `.agent/plan/epics/017-approval-surface-and-metrics.md`

## Goal

A human response to an inbox item acts through existing seams: approvals
dispatch or fail the pending operation, escalation responses resume or halt the
task; every response is attributed and journaled.

## Acceptance Criteria

- Approving an `approval` item records a durable approval decision, then
  transitions its op `pending → in_flight` — the verb adapter's `submit` runs now
  and not before (Epic 005 state model; ring-3 is the release valve, PRD §4).
- A crash between the recorded decision and the adapter submit fires the effect
  **exactly once**: on restart the op reconciles per Epic 005 with its
  idempotency key (asserted with a simulated crash in that window; debate
  finding).
- Denying resolves the op `failed` with reason `denied`; the adapter never runs;
  the awaiting task's park/failure propagation follows the existing scheduler
  semantics (Epic 004).
- Approving an item whose op is past per-verb expiry is rejected with a typed
  error, the op stays `expired`, and the item auto-resolves as `expired` with a
  journal entry (debate finding — no perpetually-open dead items) (PRD §5).
- Action-kind compatibility is enforced at the RPC boundary: `approve/deny` on an
  escalation item (or `resume/halt` on an approval item) is a typed error
  (debate finding).
- An `escalation` item response of `resume` re-dispatches the parked task;
  `halt` marks the task halted and it is not re-dispatched (Epic 004
  transitions).
- Every response journals actor, timestamp, item id, and action; responding to
  an already-resolved item is a typed conflict error (no double-fire).
- The respond round-trip works through the SU6 Connect control methods
  (in-process client).

## Constraints

- All effects go through Epic 004/005 seams — this Story adds **no** scheduler or
  broker logic, only the response routing (Epic 017 anchor).
- Actor identity in 2A is the operator string supplied on the call (no auth
  until 2B — Epic 017 Non-Goals); the field is mandatory anyway so the audit
  trail is complete from day one.

## Verification Gate

- `npm test` green for `src/inbox/respond.test.ts`.

### Task T1 - Approval responses

**Input:** `src/inbox/respond.ts`, `src/inbox/respond.test.ts`

**Action - RED:** Write tests: (a) approve ⇒ durable decision recorded, op goes
in_flight, the fake adapter's submit runs exactly once; (b) a simulated crash
between decision and submit ⇒ restart reconciles and the effect fires exactly
once (idempotency key asserted); (c) deny ⇒ `failed(denied)`, adapter never
runs; (d) approve on an expired op ⇒ typed error, op stays expired, item
auto-resolves `expired` + journaled; (e) response journaled with actor;
double-respond ⇒ typed conflict; (f) a kind-mismatched action ⇒ typed error.

**Action - GREEN:** Implement approval response routing (durable decision, then
dispatch) to the broker seam with RPC-boundary action typing.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Escalation responses + RPC round-trip

**Input:** `src/inbox/respond.ts`, `src/rpc/inbox-respond.ts`,
`src/inbox/respond.test.ts`, `docs/operator-surface-2a.md` (the documented call
set — named here so the lane check allows it)

**Action - RED:** Write tests: (a) resume ⇒ parked task re-dispatched;
(b) halt ⇒ task halted, not re-dispatched; (c) the full list→respond flow over a
real loopback HTTP socket (status codes + JSON shapes asserted); (d) a control
method configured on a non-loopback bind refuses to serve.

**Action - GREEN:** Implement escalation response routing + the SU6 respond RPC
handlers with the loopback-bind guard, and write the operator surface doc (call
set with example bodies and error shapes).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
