# kanthord — Deployment Phases (Lego Plan)

Source: `.agent/plan/prd.md` (the PRD). This document defines **how the MVP is
built and rolled out in three phases**, following the lego logic:

1. **Phase 1 — Frame:** build the structure of the whole system with fakes, and
   prove the deterministic workflow end-to-end.
2. **Phase 2 — Bricks:** replace each fake with a real implementation behind
   stable seams. Phase 2 has an internal hard checkpoint: **2A** proves one
   thin real vertical slice early; **2B** expands to full MVP breadth.
3. **Phase 3 — Polish:** perfect the system — optimizations, deep error
   handling, and additional features — and operate it on a real project.

The three phases together deliver the PRD's MVP scope (§11). Phases are
sequential gates: a phase closes only when its success criteria pass.

> Debate-hardened (adversarial engine, 2026-07-02). Key changes from the
> debate: Phase 1 is framed as *contract-hypothesis validation*, not
> architecture proof; Phase 2 gained the 2A/2B split so the first live proof
> arrives early, not after nine bricks; minimal ring-1 now precedes the first
> external mutating verb; dead-man ping and a basic `kanthord verify` moved
> from Phase 3 into Phase 2.

---

## Guiding rules (apply to every phase)

- **Interface first, fake second, real third.** Every component gets a typed
  interface and an in-memory/fake implementation in Phase 1. Phase 2 swaps
  fakes for real implementations behind the same interface. Fakes are never
  deleted — they become permanent test doubles for the lifecycle harness
  (PRD §7.7).
- **Seams are stable intent, not frozen law.** Phase-1 fake contracts are
  hypotheses. Early real integration (Phase 2A) is *expected* to correct some
  interfaces; a correction needs a short decision record, not a change-control
  process. What is frozen is the harness suite: it must be updated and green
  after every seam correction.
- **The deterministic surface is testable without an LLM** (PRD §7.1): lint,
  compile, schedule, gate mechanics, lease behavior. Phase 1 proves exactly
  this surface. Nothing in Phase 1 calls a model or the network. What Phase 1
  cannot prove — real agents, provider failures, external auth, rate limits,
  human approval behavior — is deliberately deferred to Phase 2, and the
  Phase-1 gate makes no claim about those seams.
- **One golden scenario carries across all phases:** a sample `tdd@1` feature
  with two stories and one parallel lane, exercising DAG order, scope leases,
  an artifact handoff, a gate pair, and a deploy chain. In Phase 1 it runs on
  fakes; in Phase 2 on real components; in Phase 3 on a real company project.
- **Gate criteria are named scenarios, not judgment calls.** When a phase is
  decomposed into Epics (`.agent/authoring.md`), every success criterion below
  must map to a named, executable harness scenario or checklist item with an
  observable pass/fail assertion. A criterion that cannot be expressed that
  way must be rewritten before implementation starts.
- **All work runs through the TDD pipeline** (`.agent/authoring.md`): each
  phase is decomposed into Epics/Stories/Tasks before implementation starts.
  This document is the design source, not the executable plan.

---

## Phase 1 — Frame: structure, contracts, and a walking skeleton

### Objective

Build every layer of PRD §3 as a typed seam with a fake behind it, and prove
the **deterministic surface** end-to-end: a plan file goes in one end and a
completed (fake) feature comes out the other, reproducibly. This validates the
workflow design and the contract hypotheses cheaply — it does **not** prove
the architecture at the real-world seams (agents, providers, external APIs);
that is Phase 2's job, and 2A exists to test those hypotheses early.

### Requirements

- No LLM calls, no network, no external credentials anywhere in Phase 1.
- All components behind interfaces with fake/in-memory implementations.
- The deterministic lifecycle harness (PRD §7.7) is built **in this phase**,
  not later — it is what "prove the workflow" means: fake clock, fake broker
  (success/failure/timeout/regression), temp SQLite, temp git repo,
  crash/restart entrypoint. Clock and broker are injectable seams from day one.
- Storage conventions fixed now (PRD §7.1.1 format rules): markdown +
  frontmatter for plan nodes, jsonl for journals/events, yaml for registries,
  SQLite for the compiled plan.
- The markdown→SQLite projection is written down as the versioned contract the
  PRD requires (§6.1) — `kanthord verify` (Phase 2A) and the severity levels
  (Phase 3) build on it; its semantics are designed here, not retrofitted.

### Deliverables

1. **Plan Contract compiler (`tdd@1`, hardcoded):** walk/parse filename
   grammar → frontmatter cross-check → edges + core lint → shape lint →
   compile to SQLite rows; `compile_hash` + generation stamping; planner-
   vocabulary diagnostics (PRD §7.1.1 pipeline steps 1–5).
2. **Scheduler skeleton:** SQLite task rows, DAG dispatch as a `WHERE` clause
   on the poll, scope + resource leases with expiry/heartbeat, `blocked_on:
   op_id` park/resume transition (PRD §7.3).
3. **Broker skeleton:** verb registry (yaml), always-async submit/poll
   lifecycle, idempotency keys, durable operation ledger entries in markdown,
   reconciliation state machine — all against the **fake** broker (PRD §5).
4. **Markdown store skeleton:** single-writer feature directory
   (frontmatter/STATE/JOURNAL triples, RUNBOOK), rebuild-SQLite-from-markdown
   path with the projection contract documented (PRD §6.1–6.2).
5. **Workflow interface** (`phases[]`, `gateCheck`, `checkpoint`) with a fake
   workflow driving the TDD gate pair; **agent session interface** (spawn/
   teardown/respawn from STATE.md) with a scripted fake agent (PRD §3.2, §10).
6. **Deploy-chain executor** with fake observers and soak timers on the fake
   clock (PRD §7.4).
7. **Daemon shell:** single process wiring the above + Connect RPC server
   with `/healthz` and a minimal read-only status API (PRD §3.1) — enough to
   prove the transport layer seam, no web client yet.
8. **Harness scenario suite:** golden path; lease expiry + heartbeat timeout;
   crash/restart with ledger reconciliation; compaction respawn (respawn-
   equivalence as defined in PRD §7.7); dirty-plan recompile with generation
   pinning; phase-boundary hash drift.

### Success criteria (gate to Phase 2)

- The golden scenario runs end-to-end on fakes in CI: sign-off compile →
  DAG-ordered dispatch respecting leases → artifact handoff gate → TDD gate
  pair → fake deploy chain with soak → feature complete — fully deterministic.
- Kill-and-restart at any scenario step reproduces the pre-crash pending-task
  set, lease ownership, phase, and injected STATE (respawn-equivalence,
  asserted field-by-field per PRD §7.7's definition).
- A deliberately invalid plan set (cycle, forward handoff, overlapping lanes,
  missing ticket ref, missing body section) is rejected with planner-
  vocabulary diagnostics (asserted against expected diagnostic text).
- Rebuilding SQLite from markdown yields the same markdown-derived projection
  (asserted per the documented projection contract).
- All of the above run with zero network access (enforced in the test runner).

### Explicitly out of Phase 1

Real pi sessions, real broker verbs, S3 sync, fff, web client UI, guardrail
classifier (ring 2), metrics dashboards. Ring-1 *interfaces* (write-scope
check, budget ledger) exist as seams but enforce against fakes only.

---

## Phase 2 — Bricks: real implementations behind the stable seams

### Objective

Replace every fake with a production implementation without breaking the
harness suite. **2A** proves the core loop on real components as early as
possible — one thin vertical slice, one real PR — so wrong contract
hypotheses surface while they are cheap to fix. **2B** then expands breadth
to the full MVP scope, ending with the multi-repo proof — the PRD's reason
to exist.

### Requirements

- Interface corrections found during 2A get a short decision record and a
  harness update; the harness suite must stay green after every brick swap —
  it is the regression net for the whole phase.
- Bricks land in dependency order; each brick has its own verification before
  the next starts.
- **Security invariant:** no real agent session ever runs without full ring-1
  enforcement, and no external *mutating* verb ships before minimal ring-1
  (secret-pattern scan on outbound content + fail-closed budget ledger) is
  active on its path.

### Phase 2A — minimal real vertical slice

Deliverables, in order:

1. **Real markdown store** + git-based feature dirs (single-writer invariant;
   PRD §6.1–6.2). S3 sync deferred to 2B — it is replication, not the loop.
2. **Minimal ring 1:** secret-pattern scan on anything leaving the machine +
   fail-closed cost circuit-breaker with the durable per-task ledger surviving
   respawns (PRD §4). Lands **before** the first external mutating verb.
3. **Minimal real broker path:** `git.*` local ops (auto) + `github.create_pr`
   (auto-with-audit), each with `submit`, `poll_status`, terminal states,
   backoff, timeout+escalation, and a reconcile path (PRD §5).
4. **Full ring 1 for agents:** path allowlists + write-scope `beforeToolCall`
   blocking + escalation (PRD §4) — a hard precondition for the next brick.
5. **Real agent sessions:** pi stack in repo slots, worktree strategy,
   compaction at the configured window threshold via the Phase-1 respawn path
   (PRD §3.2–3.3). (`single_checkout` + WIP-commit park/resume may land in 2B
   if no mobile repo is in the 2A proof.)
6. **Basic approval surface + basic metrics:** ring-3 approval over the
   Phase-1 status API (minimal UI or CLI), every human interaction captured
   with typed classification and cost attribution (PRD §2, §4).
7. **Basic `kanthord verify`:** rebuild shadow SQLite from markdown, diff the
   markdown-derived projection, report divergences (severity levels and
   startup hooks come later; PRD §6.1).

#### Success criteria (2A checkpoint — gate to 2B)

- **Single-repo proof:** one real feature on a sandbox repo runs
  plan → real agent session → real PR via broker → human merge, with
  escalate-all-diffs and the cost breaker active.
- A forced out-of-scope write is blocked and escalated; a forced budget breach
  halts the task; a daemon kill mid-`create_pr` reconciles from the ledger
  against the real GitHub state.
- `kanthord verify` reports zero divergence after the proof run.
- Interface corrections made during 2A are decision-recorded and the harness
  suite is green on the corrected seams.

### Phase 2B — full MVP breadth

Deliverables:

1. **S3 sync** (backup/replication, single-writer; PRD §6.1) and
   `single_checkout` strategy with WIP-commit park/resume (PRD §3.3).
2. **Remaining MVP broker verbs** (PRD §5): `jira.transition`, `jira.comment`,
   `github.create_issue` (auto-with-audit); `github.merge` (approval);
   read-only observer verbs. Same per-verb contract as 2A.
3. **fff search** in the daemon, pinned version, behind the thin internal
   search interface (PRD §6.4).
4. **Real TDD workflow** (`tdd@1` execution: failing-test entry gate,
   tests-pass exit gate, `checkpoint()` writing STATE.md) + model policy
   resolution chain and provider registry (PRD §8, §10).
5. **Ring 2 classifier** (global-config model only; PRD §4).
6. **Connect RPC full API + web client — the control-plane dashboard**
   (MVP UI). One place to see and control everything the daemon owns. Every
   dashboard action goes through the same Connect API and the same three
   security rings — the dashboard has no privileged bypass, and ring-1
   deterministic policy cannot be switched off from it (sole exception: the
   PRD §4 budget override, rate-limited and recorded as an interaction).
   Surfaces:
   - **Features:** list; per-feature drill-down showing what runs inside the
     feature (stories/tasks with live status, DAG progress, in-flight broker
     operations, STATE/JOURNAL views); plan sign-off; halt on a running
     feature/task (PRD §6.3); re-planning diff approval (PRD §7.5).
   - **Escalations & approvals:** inbox with evidence attached; ring-3
     approvals and approval-tier verb buttons (`github.merge`, deploys).
   - **Broker:** in-flight / pending / expiring operations, reconciliation
     status; read-only verb-registry view with tiers.
   - **Repo slots:** registered repos, strategy, held leases, active sessions.
   - **Budgets:** per-task ledger and circuit-breaker state; the recorded
     human override.
   - **Daemon ops:** health, dead-man ping status, trigger `kanthord verify`
     and view its report.
   Basic auth over TLS, bound to the VPN interface (PRD §3, §9). The approval
   flow proven in 2A is **re-validated through this dashboard**. Out of the
   dashboard by design: authoring/editing plan files (planning is external,
   PRD §1) and editing registries/config (yaml on disk under git discipline)
   — the dashboard shows them read-only.
7. **Deploy-chain observers, real read-only verbs** (`k8s.rollout_status`,
   `sentry.new_issues`, `signoz.query`) wired into the Phase-1 chain executor
   (PRD §7.4); byte-diff fallback + `unclassified-artifact-change` escalation
   for contract artifacts (PRD §7.2).
8. **Dead-man ping** (daily "alive, N tasks processed" Slack DM via broker;
   PRD §3.1) — required here, not Phase 3: 2B already runs real external
   side effects, so silent-idle detection must exist before daily operation.
9. **Per-feature metrics summary** ("4 human interactions, $11") readable in
   the web client — the raw capture from 2A made visible (PRD §2).

#### Success criteria (gate to Phase 3)

- Full Phase-1 harness suite green on real components (fakes still used for
  clock/failure injection).
- **Multi-repo proof (MVP baseline):** one real two-repo feature with an
  artifact-gated handoff completes: publisher exit gate → consumer entry gate
  (hash-checked) → two PRs → observed deploy stage with soak → human merges —
  and the human side is driven **end-to-end from the dashboard**: sign-off,
  every approval, every escalation response, and at least one induced halt.
- Every human control point the daemon exposes in 2B is reachable from the
  dashboard — no control action requires falling back to the 2A surface.
- Every human interaction in the proof is captured, typed, and visible in the
  per-feature summary.
- Dead-man ping observed firing on schedule; an induced silent-idle day is
  detectable from the ping content.

### Explicitly out of Phase 2

Semantic contract-artifact handlers (byte-diff + escalate is the MVP stance),
auto-merge/auto-deploy, preview environments, multi-daemon, non-web clients.

---

## Phase 3 — Polish: perfect, harden, and operate

### Objective

Turn the working system into a dependable daily tool: deep error handling,
performance and cost optimization, operational visibility, and the additional
features that the first real usage shows are worth building. Close the PRD's
rollout loop: apply to a real company project → observe the metrics
portfolio → modify (PRD §11).

### Requirements

- Phase 3 starts by putting kanthord on a **real company project** — polish is
  driven by observed failures and the metrics portfolio, not speculation.
- The interaction-type data (§2) decides priority: `correction`/`takeover`
  clusters get fixed first; `approval` rubber stamps become policy-knob
  candidates.

### Deliverables

1. **Error-handling depth:** exhaustive reconciliation edge cases per verb
   (state regression, rate limits, expiry of stale pending ops); re-planning
   flow (§7.5) exercised and polished under `breaking_allowed`; ticket-drift
   handling at every phase boundary (§6.3); escalation UX with evidence
   attached.
2. **Operational hardening:** launchd/systemd supervision, structured log
   rotation (PRD §3.1); `kanthord verify` grows warn/repairable/fatal
   severity levels, then startup/post-crash verify hooks once severities are
   wired (PRD §6.1).
3. **Optimizations:** generation-pinned task continuation on dirty plans with
   the post-completion compatibility check (§7.1.1); `draft_ok` edge semantics
   where rework risk is acceptable; poll-interval and compaction-threshold
   tuning per model; cost-ceiling auto-tuning inputs; `kanthord renumber`.
4. **Test hardening:** property tests over DAG + lease interleavings on a
   small state model (PRD §7.7 "later hardening" arrives now).
5. **Metrics portfolio surfaced in the dashboard:** portfolio trends across
   features, rubber-stamp analysis to guide policy loosening (PRD §2) —
   building on the per-feature summary shipped in 2B; the control-plane
   dashboard grows these views rather than gaining a separate tool.
6. **Additional features, only if usage demands:** first semantic contract
   handler for the company's dominant boundary format; first policy-knob
   flips (auto-accept additive diffs) behind config; candidates from the
   parking lot stay parked unless the data argues otherwise.

### Success criteria (Phase 3 / MVP done)

- kanthord has executed **≥3 real features on the company project**, at least
  one spanning ≥2 repos, with the human touching only approval/clarification
  interactions on the best run.
- Metrics portfolio populated for every feature; rework/error guard metric
  tracked; at least one policy decision (loosen or tighten) made from the data.
- Chaos checks pass in the real environment: daemon crash mid-feature
  recovers unattended; dead-man ping fires on an induced silent-idle;
  `kanthord verify` reports clean (or repairable-only) drift.
- The PRD's second deliverable exists: a written guideline for improvement,
  driven by interaction-type data (PRD §11 rollout).

### Explicitly out of Phase 3 (still post-MVP)

Support/Q&A lane and routing envelope, customer-facing anything, automated
preview environments, multi-daemon sync, macOS/iOS/terminal clients,
auto-merge/auto-deploy by default, Shape plugin framework (Appendix A —
extract only at shape #2).
