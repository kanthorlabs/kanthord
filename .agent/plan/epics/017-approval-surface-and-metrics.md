# 017 Basic Approval Surface & Interaction Metrics Capture

## Outcome

The ring-3 human loop, minimally: **escalations and approval-required operations
become durable inbox items** a human can list and respond to over the Connect API
(the 2A methods from Epic 011 SU6 — usable with plain `curl` via Connect's
HTTP/JSON, no client build), responses **resume, dispatch, or halt** the affected
task/operation through existing seams, and **every human interaction is captured
as a typed metric event** — system-proposed type, human-confirmed category, cost
attribution — the raw data PRD §2's portfolio is built from. This is the surface
the 2A proof drives (escalate-all-diffs lands here); the full dashboard is Phase
2B.

## Decision Anchors

- phases.md Phase 2A Deliverable 6 — basic approval surface + basic metrics:
  ring-3 approval over the Phase-1 status API (minimal UI or CLI); every human
  interaction captured with typed classification and cost attribution.
- PRD §4 ring 3 — human approval for irreversible/external actions per the verb
  registry tier; PRD §5 — the `tier` column is the approval matrix; pending
  approvals expire per-verb.
- PRD §2 — every human interaction carries a coarse approximate type; the system
  **proposes** the type from observable signals and the human **confirms** during
  the approval they are already doing; escalation events double as metric events;
  classification is never authoritative.
- PRD §3 (Layer 2) — Connect serves HTTP/JSON natively; the minimal 2A surface is
  the API itself, documented curl calls stand in for a client (the CLI/web
  clients ship from separate bakes — PROFILE.md).

## Stories

- `001-escalation-approval-inbox.md` — ring-1/broker escalation events and
  `approval_required` operations land as durable inbox items with evidence
  references; listable via the SU6 read method; unresolved items survive daemon
  restart.
- `002-respond-and-act.md` — responding to an item through the SU6 control
  methods acts through existing seams: approve dispatches the pending op, deny
  fails it, escalation responses resume or halt the task; every response is
  recorded with actor + timestamp.
- `003-interaction-capture.md` — each inbox response becomes a typed interaction
  event: proposed type from observable signals, human-confirmed category, task
  cost attribution; `unclassified-artifact-change` items are tagged excluded from
  the automation metric.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- A ring-1 out-of-scope-write escalation (Epic 015) and a broker
  timeout-escalation (Epic 005) each appear as inbox items carrying the emitting
  event's evidence; a submitted `approval_required` fake verb parks `pending` and
  appears as an approval item (Epic 005 state model — `pending` until approval).
- Inbox items survive a daemon kill/restart (rebuilt from durable state, not
  RAM — asserted through the Epic 009 entrypoint).
- Approving the parked op records a **durable approval decision first**, then
  dispatches; a crash between the decision and the adapter submit is recovered by
  the Epic 005 reconcile path with the op's idempotency key, so the effect fires
  **exactly once** across the crash (debate finding — the hard case is the crash
  window, asserted, with the Epic 005 idempotency mechanism cited as the
  guarantee).
- Denying resolves it `failed` without the adapter running; an approval item
  whose op has passed per-verb expiry cannot be approved — the item auto-resolves
  as `expired` and the transition is journaled (debate finding — dead items must
  not sit open forever) (PRD §5 — a stale pending op must never fire).
- Responses are kind-typed at the RPC boundary: `approve/deny` are valid only on
  approval items, `resume/halt` only on escalation items; a mismatched action is
  a typed error (debate finding — one inbox needs action-compatibility rules).
- An escalation response `resume` re-dispatches the parked task; `halt` marks it
  halted; both are journaled with actor + timestamp.
- Inbox item ids are **deterministic** (derived from the source event/op id), so
  a restart rebuild is idempotent and a resolved item stays resolved — resolution
  is durable state, never recomputed away (debate finding).
- Each response produces an interaction event with: proposed type (per the
  data-driven signal map), the human's category — **required on every response**,
  as either an explicit accept-of-proposal or an override (debate finding + PRD
  §2: the human confirms during the approval they are already doing; recording
  accept-vs-override keeps the bias signal) — task id, and cost-to-date =
  the task's cumulative ledger total at response time (missing ledger ⇒ 0 +
  `no-ledger` flag; debate finding — attribution defined, not hand-waved); the
  events are jsonl (format rules) and queryable per feature.
- The full list/respond round-trip is exercised through the Connect methods over
  a **real loopback HTTP socket** (status codes and JSON shapes asserted — the
  curl-equivalent surface proven at the HTTP level, not internal calls only;
  debate finding), and the control methods refuse to serve on a non-loopback
  bind in 2A (debate finding — approval endpoints dispatch external actions).
- The **operator surface doc** exists: the exact call set (URLs, verbs, example
  request/response bodies, error shapes) for list/respond — the "minimal CLI"
  deliverable is this documented call set, an accepted interpretation recorded
  here (debate finding — bare "curl can reach it" is not an operator surface).

## Dependencies

- **Epic 011 SU6** (control-method stubs — blocks the RPC halves of Stories
  001–002). **Epic 005** (op state model + escalation-needed events), **Epic 007/
  013/015** (escalation event sources + cost ledger), **Epic 009** (Connect
  server + restart entrypoint), **Epic 004** (park/resume/halt transitions).

## Non-Goals

- No web client, no UI rendering — Phase 2B (Epics 026/027); 2A's surface is the
  documented HTTP/JSON call set.
- No auth on the control methods beyond loopback binding — Basic-auth/TLS/VPN
  arrive with the 2B exposure (Epic 026); 2A runs operator-local (PRD §9 knob
  stays "VPN-only" for the exposed phase).
- No metrics **portfolio/aggregation views** — capture only; the per-feature
  summary is Epic 029, trends are Phase 3 (PRD §2).
- No approval-latency SLO/nudging — assumption #10 (human reachable) stands.

## Findings Out

- none. The inbox item shape and interaction-event schema are documented in the
  stories and asserted by tests; Epics 026/029 read them.
