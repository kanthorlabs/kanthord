# 037 Dirty-Plan Continuation & Compatibility Check

## Outcome

The §7.1.1 continuation optimization lands: when a dirty plan recompiles to
`G+1`, a task already running under `G` **continues** if the edit lies outside
its node, its dependencies, its acceptance criteria, its consumed artifacts,
and the feature-level invariants — computed by the Epic 033 affected-set seam —
instead of the conservative park-everything baseline. Continuation is an
optimization, not a safety promise: any task that finishes against a
superseded generation must pass the **post-completion compatibility check
against the latest generation before its PR may merge**, and a failed compile
still falls back to halting the whole feature.

## Decision Anchors

- phases.md Phase 3 Deliverable 3 — "generation-pinned task continuation on
  dirty plans with the post-completion compatibility check (§7.1.1)".
- PRD §7.1.1 pipeline — the continuation rule verbatim (outside node AND
  dependencies, ACs, consumed artifacts, feature invariants); continuation is
  an optimization, **not** a safety promise; the merge-gating compatibility
  check; compile failure ⇒ halt the whole feature.
- Epic 004 Story 004 — generation-pinned dispatch (the conservative baseline
  this Epic refines; dirty still halts **new** dispatch, unchanged).
- Epic 033 — the affected-set seam is computed there and **reused here**; two
  implementations of "what did this edit touch" would drift (constraint, not
  choice).

## Stories

- `001-continuation-decision.md` — on recompile to `G+1`, each running task is
  kept (edit fully outside its affected set) or parked-for-rebase (anything
  else, including any doubt — fail-closed); the decision and its reason are
  journaled per task; compile failure halts the feature (baseline preserved,
  asserted).
- `002-post-completion-compat-check.md` — a task completing under a
  superseded `G` enters `awaiting_compat_check`: its node definition,
  dependency set, consumed artifact hashes, and ACs are compared between its
  pinned `G` and the latest generation; identical ⇒ merge unblocked; different
  ⇒ rework escalation with the diff as evidence; the check result is journaled
  and the `github.merge` approval is blocked until pass (tier mechanics
  unchanged).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites
  (hermetic; harness composition).
- An edit to an untouched parallel lane while a task runs: the task continues
  under `G` and completes; the journal records the keep decision with the
  affected-set evidence.
- An edit to the running task's node, to a dependency, to a consumed
  artifact, and to the epic Acceptance section (feature invariant) each park
  that task for rebase — four separate asserted cases.
- The continuation decision uses the **same seam** as Epic 033's re-open (one
  implementation — asserted by import/structure test or equivalent proof named
  in the Story).
- A task finishing under superseded `G` with an unchanged affected set passes
  the compat check and its merge approval unblocks; with a changed dependency
  or feature invariant it fails, raises a rework escalation carrying the
  diff, and merge stays blocked (asserted end-to-end on the harness). The
  gate is **merge-effectiveness**: a pre-issued approval is suspended by
  supersession, and the completion→awaiting-check→merge-block transition is
  one durable unit across crashes (debate findings).
- A recompile whose compile fails halts the whole feature (fallback
  asserted).
- Named harness scenario `p3-continuation-compat` covers keep + park + compat
  pass + compat fail in one deterministic run.

## Dependencies

- **Epic 031** (setup gate).
- **Epic 033** (affected-set seam — hard dependency; this Epic must not fork
  it), **Epics 002/004** (compile/generation, pinned dispatch), **Epic 022**
  (`github.merge` approval mechanics), **Epic 017** (escalations), **Epic
  010** (harness).

## Non-Goals

- No relaxation of "dirty halts new dispatch" — only *running* tasks gain
  continuation (PRD §7.1.1).
- No semantic code-level compatibility analysis — the check compares plan-
  level definitions and artifact hashes, not produced code (PRD §7.1
  non-guarantees).
- No `draft_ok` semantics — Epic 038.

## Findings Out

- none.
