# 031 Phase-3 Milestone Setup (maintainer gate — blocks all Phase-3 TDD epics)

## Outcome

The dependencies, credentials, decisions, and real-world observations Phase 3
**cannot do through the TDD lane**: the real company project onboarded (repos,
credentials, deploy/observability targets), the contract-artifact format
inventory the PRD has owed since §12, the supervision-environment and
log-rotation-mechanism decisions, the property-testing tooling decision, and —
the phase's opening move per phases.md — the **first real company feature run
on the Phase-2 system as-is**, whose observed failures and interaction-type
clusters are the data that drives Phase-3 priorities. After this Epic, the
**known** maintainer-lane dependencies of the authored Phase-3 epics are
resolved (debate finding — the absolute "no story hits a missing dependency"
claim is unverifiable over future work; this gate clears the identified
blockers, with Epic 041 HD1 as the named exception), and the polish epics have
a real observation record to prioritize against instead of speculation.

The Phase-3 epics 032–040 are authored now from phases.md's **named**
deliverables and are provisional to SU5's observations (debate finding — the
two claims must not conflict): SU5 reorders and, via decision record, may
reshape them; it does not silently author new scope.

## Why this is a gate, not RED/GREEN tasks

Same rationale as Epics 000/011/020: `lane-check.sh` denies `package.json`,
lockfile, `scripts/**`, and CI config for every engineer role; company
credentials and accounts are maintainer-owned; the first-feature run needs a
real project and a human. Spikes follow the `.agent/authoring.md` Spike Gate.
The Epic 011 spike safety boundary applies to every SU here — with one Phase-3
tightening: SU5 runs against the **real company project**, so its safety
boundary is the production Phase-2 security posture (escalate-all-diffs, cost
breaker, human merge), not a scratch sandbox.

## Setup items

### SU1 — Company project onboarding  *(unblocks SU5, daily operation + Epic 042 LPs)*
- **Action (maintainer):** register the company project's repos as slots
  (strategy per repo — `worktree` vs `single_checkout` per PRD §3.3); provision
  least-privilege company credentials (GitHub/GitLab, Jira, Slack) into the
  Epic 011 SU4 custody config (same invariants: git-ignored, `0600`, no env
  propagation); record the deploy targets and observability endpoints
  (k8s context, SigNoz, Sentry) per repo. Scope discipline (debate finding —
  don't force a complete ops inventory before any learning): onboard the
  **minimum access SU5's first feature needs**; observer endpoints not needed
  by that feature are listed with access recorded as an explicit follow-up
  item, not provisioned up front. Record everything in
  `.agent/plan/feedback/031-phase3-milestone-setup/company-onboarding.md`.
- **Verify:** each repo slot needed by SU5 registers and its
  worktree/checkout provisioning probe passes; custody invariants hold; each
  **provisioned** observer endpoint answers a read-only probe (e.g.
  `k8s.rollout_status` against a known deployment) and the probe cleans up;
  unprovisioned endpoints appear on the follow-up list.

### SU2 — Contract-artifact format inventory  *(feeds Epic 041 HD1)*
- **Action (maintainer):** the PRD §12 "afternoon of listing": inventory what
  the company's repo boundaries actually speak (REST/OpenAPI, gRPC/proto,
  GraphQL, event schemas, ad-hoc JSON), which boundary is **dominant**, and
  which of the inventoried formats already caused (or will plausibly cause)
  `unclassified-artifact-change` escalation noise under the 2B byte-diff
  fallback. Record in
  `.agent/plan/feedback/041-usage-driven-additions/artifact-format-inventory.md`.
- **Verify:** the inventory names every cross-repo boundary of the onboarded
  project, its format, and the dominant format — the exact input Epic 041's
  HD1 decision requires.

### SU3 — Supervision environment + log-rotation mechanism decision  *(unblocks Epic 035)*
- **Action (maintainer):** decide where the daemon runs for daily operation
  (Mac under launchd vs VPS under systemd — PRD §3.1 supports both; pick one
  as the operated target, the other stays a generated-but-unproven template)
  and how structured logs rotate (in-process via a pinned `pino` rotation
  transport vs external logrotate + reopen signal). Add any chosen dependency
  to `package.json` + lockfile. Record decision + constraints (log paths,
  retention policy, service-user/permissions) in
  `.agent/plan/feedback/035-operational-hardening/supervision-environment.md`.
- **Verify:** the decision file names the operated supervisor, the rotation
  mechanism, and the log/retention constraints Epic 035 codes against; any new
  dep imports cleanly. **Supervisor operability spike** (debate finding —
  `.agent/authoring.md` requires a spike for OS-boundary behavior; unit-file
  fixtures prove serialization, not operability): a stub binary installed
  under the chosen supervisor demonstrably loads, starts, stops cleanly
  without restart, restarts after a non-zero exit, and writes to the
  configured log paths — observations recorded in the SU3 findings file;
  Epic 035's exit-code semantics code against them.

### SU4 — Property-testing tooling decision + spike  *(unblocks Epic 039)*
- **Action (maintainer):** decide the property-testing tool for Epic 039
  (`fast-check` at a pinned version vs a hand-rolled seeded-PRNG generator
  module) and spike the surface Epic 039 codes against: seeded determinism
  (same seed ⇒ same run), shrinking behavior on failure, `node:test`
  integration, CI reproduction workflow (how a failing seed is re-run).
  Add the chosen dep to `package.json` + lockfile. Record in
  `.agent/plan/feedback/039-property-test-hardening/property-tooling.md`.
  The spike artifact is **throwaway** (debate finding — a spike de-risks
  design, it does not close production work): Epic 039 writes its model and
  suites through the TDD lane; nothing from the spike ships as production
  test code.
- **Verify:** a probe property runs deterministically twice from the same seed
  and shrinks a planted failure; the findings file answers each point; the
  probe code is deleted or clearly quarantined outside `src/**`.

### SU5 — First real feature run + observation record  *(the phase opener; priority driver for Epics 032–038)*
- **Action (maintainer):** author, sign off, and run **one real feature** on
  the onboarded company project using the Phase-2 system unmodified (Epic 019
  LP1 minimum shape: production code + test change, ≥1 diff escalation, ≥1
  broker PR; human merge). **Safety bounds for the run** (debate finding —
  "production posture" alone is not a defined boundary): the feature touches
  only the SU1-registered repos and its named tickets; deploy stages are
  observation-only (no promotion verb); a per-task budget ceiling is set
  before sign-off; auto-merge/auto-deploy stay off; the rollback owner is the
  human, recorded before the run. While it runs, record every failure, workaround,
  and rough edge, and afterwards pull the typed interaction record and cost
  for the run. Write the observation record in
  `.agent/plan/feedback/031-phase3-milestone-setup/first-feature-observations.md`:
  observed failures mapped to the Phase-3 epic that addresses them (or "none
  — new finding"), the interaction-type cluster summary, and a recommended
  priority order for Epics 032–038.
- **Verify:** the feature completed (or its failure is itself recorded as the
  finding); the observation record contains the failure→epic mapping, the
  typed-interaction summary, and the priority recommendation. A finding that
  no authored epic covers gets a decision record before any re-authoring
  (phases.md — corrections are decision-recorded, not silently absorbed).

## SU → epic dependency map (debate finding — a dependency-clearing gate needs the map explicit)

| SU | Blocks (hard) | Informs (priority only) |
|---|---|---|
| SU1 | SU5, Epic 042 LPs, daily operation | — |
| SU2 | Epic 041 HD1 (input) | — |
| SU3 | Epic 035 | — |
| SU4 | Epic 039 | — |
| SU5 | Epic 042 LP1 counting (post-polish runs only) | Epics 032–038 sequencing |

**SU5 does not hard-block Epics 032–040** (debate finding — serializing all
hardening behind a human live run is unnecessary): an epic may dispatch once
the SUs in its own Dependencies pass; SU5's record governs *order* and any
decision-recorded scope change.

## Verification Gate

- SU1–SU5 Verify checks all pass. Epic 041 is **additionally blocked on its
  HD1 human decision** (usage data required — see that epic); other Phase-3
  epics are setup-unblocked once **their mapped SUs** pass (see the map);
  behavioral ordering stays with each epic's Dependencies (Epic 011 wording).

## Dependencies

- **Epic 030 passed** (the Phase-2→3 gate; phases.md — Phase 3 work is blocked
  until the multi-repo proof holds).

## Non-Goals

- No product behavior; not run through `/work`.
- No polish work inside the SUs — SU5 observes and records; fixing what it
  finds is Epics 032–038's job.
- No commitment to build Epic 041's candidates — SU2 only collects the data
  HD1 needs.

## Findings Out

- `.agent/plan/feedback/031-phase3-milestone-setup/company-onboarding.md` (SU1)
- `.agent/plan/feedback/041-usage-driven-additions/artifact-format-inventory.md` (SU2)
- `.agent/plan/feedback/035-operational-hardening/supervision-environment.md` (SU3)
- `.agent/plan/feedback/039-property-test-hardening/property-tooling.md` (SU4)
- `.agent/plan/feedback/031-phase3-milestone-setup/first-feature-observations.md` (SU5)
