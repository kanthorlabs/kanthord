# 032 Broker Reconciliation Depth

## Outcome

The broker's reconciliation and lifecycle machinery handles the edge cases the
happy path skipped: **state regression** is a declared, per-verb property with
fixed semantics instead of an accident; **rate limits** are a distinct signal
with their own backoff that never burns the failure-retry budget; and
**stale-pending expiry** interacts correctly with downtime, reconciliation, and
already-fired external effects. Every registered MVP verb has an asserted
row in the regression/rate-limit/**expiry** matrix — all three declared
per verb, including the expiry window (debate finding — expiry needs the same
registry-level enumeration as the other two, per PRD §5 "expire per-verb").
"Exhaustive" is scoped honestly (debate finding): the matrix proves every
verb **declares** its reconciliation contract and that declarations drive the
lifecycle on doubles; correctness of a declaration against the live provider
is evidenced by the per-verb citation (below) and, ultimately, by real
operation under Epic 042 — not by this suite.

## Decision Anchors

- phases.md Phase 3 Deliverable 1 — "exhaustive reconciliation edge cases per
  verb (state regression, rate limits, expiry of stale pending ops)".
- PRD §5 — each async verb declares `submit`, `poll_status`, terminal states,
  backoff, timeout+escalation, **rate-limit behavior**, and **whether observed
  state can regress**; pending requests expire per-verb; a verb with no
  reconcile path cannot be async. Note (debate finding): the PRD mandates the
  *declarations*; the uniform lifecycle semantics attached to them
  (regression re-entry bounds, rate-limit budget separation, expiry
  precedence) are **defined by this Epic** — they are new design decided
  here, anchored in the stories' fixed semantics, not retro-claimed from the
  PRD.
- Epic 005 — the op state model (`pending`/`in_flight`/`done`/`failed`/
  `expired`/`needs_reconciliation`) and the fake broker's regression modeling;
  this Epic deepens that machinery, never forks it.
- Epics 014/022 — the real verb adapters and their error taxonomies
  (retryable / terminal / escalate) this Epic extends.

## Stories

- `001-state-regression-depth.md` — per-verb `state_can_regress` semantics:
  regression before terminal re-enters `in_flight` (journaled, bounded);
  regression on a verb that declared it impossible ⇒ `needs_reconciliation` +
  escalation; a terminal `done` never reopens.
- `002-rate-limit-depth.md` — rate-limit responses are classified apart from
  failures: dedicated backoff schedule per verb, no failure-retry budget
  consumed, poll/reconcile stretched under limit, exhaustion window ⇒
  escalation with the op left non-terminal.
- `003-stale-expiry-depth.md` — expiry across downtime (never-submitted
  pending ops expire on restart before any submit), the **submit-intent
  marker** closing the pending-but-maybe-fired crash window (debate finding),
  expiry vs reconciliation precedence (`needs_reconciliation` is never
  silently expired), and the fired-but-expired discovery path (reconcile
  finds a real external effect for an expired op ⇒ escalation with evidence,
  human-resolved).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites (fake
  clock, verb doubles — hermetic).
- The per-verb matrix test enumerates **every verb registered in
  `broker/verbs/*.yaml`** and asserts each declares `state_can_regress`
  (with `max_regressions` mandatory when `true` — debate finding: the bound
  is part of the semantics, no silent global default), a rate-limit behavior,
  and an **expiry window** (debate finding), and that each declared value
  drives the observed lifecycle on the double — a newly registered verb
  without any of the declarations fails the suite. Each declaration cites its
  source (the Epic 011/020 spike findings or the adapter taxonomy note) in
  the verb yaml — traceability, not proof (debate finding).
- A regression observed on a `state_can_regress: true` verb re-enters
  `in_flight` with a journal event; the same observation on a `false` verb
  parks `needs_reconciliation` and raises an inbox escalation.
- A rate-limited submit retries on the rate-limit schedule without decrementing
  the failure-retry budget; failure retries afterwards still have their full
  budget (asserted by count).
- A pending op that crossed its expiry while the daemon was down is `expired`
  on restart with no adapter submit call recorded on the double.
- Reconcile discovering a real external effect behind an `expired` op parks it
  `needs_reconciliation` and raises an escalation carrying the desired-effect
  hash and the observed external state; the **human response** resolves it to
  `done` (world is in the desired state) or `failed` (debate finding —
  auto-`failed` could fail a workflow whose desired effect actually exists;
  this is a product decision, so the human gets the button).

## Dependencies

- **Epic 031** (setup gate passed; SU5 observations may reprioritize but do not
  change this Epic's scope without a decision record).
- **Epics 005, 014, 022** (op state model, real adapters, error taxonomies —
  extended, never duplicated).
- **Epic 017** (inbox for escalations), **Epic 001** (clock).

## Non-Goals

- No new verbs and no webhook/completion-detection changes (poll-only stands,
  PRD §5).
- No auto-retry policy loosening — tiers and retry maxima stay as registered.
- No rate-limit *coordination* across verbs of one integration (a shared
  limiter is post-MVP unless SU5 observations demand it via decision record).

## Findings Out

- none. The per-verb matrix is asserted in tests; registry declarations are the
  documentation.
