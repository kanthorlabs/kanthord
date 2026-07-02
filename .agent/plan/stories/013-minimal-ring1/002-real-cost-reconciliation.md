# Story 002 - Real-Cost Reconciliation

Epic: `.agent/plan/epics/013-minimal-ring1.md`

## Goal

The Epic 007 budget breaker learns reconcile-after: a call is still reserved
conservatively before it runs, and when the provider reports actual cost the
ledger replaces the reservation with the actual, keeping the fail-closed ceiling
exact across calls and respawns.

## Acceptance Criteria

- A model call reserving a conservative amount whose provider later reports a
  lower actual cost frees the difference **only when the report is marked final**
  (per the SU3 finality semantics); a provisional report keeps the conservative
  charge (PRD §4 — actual cost reconciles after; debate finding — no spend race
  on provisional signals).
- A reported actual **higher** than the reservation records the excess; if the
  new cumulative total is **over the ceiling, the task halts and escalates
  immediately** — the breaker does not wait for the next reservation attempt
  (debate finding); otherwise the next reservation breaches at the correct point.
- A call whose provider reports no cost keeps the conservative charge —
  no unbounded spend (PRD §4 conservative ceilings).
- Reconciliation is idempotent and defensive (debate finding): a duplicate
  report for the same reservation adjusts once; a report referencing an unknown
  reservation is a typed error + escalation; ledger replay after respawn does
  not double-adjust.
- The breach check remains **pre-call and fail-closed**: reconciliation never
  un-halts an already-halted task, and a breach still halts before the breaching
  call executes (Epic 007 semantics unchanged).
- The sequence split across a respawn breaches at the same cumulative point —
  reconcile entries are part of the durable ledger and survive respawn
  (PRD §4 stable task identity; Epic 007 property).

## Constraints

- Extends the Epic 007 ledger — same durable storage (task markdown via the
  store seam), new entry kind `reconcile` referencing the reservation entry; do
  not fork a second ledger (Epic 013 anchor: extended, not rebuilt).
- The provider cost signal arrives through the pi cost surface recorded in the
  Epic 011 SU3 findings; in tests it is a Mock reporting Story-named values
  (PROFILE.md fake/mock style).

## Verification Gate

- `npm test` green for `src/ring1/budget-reconcile.test.ts`.

### Task T1 - Reconcile entries adjust the cumulative total

**Input:** `src/ring1/budget-reconcile.ts`, `src/ring1/budget-reconcile.test.ts`

**Action - RED:** Write tests: (a) reserve 10, final actual 4 ⇒ next call
reserving 7 under a ceiling of 12 proceeds; (b) provisional actual 4 ⇒ the
conservative 10 stands; (c) reserve 10 under ceiling 12, final actual 15 ⇒
immediate halt + escalation at reconcile time; (d) no reported cost ⇒
conservative charge stands; (e) duplicate report adjusts once; (f) unknown
reservation reference ⇒ typed error + escalation.

**Action - GREEN:** Implement the `reconcile` ledger entry (with finality flag
and reservation reference) and the cumulative computation with the immediate
over-ceiling halt.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Respawn survival + fail-closed preserved

**Input:** `src/ring1/budget-reconcile.ts`, `src/ring1/budget-reconcile.test.ts`

**Action - RED:** Write tests: (a) reservations + reconciles split across an
Epic 006 respawn breach at the same cumulative point; (b) a halted task stays
halted when a late low actual arrives.

**Action - GREEN:** Ensure reconcile entries persist through the durable ledger
and the halt state is not recomputed downward.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
