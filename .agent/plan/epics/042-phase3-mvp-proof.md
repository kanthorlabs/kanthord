# 042 Phase-3 Gate — MVP Done (real-project proof)

## Outcome

Phase 3 — and the MVP — closes: the full harness suite (Phase 1 + 2 + the
Phase-3 named scenarios) is green, and the **real-project proof** holds:
kanthord has executed **≥3 real features on the company project** (at least
one spanning ≥2 repos, carrying the golden-scenario shape to its final
destination), the metrics portfolio is populated for every feature with at
least one data-driven policy decision recorded, the chaos checks pass in the
real environment (crash mid-feature recovers unattended; induced silent-idle
detected; verify clean or repairable-only), and the PRD's second deliverable
— the written, interaction-data-driven **improvement guideline** — exists.
Passing this Epic is MVP done per phases.md.

## Decision Anchors

- phases.md Phase 3 Success criteria — all four, restated as this Epic's
  named checks (≥3 features / ≥1 multi-repo / best-run interaction profile;
  portfolio + guard metric + ≥1 policy decision; the three chaos checks; the
  written guideline).
- phases.md guiding rules — gate criteria are named scenarios/checklist items
  with observable pass/fail; the golden scenario carries across phases (Phase
  3 = the real company project).
- PRD §11 Rollout — apply → observe the portfolio → modify; deliverables are
  (1) working MVP, (2) a guideline for improvement driven by interaction-type
  data.
- Epics 019/030 — the checkpoint-gate pattern (hermetic story + maintainer LP
  checklist + structured evidence + rerun policy), reused as-is.

## Stories

- `001-phase3-harness-composition.md` — the full suite green with the Phase-3
  scenarios composed in: `p3-replan-loop` (Epic 033), `p3-continuation-compat`
  (Epic 037), the Epic 036 boot-hook scenarios (self-repair; fatal-halt;
  non-blocking verify failure), the Epic 038 `draft_ok` rework scenario, the
  property suites on the CI seed list (Epic 039), and one new named scenario
  `p3-chaos-rehearsal` — the hermetic twin of LP2's live chaos: kill/restart
  at every step of a replanning-and-continuation-rich feature, asserting
  respawn-equivalence and unattended recovery.

## Live proof checklist (maintainer-executed — Epic 019/030 pattern and evidence format)

Recorded in `.agent/plan/feedback/042-phase3-mvp-proof/proof-run.md` with the
Epic 019 evidence format (dates, URLs, SHAs, command outputs, ledger/inbox
excerpts, decision-record links).

**Gate-wide rules (inherited from Epic 030):** the rerun policy (external-
service faults allow a recorded re-run; kanthord-caused failures fail the gate
until fixed; unexplained failures count as kanthord failures) and the frozen-
inventory discipline apply. Features counted by LP1 must **start and
complete after** Epics 032–040 are done, evidenced by the feature-creation
timestamp and the kanthord build + config SHAs recorded in the proof-run
preamble per feature (debate finding — "complete after" alone admits
part-pre-polish runs; the gate proves the polished system). Runs on the
pre-polish system (031 SU5, interim operation) inform priorities but do not
count toward the gate.

### LP1 — Three real features, one multi-repo, best-run profile
- **Action:** execute ≥3 real company features end-to-end on the polished
  system; at least one spans ≥2 repos with an artifact-gated handoff and an
  observed deploy stage (the golden shape, on the real project).
- **Pass:** each feature reaches complete with its PRs human-merged; the
  multi-repo feature's handoff is hash-checked in the ledger; on the **best
  run**, the typed interaction record contains only `approval` and
  `clarification` interactions (no `correction`, `rework`, or `takeover`) —
  evidenced by the **raw typed interaction rows** (ids, types, any
  reclassification notes) attached to the proof, with the per-feature
  summary reconciling against them (debate finding — a summary alone can
  hide classification drift).

### LP2 — Chaos checks in the real environment
- **Action:** during **one counted LP1 feature — preferably the multi-repo
  one** (debate finding — the "equivalent live run" loophole is closed):
  kill the daemon process mid-feature and let the SU3 supervisor restart it;
  induce a silent-idle day (named condition: zero completed tasks with the
  daemon alive); run `kanthord verify` against the live store.
- **Pass:** the supervisor restarts the daemon and the feature recovers
  **unattended**, defined event-bound (debate finding): in the ledger/journal
  interval from the kill timestamp through supervisor restart, boot
  verify/reconcile, and the first resumed task transition, up to the next
  **pre-existing** approval/clarification gate, there is no inbox response,
  config edit, manual daemon command, store repair, or supervisor
  intervention; the idle day's ping arrives on schedule and carries the
  explicit idle warning with counts matching daemon state (Epic 029 content
  check, live — alive-but-idle, not down); verify evidence is complete: the
  initial report, its severity list, the self-repair action, and the clean
  post-repair re-verify (exit 0), never "repairable-only" as an unexamined
  catch-all (debate finding).

### LP3 — Portfolio populated + a policy decision from the data
- **Action:** open the portfolio views after LP1; review the rubber-stamp
  candidate list; make (or record having made) at least one policy decision.
- **Pass:** every LP1 feature has a populated portfolio row (derivable
  metrics complete; manual fields either annotated or explicitly absent); the
  rework guard metric is tracked across the LP1 runs; **≥1 policy decision
  (loosen or tighten) is recorded citing the LP1 portfolio data collected
  for this gate** (debate finding — PRD §11 is apply→observe→modify; a
  pre-LP1 decision does not close the loop): the Epic 041 HD1 record
  qualifies only if made or updated after LP1 with citations to these runs;
  an independent tighten decision qualifies on the same terms; a knob flip
  without a data citation does not.

### LP4 — The improvement guideline exists
- **Action:** write the PRD §11 second deliverable from the accumulated
  interaction-type data.
- **Pass:**
  `.agent/plan/feedback/042-phase3-mvp-proof/improvement-guideline.md`
  exists and is **auditable** (debate finding — data-driven means traceable,
  not plausible prose): it names its date range, the feature inventory it
  covers, and the interaction-taxonomy semantics in force, and contains at
  minimum: the interaction-type distribution across all real features; the
  top `correction`/`takeover` clusters with their suspected causes (PRD §2
  fix directions); the rubber-stamp findings and the policy decision(s)
  taken; and a prioritized next-changes list where **each entry links the
  specific rows/records backing it**.

## Verification Gate

- Story 001's composed suite green in `npm test` (zero network).
- LP1–LP4 all recorded **pass** with structured evidence in `proof-run.md`.
- Epic 041's HD1 is **resolved**: built-and-landed, decided-out, or deferred
  with its named re-evaluation trigger — a deferral counts only if LP3's
  policy-decision criterion is met by another post-LP1 data-cited decision
  (debate finding — no paperwork bypass); an open HD1 blocks this gate.
- All of the above hold ⇒ MVP done (phases.md Phase 3 / MVP done).

## Dependencies

- **Epics 031–040 all complete**; **Epic 041 resolved** (not necessarily
  built; deferral rules per the Verification Gate).
- **Epic 030** (Phase-2 gate passed), **Epic 010/019/030** (harness + proof
  pattern — composed, never duplicated).

## Non-Goals

- No post-MVP scope: support/Q&A lane, customer-facing anything, preview
  environments, multi-daemon sync, non-web clients, auto-merge/auto-deploy by
  default, Shape plugin framework (phases.md "still post-MVP" list).
- No perfection bar beyond the named criteria — the gate is the phases.md
  list, nothing more.

## Findings Out

- `.agent/plan/feedback/042-phase3-mvp-proof/proof-run.md` — the MVP
  completion evidence.
- `.agent/plan/feedback/042-phase3-mvp-proof/improvement-guideline.md` — the
  PRD §11 second deliverable (LP4).
