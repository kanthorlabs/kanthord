# 030 Phase-2B Gate — Multi-Repo Proof (gate to Phase 3)

## Outcome

Phase 2 closes: the **full Phase-1 harness suite is green on real components**
(fakes retained for clock and failure injection), and the **multi-repo proof** —
the PRD's reason to exist — runs live: one real two-repo feature with an
artifact-gated handoff completes (publisher exit gate → consumer entry gate,
hash-checked → two PRs → observed deploy stage with soak → human merges), with
the human side driven **end-to-end from the dashboard**, every interaction
captured and visible in the per-feature summary, and the dead-man ping observed
firing (including a detectable induced silent-idle day). Passing this Epic is
the gate to Phase 3.

## Decision Anchors

- phases.md 2B Success criteria — all five, restated as this Epic's named
  checks: harness green on real components; the multi-repo proof with the
  dashboard-driven human side including at least one induced halt; every human
  control point reachable from the dashboard (no fallback to the 2A surface);
  every interaction captured, typed, visible in the summary; dead-man ping on
  schedule + induced silent-idle detectable.
- phases.md guiding rule — the golden scenario carries across phases: Phase 2
  runs it on real components.
- Epic 019 — the checkpoint-gate pattern (hermetic story + LP checklist +
  structured evidence + interface-correction protocol), reused as-is.

## Stories

- `001-harness-on-2b-bricks.md` — the full Epic 010 suite green with all 2B
  bricks substituted (real workflow, real store, verb adapters on doubles,
  ring 2 fake, S3 double), plus named hermetic scenarios for the 2B mechanics:
  `2b-multi-repo-handoff` (two slots, artifact hash gate, two PRs on the
  double), `2b-deploy-soak-observed` (real observer wiring on doubles),
  `2b-unclassified-artifact-change`, and `2b-induced-silent-idle` (ping content
  on a zero-task day).

## Live proof checklist (maintainer-executed — Epic 019 pattern and evidence format)

Recorded in `.agent/plan/feedback/030-phase2b-multi-repo-proof/proof-run.md`
with the Epic 019 evidence format (dates, URLs, SHAs, command outputs,
ledger/inbox excerpts, decision-record links). Prerequisite: a **second sandbox
repo** is provisioned and slot-registered (same SU5 posture — recorded in the
preamble).

**Gate-wide rules (debate findings):**
- **Frozen inventory:** the proof-run preamble snapshots the control-point
  inventory from the live Epic 026 descriptor at proof time — the LP2 sweep
  runs against that frozen list, not a moving reference.
- **Rerun policy:** an LP failure classified as an external-service fault (per
  the verb taxonomies) allows a recorded re-run (cause + attempt logged); a
  failure caused by kanthord fails the gate until fixed and re-run from LP1;
  unexplained failures count as kanthord failures.
- **Dashboard exclusivity is gate-wide:** every human decision across LP1–LP4
  uses dashboard surfaces only — any fallback anywhere is a gate failure, not
  only in LP1.

### LP1 — Multi-repo feature end-to-end, dashboard-driven
- **Action:** author a real two-repo `tdd@1` feature with a **non-toy artifact
  handoff** (debate finding): the consumer's test must actually consume the
  artifact's content, so a stale artifact makes the consumer's suite fail —
  and the run must demonstrate hash blocking live: re-publish a changed
  artifact and observe the consumer blocked until the human re-approves.
  Publisher also carries a deploy stage with observers + soak. Minimum shape
  per Epic 019 LP1 (production code + test in each repo; ≥1 diff escalation;
  ≥1 broker PR per repo). Drive **every** human action from the dashboard:
  sign-off, every escalation response, every approval (including
  `github.merge`), and at least one induced halt + resume.
- **Pass:** publisher exit gate → consumer entry gate hash-checked → two real
  PRs → observed deploy stage passes its soak → human merges via the dashboard
  `github.merge` approval; the induced halt parked and resumed correctly; no
  human action needed any surface other than the dashboard (any fallback = fail
  — phases.md criterion).

### LP2 — Control-point coverage sweep
- **Action:** exercise every control point on the frozen preamble inventory
  from the dashboard.
- **Pass:** for each control point the sweep table records method → dashboard
  location → **resulting daemon state + the journal/inbox capture it
  produced** (not click-success alone — debate finding); every row passes.

### LP3 — Metrics visibility
- **Action:** after LP1, open the feature's per-feature summary in the
  dashboard.
- **Pass:** a **complete reconciliation table** (debate finding — not a
  spot-check): every LP1 interaction from the inbox/journal record appears in
  the summary, typed (confirmed categories), with cost attribution; excluded
  interactions sit outside the headline; zero unmatched rows.

### LP4 — Dead-man ping live
- **Action:** let the daily ping fire on schedule for ≥2 consecutive days; then
  induce a silent-idle day — defined as **zero completed tasks** (debate
  finding: parked/stalled work is visible through the ping's pending-op count,
  which this LP also checks against the daemon state).
- **Pass:** pings arrive in Slack on schedule; the idle day's ping content
  carries the explicit idle warning — detectable without noticing an absence;
  the pending/escalation counts in the pings match the daemon's actual state.

### LP5 — Verify, corrections, harness green
- **Action:** run verify after LP1; review all 2B seam corrections.
- **Pass:** verify exits 0; every correction has an Epic 019-format decision
  record; `npm test` green on the corrected seams (the harness stayed the
  regression net through every brick swap — phases.md Phase 2 requirement).

## Verification Gate

- Story 001's suites green in `npm test` (full Phase-1 suite + the named 2B
  scenarios, zero network).
- LP1–LP5 all recorded **pass** with structured evidence in `proof-run.md`.
- Phase 3 work is blocked until both hold — this Epic **is** the Phase-2→3
  gate.

## Dependencies

- **Epics 020–029 all complete** (027 included — the dashboard is load-bearing
  for LP1/LP2; its SU7 blocker must be resolved and built).
- **Epic 010** (harness — composed, never duplicated; anti-reimplementation
  review check per Epic 019).
- **Epic 019** (proof pattern + 2A corrections already folded in).

## Non-Goals

- No Phase-3 scope (severity levels, property tests, portfolio trends,
  launchd/systemd, re-planning depth) — Phase 3 starts after this gate.
- No real company project — Phase 3's opening move (phases.md).
- No preview environments, auto-merge, multi-daemon (PRD §11 out).

## Findings Out

- `.agent/plan/feedback/030-phase2b-multi-repo-proof/proof-run.md` — the
  Phase-2 completion evidence + any final seam-correction decision records;
  the input to Phase-3 planning.
