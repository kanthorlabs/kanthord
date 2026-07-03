# Phase 2 — End-to-End Acceptance Testsuite

Status: **spec / runbook** (authored 2026-07-03). Executable the day the Phase-2
bricks build green. Source of truth for the Phase-2 → Phase-3 gate, in human- and
AI-followable form.

Sources: `.agent/plan/prd.md` (PRD), `.agent/plan/phases.md` (Phase 2, both 2A
and 2B), Epic `019-phase2a-single-repo-proof` (the 2A checkpoint gate), Epic
`030-phase2b-multi-repo-proof` (the 2B completion gate), Epic `027-web-dashboard`
(the control-plane UI), Epic `026-control-plane-api`, Epic `017`/`018`/`029`
(approval surface, verify, dead-man ping). Companion: `phase1-e2e-testsuite.md`
(the deterministic harness this suite still runs, now on real components).

---

## 0. What this suite is (and is not)

- **Is:** a step-by-step acceptance runbook for **all of Phase 2**. Phase 2 has
  two sequential gates: **Part A** = the 2A single-repo checkpoint (Epic 019),
  **Part B** = the 2B multi-repo completion gate (Epic 030). Passing Part B is
  Phase-2-done (the gate to Phase 3). Each test case has exact commands or UI
  steps, one observable pass/fail assertion, the phases.md criterion it maps to,
  and a human manual-verify checkbox.
- **Is not:** a second implementation of the tests. The hermetic assertions live
  in the Epic 010 harness (extended by Epic 019 Story 001 and Epic 030 Story 001)
  and in the Epic 027 `web e2e` suite. This runbook **drives and observes** those
  suites and the **live proofs**; it defines no new mechanism (mirrors the Epic
  010 / 019 / 030 "composition only, no new production mechanism" rule).
- **Has a UI, real external side effects, and video.** Unlike Phase 1, Phase 2
  ships the **web dashboard** (Epic 027), makes **real GitHub PRs**, sends **real
  Slack DMs**, and runs **real pi agent sessions**. So this suite has two
  observation layers:
  1. **Hermetic** — `npm test` / `npm run e2e:web`, zero network, on doubles.
  2. **Live proof** — maintainer + AI drive real credentials against sandbox
     repos; the **dashboard side is driven and recorded with Chrome MCP** (video
     + screenshots) so a human can replay exactly what the AI did.

### Two lanes, never confused

| Lane | Runs against | Network | Evidence artifact |
|---|---|---|---|
| **Hermetic** (G-checks, TC-H*) | doubles / fakes | zero (guarded) | saved test output + green CI URL |
| **Live proof** (LP-A*, LP-B*) | real GitHub / Slack / pi / sandbox repos | real, credentialed | `proof-run.md` structured evidence + Chrome MCP video/screens |

### Phase-2 invariants this suite must never violate

- **Security ordering (phases.md 2A/2B security invariant).** No real agent
  session runs without **full ring 1** (Epic 015). No external **mutating** verb
  ships before **minimal ring 1** (outbound secret scan + fail-closed budget
  ledger, Epic 013) is active on its path. This suite asserts the ordering held,
  not just that the features exist (see G-SEC).
- **The harness stays the regression net.** Every brick swap must leave the full
  Phase-1 harness suite green on real components (fakes retained only for clock
  and failure injection). A red harness fails the gate regardless of live proof.
- **Dashboard exclusivity (2B, gate-wide) — proven server-side, not by video.**
  In Part B every human decision goes through the dashboard only. The recording
  shows *what the AI did*; it does **not** prove nothing happened out-of-band. So
  exclusivity is proven **server-side**: every accepted human decision across
  LP-B1…LP-B4 has an interaction event whose **origin is the dashboard/Epic 026
  API** with the authenticated actor identity, and a matching journal transition;
  **no accepted decision may originate from the 2A curl/CLI surface** (checked by
  querying the interaction/journal records for origin, not by watching the video).
  Any 2A-origin accepted decision is a **gate failure** (Epic 030 gate-wide rule).
- **No-bypass.** No dashboard or API action bypasses the three rings; ring-1
  deterministic policy cannot be switched off from the UI (sole exception: the
  rate-limited, recorded budget override).

---

## 1. Command & surface reference (read before running)

**Hermetic commands** (safe to depend on):

| Command | Meaning |
|---|---|
| `npm run typecheck` | `tsc` type-check of `src/`; must exit 0 |
| `npm test` | full `node:test` harness suite under the zero-network guard, on real components (2A: Epic 019 Story 001; 2B: Epic 030 Story 001) |
| `npm run typecheck:web` | `tsc` of `web/src`; must exit 0 (PROFILE web variant) |
| `npm run test:web` | Vitest + Testing Library unit suite for the dashboard |
| `npm run e2e:web` | Playwright dashboard E2E against the pre-flight daemon seeded with the golden fixture (Epic 027 gate run) |
| `node src/cli/verify.ts --from-markdown --read-only` | shadow-rebuild drift check; **exit 0 clean / 1 divergent / 2 contract-version mismatch** (Epic 018) |

**2A live surface** (Part A only): the Epic 017 approval/metrics inbox over
Connect **HTTP/JSON**, driven with plain `curl` (no client build in 2A). Exact
method names come from the Epic 011 SU6 descriptor.

**2B live surface** (Part B): the **web dashboard** — the Vite production bundle
served per the SU7/PROFILE pre-flight arrangement, over **Basic auth on TLS**,
bound to the VPN interface in production (loopback allowed only by explicit
dev/test config flag — Epic 026 gate). This is the surface Chrome MCP drives.

**Provisional pins** (settle at build time, flagged inline): the dashboard base
URL + port, the daemon boot entrypoint, and the broker **debug hold-point** flag
name (Epic 019 LP4 / Epic 030 — the reproducible cutpoint for kill-mid-op). Pin
these from the Epic 026 SU6 descriptor and the Epic 020 SU5/SU6 findings before
the live proofs.

---

## 2. Preconditions

### Part A (2A checkpoint) preconditions

- [ ] **PA1 — Phase 1 gate passed.** `phase1-e2e-testsuite.md` gate recorded
  green (the deterministic surface is proven before real bricks land).
- [ ] **PA2 — Epics 011–018 complete.** Every 2A brick built and unit-green.
- [ ] **PA3 — Sandbox repo #1 provisioned** and slot-registered (Epic 011 SU5
  posture: real GitHub repo, credentials in broker custody, never in a plan).
- [ ] **PA4 — Security ordering verified in git history / decision records.**
  Epic 013 (minimal ring 1) landed before Epic 014's external mutating verb;
  Epic 015 (full ring 1) landed before Epic 016's live sessions.
- [ ] **PA5 — Epic 016 live-smoke run recorded** (`live-smoke.md`) before LP-A1,
  so signal-fidelity surprises surface cheaply.

### Part B (2B completion) additional preconditions

- [ ] **PB1 — Part A gate passed.** Epic 019 `proof-run.md` records LP-A1…LP-A5
  all pass; 2A interface corrections are decision-recorded and the harness is
  green on the corrected seams.
- [ ] **PB2 — Epics 020–029 complete**, including Epic 027 (the dashboard is
  load-bearing for LP-B1/LP-B2) and Epic 029 (dead-man ping + summary).
- [ ] **PB3 — SU7 bootstrap gate passed.** The PROFILE web bootstrap
  (scaffold + generated Connect-Web client + lane predicates + pre-flight
  script + hello-world through the full pipeline) is green. No web story is
  dispatchable, and no `web e2e` run is meaningful, until this holds.
- [ ] **PB4 — Second sandbox repo provisioned** and slot-registered (the
  multi-repo proof needs two slots).
- [ ] **PB5 — Slack DM target configured** (the dead-man ping recipient; a
  missing target is a config load error, Epic 029).
- [ ] **PB6 — Chrome MCP available and site-permitted** for the dashboard
  origin (see §6). `tabs_context_mcp` returns a live browser.
- [ ] **PB7 — Control-point inventory frozen.** The proof-run preamble snapshots
  the live Epic 026 descriptor's control-point list at proof time; LP-B2 runs
  against that frozen list, not a moving reference.

If any precondition fails, **stop** — that part's gate cannot be evaluated.

---

## 3. Cross-cutting gate checks (G-series)

Properties the whole suite must satisfy, not individual scenarios.

### G1 — Type-check clean (core + web)
- **Run:** `npm run typecheck` and `npm run typecheck:web`.
- **Pass:** both exit 0.
- **Human verify:** [ ] both exit codes are 0.
- **Maps:** Epic 026/027 Verification Gates.

### G2 — Hermetic suites green on real components
- **Run:** `npm test` (Part A: with 2A bricks; Part B: with 2B bricks) and, for
  Part B, `npm run test:web` + `npm run e2e:web`.
- **Pass:** every suite green; the **full Phase-1 harness** passes with real
  components substituted (fakes retained only for clock + failure injection).
- **Binding manifest (required — green is not enough).** The run emits an
  observable **wiring manifest** listing, per seam, whether the **real** adapter
  or a **double** is bound (store, git verbs, github/jira/slack verbs, pi
  session, S3, workflow, observers, ring-2). Assert: for the given part, every
  seam that phases.md says is *real* shows the real adapter, and **only** clock +
  failure-injection seams show doubles. A fake accidentally left in place must
  fail this check even if the suite is green.
- **Human verify:** [ ] 0 failing across `npm test`; [ ] Part B also shows
  `test:web` and `e2e:web` green; [ ] no Phase-1 scenario was deleted or skipped
  to make a brick pass; [ ] the wiring manifest shows real adapters for every
  seam that must be real, doubles only for clock/failure injection.
- **Maps:** phases.md 2B criterion 1; Epic 019 Story 001; Epic 030 Story 001.

### G3 — Hermetic zero-network guard still active
- **Run:** `npm test`.
- **Pass:** the Phase-1 network/credential guard is still installed and
  self-tests pass; real verb adapters run against **doubles**, not the network,
  in the hermetic suite (git on temp remotes, GitHub/Slack on HTTP doubles, pi
  on the SU3 fake, S3 on a double).
- **Human verify:** [ ] guard self-test present and green; [ ] no hermetic
  scenario opens a non-loopback socket.
- **Maps:** Epic 014/016/022/028 hermetic-test constraints; PRD §7.1.

### G-SEC — Security ordering asserted
- **Run:** inspect git history + decision records; run the two named hermetic
  security scenarios (`forced out-of-scope write`, `forced budget breach`).
- **Pass:** minimal ring 1 (Epic 013) predates the first mutating verb path
  (Epic 014); full ring 1 (Epic 015) predates live sessions (Epic 016); the two
  hermetic security scenarios both block + escalate as asserted.
- **Human verify:** [ ] ordering shown in commit/decision-record dates;
  [ ] no real-agent seam is reachable without the ring-1 chain attached.
- **Maps:** phases.md 2A/2B security invariant.

### G-AUTH — TLS + Basic auth + bind policy (dashboard path)
- **Run:** Epic 026 auth suite (hermetic, loopback-TLS) + a live check from
  Chrome MCP.
- **Pass, all of:**
  - A plaintext (non-TLS) call is refused.
  - Wrong credentials ⇒ 401-class error (timing-safe comparison; creds never
    logged).
  - An **unauthenticated** browser session reaches **no** dashboard surface.
  - Bind policy: production accepts only the configured VPN-interface address;
    loopback is dev/test by explicit flag; `0.0.0.0`/`::`/foreign binds fail
    startup with a typed error.
- **Human verify:** [ ] unauthenticated session blank; [ ] bind is not
  `0.0.0.0`; [ ] wrong-password path returns 401-class, nothing logged.
- **Maps:** phases.md 2B Deliverable 6; PRD §9; Epic 026/027 auth gates.

#### G-AUTH-NEG — Unauthenticated browser reaches no surface (its own case)
- **Why separate:** the §6 Chrome MCP setup authenticates first, so the negative
  case cannot be observed inside the LP recordings; it needs a **fresh browser
  context**.
- **Run:** open a **new** tab (`tabs_create_mcp`) with **no credentials
  supplied**; navigate to the dashboard base URL; `read_page` + screenshot.
- **Pass, all of:** no dashboard surface renders (blank/login only); a direct
  request to an Epic 026 read/control method from that context returns a
  401-class error; a **plaintext (non-TLS)** request is refused.
- **Human verify:** [ ] screenshot shows no surface for the unauth context;
  [ ] the 401 body/status is captured as an artifact; [ ] plaintext refused.
- **Fail signal:** any surface data visible, or any method reachable, without
  auth.

### G-NET — Dashboard talks only to the authenticated Epic 026 API
- **Run:** during the LP-B1 dashboard drive, capture network with Chrome MCP
  (`mcp__chrome-devtools__list_network_requests` or
  `mcp__claude-in-chrome__read_network_requests`).
- **Pass:** every request goes to the Epic 026 API origin, authenticated; **no
  other origin**, no unauthenticated call, no external CDN/telemetry.
- **Human verify:** [ ] the captured request list shows a single API origin;
  [ ] every request carries auth; [ ] no third-party host appears.
- **Maps:** Epic 027 gate ("all dashboard traffic is the authenticated Epic 026
  API").

### G-RO — Plan files & registries are read-only from the UI
- **Run:** in the dashboard, open a plan-file view and a verb-registry view.
- **Pass:** the views render but expose **no edit affordance**; the Epic 026
  descriptor has no write method for them, and the write-counting seam shows zero
  writes across all read methods.
- **Human verify:** [ ] no edit/save control exists on plan or registry views;
  [ ] descriptor has no plan/registry write method.
- **Maps:** phases.md "out by design"; Epic 026/027 read-only gates.

### G-VID — Live proofs are recorded
- **Run:** every LP that touches the dashboard is recorded with Chrome MCP
  `gif_creator` (see §6), plus per-step screenshots for manual replay.
- **Pass:** one named recording per LP-B* exists; each captures the action and
  its observable result (before/after frames).
- **Human verify:** [ ] each LP-B* has a recording named per §6; [ ] a human can
  watch it and see the asserted outcome.
- **Maps:** the "AI testing + video recording" requirement of this task.

---

## 4. Part A — 2A single-repo checkpoint (LP-A series)

Maps to Epic 019 LP1–LP5. Driven by CLI + `curl` (no dashboard in 2A — responses
go through the Epic 017 HTTP/JSON surface). Evidence recorded in
`.agent/plan/feedback/019-phase2a-single-repo-proof/proof-run.md` with the Epic
019 structured-evidence format (date, repo URL, PR URL(s), commit SHA(s), command
outputs, ledger/inbox excerpts, verify exit code, decision-record links).

### TC-H-A — Hermetic 2A scenarios green
- **Maps:** Epic 019 Story 001.
- **Run:** `node --test src/harness/*.test.ts` (or `npm test`).
- **Pass:** the Epic 010 golden + lifecycle scenarios pass with the 2A bricks
  substituted (real git store; git verbs on temp remotes; github adapter on its
  double; pi adapter on the SU3 fake), **plus** the three named hermetic 2A
  security scenarios: forced out-of-scope write → blocked + escalated + inbox
  item; forced budget breach → halt + escalation; kill mid-`create_pr` → ledger
  reconciliation against the double.
- **Human verify:** [ ] all three security scenarios present and green;
  [ ] golden scenario green on real store + adapters.
- **Fail signal:** any Phase-1 scenario red on real bricks, or a security
  scenario missing.

### LP-A1 — Golden single-repo feature end-to-end (live)
- **Maps:** phases.md 2A criterion 1; Epic 019 LP1.
- **Action:** author a real one-repo `tdd@1` feature on sandbox repo #1 with the
  **minimum shape**: it changes production code **and** ≥1 test, and its expected
  run produces ≥1 diff escalation and ≥1 broker-pushed commit. Sign off; let
  kanthord run it: session → commits → push → `github.create_pr`; respond to
  escalations via the Epic 017 `curl` surface; merge the PR by hand on GitHub.
- **Pass:** the PR exists on GitHub, produced through the broker (audit ledger
  shows the op chain); the feature reaches **complete** after the human merge;
  every escalate-all-diffs interaction appears in the inbox and is captured as a
  typed interaction event with cost attribution. **The cost breaker was active
  during the normal run** — the durable per-task budget ledger shows spend was
  **reserved before each model call** (not just that a separate breach test
  exists); phases.md says the single-repo proof itself runs "with the cost
  breaker active".
- **Human verify:** [ ] PR URL recorded and reachable; [ ] ledger op chain shows
  the PR came through the broker, not a manual push; [ ] each diff escalation is
  an inbox item + a typed metric event; [ ] the budget ledger shows per-call
  reservations for this run (breaker armed, not merely present in code).
- **Fail signal:** PR created outside the broker, feature stuck, or an escalation
  with no metric event.

### LP-A2 — Forced out-of-scope write blocked (live)
- **Maps:** phases.md 2A criterion 2; Epic 019 LP2.
- **Action:** plant a task whose agent instruction leads it to write outside
  `write_scope`; snapshot the worktree + protected roots before the run.
- **Pass:** the post-run filesystem diff **outside** the allowed roots is
  **empty** (not merely "the one target file is absent"); the blocked call is
  durably recorded (ledger/journal); the escalation appears in the inbox tagged
  **re-planning**; the task does not proceed past it until responded.
- **Human verify:** [ ] full out-of-scope diff is empty; [ ] escalation tagged
  re-planning; [ ] task parked, not silently continued.
- **Fail signal:** any out-of-scope file changed, or the write not escalated.

### LP-A3 — Forced budget breach halts, survives restart (live)
- **Maps:** phases.md 2A criterion 2; Epic 019 LP3.
- **Action:** set the task's hard ceiling to a fixed small value known to be
  below the session's minimum cost (e.g. one model call's conservative
  reservation).
- **Pass:** the halt occurs **before** the breaching call executes (ledger shows
  the reservation attempt, no matching provider charge after it); the halt
  **survives a daemon restart** (the task does not resume spending); the breach
  interaction is captured with cost attribution.
- **Human verify:** [ ] no provider charge after the reservation attempt;
  [ ] restart does not resume the task; [ ] breach recorded as a typed
  interaction.
- **Fail signal:** the breaching call ran, or a restart reset the breaker.

### LP-A4 — Kill mid-`create_pr`, reconcile against real GitHub (live)
- **Maps:** phases.md 2A criterion 2; Epic 019 LP4.
- **Action:** use the broker **debug hold-point** flag (pause the op between its
  ledger write and adapter submit, or between submit and completion — the
  reproducible cutpoint; manual timing would be flaky) to kill the daemon
  mid-`github.create_pr`; restart.
- **Pass:** reconciliation resolves the op via the **head-branch lookup** with
  **no duplicate PR** on GitHub (verified by listing PRs for the head branch);
  recorded evidence includes the real GitHub observed state and the ledger state
  before and after restart; the op reaches a terminal state consistent with the
  real PR.
- **Human verify:** [ ] exactly one PR for the head branch; [ ] op identity
  recovered from the durable ledger, not RAM; [ ] terminal state matches GitHub.
- **Fail signal:** duplicate PR, op lost on restart, or reconciled from memory.

### LP-A5 — Zero divergence + corrections recorded (live)
- **Maps:** phases.md 2A criterion 3/4; Epic 019 LP5.
- **Action:** after LP-A1…LP-A4, run
  `node src/cli/verify.ts --from-markdown --read-only`; review 2A seam
  corrections.
- **Pass:** verify **exits 0** (zero divergence); every interface correction
  made during 2A has a decision record (in or linked from `proof-run.md`); `npm
  test` is green on the corrected seams. (If verify reports transient divergence,
  re-run quiescent per Epic 018 guidance — it does not claim a snapshot against a
  live-writing daemon.)
- **Human verify:** [ ] verify exit code 0; [ ] each correction has a record
  stating what changed, why the live run forced it, affected epics, and the
  harness update; [ ] harness green after corrections.
- **Fail signal:** non-zero verify with no re-run explanation, or an
  undocumented seam change.

### Part A gate decision
**Part A passes only when:** G1–G3 + G-SEC hold, TC-H-A green, and LP-A1…LP-A5 all
recorded **pass** in `proof-run.md`. Part A is the precondition for Part B (PB1).

---

## 5. Part B — 2B multi-repo completion (LP-B series)

Maps to Epic 030 LP1–LP5. The human side is **driven end-to-end from the
dashboard via Chrome MCP** and recorded (§6). Evidence recorded in
`.agent/plan/feedback/030-phase2b-multi-repo-proof/proof-run.md` (Epic 019
evidence format). **Dashboard exclusivity is gate-wide** (§0): any fallback to a
non-dashboard surface across LP-B1…LP-B4 fails the gate.

### TC-H-B — Hermetic 2B scenarios green
- **Maps:** Epic 030 Story 001.
- **Run:** `npm test` + `npm run test:web` + `npm run e2e:web`.
- **Pass:** the full Epic 010 suite green with all 2B bricks substituted (real
  workflow, real store, verb adapters on doubles, ring-2 fake, S3 double), plus
  the named 2B hermetic scenarios: `2b-multi-repo-handoff` (two slots, artifact
  hash gate, two PRs on the double); `2b-deploy-soak-observed` (real observer
  wiring on doubles); `2b-unclassified-artifact-change`; `2b-induced-silent-idle`
  (ping content on a zero-task day). Dashboard `web e2e` green against the
  golden-fixture-seeded pre-flight daemon.
- **Deliverable coverage (required — the headline proof is not enough).** The
  multi-repo LP alone does not exercise every 2B **deliverable**. A missing
  `jira.transition`, a broken S3 sync, `single_checkout` park/resume, wrong
  model-policy resolution, or an unwired observer could pass LP-B1 and still be
  absent. So TC-H-B must include a **named hermetic scenario (or a listed unit
  suite) per 2B deliverable** and the run maps each to its scenario:
  S3 sync round-trip; `single_checkout` + WIP-commit park/resume; each remaining
  broker verb (`jira.transition`, `jira.comment`, `github.create_issue`,
  `github.merge`, read-only observers) with its per-verb contract; fff search
  behind the internal interface; model-policy resolution precedence
  (task→feature→repo→role→system); ring-2 classifier (global-config model);
  observer wiring + `unclassified-artifact-change` byte-diff escalation.
  A deliverable with **no** mapped scenario fails this check.
- **Human verify:** [ ] all four named 2B scenarios present and green;
  [ ] `e2e:web` covers every 2B dashboard surface incl. the per-feature summary;
  [ ] every 2B deliverable in the §7 deliverable-coverage table maps to a present,
  green scenario/suite (no deliverable proven only indirectly by LP-B1).
- **Fail signal:** any named scenario missing, a dashboard surface not exercised
  by `e2e:web`, or a 2B deliverable with no mapped hermetic scenario.

### LP-B1 — Multi-repo feature end-to-end, dashboard-driven (live)
- **Maps:** phases.md 2B criterion 2; Epic 030 LP1. **Record: `lp-b1-multi-repo-handoff.gif`.**
- **Action:** author a real **two-repo** `tdd@1` feature with a **non-toy
  artifact handoff** — the consumer's test must actually consume the artifact's
  content, so a stale artifact makes the consumer's suite fail. The publisher
  also carries a deploy stage with observers + soak. Minimum shape per LP-A1 in
  **each** repo (production code + test; ≥1 diff escalation; ≥1 broker PR per
  repo). Then drive **every** human action from the dashboard via Chrome MCP:
  1. **Sign-off** the plan from the Features surface.
  2. Respond to **every escalation** from the inbox (evidence → confirm typed
     category).
  3. **Demonstrate hash blocking live:** re-publish a changed artifact; observe
     the consumer **blocked** in the dashboard until you re-approve.
  4. Induce **at least one halt** on a running task from the dashboard, then
     **resume** it.
  5. Approve `github.merge` for **both** PRs from the dashboard approval-tier
     buttons.
- **Pass:** publisher exit gate → consumer entry gate **hash-checked** → **two
  real PRs** → observed deploy stage passes its **functional soak** → human
  merges via the dashboard `github.merge` approval; the induced halt parked and
  resumed correctly; the stale-artifact re-publish blocked the consumer until
  re-approval; **every accepted human decision has a dashboard/Epic-026-origin
  interaction event with the authenticated actor** (server-side provenance, per
  §0 — not just "no fallback in the video").
- **Functional soak, not a performance claim.** The pass condition is: the soak
  **window elapses** and the registered observers report **pass** against their
  declared criteria (rollout complete / error-rate under threshold / zero new
  issues). No latency/throughput number is asserted — the soak proves the
  *observe-for-N-then-decide* mechanism works, which is Phase-2 scope; deploy
  performance is not (see §9).
- **Human verify:** [ ] both PR URLs recorded; [ ] the recording shows sign-off,
  each escalation response, both merges, and the halt+resume all in the
  dashboard; [ ] the stale artifact demonstrably blocked the consumer; [ ] the
  soak window elapsed and observers reported pass (not skipped); [ ] the
  interaction/journal records show every accepted decision originated from the
  dashboard/API, none from the 2A surface.
- **Fail signal:** any human step done outside the dashboard, no live hash block,
  soak skipped, or a PR not merged through the dashboard verb.

### LP-B2 — Control-point coverage sweep (live)
- **Maps:** phases.md 2B criterion 3; Epic 030 LP2. **Record: `lp-b2-control-sweep.gif`.**
- **Action:** exercise **every** control point on the **frozen** PB7 inventory
  from the dashboard, one by one.
- **Anti-circularity check (required).** The frozen PB7 inventory is the daemon's
  **self-reported** descriptor — if the descriptor omits a required control point,
  a sweep over it alone would still pass. So first **cross-check** the frozen list
  against the **required** dashboard surfaces enumerated in phases.md 2B
  Deliverable 6 + Epic 027's surface list (features sign-off/halt/re-plan-approve;
  inbox responses; approval-tier verbs incl. `github.merge`; budget override;
  verify trigger). A required control point **absent** from the descriptor is a
  gate failure, not an out-of-scope row.
- **Pass:** the cross-check finds no required control point missing from the
  descriptor; then for each control point the sweep table records **method →
  dashboard location → resulting daemon state + the journal/inbox capture it
  produced** (not click-success alone); every row passes; **no control point
  requires falling back to the 2A surface**.
- **Human verify:** [ ] the frozen inventory covers every required phases.md/Epic
  027 surface (nothing required is missing); [ ] the sweep table has one row per
  frozen control point; [ ] each row shows a real daemon-state change or capture,
  not just a UI ack; [ ] every daemon control point is reachable from the
  dashboard.
- **Fail signal:** a required control point missing from the descriptor, any
  control point missing from the dashboard, or a row that only shows a click with
  no state change.

### LP-B3 — Metrics visibility (live)
- **Maps:** phases.md 2B criterion 4; Epic 030 LP3. **Record: `lp-b3-metrics-summary.gif`.**
- **Action:** after LP-B1, open the feature's **per-feature summary** in the
  dashboard.
- **Pass:** a **complete reconciliation table** — **every** LP-B1 interaction
  from the inbox/journal record appears in the summary, **typed** (confirmed
  categories), with **cost attribution**; excluded interactions
  (`unclassified-artifact-change`) sit **outside** the headline automation
  metric; **zero unmatched rows**.
- **Human verify:** [ ] every LP-B1 interaction reconciles to a summary row;
  [ ] types are the human-confirmed categories; [ ] cost shown; [ ] excluded
  interactions are outside the headline; [ ] no unmatched rows either direction.
- **Fail signal:** any interaction missing from the summary, a wrong type, or an
  excluded interaction counted in the headline.

### LP-B4 — Dead-man ping live (live)
- **Maps:** phases.md 2B criterion 5; Epic 030 LP4. **Record: Slack screenshots
  `lp-b4-ping-day{1,2,idle}.png` (Slack is outside the dashboard — capture the
  DMs directly).**
- **Schedule semantics (Epic 029 — not left to interpretation).** Fire once per
  calendar day in the **configured ops timezone** at the configured **HH:MM**;
  idempotency key = daemon-instance-id + ops-date; on a boundary missed while
  down, send at startup iff no successful ping exists for the current ops day.
  **Tolerance:** a ping is "on schedule" if it lands within the ping's own
  same-ops-day window (not to the second). **Accelerated path allowed for the
  proof:** exercising this over 2 real calendar days is not required — a
  config-driven short ops-day boundary (or a test scheduler hook, if one exists)
  may compress it, **provided** the timezone/HH:MM/idempotency logic is the real
  code path, not bypassed. Record which path was used.
- **Action:** let the daily ping fire for **≥2 consecutive ops-days** (real or
  accelerated per above); then induce a **silent-idle day** — defined as **zero
  completed tasks**.
- **Pass:** pings arrive in Slack **on schedule** (per tolerance above); the idle
  day's ping content carries the **explicit idle warning** (detectable without
  noticing an absence); the **pending + in-flight and open-escalation counts** in
  the pings **match the daemon's actual state** (cross-check against the dashboard
  daemon-ops view for the same moment); a **forced send-failure** records a
  durable open escalation in the local inbox (not only another Slack attempt).
- **Human verify:** [ ] ≥2 scheduled pings received (path recorded); [ ] idle-day
  ping has an explicit warning in its content; [ ] counts in the ping equal the
  dashboard's daemon-ops counts; [ ] a send-failure surfaces as a local inbox
  escalation.
- **Fail signal:** a ping missed its window, the idle day looks like a normal
  ping, ping counts disagree with daemon state, or the real schedule logic was
  bypassed rather than accelerated.

### LP-B5 — Verify, corrections, harness green (live)
- **Maps:** phases.md 2B criterion 1; Epic 030 LP5.
- **Action:** run `node src/cli/verify.ts --from-markdown --read-only` after
  LP-B1; review all 2B seam corrections.
- **Pass:** verify **exits 0**; every 2B correction has an Epic 019-format
  decision record; `npm test` green on the corrected seams (the harness stayed
  the regression net through every brick swap).
- **Human verify:** [ ] verify exit 0; [ ] each 2B correction recorded; [ ]
  harness green after corrections.
- **Fail signal:** non-zero verify unexplained, or an undocumented 2B seam change.

### Rerun policy (Epic 030 gate-wide)
An LP failure classified as an **external-service fault** (per the verb
taxonomies) allows a recorded re-run (cause + attempt logged). A failure caused
by **kanthord** fails the gate until fixed and re-run **from LP-B1**. Unexplained
failures count as kanthord failures.

---

## 6. Chrome MCP automation protocol (how the AI drives Part B)

The AI executes LP-B1…LP-B3 in the browser and records them. Deterministic,
replayable, human-verifiable.

### Pin the tool surface first (do not assume)
Two MCP servers may be present; they are **not** interchangeable and the exact
names must be **confirmed available at run time** (load via ToolSearch, then
`tabs_context_mcp` / `list_pages` to confirm a live browser) before relying on
them. Their roles here:

- **`mcp__claude-in-chrome__*`** — **drive + record.** `tabs_context_mcp`,
  `tabs_create_mcp`, `navigate`, `find`, `computer`, `read_page`,
  `get_page_text`, and **`gif_creator`** (the recording mechanism — it produces
  an animated **GIF**, which is this suite's "video" artifact).
- **`mcp__chrome-devtools__*`** — **inspect.** `list_network_requests`,
  `take_screenshot`, `list_console_messages` for G-NET capture and per-step
  screenshots.

If neither `gif_creator` nor an equivalent recorder is available in the actual
run environment, **fall back to a dense screenshot sequence** (before/after every
action) and say so in the evidence — a proof with no visual record fails G-VID.
Do not invent tool names; use whatever the confirmed surface exposes.

### Setup (once per Part-B session)
1. `mcp__claude-in-chrome__tabs_context_mcp` — get the current browser context.
   **Never reuse a tab id from another session.**
2. `mcp__claude-in-chrome__tabs_create_mcp` — open a fresh tab for the dashboard.
3. `mcp__claude-in-chrome__navigate` to the dashboard base URL (pin from PB6 /
   Epic 020 SU5 findings). Authenticate with Basic auth (test operator
   credentials from broker custody — never hard-code into this file).
4. Confirm the authenticated Features surface renders (`read_page` / a
   screenshot). If the session is unauthenticated, **stop** — that is G-AUTH's
   negative case, run separately.

### Per-LP recording
- Start `mcp__claude-in-chrome__gif_creator` with the LP's named file (see each
  LP above). **Capture extra frames before and after each action** so playback is
  smooth and the result is visible.
- Prefer `mcp__claude-in-chrome__find` + `computer` clicks over blind
  coordinates; read state back with `read_page` / `get_page_text` before
  asserting.
- After each control action, **screenshot** the resulting daemon-state change
  (the dashboard reflecting it) for the LP-B2 sweep table and the manual-verify
  boxes.
- Stop the recording; save it under the proof-run evidence directory alongside
  `proof-run.md`.

### Network capture (for G-NET)
- During LP-B1, capture requests with
  `mcp__chrome-devtools__list_network_requests` (or
  `mcp__claude-in-chrome__read_network_requests`). Save the origin list into the
  proof-run evidence. Assert: single API origin, all authenticated, no third
  party.

### Safety rails (from the harness browser rules)
- **Do not trigger native dialogs** (`alert`/`confirm`/`prompt`) — they freeze
  the extension. If a dashboard action would confirm-dialog (e.g. a destructive
  halt), warn first and prefer the in-page confirmation the dashboard renders.
- If a browser tool errors 2–3 times, or the page will not load, **stop and
  report** — do not loop. Re-fetch tab context if a tab id goes stale.
- The dashboard is **read + control only**; it cannot edit plans/registries, so
  there is no destructive file action to guard here — the risk surface is the
  approval-tier verbs (`github.merge`, deploys), which are the point of the proof
  and are driven deliberately, once, with recording on.

---

## 7. Traceability — every Phase-2 outcome is covered

| phases.md 2A success criterion | Covered by |
|---|---|
| Single-repo proof: plan → real agent → real PR → human merge, escalate-all-diffs + cost breaker | LP-A1 |
| Forced out-of-scope write blocked + escalated | LP-A2 |
| Forced budget breach halts | LP-A3 |
| Daemon kill mid-`create_pr` reconciles against real GitHub | LP-A4 |
| `kanthord verify` zero divergence after the proof | LP-A5 |
| Interface corrections decision-recorded + harness green | LP-A5 (+ G2) |

| phases.md 2B success criterion (gate to Phase 3) | Covered by |
|---|---|
| Full Phase-1 harness green on real components | G2 + TC-H-B |
| Multi-repo proof: handoff (hash-checked) → 2 PRs → observed deploy soak → human merges, dashboard-driven, incl. induced halt | LP-B1 |
| Every human control point reachable from the dashboard (no 2A fallback) | LP-B2 |
| Every human interaction captured, typed, visible in per-feature summary | LP-B3 |
| Dead-man ping on schedule + induced silent-idle detectable | LP-B4 |

| Cross-cutting Phase-2 invariant | Covered by |
|---|---|
| Security ordering (minimal ring 1 before mutating verb; full ring 1 before live sessions) | G-SEC + PA4 |
| Dashboard = only the authenticated Epic 026 API, no bypass | G-NET + G-RO |
| Dashboard exclusivity proven server-side (interaction origin, not video) | §0 invariant + LP-B1 + LP-B2 |
| TLS + Basic auth + bind policy (incl. unauth negative case) | G-AUTH + G-AUTH-NEG |
| Live proofs recorded (video/screens) | G-VID |

**2B deliverable coverage** (phases.md 2B deliverable list — each must map to a
present, green scenario, not be inferred from LP-B1; enforced by TC-H-B):

| phases.md 2B deliverable | Covered by |
|---|---|
| S3 sync (backup/replication, single-writer) | TC-H-B `s3-sync-roundtrip` |
| `single_checkout` + WIP-commit park/resume | TC-H-B `single-checkout-park-resume` |
| Remaining broker verbs (`jira.transition`, `jira.comment`, `github.create_issue`, `github.merge`, observers) | TC-H-B per-verb suites (Epic 022) |
| fff search behind the internal interface | TC-H-B `fff-search` (Epic 023) |
| Real `tdd@1` workflow + model policy + provider registry | TC-H-B workflow suite + `model-policy-resolution` (Epic 024) |
| Ring-2 classifier (global-config model) | TC-H-B ring-2 scenario (Epic 025) |
| Connect full API + web dashboard | G2 (`test:web`/`e2e:web`) + LP-B1/LP-B2 |
| Deploy observers + `unclassified-artifact-change` byte-diff | TC-H-B `2b-deploy-soak-observed` + `2b-unclassified-artifact-change` |
| Dead-man ping | TC-H-B `2b-induced-silent-idle` + LP-B4 |
| Per-feature metrics summary | Story-007 `web e2e` + LP-B3 |

Every phases.md Phase-2 success criterion (2A and 2B) and every stated Phase-2
invariant maps to at least one check. No check introduces a mechanism Epics
011–030 do not already own.

---

## 8. Gate decision (Phase 2 → Phase 3)

**Phase 2 is complete only when ALL of the following hold:**

- [ ] **Part A** passed and recorded (§4 gate decision):
  G1–G3 + G-SEC, TC-H-A green, LP-A1…LP-A5 pass in the 019 `proof-run.md`.
- [ ] **Part B** passed and recorded:
  - [ ] G1, G2 (incl. `test:web` + `e2e:web` **and the wiring manifest**), G3,
    G-AUTH, **G-AUTH-NEG**, G-NET, G-RO, G-VID.
  - [ ] TC-H-B green (all four named 2B scenarios + dashboard E2E) **and every 2B
    deliverable in the §7 deliverable-coverage table maps to a present, green
    scenario** (no deliverable proven only by LP-B1).
  - [ ] LP-B1…LP-B5 all recorded **pass** in the 030 `proof-run.md`, with
    structured evidence (dates, URLs, SHAs, ledger/inbox excerpts, decision-record
    links) and the Chrome MCP recordings (or screenshot sequences) named per §6.
  - [ ] Dashboard exclusivity held across LP-B1…LP-B4, **proven server-side**
    (every accepted decision has a dashboard/API-origin interaction event; none
    from the 2A surface) — not by video alone.
  - [ ] Every 2B interface correction is decision-recorded and the harness is
    green on the corrected seams.

Record the gate result (date, PR URLs, Slack ping evidence, verify exit codes,
who verified) in the 030 `proof-run.md`. That file + green hermetic suites + the
named recordings **is** the Phase-2 → Phase-3 gate artifact (Epic 030 Findings
Out). It is the input to Phase-3 planning.

---

## 9. Explicitly out of this suite (deferred, by phase)

- **Semantic contract-artifact handlers** — Phase 2 is byte-diff + escalate;
  `unclassified-artifact-change` is the MVP stance (phases.md "out of Phase 2").
- **Auto-merge / auto-deploy / automated cross-repo rollback** — human keeps the
  button in MVP (PRD §7.4, §9); the proofs merge by human approval only.
- **Preview environments, multi-daemon, non-web clients, UDS fast-path** —
  post-MVP (PRD §11).
- **`kanthord verify` severity levels + startup/post-crash hooks** — **Phase 3**;
  Phase 2 uses the basic on-demand exit-code contract (0/1/2, Epic 018).
- **Property tests over DAG + lease interleavings** — **Phase 3** "later
  hardening" (PRD §7.7); this suite ships named scenarios + live proofs only.
- **Metrics portfolio / trend views** — **Phase 3** grows the dashboard; Phase 2
  ships only the per-feature summary (LP-B3).
- **Real company project** — Phase 3's opening move; Phase 2 proves on sandbox
  repos.
- **Lighthouse / performance / soak *performance* claims** — the proofs are
  **functional**; no performance assertion is a Phase-2 gate criterion.
