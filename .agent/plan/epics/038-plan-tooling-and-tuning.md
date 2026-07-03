# 038 Plan Tooling & Tuning Knobs

## Outcome

The remaining Deliverable-3 optimizations: **`draft_ok` edge semantics** let an
opted-in consumer start against a draft contract and get a deterministic
rework signal when the final artifact differs; **`kanthord renumber`** moves a
task's plan/state/journal trio (or a story directory) atomically so
renumbering is a normal re-planning operation instead of a hand-executed risk;
and the **tuning knobs** arrive — compaction threshold resolved per model
through the policy chain, scheduler/broker poll intervals as operator config,
and the **cost-ceiling auto-tuning inputs** captured as a readable per-task
dataset (inputs only; auto-tuning itself stays out).

## Decision Anchors

- phases.md Phase 3 Deliverable 3 — "`draft_ok` edge semantics where rework
  risk is acceptable; poll-interval and compaction-threshold tuning per model;
  cost-ceiling auto-tuning inputs; `kanthord renumber`".
- PRD §7.3 — dependency semantics per edge: `frozen` (default) | `draft_ok`
  (downstream may start against a draft contract — parallelism vs. rework
  risk, opt-in).
- PRD §7.1.1 §4 — filename = position, id = identity; `kanthord renumber`
  moves a task's file trio atomically; a rename is a plan change (dirty flag).
- PRD §3.2 — compaction threshold is per-model config, not a constant; PRD §8
  — the resolution chain (task → feature → repo slot → role → system).
- PRD §9 — budgets: finer tiers logged now, auto-tune later ⇒ this Epic
  captures the tuning *inputs*, never adjusts a ceiling.
- Epic 033/037 — the re-open/rework machinery `draft_ok` reuses for its rework
  signal (one mechanism).

## Stories

- `001-draft-ok-semantics.md` — a `draft_ok` consumer dispatches on the
  publisher's explicit durable `draft_published` record (debate finding —
  never on an artifact file's mere existence), pinning the draft hash at
  dispatch; on publisher exit: final hash equal to the pinned draft ⇒ the
  consumption finalizes silently (journaled); different ⇒ the consumer gets
  the rework re-open (Epic 033 machinery) with both hashes and its
  already-emitted external ops as evidence; `frozen` edges are byte-for-byte
  unaffected (default asserted).
- `002-kanthord-renumber.md` — `kanthord renumber` moves a task trio or story
  directory to a new number/lane: staged then committed all-or-nothing (a
  failure mid-move leaves the original intact), ids and id-based references
  untouched, grammar re-validated after the move, dirty flag tripped
  (a rename is a plan change), refusal cases (target collision, malformed
  target name) exit non-zero with planner-vocabulary messages.
- `003-tuning-knobs-and-ceiling-inputs.md` — compaction threshold resolves
  per model through the Epic 024 policy chain (most specific wins, asserted at
  every level); scheduler poll interval and per-verb broker poll multipliers
  are operator config with documented defaults and bounds; every task run
  appends a ceiling-input record (task id, model, ceiling, reserved,
  reconciled actual, breach flag, respawn count) to a jsonl dataset readable
  over the Epic 026 surface.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites
  (hermetic).
- A `draft_ok` consumer dispatches on the publisher's `draft_published`
  record (not a bare file) with the pinned hash journaled; a `frozen`
  consumer in the same fixture stays blocked (both asserted).
- Publisher finishing with the pinned hash finalizes the consumer's
  consumption without re-open; finishing with a different hash re-opens the
  consumer with both hashes + emitted-ops evidence — and the re-open goes
  through the Epic 033 path (no second mechanism).
- `kanthord renumber`: a successful move relocates exactly the trio, trips the
  dirty flag, and the next compile is clean with unchanged node ids; an
  injected crash at any stage boundary recovers via the durable marker to one
  consistent state (debate finding — multi-file atomicity is marker-based);
  a collision refusal names both files in planner vocabulary; a lint-breaking
  move needs `--allow-invalid`.
- Compaction threshold: a task-level model override, feature default, repo
  slot, role default, and system default each win in precedence order
  (asserted per level); the resolved threshold drives the Epic 016 compaction
  trigger on a fake window-usage feed.
- Poll knobs: changed intervals observably change fake-clock poll cadence for
  scheduler and one verb; out-of-bounds config is rejected at load.
- The ceiling-input dataset for a fixture run contains one record per task
  respawn-inclusive lifecycle with the asserted fields, and is readable over
  the control-plane read method.

## Dependencies

- **Epic 031** (setup gate).
- **Epic 033** (re-open machinery), **Epic 008/028** (artifact gates),
  **Epic 003** (file trio store), **Epic 002** (grammar/compile + dirty
  flag), **Epic 024** (policy chain), **Epic 016** (compaction trigger),
  **Epic 013** (ledger fields), **Epic 026** (read surface).

## Non-Goals

- No auto-tuning of ceilings or intervals — inputs and knobs only (PRD §9
  future flip).
- No `draft_ok` as default — `frozen` stays the default semantics (PRD §7.3).
- No renumber of ids — ids are identity, forever (PRD §7.1.1 §4).

## Findings Out

- `.agent/plan/feedback/038-plan-tooling-and-tuning/poll-interval-decision.md`
  — the recorded deviation (debate finding): phases.md's "poll-interval …
  tuning per model" is implemented as ops-level knobs because polls are
  scheduler-wide; the note states the rationale and what a real per-model
  polling policy would take, for future review.
- Knob names, bounds, and the ceiling-input record shapes are documented with
  the config/dataset definitions and asserted by tests.
