# Phase 3 — End-to-End Acceptance Testsuite

Status: **spec / runbook** (authored 2026-07-03). Executable the day the Phase-3
epics (032–040) build green and Epic 031's setup gate has run kanthord on the
real company project. Source of truth for the **Phase 3 / MVP-done** gate, in
human- and AI-followable form.

Sources: `.agent/plan/prd.md` (PRD §2, §6.1, §6.3, §7.1.1, §7.2, §7.4, §7.5,
§7.7, §11), `.agent/plan/phases.md` (Phase 3), and the Phase-3 epics:
`031-phase3-milestone-setup` (the maintainer setup gate + first-feature
observation), `032-broker-reconciliation-depth`, `033-replanning-flow-depth`,
`034-ticket-drift-and-escalation-evidence`, `035-operational-hardening`,
`036-verify-severities-and-boot-hooks`, `037-dirty-plan-continuation`,
`038-plan-tooling-and-tuning`, `039-property-test-hardening`,
`040-metrics-portfolio-dashboard`, `041-usage-driven-additions` (BLOCKED DRAFT —
HD1-gated), `042-phase3-mvp-proof` (the Phase-3 gate Epic).
Companions: `phase1-e2e-testsuite.md` (the deterministic harness this suite still
runs, now with Phase-3 scenarios composed in), `phase2-e2e-testsuite.md` (the
gate this phase builds on).

---

## 0. What this suite is (and is not)

- **Is:** a step-by-step acceptance runbook for **all of Phase 3** — the polish
  phase whose gate is **MVP done** (phases.md Phase 3 / MVP done). Each test case
  has exact commands or UI steps, one observable pass/fail assertion, the
  phases.md criterion (or Epic 042 LP) it maps to, and a human manual-verify
  checkbox.
- **Is not:** a second implementation of the tests. The hermetic assertions live
  in the Epic 010 harness (extended by Epic 042 Story 001 and each Phase-3 epic's
  own suites) and in the Epic 027/040 `web e2e`/component suites. This runbook
  **drives and observes** those suites and the **live real-project proofs**; it
  defines no new mechanism (mirrors the Epic 010/019/030/042 "composition only,
  no new production mechanism" rule).
- **Runs on a real company project, not a sandbox.** This is the phases.md Phase-3
  requirement: polish is driven by observed failures and the metrics portfolio,
  not speculation. Unlike Phase 2's sandbox repos, the live proofs here run on the
  **onboarded company project** (Epic 031 SU1) under the full production security
  posture (escalate-all-diffs, cost breaker, human merge, human-owned rollback).

### The one thing that makes Phase 3 different from Phase 2

Phase 2 proved the *machinery* works on sandbox repos. **Phase 3 proves the
*polished* machinery survives real usage** — and the gate is deliberately about
**observed data driving decisions**, not just green tests. So this suite has a
third obligation Phase 1/2 did not: **the improvement guideline (LP4) and the
data-cited policy decision (LP3) must actually exist**, traceable to real
interaction rows. A green harness with no guideline is a **gate failure**.

### Two lanes, never confused (same discipline as Phase 2)

| Lane | Runs against | Network | Evidence artifact |
|---|---|---|---|
| **Hermetic** (G-checks, TC-H*) | doubles / fakes | zero (guarded) | saved test output + green CI URL |
| **Live proof** (LP1…LP4) | **real company** GitHub/GitLab, Jira, Slack, k8s, SigNoz/Sentry, real pi | real, credentialed | `proof-run.md` structured evidence + Chrome MCP video/screens + written guideline |

### Phase-3 invariants this suite must never violate

- **The harness stays the regression net.** The full Phase-1 **and** Phase-2
  harness suite must be green with the Phase-3 scenarios composed in (Epic 042
  Story 001). A red harness fails the gate regardless of live proof.
- **Polished-system-only counting (Epic 042 gate-wide rule).** A feature counted
  by LP1 must **start and complete after** Epics 032–040 are done, evidenced by
  the feature-creation timestamp and the kanthord build + config SHAs recorded in
  the proof-run preamble per feature. Runs on the pre-polish system (Epic 031 SU5,
  interim operation) inform priorities but **do not count** toward the gate.
- **No paperwork bypass on HD1 (Epic 041/042).** Epic 041's HD1 must be
  *resolved* — built-and-landed, decided-out, or deferred **with a named
  re-evaluation trigger**. A deferral counts only if LP3's policy-decision
  criterion is met by another post-LP1, data-cited decision. An **open HD1 blocks
  this gate**.
- **Data-driven means traceable, not plausible.** LP3's policy decision and LP4's
  guideline must each **cite the specific interaction rows/records** backing them
  (Epic 042 debate findings). Plausible prose with no row citations fails.
- **No-bypass, unchanged from Phase 2.** No dashboard or API action bypasses the
  three security rings; ring-1 deterministic policy cannot be switched off from
  the UI (sole exception: the rate-limited, recorded budget override).
- **Chaos is event-bound, not vibes.** "Recovers unattended" (LP2) has the Epic
  042 event-bound definition asserted below — no human action in the recovery
  interval — not a subjective "looked fine".

---

## 1. Command & surface reference (read before running)

**Hermetic commands** (safe to depend on):

| Command | Meaning |
|---|---|
| `npm run typecheck` | `tsc` type-check of `src/`; must exit 0 |
| `npm run typecheck:web` | `tsc` of `web/src`; must exit 0 (PROFILE web variant) |
| `npm test` | full `node:test` harness suite under the zero-network guard, on real components, **with the Phase-3 scenarios composed in** (Epic 042 Story 001) |
| `npm run test:web` | Vitest + Testing Library unit/component suite for the dashboard (incl. Epic 034/040 web views) |
| `npm run e2e:web` | Playwright dashboard E2E against the pre-flight daemon seeded with the golden fixture |
| `node src/cli/verify.ts --from-markdown --read-only` | shadow-rebuild drift check with **Phase-3 severity levels** — **exit 0 clean-or-warn-only / 1 repairable present / 2 fatal present** (Epic 036); `--strict` turns warn-only into exit 1 |
| `kanthord service install\|uninstall\|status` | generate/install/inspect the launchd/systemd unit (Epic 035); tests target a temp prefix |
| `kanthord renumber <from> <to>` | atomically move a task trio / story directory (Epic 038) |

> **Provisional pins** (settle at build time, flagged inline): exact CLI entry
> path (`kanthord` vs `node src/cli/*.ts`), the dashboard base URL + port, the
> daemon boot entrypoint, the supervisor target (launchd vs systemd — decided in
> Epic 031 SU3), and the broker **debug hold-point** flag name (the reproducible
> cutpoint for kill-mid-op, from Epic 020). Pin these from the Epic 026 SU6
> descriptor and the Epic 031 SU3/SU5 findings before the live proofs.

**Live surface** (Part LP\*): the **web dashboard** (Epic 027 + the Phase-3
views: Epic 034 escalation-evidence rendering, Epic 040 portfolio/rubber-stamp
views) over **Basic auth on TLS**, bound to the VPN interface in production. This
is the surface Chrome MCP drives (§6). Slack (dead-man ping) is outside the
dashboard — capture DMs directly.

---

## 2. Preconditions

- [ ] **P1 — Phase 2 gate passed.** `phase2-e2e-testsuite.md` §8 gate recorded
  green (the multi-repo proof holds). Phase-3 work is blocked until then
  (phases.md; Epic 042 dep on Epic 030).
- [ ] **P2 — Epic 031 setup gate passed (SU1–SU5).** Company project onboarded
  (SU1); contract-format inventory written (SU2 → `artifact-format-inventory.md`);
  supervision environment + log-rotation mechanism decided **and the supervisor
  operability spike recorded** (SU3); property-tooling decided + spiked (SU4);
  the **first real feature run on the pre-polish system** is observed and recorded
  (SU5 → `first-feature-observations.md`). Without SU5's observation record there
  is no data to drive polish and no priority basis — the phase has not started.
- [ ] **P3 — Epics 032–040 complete and unit-green.** Every Phase-3 brick built;
  each epic's own Verification Gate passed. This is the "polished system" LP1
  counts against.
- [ ] **P4 — Epic 041 HD1's *pre-LP1* input exists.** The only HD1 input available
  before the live proofs is the SU2 `artifact-format-inventory.md` (Epic 031). The
  **other** HD1 inputs — Epic 040 `knob-candidates.md`, the observed
  `unclassified-artifact-change` share, the `correction`/`takeover` cluster
  analysis — are **derived from real-project operation and materialize during/after
  LP1** (Epic 041 depends on operation under Epic 042 LP1; earliest decision is
  after ≥2 completed real features, including the multi-repo one when the decision
  concerns a cross-repo format). So **HD1 is resolved after LP1/LP3, never as a
  precondition** — putting HD1 resolution before LP1 would be a circular gate. This
  precondition asserts only that the *pre-LP1* input (SU2 inventory) is present;
  HD1 resolution itself is checked in §8 (G-HD1), gated on the LP1/LP3 data.
- [ ] **P5 — Company credentials in broker custody** (Epic 031 SU1 posture:
  least-privilege, git-ignored, `0600`, no env propagation; never in a plan).
- [ ] **P6 — Slack DM target configured** for the dead-man ping (Epic 029).
- [ ] **P7 — Chrome MCP available and site-permitted** for the dashboard origin
  (§6). `tabs_context_mcp` returns a live browser.
- [ ] **P8 — Supervisor installed for the operated target** (Epic 035;
  the SU3-decided launchd/systemd unit), because LP2 asserts supervisor-driven
  restart, not a manual relaunch.
- [ ] **P9 — Control-point / portfolio-metric inventory frozen.** The proof-run
  preamble snapshots, at proof time: the live Epic 026 descriptor's control-point
  list (for the dashboard sweeps this suite reuses from Phase 2) **and** the Epic
  040 portfolio-metric list (which derivable metrics are claimed). LP1/LP3 run
  against these frozen lists, not moving references.

If any precondition fails, **stop** — the Phase-3 gate cannot be evaluated.

---

## 3. Cross-cutting gate checks (G-series)

Properties the whole suite must satisfy, not individual scenarios.

### G1 — Type-check clean (core + web)
- **Run:** `npm run typecheck` and `npm run typecheck:web`.
- **Pass:** both exit 0.
- **Human verify:** [ ] both exit codes are 0.
- **Maps:** every Phase-3 epic Verification Gate.

### G2 — Full composed harness green (Phase 1 + 2 + Phase 3 scenarios)
- **Run:** `npm test` + `npm run test:web` + `npm run e2e:web`.
- **Pass:** every suite green; the **full Phase-1 and Phase-2 harness** passes
  with the Phase-3 scenarios composed in (Epic 042 Story 001):
  `p3-replan-loop` (Epic 033), `p3-continuation-compat` (Epic 037), the Epic 036
  boot-hook scenarios (self-repair / fatal-halt / non-blocking verify failure),
  the Epic 038 `draft_ok` rework scenario, the Epic 039 property suites on the CI
  seed list, and `p3-chaos-rehearsal` (Epic 042 Story 001 — the hermetic twin of
  LP2). Fakes retained only for clock + failure injection.
- **Wiring manifest (required — green is not enough; carried from Phase 2 §G2).**
  The run emits an observable **wiring/composition manifest** listing, per seam,
  whether the **real** adapter or a **double** is bound (store, git/github/jira/
  slack verbs, pi session, S3, workflow, observers, ring-2) **and** which Phase-3
  scenario is composed in. Assert: every seam that phases.md says is *real* shows
  the real adapter, **only** clock + failure-injection seams show doubles, and a
  Phase-3 brick accidentally run through a double fails this check even if the
  suite is green.
- **If Epic 041 HD1 decided "build":** the newly-authored D6 stories' suites are
  **present and green** in this run too (see G-HD1) — "built-and-landed" means the
  tests exist and pass, not merely that stories were authored.
- **Human verify:** [ ] 0 failing across `npm test`/`test:web`/`e2e:web`;
  [ ] no Phase-1/2 scenario was deleted or skipped to make a Phase-3 brick pass;
  [ ] every named Phase-3 scenario above is present and green;
  [ ] the wiring manifest shows real adapters for every must-be-real seam,
  doubles only for clock/failure injection;
  [ ] if HD1 built anything, its D6 suites are green here.
- **Maps:** Epic 042 Story 001; Verification Gate bullet 1; phases.md guiding rule
  "harness stays the regression net" (gate discipline, **not** one of the four
  phases.md Phase-3 success bullets — see §7).

### G3 — Zero-network guard still active
- **Run:** `npm test`.
- **Pass:** the Phase-1 network/credential guard is still installed and self-tests
  pass; no hermetic scenario opens a non-loopback socket; real verb adapters run
  against doubles, not the network, in the hermetic suite.
- **Human verify:** [ ] guard self-test present and green; [ ] no hermetic
  scenario touches the network.
- **Maps:** PRD §7.1; every Phase-3 epic's "hermetic" gate.

### G4 — Deliverable coverage (every Phase-3 deliverable maps to a green scenario)
- **Why:** the headline real-project proof (LP1) does not, by itself, exercise
  every Phase-3 **deliverable** — a broken `state_can_regress` matrix, an unwired
  boot hook, a wrong compaction-threshold resolution, or a missing rubber-stamp
  cluster could pass LP1 and still be absent. Same rule Phase 2 applied to its 2B
  deliverables.
- **Run:** confirm the §7 deliverable-coverage table — every phases.md Phase-3
  deliverable maps to a **present, green** hermetic scenario or listed unit suite.
- **Pass:** no deliverable is proven only indirectly by a live proof; each has its
  mapped scenario green.
- **D6 branches by HD1 outcome:** if HD1 = **neither** or a valid **defer**, D6 is
  covered by G-HD1 (nothing to build). If HD1 = **build**, D6 is **not** covered
  until the built additions have their own green tests (G2) **and** live/fixture
  evidence — assert that branch, do not treat "resolved" as "covered".
- **Human verify:** [ ] every row in §7's deliverable table resolves to a green
  scenario/suite; [ ] no deliverable is "covered" only by LP1; [ ] D6's coverage
  matches the actual HD1 outcome (built ⇒ its tests green here).
- **Maps:** phases.md Phase 3 Deliverables 1–5 (Deliverable 6 is HD1-gated — see
  G-HD1).

### G-HD1 — Epic 041 HD1 is resolved (not open)
- **Run:** inspect `.agent/plan/feedback/041-usage-driven-additions/hd1-decision.md`.
- **Pass, all of:** the record exists and **cites every checklist input** (SU2
  inventory, Epic 040 knob-candidates with catch evidence, observed
  `unclassified-artifact-change` share with cost/time impact, the
  `correction`/`takeover` cluster analysis, and — for a "build (b)" outcome — the
  additive-diff safety analysis); the decision is one of **build (a)/(b)/both**,
  **neither (decided-out)**, or **defer with a named re-evaluation trigger**; if
  "build", the re-authored stories landed through authoring+debate **and are
  built-and-green** — implementation complete, their suites present and passing in
  G2, and any new D6 scenario reflected in G4 (Epic 042 requires HD1 "built-and-
  landed", which is more than "stories authored"). A **missing input invalidates
  the decision whatever it says** (Epic 041 debate finding); an **open HD1 fails
  this gate**.
- **Human verify:** [ ] hd1-decision.md exists; [ ] every checklist input cited;
  [ ] the outcome is build/neither/defer-with-trigger; [ ] if "build", the D6
  suites are green in G2 and mapped in G4 (not just stories authored); [ ] if
  deferred, LP3 supplies the qualifying post-LP1 data-cited decision (no paperwork
  bypass).
- **Maps:** Epic 041 Verification Gate; Epic 042 Verification Gate bullet 3.

### G-VID — Live proofs are recorded
- **Run:** every LP that touches the dashboard is recorded with Chrome MCP
  `gif_creator` (§6), plus per-step screenshots; Slack pings captured as
  screenshots.
- **Pass:** one named recording (or dense screenshot sequence + stated fallback)
  per dashboard-driving LP; each captures the action and its observable result.
- **Human verify:** [ ] each dashboard LP has a recording named per §6; [ ] a
  human can watch it and see the asserted outcome; [ ] Slack ping screenshots
  present for LP2.
- **Maps:** the "AI testing + video recording" requirement of this task.

### G-ORIGIN — Human decisions are dashboard-driven, proven server-side
- **Why:** carried from Phase 2's "dashboard exclusivity proven server-side, not
  by video" invariant (`phase2-e2e-testsuite.md` §0 / LP-B1). The recording shows
  *what the AI did*; it does **not** prove nothing happened out-of-band. Phase 3
  still routes every human decision through the dashboard, so the same server-side
  proof applies.
- **Run:** after LP1/LP3, query the interaction/journal records for the origin of
  **every accepted human decision** (sign-off, each escalation response, each
  `github.merge` approval, each halt/resume, the LP3 policy decision if made via a
  dashboard control).
- **Pass:** every accepted decision has an interaction event whose **origin is the
  dashboard / Epic 026 API** with the authenticated actor identity, and a matching
  journal transition; **no accepted decision originates from a non-dashboard
  surface** (e.g. a raw CLI/curl call). Any non-dashboard-origin accepted decision
  is a gate failure.
- **Human verify:** [ ] the interaction/journal origin for every accepted LP1/LP3
  decision is the dashboard/API with the actor; [ ] none originate off-dashboard
  (checked by querying records, not by watching the video).
- **Maps:** phase2 §0 dashboard-exclusivity invariant, carried into Phase 3;
  PRD §2 (typed interactions), Epic 026/027.

> **Reused Phase-2 gate checks (still required, unchanged):** G-AUTH / G-AUTH-NEG
> (TLS + Basic auth + bind policy, incl. the unauthenticated-browser negative
> case), G-NET (dashboard talks only to the authenticated Epic 026 API), and G-RO
> (plan files & registries read-only from the UI). Phase 3 adds dashboard **views**
> (Epic 034/040) but no new write path, so these Phase-2 invariants carry forward
> verbatim — re-run them against the Phase-3 dashboard build. See
> `phase2-e2e-testsuite.md` §3 for the exact steps. **Each re-run must produce a
> named evidence artifact** in the proof-run dir (`g-auth.md`, `g-auth-neg.md`
> with the 401 body + unauth screenshot, `g-net-origins.txt`, `g-ro.md`) — a bare
> "re-run green" checkbox is not enough for the MVP-done runbook.
> **Human verify:** [ ] G-AUTH, G-AUTH-NEG, G-NET, G-RO re-run green on the
> Phase-3 dashboard, each with its named evidence artifact saved.

---

## 4. Hermetic composed suite (TC-H series)

The hermetic lane. Each maps to a Phase-3 epic's Verification Gate; this runbook
**drives and observes** them, asserting the composed run is green and complete.
Run all with `npm test` (+ `test:web` for web rows) under the zero-network guard.

### TC-H1 — Broker reconciliation depth matrix (Epic 032)
- **Run:** the Epic 032 per-verb matrix suite.
- **Pass:** the matrix enumerates **every** verb in `broker/verbs/*.yaml` and
  asserts each declares `state_can_regress` (with `max_regressions` when `true`),
  a rate-limit behavior, and an **expiry window**, and that each declared value
  drives the observed lifecycle on the double; a regression on a `true` verb
  re-enters `in_flight` (journaled), on a `false` verb parks
  `needs_reconciliation` + escalates; a rate-limited submit uses its own backoff
  **without** decrementing the failure-retry budget; a pending op that crossed
  expiry while down is `expired` on restart with **no** adapter submit; a
  reconcile that finds a real external effect behind an `expired` op parks
  `needs_reconciliation` + escalates with the desired-effect hash and observed
  state, human-resolved to `done`/`failed`. Each declaration **cites its source**
  (Epic 011/020 spike findings or the adapter taxonomy note) in the verb yaml
  (traceability, per Epic 032 gate).
- **Human verify:** [ ] a newly-registered verb missing any of the three
  declarations fails the suite; [ ] all lifecycle assertions green; [ ] each
  declaration carries its source citation.
- **Maps:** phases.md Deliverable 1 (reconciliation edge cases); Epic 032 gate.

### TC-H2 — Re-planning loop `p3-replan-loop` (Epic 033)
- **Run:** the `p3-replan-loop` scenario.
- **Pass:** a running task raises a replan signal → the feature enters
  `replanning` and **new dispatch halts by the replanning state itself** (not only
  the dirty flag) while running tasks stay generation-pinned → human recompile
  mints `G+1` → the affected-set seam re-opens exactly the affected subgraph
  (changed node re-opens; downstream-of-changed-artifact re-opens; untouched
  parallel lane does **not**), each asserted by id **and** observed scheduler
  behavior; the abort path (human rejects the diff) leaves execution-affecting
  state field-by-field identical to the pre-signal snapshot; a scope-violation
  inbox item converts into a replan signal producing the same feature state;
  runs under `contract_policy: breaking_allowed`, zero network; kill-and-restart
  injected at **every** transition point.
- **Human verify:** [ ] affected-set re-open matches by id both ways; [ ] reject
  path is state-identical; [ ] crash-at-every-transition passes.
- **Maps:** phases.md Deliverable 1 (re-planning flow); Epic 033 gate.

### TC-H3 — Ticket-drift handling + escalation evidence (Epic 034)
- **Run:** the Epic 034 Story suites (+ `test:web` for the rendering story).
- **Pass:** a drifted ticket at a phase boundary yields **exactly one** open drift
  item carrying the content diff, keyed by (node, baseline hash, current hash);
  re-crossing with the same pair adds none; a distinct edit (incl. oscillation
  back after re-snapshot) yields a second; feature-level and task-level drift
  produce distinct node-named items; halt parks the node subtree (unaffected lanes
  untouched), re-snapshot resolves + resumes; **every** escalation class emitted
  anywhere carries its declared evidence type off **one canonical class registry**
  (exhaustiveness test rejects an evidence-less escalation **on any write path**,
  while **legacy items read as an explicit `missing-evidence` payload** —
  strict-write/tolerant-read, Epic 034); oversized evidence is truncated
  class-aware with the marker (structural fields survive); web: each class renders
  its evidence via locator-registry selectors, truncation marker visible.
- **Human verify:** [ ] one-item-per-hash-pair asserted; [ ] exhaustiveness test
  present (no evidence-less escalation on any write path; legacy reads as
  `missing-evidence`); [ ] web renders every class's evidence.
- **Maps:** phases.md Deliverable 1 (ticket drift; escalation UX with evidence);
  Epic 034 gate.

### TC-H4 — Operational hardening: supervision + log rotation (Epic 035)
- **Run:** the Epic 035 Story suites (unit generation asserted on content; signal
  handling in-process with injected fakes; `install` targets a temp prefix).
- **Pass:** the generated unit for the **SU3 operated target** contains
  restart-on-crash, start-on-boot, the configured log paths, and the service user;
  SIGTERM during a running fake session drains the quiescence contract (no new
  admissions, submit-ambiguity window flushed to the ledger, leases released,
  STATE written) and exits 0 in the grace window, and the next boot matches on the
  respawn-equivalence fields; SIGTERM overrun exits non-zero and the next boot's
  crash-recovery reconciles; logs rotate at the configured size on the fake
  clock/size driver, retention prunes to the configured count, **rotation state
  survives a daemon restart** (Epic 035), a rotation error degrades to stderr +
  journal without dropping the daemon.
- **Human verify:** [ ] only the SU3 target is claimed operated (the other unit is
  a labelled template); [ ] SIGTERM quiescence is field-level, not "resumes
  correctly"; [ ] rotation state survives restart; [ ] rotation-error path does not
  drop the daemon.
- **Maps:** phases.md Deliverable 2 (supervision, log rotation); Epic 035 gate.

### TC-H5 — `kanthord verify` severities + boot hooks (Epic 036)
- **Run:** the Epic 036 Story suites (temp stores).
- **Pass:** every divergence class in the projection contract maps to a declared
  severity; a synthetic **unknown** class classifies **fatal** (fail-closed); exit
  codes 0 clean-or-warn-only / 1 repairable / 2 fatal, `--strict` turns warn-only
  into 1; **boot with injected repairable drift** self-repairs via the Epic 003
  rebuild path, journals the repair, re-verifies clean, dispatch proceeds — **no
  human interaction** (asserted end-to-end on the restart scenario); **boot with
  injected fatal corruption** holds the degraded contract (no dispatch/new
  submits; in-flight reconciliation continues; reads answer; recovery-only inbox;
  degraded `/healthz`) with an inbox escalation carrying the report, and clearing +
  rebooting restores normal dispatch; **boot with a verify engine forced to throw**
  still boots + dispatches with a **loud inbox escalation** (not a silent journal
  line); a reboot facing an **already-attempted divergence fingerprint** escalates
  instead of re-repairing (no repair-reboot loop); the severity additions **bump
  the projection-contract version**.
- **Human verify:** [ ] unknown class ⇒ fatal; [ ] repairable self-repairs
  unattended; [ ] fatal degraded contract asserted (not prose); [ ] verify-engine
  crash never bricks the daemon; [ ] no repair-reboot loop.
- **Maps:** phases.md Deliverable 2 (verify severities + boot hooks); Epic 036 gate.

### TC-H6 — Continuation + post-completion compat `p3-continuation-compat` (Epic 037)
- **Run:** the `p3-continuation-compat` scenario.
- **Pass:** an edit to an **untouched parallel lane** lets a running task continue
  under `G` and complete (journaled keep-decision with affected-set evidence); an
  edit to the running task's node / a dependency / a consumed artifact / the epic
  Acceptance section (feature invariant) each **parks that task for rebase** (four
  asserted cases); the continuation decision uses the **same Epic 033 affected-set
  seam** (one implementation, asserted by import/structure test); a task finishing
  under superseded `G` with an unchanged affected set passes the **post-completion
  compat check** and its `github.merge` approval unblocks, while a changed
  dependency/invariant fails it, raises a rework escalation with the diff, and
  merge stays blocked — with **merge-effectiveness** proven (a pre-issued approval
  is suspended by supersession; completion→awaiting-check→merge-block is one
  durable unit across crashes); a compile failure halts the whole feature
  (fallback).
- **Human verify:** [ ] keep vs 4× park all asserted; [ ] same seam as Epic 033;
  [ ] pre-issued approval suspended by supersession; [ ] compile-fail fallback.
- **Maps:** phases.md Deliverable 3 (continuation + compat check); Epic 037 gate.

### TC-H7 — Plan tooling & tuning knobs (Epic 038)
- **Run:** the Epic 038 Story suites.
- **Pass:** a `draft_ok` consumer dispatches on the publisher's durable
  `draft_published` record (**not** a bare file), pinning the draft hash; a
  `frozen` consumer in the same fixture stays blocked; publisher finishing with
  the pinned hash finalizes silently, a different hash re-opens the consumer with
  both hashes + emitted-ops evidence **through the Epic 033 path** (no second
  mechanism); `kanthord renumber` relocates exactly the trio **or a story
  directory**, trips the dirty flag, next compile clean with **unchanged ids**, a
  crash at any stage boundary recovers to one consistent state via the durable
  marker, a collision refusal names both files in planner vocabulary, a
  lint-breaking move needs `--allow-invalid`; compaction threshold resolves per
  model through the policy chain (task→feature→repo→role→system, each level
  asserted) and drives the compaction trigger; poll knobs change fake-clock cadence
  and reject out-of-bounds config at load; the ceiling-input jsonl dataset has one
  record per task respawn-inclusive lifecycle with the asserted fields, readable
  over the control-plane read method. **The Epic 038 poll-interval deviation
  record** (`.agent/plan/feedback/038-plan-tooling-and-tuning/poll-interval-decision.md`)
  exists and states why "poll-interval per model" is implemented as scheduler-wide
  ops knobs (a named Findings-Out artifact, not optional).
- **Human verify:** [ ] `draft_ok` keys on the durable record, not file existence;
  [ ] renumber (trio **and** story directory) is all-or-nothing + ids unchanged;
  [ ] policy chain precedence at every level; [ ] ceiling-input dataset shape
  asserted; [ ] the poll-interval deviation record exists.
- **Maps:** phases.md Deliverable 3 (`draft_ok`, tuning, `renumber`); Epic 038 gate
  + Findings Out.

### TC-H8 — Property-test hardening (Epic 039)
- **Run:** the Epic 039 property suites on the **fixed CI seed list** (the
  time-seeded run is local-only, non-gating).
- **Pass:** two consecutive runs on the fixed seed list produce identical results
  (determinism per the SU4 tooling contract); each safety invariant (no
  overlapping capability leases, dispatch respects DAG order + gates, pinned
  generations never mix, leases always heartbeat or expire) has ≥1 model unit test
  that constructs the invalid state/transition and proves the predicate trips (the
  model is falsifiable, not vacuous); **four planted scheduler bugs** (one per
  invariant family) are each caught with the reproducing seed and shrunk sequence;
  re-running a failure's printed seed reproduces the same sequence; the suites
  drive the **real** dispatch/lease code through the harness seams (no scheduler
  reimplementation).
- **Human verify:** [ ] deterministic on fixed seeds; [ ] four planted bugs all
  caught with seed + shrunk sequence; [ ] no scheduler reimplementation; [ ]
  time-seeded run excluded from CI.
- **Maps:** phases.md Deliverable 4 (property tests); Epic 039 gate.

### TC-H9 — Metrics portfolio aggregation + rubber-stamp (Epic 040)
- **Run:** the Epic 040 Story suites (fixture event/ledger sets — hermetic; web on
  the fake client).
- **Pass:** a **three-feature fixture** produces asserted portfolio rows + trend
  series matching hand-computed values for every derivable metric (approval
  latency = inbox open→response; blocked time = park durations; rework =
  **deduplicated** incidents; % no-human-edit nodes, reporting `unknown` where the
  signal is absent; completion rate; net cost); manual fields (human minutes,
  escaped defects) read **absent** until annotated, then persist with provenance;
  **excluded** interactions (`unclassified-artifact-change`) appear in **no**
  automation-benefit metric but remain in operational-interruption metrics
  (blocked time) and stay countable separately; the **guard signal** fires
  unconditionally on rework deterioration (silent on the all-improving fixture);
  the rubber-stamp fixture (mixed fast-unmodified / slow / modified approvals)
  yields exactly the expected clusters + candidate list with correct evidence
  counts, catch evidence, and proxy labels, and below-threshold clusters yield no
  candidate; web: portfolio table, one trend rendering, the guard warning, and the
  candidate list each render from fixture responses via locator-registry selectors.
- **Human verify:** [ ] derivable metrics match hand-computed values; [ ] excluded
  interactions scoped (out of automation, in blocked-time); [ ] guard fires on
  rework deterioration; [ ] rubber-stamp clusters exact; [ ] web views render.
- **Maps:** phases.md Deliverable 5 (portfolio + rubber-stamp views); Epic 040 gate.

### TC-H10 — Chaos rehearsal `p3-chaos-rehearsal` (Epic 042 Story 001)
- **Run:** the `p3-chaos-rehearsal` scenario.
- **Pass:** kill/restart at **every step** of a replanning-and-continuation-rich
  feature reproduces respawn-equivalence (pending-task set, lease ownership,
  current phase, injected STATE match field-by-field) and unattended recovery —
  the hermetic twin of LP2, so LP2's live pass is de-risked before touching the
  company project.
- **Human verify:** [ ] respawn-equivalence asserted field-by-field at every kill
  point; [ ] recovery needs no human step in the scenario.
- **Maps:** Epic 042 Story 001; phases.md Success criterion 3 (hermetic side).

### Hermetic-lane gate decision
**The hermetic lane passes only when:** G1–G4 hold and TC-H1…TC-H10 are all green
in one `npm test` (+ `test:web`/`e2e:web`) run. This is the precondition for the
live proofs (a red harness fails the whole gate regardless of LP results).

---

## 5. Live proof (LP1…LP4) — real company project

Maps to Epic 042 LP1–LP4. Evidence recorded in
`.agent/plan/feedback/042-phase3-mvp-proof/proof-run.md` with the Epic 019
evidence format (dates, real repo/PR URLs, commit SHAs, command outputs,
ledger/inbox excerpts, verify exit codes, decision-record links) **plus** the
per-feature proof-run preamble: feature-creation timestamp and kanthord build +
config SHAs (the polished-system-only counting rule, §0).

The human side is **driven and recorded from the dashboard via Chrome MCP** (§6)
wherever a dashboard control exists (sign-off, escalation responses, approvals,
halt/resume, portfolio views). Rerun policy (Epic 030/042 gate-wide): an
external-service fault allows a recorded re-run (cause + attempt logged); a
**kanthord-caused** failure fails the gate until fixed and re-run **from LP1**;
unexplained failures count as kanthord failures.

### LP1 — Three real features, one multi-repo, best-run profile
- **Maps:** phases.md Success criterion 1 (≥3 features / ≥1 multi-repo / best-run
  profile); Epic 042 LP1. **Record: `lp1-feature-{1,2,3}.gif`** (dashboard drive
  per feature).
- **Action:**
  1. On the polished system, author + sign off (from the dashboard Features
     surface) **≥3 real company features** end-to-end. At least one spans **≥2
     repos** with a **non-toy artifact-gated handoff** (the consumer's test
     actually consumes the artifact content) and an **observed deploy stage**
     (real observers + soak) — the golden shape, on the real project.
  2. For each feature, let kanthord run it: real pi sessions → commits → PRs via
     the broker; respond to **every** escalation from the dashboard inbox
     (evidence → confirm typed category); approve `github.merge` for each PR from
     the dashboard approval-tier button.
  3. Record the per-feature preamble **before** each run: which build/config SHA is
     live. **Evidence must be system-derived, not prose** — the first-dispatch and
     completion journal entries for each counted feature carry the daemon
     build/config SHA and timestamps from the system's own records (the preamble
     prose only points at them). A preamble that merely *asserts* "ran on the
     polished build" without the daemon-record cross-check does not satisfy the
     counting rule.
- **Best-run selection is declared, not cherry-picked.** "Best run" is not chosen
  after seeing the interaction types. Either **(a)** designate the best-run
  candidate feature **before** its run and hold it to the profile, or **(b)** define
  "best" by a **deterministic pre-declared metric** (e.g. fewest non-
  approval/clarification interactions, ties broken by lowest cost) applied over all
  counted features. Record which rule was used in the proof-run preamble. Post-hoc
  selection to dodge a `correction`/`takeover` is a gate failure.
- **Pass:** each feature reaches **complete** with its PRs human-merged; the
  multi-repo feature's handoff is **hash-checked in the ledger** (publisher exit
  gate → consumer entry gate, hash matched) and its deploy stage's **soak window
  elapsed with observers reporting pass** against their declared criteria; on the
  **pre-declared best run**, the typed interaction record contains **only
  `approval` and `clarification`** interactions (no `correction`/`rework`/
  `takeover` — this is Epic 042 LP1's exact disqualifying set; `external`/`blocker`
  are excluded from autonomy scoring per PRD §2 and are **not** disqualifying) —
  evidenced by the **raw typed interaction rows** (ids, types, any reclassification
  notes) attached to the proof, with the per-feature summary reconciling against
  them (a summary alone can hide classification drift); **every accepted human
  decision has dashboard/Epic-026 origin** (G-ORIGIN, server-side, not the video).
- **Human verify:** [ ] ≥3 features complete, ≥1 multi-repo; [ ] all PR URLs
  recorded + reachable; [ ] multi-repo handoff hash-checked in the ledger; [ ]
  deploy soak elapsed + observers passed (not skipped); [ ] the best-run rule was
  declared before the run; [ ] the best run's raw interaction rows are all
  `approval`/`clarification`; [ ] per-feature summary reconciles to the raw rows;
  [ ] each feature's first-dispatch **and** completion daemon records carry the
  polished build/config SHA + timestamps; [ ] every accepted decision is
  dashboard-origin (G-ORIGIN).
- **Fail signal:** a feature whose daemon records show pre-polish dispatch or
  completion; a handoff not hash-checked; soak skipped; the best run (post-hoc
  selected, or the pre-declared one) contains a `correction`/`rework`/`takeover`; a
  summary that does not reconcile to raw rows; an accepted decision with no
  dashboard origin.

### LP2 — Chaos checks in the real environment
- **Maps:** phases.md Success criterion 3 (chaos checks pass in real env); Epic
  042 LP2. **Record: `lp2-chaos.gif`** (dashboard daemon-ops + inbox during
  recovery) **+ Slack screenshots `lp2-ping-idle.png`.**
- **Action:** during **one counted LP1 feature — preferably the multi-repo one**
  (the "equivalent live run" loophole is closed):
  1. **Kill the daemon process at a named live cutpoint mid-feature** — not any
     idle moment. The cutpoint must have real recovery pressure: a **running task
     with a held lease and a pending/in-flight broker op**, ideally right after a
     replan or continuation transition (reuse the broker debug hold-point where it
     helps make the cutpoint reproducible). Record the kill timestamp **from the
     supervisor log**, the running task id, the held lease, and the in-flight op id.
     Then let the **SU3 supervisor** restart it (not a manual relaunch — that is
     why P8 requires the installed unit).
  2. **Induce a silent-idle day** — the named condition: **zero completed tasks
     with the daemon alive** (Epic 029 semantics; accelerated ops-day boundary
     allowed per Epic 029 provided the real timezone/HH:MM/idempotency code path
     runs — record which path was used).
  3. Run `node src/cli/verify.ts --from-markdown --read-only` against the **live
     store**.
- **Pass, all of:**
  - **Unattended recovery, event-bound:** in the ledger/journal interval from the
    kill timestamp through supervisor restart, boot verify/reconcile, and the
    first resumed task transition, up to the next **pre-existing**
    approval/clarification gate, there is **no** inbox response, config edit,
    manual daemon command, store repair, or supervisor intervention. Because
    supervisor actions live **outside** the daemon ledger, this is cross-checked
    against the **supervisor log**: it shows the automatic restart and **no manual
    `service`/start/stop command** in the recovery interval (a ledger-only check
    cannot see a human relaunch — the supervisor log can).
  - **Idle-day ping:** arrives **on schedule** and carries the **explicit idle
    warning** (alive-but-idle, not down), with the **pending + in-flight +
    open-escalation counts matching daemon state** (cross-check against the
    dashboard daemon-ops view for the same moment).
  - **Verify evidence complete:** the initial report, its severity list, the
    self-repair action taken (if any), and the **clean post-repair re-verify
    (exit 0)** — never "repairable-only" as an unexamined catch-all.
- **Human verify:** [ ] the kill hit a named cutpoint (running task + held lease +
  in-flight op recorded); [ ] recovery interval shows zero human/manual actions
  (event-bound, from ledger **and** supervisor log); [ ] the supervisor log shows
  automatic restart and no manual service command; [ ] idle ping has the explicit
  warning + counts equal to the dashboard; [ ] verify evidence includes a clean
  post-repair re-verify.
- **Fail signal:** a kill at an idle point with no in-flight work; any human/manual
  action inside the recovery interval; a manual relaunch (supervisor log shows a
  service command); an idle day that looks like a normal ping; ping counts
  disagreeing with daemon state; the real schedule logic bypassed; verify left at
  "repairable-only" with no examined re-verify.
- **Note — daily-operation continuity.** The *multi-ops-day scheduled ping* proof
  is Phase 2's (LP-B4) and is not re-run here; Phase 3's new assertion is the
  **induced idle-day** above. But "dependable daily tool" (phases.md Phase 3
  objective) is evidenced by capturing the **normal scheduled pings that fire
  during the LP1 operation window** (attach them to the proof) — so the gate shows
  the daily loop actually ran during real operation, not only that idle detection
  works.

### LP3 — Portfolio populated + a policy decision from the data
- **Maps:** phases.md Success criterion 2 (portfolio + guard + ≥1 data-driven
  policy decision); Epic 042 LP3. **Record: `lp3-portfolio.gif`** (dashboard
  portfolio + rubber-stamp views).
- **Action:** after LP1, open the **portfolio views** in the dashboard; review the
  **rubber-stamp candidate list**; make (or record having made) **≥1 policy
  decision** (loosen or tighten).
- **Pass, all of:**
  - **Every LP1 feature has a populated portfolio row** — derivable metrics
    complete; manual fields either annotated or explicitly marked absent.
  - The **rework guard metric** is tracked across the LP1 runs.
  - **≥1 policy decision (loosen or tighten) is recorded citing the LP1 portfolio
    data collected for this gate.** PRD §11 is apply→observe→modify, so a pre-LP1
    decision does **not** close the loop: the Epic 041 HD1 record qualifies only
    if made or updated **after LP1** with citations to these runs; an independent
    tighten decision qualifies on the same terms; a knob flip **without a data
    citation does not**.
- **Human verify:** [ ] every LP1 feature has a portfolio row; [ ] guard metric
  tracked; [ ] the recorded policy decision cites specific LP1 portfolio
  rows/records; [ ] the decision was made/updated after LP1 (timestamp).
- **Fail signal:** a feature with no portfolio row; guard metric absent; a policy
  decision with no row citation, or dated before LP1.

### LP4 — The improvement guideline exists (PRD §11 second deliverable)
- **Maps:** phases.md Success criterion 4 (written guideline); Epic 042 LP4.
- **Action:** write the PRD §11 second deliverable from the accumulated
  interaction-type data:
  `.agent/plan/feedback/042-phase3-mvp-proof/improvement-guideline.md`.
- **Pass:** the file exists and is **auditable** (data-driven means traceable, not
  plausible prose): it names its **date range**, the **feature inventory** it
  covers (with **counted polished LP1 features separated from pre-polish SU5/interim
  observations** — the SU5 data informs priorities but does not count toward the
  gate, §0; the guideline must not blur the two), and the **interaction-taxonomy
  semantics** in force, and contains at minimum:
  - the **interaction-type distribution** across the real features (LP1 counted set
    explicit; any pre-polish data labelled as such);
  - the top **`correction`/`takeover` clusters** with their suspected causes (PRD
    §2 fix directions);
  - the **rubber-stamp findings** and the **policy decision(s)** taken (LP3);
  - a **prioritized next-changes list where each entry links the specific
    rows/records backing it**.
- **Human verify:** [ ] the guideline file exists; [ ] date range + feature
  inventory + taxonomy semantics named; [ ] all four content elements present;
  [ ] every next-change entry links its backing rows.
- **Fail signal:** no guideline; prose with no row/record links; missing any of
  the four content elements.

---

## 6. Chrome MCP automation protocol (how the AI drives the live proofs)

The AI executes the dashboard side of LP1–LP3 in the browser and records it.
Deterministic, replayable, human-verifiable. **This is the same protocol as
Phase 2 §6** — reproduced here so this suite stands alone; if the two ever drift,
Phase 2 §6 is the canonical source for the tool-surface details.

### Pin the tool surface first (do not assume)
Two MCP servers may be present; they are **not** interchangeable and the exact
names must be **confirmed available at run time** (load via ToolSearch, then
`tabs_context_mcp` / `list_pages` to confirm a live browser) before relying on
them:

- **`mcp__claude-in-chrome__*`** — **drive + record.** `tabs_context_mcp`,
  `tabs_create_mcp`, `navigate`, `find`, `computer`, `read_page`,
  `get_page_text`, and **`gif_creator`** (the recording mechanism — produces an
  animated **GIF**, this suite's "video" artifact).
- **`mcp__chrome-devtools__*`** — **inspect.** `list_network_requests`,
  `take_screenshot`, `list_console_messages` for G-NET capture and per-step
  screenshots.

If no recorder is available, **fall back to a dense screenshot sequence**
(before/after every action) and say so in the evidence — a proof with no visual
record fails G-VID. Do not invent tool names.

### Setup (once per live-proof session)
1. `mcp__claude-in-chrome__tabs_context_mcp` — get the current browser context.
   **Never reuse a tab id from another session.**
2. `mcp__claude-in-chrome__tabs_create_mcp` — open a fresh tab for the dashboard.
3. `mcp__claude-in-chrome__navigate` to the dashboard base URL (pin from P7 /
   Epic 031 SU findings). Authenticate with Basic auth (test operator credentials
   from broker custody — **never hard-code into this file**).
4. Confirm the authenticated Features surface renders (`read_page` / screenshot).
   If unauthenticated, **stop** — that is G-AUTH-NEG's case, run separately.

### Per-LP recording
- Start `mcp__claude-in-chrome__gif_creator` with the LP's named file (§5).
  **Capture extra frames before and after each action** so playback is smooth and
  the result is visible.
- Prefer `mcp__claude-in-chrome__find` + `computer` clicks over blind
  coordinates; read state back with `read_page` / `get_page_text` before
  asserting.
- After each control action, **screenshot** the resulting daemon-state change (the
  dashboard reflecting it) for the manual-verify boxes.
- Stop the recording; save it under the proof-run evidence directory alongside
  `proof-run.md`.

### Network capture (for the carried-forward G-NET)
- During LP1's dashboard drive, capture requests with
  `mcp__chrome-devtools__list_network_requests` (or
  `mcp__claude-in-chrome__read_network_requests`). Save the origin list into the
  evidence. Assert: single authenticated Epic 026 API origin, no third party.

### Safety rails (from the harness browser rules)
- **Do not trigger native dialogs** (`alert`/`confirm`/`prompt`) — they freeze the
  extension. If a dashboard action would confirm-dialog (e.g. a destructive halt),
  warn first and prefer the in-page confirmation the dashboard renders.
- If a browser tool errors 2–3 times, or the page will not load, **stop and
  report** — do not loop. Re-fetch tab context if a tab id goes stale.
- The dashboard is **read + control only**; it cannot edit plans/registries, so
  there is no destructive file action to guard — the risk surface is the
  approval-tier verbs (`github.merge`, deploys) **against the real company
  project**. Drive them deliberately, once, with recording on. Treat the real
  merge/deploy buttons with the caution real side effects deserve.

---

## 7. Traceability — every Phase-3 outcome is covered

**The four phases.md Phase-3 success criteria** (exactly these — "harness green"
is gate *discipline*, not one of the four; see the invariant table below):

| phases.md Phase 3 Success criterion | Covered by |
|---|---|
| ≥3 real features, ≥1 multi-repo, best-run only approval/clarification | LP1 |
| Metrics portfolio populated + guard metric + ≥1 data-driven policy decision | LP3 (+ TC-H9 mechanism) |
| Chaos: crash mid-feature recovers unattended; induced silent-idle detectable; verify reports clean **or** repairable-only — Epic 042 tightens this to *complete verify evidence + a clean post-repair re-verify (exit 0)* | LP2 (+ TC-H10 hermetic twin) |
| The written improvement guideline exists | LP4 |

| phases.md Phase 3 Deliverable (each maps to a green scenario — G4) | Covered by |
|---|---|
| D1 — reconciliation edge cases per verb | TC-H1 (Epic 032) |
| D1 — re-planning flow under `breaking_allowed` | TC-H2 `p3-replan-loop` (Epic 033) |
| D1 — ticket-drift handling + escalation evidence | TC-H3 (Epic 034) |
| D2 — launchd/systemd supervision + log rotation | TC-H4 (Epic 035) |
| D2 — verify severities + boot hooks | TC-H5 (Epic 036) |
| D3 — dirty-plan continuation + compat check | TC-H6 `p3-continuation-compat` (Epic 037) |
| D3 — `draft_ok`, `renumber`, tuning knobs, ceiling inputs | TC-H7 (Epic 038) |
| D4 — property tests over DAG + lease interleavings | TC-H8 (Epic 039) |
| D5 — metrics portfolio + rubber-stamp views | TC-H9 (Epic 040) |
| D6 — usage-driven additions (HD1-gated) | G-HD1 if HD1 = neither/defer; **if HD1 = build**, G2 (its suites green) + G4 (branch) — "resolved" ≠ "covered" when built |

| Cross-cutting Phase-3 invariant | Covered by |
|---|---|
| Harness stays the regression net (P1+P2 green with P3 composed) — gate discipline, not a phases.md success bullet | G2 (+ wiring manifest) |
| Polished-system-only counting (system-record evidence, not prose) | §0 invariant + LP1 daemon records |
| HD1 resolved, no paperwork bypass; built ⇒ built-and-green | G-HD1 + G2 + LP3 |
| Data-driven = traceable (row citations) | LP3 + LP4 |
| Human decisions dashboard-driven, proven server-side | G-ORIGIN + LP1 |
| Best run declared, not cherry-picked | LP1 best-run rule |
| Zero-network hermetic | G3 |
| Dashboard auth / no-bypass / read-only (carried from Phase 2) | G-AUTH, G-AUTH-NEG, G-NET, G-RO (re-run) |
| Live proofs recorded (video/screens) | G-VID |

Every phases.md Phase-3 success criterion and every named deliverable maps to at
least one check. No check introduces a mechanism Epics 031–042 do not already own.

---

## 8. Gate decision (Phase 3 → MVP done)

**Phase 3 — and the MVP — is complete only when ALL of the following hold:**

- [ ] **Preconditions P1–P9** satisfied (Phase-2 gate passed, Epic 031 setup gate
  passed incl. SU5, Epics 032–040 complete, HD1's **pre-LP1** input present,
  supervisor installed, Chrome MCP available, inventories frozen).
- [ ] **Cross-cutting G-series** green: G1, G2 (incl. the wiring manifest), G3, G4,
  **G-HD1**, **G-ORIGIN**, G-VID, and the carried-forward **G-AUTH / G-AUTH-NEG /
  G-NET / G-RO** (each with its named evidence artifact) on the Phase-3 dashboard.
- [ ] **Hermetic lane** green: TC-H1…TC-H10 all green in one `npm test`
  (+ `test:web`/`e2e:web`) run; no Phase-1/2 scenario deleted or skipped to pass a
  Phase-3 brick.
- [ ] **Live proofs** all recorded **pass** in `042-phase3-mvp-proof/proof-run.md`
  with structured evidence and the per-feature polished-system evidence
  (first-dispatch + completion daemon records carrying build/config SHA):
  - [ ] **LP1** — ≥3 real features, ≥1 multi-repo (hash-checked handoff + observed
    deploy soak), **pre-declared** best-run profile evidenced by raw interaction
    rows reconciling to the summary; every accepted decision dashboard-origin
    (G-ORIGIN).
  - [ ] **LP2** — kill at a named cutpoint (running task + held lease + in-flight
    op); supervisor-driven crash recovery **unattended (event-bound, ledger +
    supervisor log)**; induced silent-idle ping with explicit warning + matching
    counts; verify evidence complete with a clean post-repair re-verify.
  - [ ] **LP3** — every LP1 feature has a portfolio row; guard metric tracked; ≥1
    policy decision recorded **citing post-LP1 portfolio data**.
  - [ ] **LP4** — `improvement-guideline.md` exists and is auditable (date range,
    feature inventory, taxonomy, distribution, `correction`/`takeover` clusters,
    rubber-stamp findings + policy decision, prioritized next-changes with row
    links).
- [ ] **Epic 041 HD1 resolved** — built-and-landed, decided-out, or deferred with
  a named re-evaluation trigger (a deferral counts only if LP3's data-cited
  decision satisfies the policy-decision criterion). **An open HD1 blocks the
  gate.**
- [ ] Every Phase-3 interface correction is decision-recorded and the harness is
  green on the corrected seams.

Record the gate result (date, real PR URLs, Slack ping evidence, verify exit
codes, who verified) in `042-phase3-mvp-proof/proof-run.md`. That file + the green
composed hermetic suites + the named recordings + `improvement-guideline.md`
**is** the Phase-3 / MVP-done gate artifact (Epic 042 Findings Out).

---

## 9. Explicitly out of this suite (still post-MVP — phases.md "out of Phase 3")

- **Support/Q&A lane and routing envelope** — deferred to v2 (PRD §11 Out).
- **Customer-facing anything** and visibility-firewall enforcement.
- **Automated preview environments** — first post-MVP investment candidate.
- **Multi-daemon / multi-writer sync**; macOS/iOS/terminal clients; UDS fast-path.
- **Auto-merge / auto-deploy by default** — human keeps the button (a config flip
  is future; not a Phase-3 gate criterion). Note: a **single** additive-diff
  policy flip may land via Epic 041 HD1 *if the data argues for it and the safety
  analysis exists* — that is in-scope-if-decided, not this exclusion.
- **Shape plugin framework (Appendix A)** — extract only at shape #2.
- **More usage-driven additions than HD1 decides** — no handler/knob beyond the
  HD1-decided set (Epic 041 Non-Goals).
- **Performance / Lighthouse / soak-*performance* claims** — the proofs are
  **functional** (soak proves observe-then-decide, not latency); no performance
  number is a Phase-3 gate criterion.
