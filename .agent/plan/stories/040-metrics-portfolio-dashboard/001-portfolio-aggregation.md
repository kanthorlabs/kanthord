# Story 001 - Portfolio Aggregation

Epic: `.agent/plan/epics/040-metrics-portfolio-dashboard.md`

## Goal

One aggregation turns the data the system already captures into the PRD §2
portfolio — per-feature rows, cross-feature trends, honest absences for what
cannot be derived, and a guard flag that fires when improvement hides rework.

## Acceptance Criteria

- Per-feature portfolio rows computed from existing stores with these
  defined formulas: included-interaction count by confirmed type (Epic 029
  exclusion rules); net cost per task and per feature (Epic 013 ledger, the
  no-double-counting rule); **open-to-response latency** (named for what it
  measures — inbox item open → response, aggregated median/max; debate
  finding: it is instrumentation-bounded, not true human decision time, and
  must not claim otherwise); blocked time = sum of park durations (journal
  park/resume events); **rework incidents** — a rework re-open and its
  causing `correction`/`rework` interaction are one incident, deduplicated
  by node + causal link (debate finding — the guard metric must not
  double-count one event seen through two stores); % of nodes completed with
  no human code edits, derived from the Epic 017 edit-detection signal and
  labeled approximate — a node whose completion has **no signal coverage
  reports `unknown`, never "no edit"** (debate finding — absence of evidence
  is not evidence of absence; PRD §2 honesty stance); task completion rate =
  completed / (completed + abandoned).
- A trend series across features orders rows by feature completion time and
  exposes each metric as a series (the shape the web view consumes —
  documented example asserted).
- Manual-annotation fields (human minutes, escaped defects) are settable per
  feature via a control method with **first-class provenance** — actor,
  timestamp, source type (observed/imported/estimated-by-human), and a
  correction history; `unknown` and `annotated` are distinct states and the
  value is reported absent until set — never estimated by the system (PRD §2
  honesty stance; debate finding — manual without provenance still fakes
  authority).
- Exclusion scoping is precise (debate finding): exclusion-flagged
  interactions (`unclassified-artifact-change`, `external`/`blocker`) stay
  out of **automation-benefit metrics** (interaction counts, no-edit share,
  rework), but operational-interruption metrics keep them — blocked time
  still counts an `external`-caused park; excluded items remain separately
  countable.
- The **guard signal is unconditional** (debate finding — PRD §2 makes
  rework the guard, not a side-warning): rework-trend deterioration is always
  surfaced; the "another metric improved while the guard worsened" case is an
  additional, distinct warning annotation (both fixtures asserted, plus the
  deteriorate-with-nothing-improving case).
- A feature with no data yields an explicit empty row (no NaN/zero
  fabrication).

## Constraints

- Aggregation reads existing event/ledger/journal stores only — **no new
  automatic capture points** for derivable metrics and no new counter store
  (PRD §6.1 division of truth; Epic 029 semantics reused); the annotation
  method is a manual input, not a capture point (debate finding — the
  constraint scoped to what it means).
- The annotation method lands as an Epic 026 control-verb-pattern method
  (auditable, typed interaction like any human input).

## Verification Gate

- `npm test` green for `src/metrics/portfolio.test.ts`;
  `npm run typecheck` exits 0.

### Task T1 - Derivable metrics + trends

**Input:** `src/metrics/portfolio.ts`, `src/metrics/portfolio.test.ts`

**Action - RED:** Write tests over a three-feature fixture (events + ledger +
journal): every derivable metric matches hand-computed values per feature;
the trend series matches the documented example shape; exclusions honored;
the empty-feature row is explicit.

**Action - GREEN:** Implement the aggregation with the defined formulas.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Annotations + guard flag

**Input:** `src/metrics/portfolio.ts`, `src/rpc/control-verbs.ts`,
`src/metrics/portfolio.test.ts`

**Action - RED:** Write tests: (a) manual fields absent until annotated, then
persisted with provenance (actor/timestamp/source type) + correction history
+ journaled + reported; (b) the unconditional guard on the worsening-rework
fixture (with and without another metric improving — the improving case adds
the extra annotation), silent on the all-improving fixture; (c) the
annotation call is captured as a typed interaction.

**Action - GREEN:** Implement the annotation method and the guard-flag rule.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
