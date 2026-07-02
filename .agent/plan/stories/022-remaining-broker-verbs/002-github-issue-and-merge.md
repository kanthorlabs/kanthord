# Story 002 - github.create_issue & github.merge

Epic: `.agent/plan/epics/022-remaining-broker-verbs.md`

## Goal

`github.create_issue` (auto-with-audit) and `github.merge` (approval-required —
the first approval-tier verb through the live inbox path) run against the
Epic 014 GitHub double, with merge parked until human approval and reconciled
against real PR state.

## Acceptance Criteria

- `github.create_issue`: idempotency by a **unique marker embedded in the issue
  body** (the op's idempotency key — stable, searchable; title changes never
  affect it; debate finding — title-based matching is fragile); a retry finds
  the existing issue and resolves `done` with its number as correlation;
  reconcile searches by marker **including closed issues**; two issues matching
  one marker ⇒ escalate, never guess.
- `github.merge` registry entry is `tier: approval_required`; submit parks the
  op `pending` (adapter untouched) and creates an Epic 017 approval item naming
  the PR (PRD §5 — the tier column is the approval matrix; §7.4 — merge stays
  human).
- Approval fires the merge exactly once, surviving the crash window (Epic 017
  decision-then-dispatch semantics re-asserted on this verb); denial resolves
  `failed(denied)` with the adapter never called.
- Merge desired effect = PR merged; reconcile of an interrupted merge:
  merged ⇒ `done`; closed-unmerged ⇒ `failed(closed-externally)` +
  escalation-needed; still open ⇒ idempotent resubmit (each branch asserted).
- A `github.merge` op past per-verb expiry cannot fire, and its approval item
  follows the Epic 017 lifecycle — auto-resolves `expired`, journaled, late
  approve/deny rejected typed (Epic 005 expiry on an approval-tier verb — the
  PRD's "3-day-old pending op" case on the scariest verb; debate finding — the
  item lifecycle named, not implied).

## Constraints

- Extends the Epic 014 GitHub double with the SU2/SU3-recorded issue + merge
  surfaces; same injected HTTP seam, same redaction standard.
- Approval routing goes through Epic 017 seams — no bespoke approval logic here.

## Verification Gate

- `npm test` green for `src/broker/verbs/github-issue-merge.test.ts`.

### Task T1 - github.create_issue

**Input:** `src/broker/verbs/github-issue.ts`,
`broker/verbs/github.create_issue.yaml`,
`src/broker/verbs/github-issue-merge.test.ts`

**Action - RED:** Write tests: (a) create + correlation; (b) retry resolves to
the existing issue; (c) reconcile branches (marker found/absent).

**Action - GREEN:** Implement the adapter + registry entry.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - github.merge under approval

**Input:** `src/broker/verbs/github-merge.ts`,
`broker/verbs/github.merge.yaml`,
`src/broker/verbs/github-issue-merge.test.ts`

**Action - RED:** Write tests: (a) submit parks `pending` + approval item;
(b) approve ⇒ merge fires exactly once incl. crash-window; (c) deny ⇒
`failed(denied)`, adapter never called; (d) reconcile branches (merged /
closed-unmerged / open); (e) expired pending merge cannot fire.

**Action - GREEN:** Implement the merge adapter wired through the approval
path.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
