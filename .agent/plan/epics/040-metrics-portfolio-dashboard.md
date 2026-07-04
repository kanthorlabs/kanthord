# 040 Metrics Portfolio in the Dashboard

## Outcome

The PRD §2 metrics portfolio becomes visible and decision-driving: a
**portfolio aggregation** computes, per feature and as trends across features,
every metric derivable from data the system already captures (typed
interaction counts, cost per task/feature, approval latency, blocked time,
rework count, % of nodes completed with no human code edits, task completion
rate), keeps the non-derivable portfolio entries (human minutes, escaped
defects) as explicit manual-annotation fields rather than fake numbers, and
runs the **rubber-stamp analysis** that clusters fast, unmodified approvals
into named policy-knob candidates. The dashboard grows portfolio-trend and
rubber-stamp views on the existing 2B surfaces — the control plane gains
views, never a separate tool.

## Decision Anchors

- phases.md Phase 3 Deliverable 5 — "portfolio trends across features,
  rubber-stamp analysis to guide policy loosening (PRD §2) — building on the
  per-feature summary shipped in 2B; the dashboard grows these views rather
  than gaining a separate tool".
- PRD §2 — the portfolio list; no single north-star; guard metric =
  rework/error count; escalations double as metric events; rubber stamps vs
  real catches guide where to loosen policy first; classification is
  approximate, never authoritative; `unclassified-artifact-change` exclusions
  stay outside automation metrics.
- Epic 017 (typed interaction capture), Epic 013 (net ledger cost), Epic 029
  (per-feature summary — the aggregation this Epic generalizes), Epic 026/027
  (API + dashboard the views extend).

## Stories

- `001-portfolio-aggregation.md` — the cross-feature aggregation over
  captured events/ledger/journal: per-feature rows + across-feature trend
  series for the derivable metrics (defined formulas: approval latency =
  inbox open→response; blocked time = park durations; rework count =
  correction/rework-typed interactions + rework re-opens; % no-human-edit
  nodes from interaction/edit capture; completion rate; net cost); manual
  fields (human minutes, escaped defects) settable via an annotation method,
  reported as absent until set; the rework **guard metric** flagged whenever
  it worsens while another metric improves; exclusion-flagged interactions
  stay out of every automation metric.
- `002-rubber-stamp-analysis.md` — approvals answered "approve, no
  modification" within the configured latency threshold, clustered by
  escalation class and policy knob; clusters above the configured share
  emit a named policy-knob candidate list (e.g. "additive contract diffs:
  96% rubber-stamped → candidate: auto-accept additive"), each candidate
  citing its evidence counts — analysis output, never an automatic knob flip.
- `003-portfolio-views.md` *(web)* — dashboard views: portfolio table +
  trend charts across features (derivable metrics, manual fields marked),
  the guard-metric warning surfaced, and the rubber-stamp candidate list
  with evidence counts; read-only over the Epic 026 methods.

## Verification Gate

- `npm run typecheck` and `npm run typecheck:web` exit 0; `npm test` and
  `npm run test:web` green for the Story suites (fixture event/ledger sets —
  hermetic; web on the fake client).
- A three-feature fixture produces asserted portfolio rows and trend series
  matching hand-computed values for every derivable metric (rework as
  deduplicated incidents; no-edit share reporting `unknown` where the signal
  is absent — debate findings); manual fields read absent until annotated,
  then persist with provenance and reappear.
- Excluded interactions appear in no automation-benefit metric but remain in
  operational-interruption metrics where they belong (blocked time) and stay
  countable separately (PRD §2; debate finding — exclusion scoped, not
  blanket).
- The guard signal is unconditional on rework deterioration, with the
  improved-elsewhere case as an extra annotation (debate finding); silent on
  the all-improving fixture.
- The rubber-stamp fixture (mixed fast-unmodified / slow / modified
  approvals) yields exactly the expected clusters and candidate list with
  correct evidence counts, catch evidence, and proxy labels; below-threshold
  clusters yield no candidate.
- Web: portfolio table, one trend rendering, the guard warning, and the
  candidate list each render from fixture responses via locator-registry
  selectors (component tests).

## Dependencies

- **Epic 031** (setup gate).
- **Epic 017** (typed interactions), **Epic 013** (ledger), **Epic 029**
  (per-feature summary semantics — net cost, exclusion rules reused), **Epic
  026** (read surface + annotation method lands as its control-verb pattern),
  **Epic 027** (dashboard shell), **Epic 034** (escalation classes for
  clustering).

## Non-Goals

- No automatic policy changes — Epic 041 (HD-gated) owns any actual knob
  flip; this Epic only names candidates with evidence.
- No estimation of human minutes or escaped defects — manual annotation or
  absent (PRD §2's honesty stance).
- No portfolio export/reporting pipeline — dashboard views only.

## Findings Out

- `.agent/plan/feedback/040-metrics-portfolio-dashboard/knob-candidates.md` —
  written once real usage data exists (operation, not fixtures): the observed
  candidate list snapshot Epic 041's HD1 and Epic 042 LP2 consume.
