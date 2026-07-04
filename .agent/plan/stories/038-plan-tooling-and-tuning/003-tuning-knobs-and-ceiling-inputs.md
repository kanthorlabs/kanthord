# Story 003 - Tuning Knobs & Ceiling Inputs

Epic: `.agent/plan/epics/038-plan-tooling-and-tuning.md`

## Goal

The tuning surface the first weeks of real operation need: compaction
threshold per model through the policy chain, poll cadences as bounded
operator config, and a readable dataset of everything a future ceiling
auto-tuner would need — captured now, tuned by a human.

## Acceptance Criteria

- Compaction threshold resolves through the Epic 024 chain — task override →
  feature default → repo slot → role default → system default — most specific
  wins, and the value is **keyed by model at every level** (a level's entry
  maps model → threshold; debate finding — tests must prove the model
  participates per level, or "per model" silently becomes "per task/role"):
  each level asserted with two models resolving differently; the resolved
  value drives the Epic 016 compaction trigger on a fake window-usage feed
  (PRD §3.2 — per-model config, not a constant).
- Scheduler poll interval and per-verb broker poll multipliers are operator
  config with documented defaults and hard bounds; a changed value observably
  changes cadence on the fake clock (scheduler + one verb asserted);
  out-of-bounds or non-numeric values are a config load error naming the
  field and bounds. **Recorded deviation** (debate finding — phases.md says
  "poll-interval … tuning per model" and polls are scheduler-wide): the
  per-model reading is deliberately narrowed to ops-level knobs; the
  decision record in this Epic's Findings Out states the rationale and what
  a true per-model polling policy would require, so the deviation is
  reviewable, not buried.
- Ceiling-input records are captured **per attempt** (one record per
  session/respawn attempt) plus a per-task aggregate (debate finding —
  aggregate-only hides the sequence a tuner needs): the attempt record
  carries task id, feature id, attempt index, model@version, role, workflow
  phase, configured ceiling, reserved, reconciled actual, model/tool call
  cost split, compaction count, breach flag, final status, human-override
  flag, wall-clock; the aggregate sums per stable task identity (PRD §4).
  Records are append-only jsonl and survive restart.
- The dataset is readable over an Epic 026 read method with per-feature
  filtering; both record shapes have documented examples the tests assert
  against.
- No ceiling is ever changed by anything in this story (inputs only —
  asserted: a full fixture run leaves configured ceilings untouched).

## Constraints

- Ceiling figures come from the Epic 013 ledger (net reserved/reconciled —
  the Epic 029 no-double-counting rule); no parallel accounting.
- jsonl per the storage conventions (PRD §7.1.1 format rules); dataset is
  derived/operational, not plan truth.
- Config load/validation rides the existing config path (Epic 009) — one
  loader.

## Verification Gate

- `npm test` green for `src/ops/tuning.test.ts` and
  `src/metrics/ceiling-inputs.test.ts`; `npm run typecheck` exits 0.

### Task T1 - Threshold resolution + poll knobs

**Input:** `src/ops/tuning.ts`, `src/models/policy-chain.ts` (resolution
entries only), `src/foundations/registry.ts` (config schema entries only —
debate finding: the config artifact is part of the edit), `src/ops/tuning.test.ts`

**Action - RED:** Write tests: (a) five-level precedence for compaction
threshold with two models resolving differently at each level; (b) resolved
value drives the compaction trigger on a fake feed; (c) poll knobs change
observed cadence (scheduler + one verb); (d) bounds violations are load
errors naming field + bounds.

**Action - GREEN:** Add the threshold to the policy chain's resolvable keys
and wire the poll knobs through config.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Ceiling-input dataset

**Input:** `src/metrics/ceiling-inputs.ts`, `src/rpc/read-surfaces.ts`,
`src/metrics/ceiling-inputs.test.ts`

**Action - RED:** Write tests: (a) a fixture run with a respawn yields one
attempt record per attempt (fields per the documented example) plus the
per-task aggregate; (b) append-only across restart; (c) readable via the
control-plane method with per-feature filter; (d) ceilings unchanged after
the run.

**Action - GREEN:** Implement the dataset capture from ledger/scheduler
events and the read method.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
