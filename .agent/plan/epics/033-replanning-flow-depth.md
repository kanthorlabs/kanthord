# 033 Re-Planning Flow Depth

## Outcome

Re-planning (PRD §7.5) becomes a first-class, exercised path instead of a
design note: a running task can raise a **replan signal** (and a blocked
out-of-scope write can be converted into one), the feature enters a replanning
state that halts new dispatch, the human edits the authored files and signs off
a recompile, and the **affected subgraph** re-opens deterministically —
affected in-flight tasks park for rebase, affected completed exit gates
re-open with a rework marker, unaffected tasks continue untouched. The
affected-set computation is a named, exported seam (Epic 037 reuses it), and
the whole loop runs as a named harness scenario under `breaking_allowed`.

## Decision Anchors

- phases.md Phase 3 Deliverable 1 — "re-planning flow (§7.5) exercised and
  polished under `breaking_allowed`".
- PRD §7.5 — discovering task signals feature-level → plan diff → human
  approves → affected downstream gates re-open, tasks rebase/rework; same
  drift-detection shape as ticket drift.
- PRD §4 — a blocked out-of-scope write is a re-planning signal.
- PRD §7.1.1 pipeline — re-planning always edits authored files and recompiles;
  dirty ⇒ halt new dispatch; generation `G+1` on recompile (Epic 002/004
  mechanics reused).
- Epic 026 (`plan.approveReplan`) and Epic 027 (re-planning diff approval UI) —
  the approval surfaces already exist; this Epic supplies the daemon-side flow
  behind them.

## Stories

- `001-replan-signal.md` — a running task raises a typed feature-level replan
  signal (reason + proposed change + affected artifacts); the feature enters
  `replanning` (new dispatch halted **by the replanning state itself** — the
  dispatch predicate gains it alongside the dirty flag, since the signal
  precedes any file edit; debate finding — reusing only the dirty flag would
  leak dispatch between signal and edit); running tasks stay
  generation-pinned; the human can convert a scope-violation escalation into
  a replan signal.
- `002-affected-subgraph-reopen.md` — after the approved recompile mints
  `G+1`, the exported affected-set seam (keyed by stable frontmatter id, with
  `added`/`removed` verdicts and an `invalidated` verdict for feature-
  invariant changes — debate findings) drives an **idempotent, durably
  marked** re-open application: affected in-flight parks for rebase (session
  torn down, leases released), affected done exit gates re-open with a rework
  marker and their published artifacts invalidated for consumers, unaffected
  nodes untouched.
- `003-replan-harness-scenario.md` — named scenario `p3-replan-loop`: golden
  feature mid-run → replan signal → approval → `G+1` → subgraph re-opens →
  feature completes; plus the abort path (human rejects the diff ⇒ feature
  resumes under `G` unchanged); kill-and-restart injected at **every**
  transition point of the loop (debate finding — one crash point was too
  narrow).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites
  (hermetic; harness composition for 003).
- A replan signal from a running task parks the feature's **new** dispatch
  within one scheduler poll; already-running tasks continue under their pinned
  generation (asserted both ways).
- Converting a scope-violation inbox item into a replan signal produces the
  same feature state as a task-raised signal, and the interaction is captured
  typed (Epic 017).
- After recompile: a task whose node text changed re-opens; a task downstream
  of a changed artifact re-opens; a task in an untouched parallel lane does
  not — each asserted by id against the affected-set seam's output **and** the
  scheduler's observed behavior.
- Rejecting the diff leaves the **execution-affecting state** — generation,
  gate states, task states, lease ownership — field-by-field identical to the
  pre-signal snapshot (debate finding — journals, inbox records, and
  timestamps are exempt: the rejection itself is journaled).
- `p3-replan-loop` passes on the harness with `contract_policy:
  breaking_allowed` and zero network.

## Dependencies

- **Epic 031** (setup gate).
- **Epics 002/004** (compile/generation + generation-pinned dispatch — the
  mechanics this flow drives), **Epic 003** (authored-file store), **Epic
  026/027** (approval surfaces), **Epic 017** (typed interactions), **Epic
  010** (harness — composed, never duplicated).

## Non-Goals

- No automatic plan editing — the human (or an external planner) edits files;
  kanthord only signals, diffs, recompiles, and re-opens (PRD §1).
- No `draft_ok` semantics (Epic 038) and no continuation optimization
  (Epic 037) — this Epic's re-open behavior is the conservative baseline those
  epics refine.
- No contract-lint for `backward_compatible` policy — the policy flip is
  post-MVP (PRD §9).

## Findings Out

- none. The affected-set seam's contract is documented where it lives and
  asserted by Story 002; Epic 037 consumes it as a code seam, not a findings
  file.
