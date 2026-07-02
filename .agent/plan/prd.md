# kanthord — Agentic System for Multi-Repo Software Engineering

---

## 1. Vision & Positioning

kanthord is a long-running daemon that executes software-engineering work across
multiple repositories on behalf of a single engineer (initially), with the explicit
goal of **reducing human workload to only the work that requires a human**.

Positioning principle: **be thin where the market is thick, thick where it is thin.**
Single-repo agentic coding is a commodity (Claude Code, Codex, pi). kanthord's reason
to exist is the **cross-repo feature orchestration layer**. The per-repo agent is
nearly free (pi + fff + workflow contract); the engineering budget goes into the
Feature layer. Without multi-repo orchestration, this project has no advantage over
existing tools — it is therefore the MVP baseline, not a v2 milestone.

kanthord is an **execution engine for validated plans**, not a system that plans and
executes. Planning is external (human, a Claude Code brainstorm session, or a future
kanthord planning agent). The interface between any planner and kanthord is the
**Plan Contract** — a typed document kanthord lints and executes. Human-authored and
agent-authored plans are indistinguishable to the executor.

---

## 2. Metrics — A Portfolio, No Single North-Star

The goal is to shrink human effort to human-only work. Human-interaction count is a
**diagnostic, not a north-star**: it is not normalized (features vary hugely), and the
per-task/per-PR variants are gameable (slice work smaller, or push interactions into
pre-planning). It is one dial among several, never a sole decision driver.

**Portfolio (tracked together, none authoritative alone):** human minutes; blocked
time; rework/error rate; escaped defects; approval latency; task completion rate;
**% of nodes completed with no human code edits**; cost per task. Interaction count and
cost still give a human-readable per-feature summary ("4 human interactions, $11"), but
the trend that guides policy is the portfolio.

Guard metric: **rework/error count**. Any single metric improving while rework rises is
a warning, not a win — minimizing interactions alone would incentivize an agent that
stops asking when it should.

Every human interaction carries a **coarse, approximate** type. The system *proposes*
the type from observable signals (which gate fired, whether the human edited files in
scope, whether the plan/prompt changed) and the human confirms the category during the
approval they are already doing. Classification is approximate — never treated as
authoritative:

| Type | Meaning | Fix direction |
|---|---|---|
| `approval` | System worked; policy required a human | Tune autonomy matrix / policy knobs |
| `clarification` | Agent lacked information | Fix intake, knowledge, plan quality |
| `correction`/`rework` | Agent was wrong | Fix prompts, workflow, model choice |
| `takeover` | Agent failed; human did it manually | Capability gap — the honest adoption signal |
| `external`/`blocker` | Waiting on something outside the system | Not a capability gap; exclude from autonomy scoring |

Escalation events double as metric events; over time the data shows which escalations
were rubber stamps vs. real catches, guiding where to loosen policy first. Escalations
tagged `unclassified-artifact-change` (§7.2) are excluded from the automation metric so
byte-diff noise cannot poison it.

---

## 3. Architecture — Layers

| # | Layer | Contents |
|---|---|---|
| 0 | **Integration / Broker** | Typed-verb gateway to all external systems (GitHub/GitLab, Jira, Slack, k8s, SigNoz, Sentry, ...). *Layer 0 not because most user journeys start externally, but because agents have no direct network (§4) — every external side effect must pass through one auditable, idempotent, async boundary.* |
| 1 | **Agentic** | pi stack: `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`. Per-repo agents, guardrail hooks, workflows as pi packages. |
| 2 | **Transport** | Connect RPC (connectrpc.com): one server implementation serving native gRPC, gRPC-Web, and HTTP/JSON — no Envoy proxy. UDS fast-path for macOS client later. |
| 3 | **UI** | Web client first (MVP). macOS, iOS, terminal clients later. All connect to the daemon. |
| 4 | **Storage** | Markdown = source of truth (synced). SQLite = local derived index + runtime state (never synced, disposable). fff for search. |
| 5 | **Workflow** | Plan Contract validation, DAG scheduling, scope leasing, artifact gating, deploy chains, escalation. |

### 3.1 The daemon (kanthord)

- Single long-running process; all clients connect to it. Runs on the engineer's
  machine under VPN, or on a VPS.
- Owns: the fff search index, repo slots, SQLite scheduler, broker, markdown store
  (single writer).
- Supervision: launchd/systemd restart-on-crash; structured logs with rotation;
  `/healthz` on the Connect server; **dead-man ping** — daily "alive, N tasks
  processed" message to a channel the human actually reads (Slack DM via broker).
  Crash-restart handles the daemon dying; the dead-man ping handles the worse
  failure: up but silently idle.

### 3.2 Repo slots vs. ephemeral sessions

> **Durable slot, ephemeral session.**

- The **repo slot** is long-running: fff index, worktrees/checkout, config, leases.
- The **LLM session** inside it is disposable. Sessions are torn down at **task
  boundaries** (task complete or parked), re-warmed from the distilled `STATE.md` +
  repo map + `AGENTS.md`. Never reuse yesterday's session.
- Time-based cap only as a backstop: any session older than N hours mid-task must
  checkpoint and respawn.
- **Compaction**: when context exceeds ~50–60% of the model's window (per-model
  config, not a constant — never ride to the hard limit), run the workflow's
  `checkpoint()` (rewrite STATE.md, append JOURNAL.md), kill the session, respawn
  fresh. Threshold-triggered respawn, task-boundary respawn, and crash recovery are
  **the same code path**.
- Rationale: long-lived contexts degrade (tool noise, stale beliefs, drift);
  provider prompt caches expire in minutes anyway. The warm asset is the distilled
  state file and the daemon-held fff index, not the live context.

### 3.3 Per-repo strategy config

```yaml
# kanthord/repos/elsa-mobile.yaml
repo: git@github.com:elsa/mobile.git
strategy: single_checkout     # worktree | single_checkout
max_concurrent_tasks: 1       # implied 1 for single_checkout
workflows_allowed: [legacy-minimal-test]
# model defaults may also live here (see §8)
```

- **worktree** (default): worktree per task; lease per worktree, capped by
  `max_concurrent_tasks`.
- **single_checkout** (mobile repos — disk pressure from build artifacts): one lease
  for the whole slot. Park/resume protocol: **WIP commits, never stash** —
  `wip(task-123): checkpoint <ts>` on the task branch; resume via checkout +
  `git reset --soft`; squash before PR. WIP commits are named, attributable,
  and survive anything; stash entries are not.
- Note for later verification: `git worktree` shares the object DB; the observed 50%
  disk usage was almost certainly build artifacts (`build/`, `.dart_tool`, Pods,
  Gradle). Shared caches may make worktrees viable for mobile too — but
  `single_checkout` is a sound default regardless (mobile tasks serialize badly:
  signing, emulators).

---

## 4. Security Model — Three Rings

Context: the daemon runs on a machine full of confidential/sensitive data, and pi
ships **no built-in permission system** (agents run with full user permissions;
sandboxing is the integrator's job). Inbound external content (tickets, messages,
file contents) is treated as hostile (prompt injection).

1. **Deterministic policy (cannot be talked out of):**
   path allowlists/denylists per agent role; **write-scope enforcement** via
   `beforeToolCall` — writes outside the task's declared scope are blocked and
   escalated; secret-pattern scanning on anything leaving the machine;
   **no direct network access for agents** — all external I/O goes through the
   broker; **a fail-closed cost circuit-breaker** — a durable per-task budget ledger
   that *reserves* spend before each model call and halts+escalates on breach (when
   exact cost is unavailable, conservative token/request ceilings apply and actual cost
   reconciles after). Limits are separate for model calls, tool calls, and wall-clock;
   the per-task ceiling accumulates **across compaction/crash respawns** (stable task
   identity), so a respawn cannot reset the breaker. Tiers: per-task hard max +
   per-feature soft warning + per-day global kill switch (with a safe exempt path for
   recovery/cleanup tasks); a human override is rate-limited and recorded as an
   interaction (§2). Deterministic guardrails are model-independent: swapping in a
   permissive model must not weaken ring one.
2. **Classifier (judgment calls):** LLM-based sensitivity/risk classification on
   actions and outputs. Its model assignment resolves from global config only —
   never overridable per-plan.
3. **Human approval:** irreversible/external actions per the verb registry tier.

A blocked out-of-scope write is also a **re-planning signal**: it usually means the
plan's decomposition was wrong.

---

## 5. Broker — Typed Verbs, Always Async

Agents never hold credentials and never make raw calls. They submit **typed
operations** to the built-in broker service, which executes, audits, and returns
results. **Never a generic HTTP proxy** — `POST <arbitrary-url>` would rebuild the
security hole with extra steps.

Design properties:

- **Central credential custody**; scoped per integration. Single audit log.
  Compatible with enterprise IP/user restrictions. Clean seam to swap in company
  MCP servers (GitHub/Jira/Slack) later.
- **Always async**: every call returns a request ID; agents park and resume.
  Normalizing all calls as async is worth the extra second on trivial ones.
  Completion is written into SQLite; the polling scheduler wakes the task — **one
  wake-up mechanism** for *internal task scheduling*, not callbacks *and* polling.
  (This governs how tasks wake, not how external results are detected — see below.)
- **Completion detection is poll-only (MVP)**: each async verb declares a `poll_status`
  adapter; a broker poller advances in-flight operations at per-verb intervals and
  writes completion into SQLite (the same sink the scheduler reads). No inbound network
  surface — fits VPN-only. Webhooks are explicitly deferred (they need inbound
  reachability/a relay and would only *advance* a poll that must run anyway). Each async
  verb must declare: `submit`, `poll_status`, terminal states, backoff, timeout +
  escalation, rate-limit behavior, and whether observed state can regress.
- **Crash reconciliation via a durable operation ledger**: request IDs are ephemeral
  and SQLite-only, so every async operation also records a durable **operation entry** in
  the task's synced markdown (`op_id`, verb, `idempotency_key`, external correlation —
  branch/issue/deploy-env —, desired-effect hash, status). SQLite maps `op_id →
  request_id` and is rebuildable. On restart the broker rebuilds runtime requests from
  the ledger, marks interrupted operations *needs-reconciliation*, and each async verb's
  reconcile path queries real remote state (via correlation key) → done | failed |
  resubmit(idempotent) | escalate. A verb with no reconcile path cannot be async.
- **Idempotency keys** on every mutating call (webhook/agent retries must not
  double-post).
- **Verb registry** — one declared entry per verb; the approval matrix is literally
  the `tier` column of this registry:

```yaml
# broker/verbs/jira.create.yaml
verb: jira.create
schema: ./schemas/jira.create.json
tier: auto_with_audit        # auto | auto_with_audit | approval_required
timeout: 5m                  # per-verb, engineer-provided defaults
idempotency: required
retry: { max: 2, backoff: exponential }

# broker/verbs/k8s.deploy.yaml
verb: k8s.deploy
tier: approval_required
timeout: 30m
retry: { max: 0 }            # never auto-retry a deploy
```

- Pending requests **expire** per-verb (a 3-day-old pending `jira.create` must not
  fire surprisingly).
- MVP verb families: `git.*` local ops (auto); `github.create_pr`,
  `jira.transition`, `jira.comment`, `github.create_issue` (auto-with-audit);
  `github.merge`, `k8s.deploy` (approval — and merge stays human, see §7.4);
  read-only observer verbs (`k8s.rollout_status`, `sentry.new_issues`,
  `signoz.query`, `k8s.logs`).

---

## 6. Storage & Knowledge

### 6.1 Division of truth

> **Markdown = truth (synced). SQLite = derived + runtime (local, disposable, never synced).**

- Markdown files are the sole source of truth and the sole thing synced (S3-compatible
  provider; git as sync transport is a considered alternative — history, three-way
  merge, offline for free). "Diff the SQLite database" never arises because the
  database is rebuildable from markdown at any time.
- SQLite owns runtime/operational state: task queue, leases, `op_id → request_id`
  maps, schedules, indexes. WAL mode + `busy_timeout` (daemon threads and broker both
  touch it). If the machine dies, the queue rebuilds from frontmatter statuses **and
  in-flight external operations rebuild from the durable operation ledger** (§5):
  request IDs are ephemeral, but each operation's durable identity (`op_id` +
  idempotency key + external correlation) lives in synced markdown, so reconciliation
  can recover it. Request IDs themselves are never synced.
- **Single-writer invariant:** the daemon is the only writer to the markdown store.
  S3 sync is backup/replication, not multi-master. Running two daemons (Mac + VPS)
  breaks this — documented as a known constraint.
- Conflict surface is minimized by file design: JOURNAL.md is append-only (trivially
  mergeable); STATE.md is small and single-writer.
- **`kanthord verify --from-markdown --read-only`** (operator command): rebuilds a
  shadow SQLite from markdown and diffs the **markdown-derived subset** (ignoring
  runtime-only fields — leases, poll cursors — that have no markdown source) against the
  live DB, reporting divergences at three **severity levels: warn / repairable drift /
  fatal corruption**. The markdown→SQLite projection is a **documented, versioned
  contract** (so a diff is not an argument, and schema evolution stays migration-aware).
  Blind spot logged: the rebuild reuses the writer's parser, so a bug common to both
  paths is invisible — the projection should ideally be independent. Ships as an
  on-demand command first; startup/post-crash hooks are added only once the severity
  levels are wired (a verify failure must never block the daemon from self-repair). This
  is the drift detector for the single-writer convention (§14.8) and the ledger↔SQLite
  consistency check for reconciliation (§5).

### 6.2 Task/Feature document structure (three layers)

```
frontmatter   — machine-readable: ids, source-of-truth ref, workflow@version,
                model@version, repos, status, write_scope, hashes
STATE.md      — current state; BOUNDED and aggressively rewritten
                (it is what gets injected into a fresh session on resume)
JOURNAL.md    — append-only, timestamped decisions & findings
                (retrospective raw material after ship)
```

Features are first-class: a feature directory has its own frontmatter/STATE/JOURNAL
triple; tasks are children with their own triples. On finish: STATE is what shipped;
JOURNAL feeds the retrospective to extract reusable knowledge.

### 6.3 Source of truth (hard rule)

**No task without a source of truth** (Jira ticket, GitHub issue — whatever the
company actively uses). Applies hierarchically: feature ↔ epic, task ↔ sub-ticket.

**Clone-on-sign-off:** at sign-off, snapshot ticket content into the task; store
`content_hash + snapshot_at` in frontmatter; work against the clone.
**Drift detection:** re-hash the source at every workflow **phase boundary** (not
only at completion — a day-1 change on a 3-day task must not cost 2 wasted days).
On drift: signal the human, keep working unless halted. Human owns communication
with the change's author. Sync is one-directional and shallow: the external tracker
owns identity + status; markdown owns all working detail; the agent pushes status
transitions and summary comments outward. Two-way rich sync is explicitly rejected
(classic tarpit).

### 6.4 Search: fff

- `dmtrKovalenko/fff` (Rust SDK; typo-resistant path/content search, frecency,
  background watcher, in-memory index; pi extension `pi-fff` exists).
- The index lives **in the daemon**, not in agents — respawned sessions get a warm
  index for free.
- Pre-1.0 with fast-moving nightlies: pin versions and wrap behind a thin internal
  search interface.

### 6.5 Identity map & visibility

- Identity map is **content** (synced markdown/YAML, indexed into SQLite), not
  runtime state: `khoa → khoanguyen@github, 18211271@jira, khoa.nguyen@elsanow.io@slack`.
- Uses: knowledge ACLs (public tag = everyone; otherwise listed ids/usernames);
  router resolution of *who is asking*; broker translation of assignees/mentions
  across platforms.
- Class-level firewall reserved for later: anything not `customer_safe: true` can
  never be cited to an external audience, regardless of person ACLs — default-deny
  for the unmapped world. (Mostly deferred: no customer-facing lane in MVP.)

---

## 7. Feature Layer — Cross-Repo Orchestration (the MVP core)

### 7.1 Plan Contract

The typed document any planner (human or agent) hands to kanthord. kanthord **lints**
it on ingest — DAG acyclic, repos registered, gates well-formed, every node has a
ticket ref — and rejects invalid plans like a compiler. It is the API of the
**orchestration layer** and the integration-test surface ("does kanthord correctly
execute this plan file" — verifiable with no LLM involved).

**It is a coordination contract, not a correctness contract.** Passing lint/compile
proves the plan *executes as written*, not that the plan is wise or the produced code
is correct. **Non-guarantees:** kanthord does not verify task adequacy, code
correctness, security, performance, or semantic compatibility. Because of this, every
plan node declares its own **evidence target** (tests / review checklist / runtime
probe / contract check / manual acceptance): the deterministic surface (lint, compile,
schedule, gate *mechanics*, lease behavior) is fully testable without an LLM; the
non-deterministic surface (agent output quality) is exercised only by those per-node
evidence targets, review, and the metrics portfolio (§2), never proven.

Contains: epic/story/task hierarchy with source-of-truth refs; dependency DAG;
per-task `write_scope`; per-task `workflow@version`; contract artifacts per boundary
(publisher/consumers/optional handler); deploy chain; policy knobs; optional model
overrides. TDD-shaped decomposition is the MVP default (observed and adjusted later —
it is known not to fit every feature).

**Schema: designed and finalized — full specification below (§7.1.1).** The four
open questions carried into the design session were all resolved:
(a) gates are fully handler-based; shapes bind specific gates to node kinds, so the
gate vocabulary is per-shape, not a global enum;
(b) re-planning always edits the authored markdown files and recompiles — the
compiled plan exists only as SQLite rows and is never hand-edited; git history on
the authored files is the plan's version history;
(c) the story layer is kept, realized as numbered story directories;
(d) `write_scope` stays per-repo paths for v1; cross-repo coordination is expressed
through handoffs/artifacts, and parallelism safety is enforced by the filename
grammar + scope-disjointness lint.

### 7.1.1 Plan Contract Schema (v1)

> **MVP scope note.** Two things live in this section. **Binding for MVP:** the plan
> **file format** (§2–§7 below) and the **compile/lint pipeline** — the executor needs
> these regardless. **Non-binding, deferred:** the **Shape *plugin* framework** (the
> `PlanShape` interface, the shape registry, "shapes are the fifth extension family",
> untrusted-compiled-output re-validation), extracted to **Appendix A**. MVP **hardcodes
> `tdd@1`'s lint/compile rules directly in core** and ships exactly one shape; the plugin
> seam is extracted only when a real *second* shape arrives (per §10's "start with two"
> rule). Deferring the abstraction is not deferring modularity — the hardcoded compiler
> still keeps clean internal boundaries (parse / validate / emit / lint) so the second
> shape can be lifted out without a rewrite. Read "Shape" below as "the `tdd@1` rules"
> until Appendix A is built.

#### 1. Concept: Shapes (deferred as a plugin; `tdd@1` hardcoded for MVP)

A **Shape** is the structural type of a plan — the strategy object that defines how
a feature is decomposed and what discipline its tasks follow. **Workflow** is how
one task executes; **Shape** is how a whole plan is structured. A feature declares
exactly one shape (`shape: tdd@1` in `epic.md` frontmatter); shape composition is
out of scope for v1 — a feature that doesn't fit a shape gets a new shape, not a
blend.

The executor never learns about shapes. Compilation is a lowering step:

```
Authored plan (markdown files, shaped)          ← source of truth, synced, git history
        │  shape.lint() + shape.compile()
        ▼
Core Execution Plan (nodes, edges, scopes,      ← derived; SQLite rows only;
gates, artifacts, deploy chain)                    never a file, never hand-edited
        ▼
DAG scheduler / lease manager / broker (unchanged)
```

Re-planning **always** edits the authored files and recompiles. The IR is database
rows; there is nothing to hand-edit.

##### Shape interface, registry, and "fifth extension family" — deferred

The `PlanShape` interface, the yaml shape registry, and the "shapes are the fifth
extension family / compiled output re-validated by core lint" design are **not built for
MVP**. They are preserved as a **non-binding future extraction target in Appendix A**, to
be lifted out of the hardcoded `tdd@1` implementation when a real second shape appears.
For MVP, `tdd@1`'s `lint()`/`compile()` are core functions, not a registered plugin.

---

#### 2. Format rules

Storage conventions apply throughout:

| Thing | Format |
|---|---|
| Plan nodes (epic/story/task), RUNBOOK, STATE | markdown + frontmatter |
| Journals, compile/lint/gate/escalation events, metrics | jsonl (append-only) |
| Registries & extension configuration (shapes, verbs, repos, providers) | yaml |
| Compiled Core Execution Plan | SQLite rows (derived, disposable) |

Every plan file has two layers:

- **Frontmatter = machine layer.** Everything scheduler/linter/compiler must have
  *exact*: ids, refs, scopes, handoffs, outputs. No prose parsing, ever.
- **Body = agent layer.** The brief the executing agent reads. Shapes enforce the
  body's *structure* (required sections present, non-empty); content is prose.
- **Cross-check lint** ties the layers: every id in frontmatter has a body
  section and vice versa; ids referenced anywhere resolve.

Accepted trade-off: a concept appears twice (declared in frontmatter, elaborated in
body). Lint keeps ids consistent; it cannot verify prose matches declaration.
The alternative — parsing structured data out of prose — is rejected as fragile.

---

#### 3. Feature directory layout

```
features/feat-payment-retry/
  epic.md                          # goal; shape; policies; source_of_truth
  RUNBOOK.md                       # execution guidance; mutable by human AND agents
  journal.jsonl                    # feature-level append-only events
  contracts/
    payment-api.openapi.yaml       # contract artifacts (snapshot-per-feature)
  stories/
    01-contract-and-backend/
      INDEX.md                     # story content + frontmatter
      001-define-contract.md
      002-backend-impl.md
      002-backend-impl.state.md          # siblings, stem-named
      002-backend-impl.journal.jsonl
    02.1-clients-mobile/           # dotted directories = parallel STORY lanes
      INDEX.md
      001-flutter.md
    02.2-clients-web/
      INDEX.md
      001-web.md
```

**The filesystem is the single source of hierarchy.** No `story:`/`epic:` pointers,
no `order:`, no `parallel_with:` in frontmatter — location and filename carry all of
it. There is nothing to drift.

---

#### 4. Filename grammar

Applies identically to task files and story directories:

```
<major>[.<lane>]-<slug>(.md | /)      e.g. 003.1-flutter.md, 02.1-clients-mobile/
```

Semantics:

1. **Group = same major number.** Every node in group N implicitly depends on every
   node in the previous *existing* major (gaps are legal and encouraged: 001, 002,
   004 leaves insertion room).
2. **Same group, different lane (`N.1`, `N.2`) = parallel-intended.** Lint verifies
   the intention: no dependency path between them, disjoint `write_scope`s.
   Violation is reported in planner vocabulary
   ("003.1 and 003.2 both write `lib/shared/` — they cannot share a group").
3. **Actual concurrency remains the scheduler's decision** via scope leases. The
   grammar declares design intent; edges and scopes stay the only two execution
   inputs — the grammar can assert, never contradict.
4. **Grammar is the floor, not the whole graph.** Cross-story handoffs and artifact
   semantics live in frontmatter as additional edges. Lint: an explicit handoff may
   never point forward (higher number, or a later story) — caught pre-compile,
   reported in filename vocabulary.
5. **Filename = position (mutable); frontmatter `id` = identity (stable forever).**
   Renumbering is a normal re-planning operation; handoffs, tickets, journals, and
   SQLite reference ids, never filenames. `kanthord renumber` moves a task's file
   trio (plan/state/journal) atomically. Malformed names are hard errors.

---

#### 5. Node frontmatter schemas (core fields; shapes may extend)

##### epic.md
```markdown
---
kind: epic
id: feat-payment-retry
shape: tdd@1                          # governs all children; pins defaults
source_of_truth: { system: jira, ref: ELSA-1234 }
policies: { escalation: all_diffs, contract_policy: breaking_allowed }
models: { coding: anthropic/claude-fable-5 }     # feature-level default (optional)
## written back by kanthord at sign-off:
compile: { shape: tdd@1, hash: <sha>, at: <ts> }
---
## Payment retry with backoff
Goal + acceptance criteria as prose (shape may require an Acceptance section).
```

##### stories/NN[-lane]-slug/INDEX.md
```markdown
---
kind: story
id: s-clients-mobile
---
## Story: clients consume the retry API
Step-by-step intent as prose.
```

##### Task file
```markdown
---
kind: task
id: t-flutter
repo: elsa-mobile
ticket: { system: jira, ref: ELSA-1236 }        # rule #7: mandatory
write_scope: [lib/payments/**]
resources: [ports:5432, testdb:payments]         # non-path shared capabilities (§7.3)
depends_on:                                      # explicit edges beyond grammar
  - { task: t-backend, output: payment-api, semantics: frozen }  # frozen | draft_ok
outputs:
  - { kind: pr }                                 # kinds: artifact | pr | doc | ...
workflow: tdd@1                                  # set by shape; TDD forbids override
model: { coding: deepseek/coder-x }              # task override (optional)
---
## Task: Flutter consumes retry API
(body sections per shape — see TDD below)
```

Output kind `artifact` additionally carries `{ id, path }` and compiles into the
core artifact registry (publisher = this task; consumers = every task whose
`depends_on` references the output). No format intelligence in core: byte-level
snapshot/hash/diff, optional per-format handler, absent handler ⇒ byte-diff +
escalate.

---

#### 6. Guidance docs: RUNBOOK.md

Feature-root document telling agents **how to execute here**: env gotchas, per-repo
notes, conventions, discovered pitfalls. Completes the document taxonomy:

| File | Answers | Written by | Discipline | Dirties plan? |
|---|---|---|---|---|
| epic/story/task files | what & why | planner, via re-planning | compile-on-sign-off | **yes** |
| RUNBOOK.md | how | human **and** agents | curated, bounded, mutable | **no** |
| *.state.md | where we are | workflow `checkpoint()` | bounded, rewritten | no |
| *.journal.jsonl | what happened | daemon | append-only | no |
| repo AGENTS.md | repo conventions | human | durable, slow | n/a |

Rules:

- **Excluded from `compile_hash`.** Runbook edits never dirty the plan, never
  trigger recompile, never escalate under `all_diffs`. Changes are journaled
  (attributed jsonl events), not escalated.
- **Injected into every task spawn context** (brief = task body + epic body +
  RUNBOOK + STATE + repo AGENTS.md) ⇒ bounded and curated like STATE.md. Holds
  only currently-useful guidance; history → journal; repo-durable entries →
  promoted to AGENTS.md at retrospective (a mechanical retrospective step:
  harvest → promote → archive).
- **Write protocol:** humans edit freely (git is the audit). Agents write via a
  `runbook.append` action in the workflow, each entry attributed
  (`— t-backend, 2026-07-02`) at `auto_with_audit` tier. Daemon is the single
  automated writer; last-write-wins is acceptable (guidance, not truth).
- **Runbook hashing:** RUNBOOK.md remains outside `compile_hash` but carries its
  own content hash. Every `runbook.append` event records `hash_before → hash_after`
  in the journal — an unjournaled change to the runbook is thereby mechanically
  detectable (tamper/propagation check for the security note below). Every task
  session records the runbook hash it spawned with; a hash change since the
  feature's previous session is surfaced to the agent as a "guidance updated"
  notice. The runbook hash never gates dispatch — it informs and audits only.
- **Security note (logged trade-off):** RUNBOOK is an agent-writable channel
  injected into all future agent contexts — a cross-task propagation vector.
  Mitigations: ring-1 secret scan on writes, attribution, audited tier.

Shapes declare required guidance docs; kanthord scaffolds them from the shape's
template at feature creation.

---

#### 7. Validation & compilation pipeline

Compilation is an explicit **sign-off action** (multi-file edits are only
consistent as a set — never a file-watcher reaction):

1. **Walk & parse names.** Feature directory scan; story-dir and task filenames
   parsed against the grammar. Malformed ⇒ hard error, filename vocabulary.
2. **Parse frontmatter & cross-check.** Unique ids feature-wide; every
   `depends_on.task` resolves to an existing id with the referenced output
   declared; INDEX.md present per story dir; required guidance docs exist;
   body/frontmatter cross-check.
3. **Build edges & core lint.** Grammar edges (story-level + task-level) +
   explicit handoff edges. Acyclic; repos registered; every node has a ticket ref;
   no forward handoffs.
4. **Shape lint.** Shape-specific rules over both layers (see TDD §8).
5. **Compile → SQLite; core-lint the output.** Write
   `compile: { shape, hash, at }` into `epic.md` — hash covers the full file set
   **including filenames** (a rename is a plan change) and **excluding**
   RUNBOOK/state/journal files.

**Dirty detection & generation-based dispatch:** each successful compile stamps a plan
**generation** `G`; running tasks are pinned to the generation they started under.
Editing covered files marks the plan dirty and, on recompile, mints `G+1`. A dirty plan
halts **new** dispatch (clone-on-sign-off applied to the plan itself) — but a task
already running under `G` **continues** only if the edit lies outside its node **and**
its dependencies, acceptance criteria, consumed artifacts, and feature-level
invariants; otherwise the affected subgraph parks/rebases. Continuation is an
optimization, **not** a safety promise: any task that finishes against a superseded
generation must pass a **post-completion compatibility check against the latest
generation before its PR may merge**. When the compile itself fails (affected set
uncomputable), fall back to halting the whole feature. Lint diagnostics speak the
planner's vocabulary at every stage — shape errors name stories/tasks/handoffs, not
graph nodes.

Corollary: the feature directory is source code and gets git discipline; a casual
`mv` is a plan edit and will trip the dirty flag.

---

#### 8. Reference shape: `tdd@1` (the hardcoded MVP shape)

For MVP these rules are implemented **directly in core**, not as a registered plugin
(§7.1.1 note; Appendix A). "Shape" below means exactly these `tdd@1` rules.

**Intent:** epic = the goal; stories = ordered execution steps; tasks = units with
explicit prerequisites, inputs, outputs, and test-first discipline.

**Required docs:** `RUNBOOK.md` (scaffolded: Environment / Per-repo notes /
Gotchas / Conventions).

**Frontmatter requirements (beyond core):**
- Task: non-empty `outputs`; non-root tasks have ≥1 `depends_on` or a grammar
  predecessor.
- `workflow` is pinned to `tdd@1`; overriding is a lint **error** (a task that
  cannot do TDD means the feature is in the wrong shape).
- Epic body must contain a non-empty **Acceptance** section (definition of done,
  phrased testably).

**Required task body sections (presence + non-empty enforced; content is prose):**
```
## Prerequisites     — handoffs elaborated; env setup commands
## Inputs            — tickets, docs, artifacts the task consumes
## Outputs           — what it produces, elaborating frontmatter outputs
## Tests             — define-first spec; becomes the gate pair
```

**Shape lint (planner-vocabulary diagnostics):**
- Missing/empty required section ⇒ error.
- Handoff to a later story or higher group ⇒ error ("story 01 cannot depend on
  story 03").
- Same-group tasks with overlapping `write_scope` or connecting dependency path
  ⇒ error.
- Orphan artifact outputs (produced, never consumed, not a pr/deploy) ⇒ warning
  (decomposition smell).
- ≥1 story; ≥1 task per story.

**Compilation rules (mechanical):**
1. Epic → feature node; Acceptance → feature-level exit criteria.
2. Grammar → sequential/parallel edges at both story and task level (§4).
3. `depends_on` handoffs → edges + artifact-consumption entry gates with declared
   `frozen`/`draft_ok` semantics.
4. Artifact outputs → core artifact registry entries.
5. `Prerequisites` env commands → workflow phase-0 setup gate.
6. `Tests` → the TDD gate pair: entry gate `failing_test_exists`, exit gate
   `tests_pass`. Gate vocabulary is bound by the shape (gates are handlers, like
   everything else; shapes choose which gates attach to which node kinds — there
   is no global gate enum).
7. Defaults: `workflow: tdd@1`; deploy-chain stages appended from epic frontmatter
   if declared (chain executor per PRD §7.4).

---

#### 9. Decisions log (Plan Contract session)

| # | Decision |
|---|---|
| 1 | Name: **Shape**; declared once, on the epic; one shape per feature |
| 2 | Shape pins workflow; TDD forbids per-task override (lint error) |
| 3 | Plan = markdown files; frontmatter machine layer, body agent layer; cross-check lint |
| 4 | File-per-node: epic.md, story directories with INDEX.md, numbered task files |
| 5 | Filesystem is the hierarchy; grammar (`major[.lane]-slug`) encodes order + parallelism at both story and task level |
| 6 | Filename = position, frontmatter `id` = identity; refs use ids; `kanthord renumber` tooling |
| 7 | Compiled plan = SQLite rows only; re-planning edits authored files and recompiles |
| 8 | Compile on explicit sign-off; `compile_hash` over file set incl. names; generation-based dispatch — dirty ⇒ halt *new* dispatch, running tasks pinned to their generation, merge gated by post-completion compatibility check |
| 9 | STATE/JOURNAL are stem-named siblings of the task file (separate write disciplines; plan-file git history stays a clean drift signal) |
| 10 | RUNBOOK.md: required by TDD shape, mutable by human + agents, excluded from compile_hash, injected into every spawn, bounded, journaled + audited writes |
| 11 | Shape *plugin* framework (fifth extension family, yaml registry, re-validated compiled output) is **deferred** (Appendix A); MVP hardcodes `tdd@1` in core, extracts the seam at shape #2 |

### 7.2 Coordination through artifacts, not shared sessions

Repo agents are isolated (security model requires it). The only inter-agent channels:

- **Feature-level STATE.md** as a shared blackboard.
- **Contract artifacts** (OpenAPI, proto, GraphQL schema, event schemas) stored in
  the feature directory — snapshot-per-feature, matching clone-on-sign-off.

Publisher task's exit gate: "artifact published/updated." Consumer tasks' entry
gate: "artifact consumed (hash X)." Coordination is auditable, resumable across
teardowns, and debuggable: when mobile builds the wrong thing, diff the contract it
consumed, not two chat transcripts.

**Format intelligence is NOT kanthord's core.** kanthord ships the generic mechanism:
declare artifacts in the plan; gate the **authored source** artifact (the hand-written
`.proto`/`openapi.yaml`), never generated output — killing reordering/timestamp noise
at the root. Where a **semantic comparator exists** (a registered handler: proto →
descriptor-set compare; OpenAPI → normalized model + breaking/additive classification),
gates use the **semantic digest**, and generator version is tracked separately with an
explicit approval required on a generator upgrade. Where **no** comparator exists,
kanthord does **not** pretend the artifact is contract-verifiable: it marks the change
`unclassified-artifact-change`, escalates to human, and **excludes it from the
automation metric** (§2) so byte-diff noise cannot poison the metric or train
rubber-stamping.

> **Accepted MVP limitation:** semantic handlers are integration work written per
> project (§10, §12). Until they exist, most contract artifacts fall to the
> "manual-review required" path — so **MVP contract gating is genuinely weaker than
> automated verification**, and much of the coordination assurance is human review, not
> machine checks. Stated openly rather than hidden behind byte-diff.

### 7.3 Scheduling: DAG + scope leases

- SQLite task rows gain `feature_id` and `depends_on[]`; the polling scheduler
  dispatches when dependency exit gates pass **and** the required lease is free —
  the DAG executor is a `WHERE` clause on the existing poll, no new infrastructure.
- **Leases are per capability, not per repo — and `write_scope` is only one
  capability.** Disjoint write-scopes (e.g. `ios/` and `macos/`) may run concurrently;
  anything declaring `shared/` serializes. But source-path disjointness is **not**
  runtime independence: tasks also collide on ports, test DBs, build-cache names,
  devices/emulators, and dependency-manifest *writes* (`go.mod`/`package.json`/lockfiles
  — reads are fine, only writes serialize). Tasks declare these in a `resources:` set;
  the lease manager serializes on **any** shared capability. Declared write-scopes are
  enforced by ring one (§4) — but the guarantee is stated **negatively**: leases prevent
  concurrent *writes* to *declared* resources only; they do not prove runtime
  independence (only real sandboxing would). Unknown shared resources default to
  conservative serialization for risky task classes, and **empirical collision
  detection** promotes a resource rule whenever a parallel run fails on a collision.
- Leases have **expiry + heartbeat** — never plain flags; a crashed task must not
  hold a lease forever.
- **Awaiting an async broker op is a scheduler-owned transition, not a live wait.** When
  a task submits an async operation it records `blocked_on: op_id` (durable) and its
  session is torn down — the session never holds a request ID or polls. The scheduler
  re-dispatches the task only when the operation's completion row appears in SQLite,
  injecting the result into the fresh spawn context. Semantics for multiple concurrent
  ops per task (which completion resumes, how a failure propagates) and for
  cancellation/supersession are declared per workflow. This keeps "durable slot,
  ephemeral session" (§3.2) consistent with the one wake-up mechanism.
- Dependency semantics per edge: `frozen` (default) | `draft_ok` (downstream may
  start against a draft contract — parallelism vs. rework risk, opt-in for repos
  that are cheap to adjust).
- Planner role is **optional**: humans are very good at planning (spin up Claude
  Code, brainstorm, produce a plan). A kanthord planning agent is a possible later
  addition; plan review is a deliberate, high-value human approval gate either way.

### 7.4 Deploy chain (chain-of-responsibility)

The DAG continues past "PR open" into per-repo deploy stages. Per stage:

- **Observers**: read-only broker verbs registered as yaml-or-code handlers
  (`k8s.rollout_status`, `signoz.query`, `sentry.new_issues`, `k8s.logs`, ...).
- **Explicit success criteria** (rollout complete AND error rate below threshold AND
  zero new Sentry issues for the release).
- **Soak duration** — deploys look healthy at 90s and fall over at minute five;
  "observe for N minutes" is part of the gate (async design handles the wait
  natively).
- `on_pass: notify_human` — "backend deploy healthy, mobile PR safe to merge."
  **Merge remains a human-approval verb**; kanthord automates the watching, the
  human keeps the button. Auto-merge-on-green is a later config flip.
- `on_fail: halt_and_escalate` with observation evidence attached. Cross-repo
  rollback is human (MVP stance).

kanthord ships the **chain executor** (ordered handlers, pass/fail/escalate
semantics); handler logic is per-project integration work. Chain definitions differ
per feature (some backend+mobile, some 4–5 repos) and live in the plan.

### 7.5 Re-planning as a first-class flow

Mid-feature, a task discovers the contract can't express something (real life). The
discovering task signals feature-level → plan diff (contract change + affected
tasks) → human approves → affected downstream gates re-open, tasks rebase/rework.
Same drift-detection shape as ticket drift, applied to contracts. With
`contract_policy: breaking_allowed` (see §9), this loop is a **normal, frequently
exercised path** — hardened early while a single user pays the rework cost.

### 7.6 Cross-repo verification stance (MVP)

Per-repo CI green does not prove integration. MVP: **contract checks as gates +
human-registered deploy observers (§7.4) + manual e2e by the human where needed.**
Automated preview environments (compose the N branches) are the first post-MVP
investment candidate.

### 7.7 Testing the executor (deterministic lifecycle harness)

"Verifiable without an LLM" (§7.1) covers plan lint/compile/schedule, but the daemon's
riskiest code is time/concurrency/lifecycle. MVP ships a **small deterministic lifecycle
harness** as a hard requirement — **fake clock, fake broker (modeling
success/failure/timeout/regression), temp SQLite, temp git repo, crash/restart
entrypoint** — and mandates **scenario tests** for: lease expiry + heartbeat timeout;
crash recovery + broker reconciliation (§5); compaction respawn; and phase-boundary hash
drift (§6.3). **Respawn-equivalence is defined explicitly**: after a respawn the
pending-task set, lease ownership, current phase, and injected STATE must match the
pre-respawn state (live model context is *not* required to match — that is the point of
teardown). The **clock and broker are injectable seams from day one** (also what makes
the §5 poll/reconcile and §7.3 lease/await paths testable at all). Property tests over
DAG + lease interleavings are **later hardening**, not day-one scope — they need a small
state model first, or they become flaky.

---

## 8. Model Policy — Configurable Resolution Chain

Model choice is per feature, per project, per task — each LLM is good at a small set
of tasks and tech stacks (e.g. z.ai / DeepSeek / GPT-class models per repo). pi-ai
normalizes providers; OpenAI-compatible endpoints register as custom providers.

Resolution precedence (most specific wins):

```
task override (in the plan)
  → feature default (in the plan)
    → repo slot config ("this Flutter repo works best with X")
      → role default (coding / gate-check / drift / compaction)
        → system default
```

- **Provider registry mirrors the verb registry**: providers/endpoints/keys
  registered once in daemon config; plans reference models by name, never by
  credential.
- **Record `model@version` in task frontmatter and the metrics table** — without
  attribution, "6 corrections" can't distinguish bad plan from bad model. Also
  yields cheap A/B data over time.
- Guardrail classifier model: global config only, not plan-overridable (§4).
- MVP defaults: strong model for coding/planning-assist; cheap model for
  checks/drift/compaction; a hard per-task cost ceiling is **enforced** by ring 1 (§4),
  finer per-task/feature budgets are logged.

---

## 9. Policy Knobs (config today, flipped later)

| Knob | MVP value | Future flip |
|---|---|---|
| `escalation` | `all_diffs` (active development; human absorbs review load) | Auto-accept additive changes, escalate breaking |
| `contract_policy` | `breaking_allowed` (single user accepts rework risk) | Backward-compatible-by-policy at company release (+ contract lint) |
| Merge/deploy | Human button, kanthord observes & notifies | Auto-merge-on-green |
| Auth | Basic auth over TLS, VPN-only, bound to VPN interface (never `0.0.0.0`) | Tokens/mTLS before any non-VPN exposure |
| Budgets | Hard per-task cost ceiling enforced (ring 1, fail-closed); finer per-task/feature budgets logged | Enforce finer tiers; auto-tune ceilings |

Purpose of this section: releasing to company users should be a **config diff, not a
redesign**.

---

## 10. Extension Families (chain-of-responsibility everywhere)

kanthord's core = plan validator + DAG scheduler + lease manager + artifact store +
broker + chain executor. **Everything domain-specific is a registered chain**
(yaml config or actual code — pi packages; the maintainer is an engineer and custom
code is acceptable):

1. **Workflows** — TDD for greenfield, legacy-minimal-test, arbitrary custom code
   (step-by-step chain-of-responsibility when needed). All must satisfy one
   interface: `phases[]`, `currentPhase()`, `gateCheck(phase) → pass/fail/needs-human`,
   `checkpoint() → writes STATE.md`, status events. Versioned (`workflow@version` in
   frontmatter) so retrospectives can compare. Start with exactly two; add a third
   only when a real task doesn't fit.
2. **Deploy observers** — per-stage handlers + criteria + soak (§7.4).
3. **Contract-artifact handlers** — per-format lint/diff intelligence (§7.2).
4. **Model providers** — registry entries (§8).

Defining handler logic is integration work when kanthord meets a first real project;
the engine ships generic and simple, adjusted later.

---

## 11. MVP Scope

**In:**
- Feature development **across multiple repos** — the baseline and reason to exist.
  Plan Contract ingest + lint → DAG-scheduled, scope-leased repo tasks in isolated
  slots → artifact-gated handoffs → PRs → observed deploy chain → human merges.
- Daemon + Connect RPC + web client. Basic auth over TLS under VPN.
- Broker with the MVP verb families (§5). Always-async.
- Markdown store + S3 sync + SQLite scheduler + fff search.
- Guardrail rings 1–3, escalate-all-diffs.
- Metrics instrumentation at every human touchpoint (typed interactions + cost).
- Deploy-chain executor component (handler logic = integration work).

**Out (deliberately):**
- Support/Q&A lane and ambient-message routing — intake for MVP is tickets assigned
  to the system, so the routing envelope shrinks to almost nothing and its full
  design is deferred to v2.
- Anything customer-facing (and with it, most visibility-firewall enforcement).
- Auto-merge, auto-deploy, automated cross-repo rollback.
- Automated preview environments (first post-MVP investment candidate).
- Multi-daemon / multi-writer sync.
- macOS/iOS/terminal clients; UDS fast-path.

**Rollout:** MVP → apply to a real company project → observe the metrics portfolio (§2) →
modify. The deliverables are (1) a working MVP and (2) a guideline for improvement,
driven by interaction-type data.

**Parking lot (future ideas, non-binding — not scoped yet):**
- **Meeting input as an intake source.** Feed meeting content (transcript / notes /
  recording) into the system so it can extract decisions and action items and turn them
  into tickets/tasks — another intake lane alongside assigned tickets. Belongs with the
  deferred intake/routing envelope (§11 Out; assumption #11); design it later.

---

## 12. Remaining Open Items

| Item | Owner / venue |
|---|---|
| ~~Plan Contract schema (incl. open questions a–d)~~ | ✅ Resolved — see §7.1.1 |
| Shape *plugin* framework (interface/registry/re-validation) | Deferred — Appendix A; extract at shape #2 (§7.1.1 note) |
| Contract artifact format inventory (what boundaries actually speak: REST/gRPC/GraphQL/events, per company stack) | Human — an afternoon of listing; handlers written at integration time |
| Observer handler logic per platform (k8s, SigNoz, Sentry, ...) | Integration work on first real project |
| Worktree-vs-artifacts disk verification for mobile (shared caches experiment) | Optional; `single_checkout` default stands regardless |

---

## 13. Assumptions Made During This Session

1. **Single user for MVP.** kanthord serves one engineer (the maintainer); teammates
   come later, customers much later. Several designs lean on this (breaking changes
   allowed, escalate-everything, Basic auth, single writer).
2. **Single daemon instance at a time.** The single-writer invariant for the markdown
   store assumes exactly one kanthord running; Mac+VPS simultaneously is out.
3. **The maintainer is a software engineer who accepts maintaining custom code**
   (workflows-as-code, handlers, the daemon itself). Build-vs-buy trade-offs were
   evaluated under this assumption.
4. **Stack assumptions from context:** GitHub (and/or GitLab) for code hosting, Jira
   and/or GitHub Issues as trackers, Slack for messaging, Kubernetes as deploy
   target, SigNoz/Sentry for observability, Flutter/iOS/macOS among the client
   repos. Verb names in examples reflect this; the registry pattern doesn't depend
   on it.
5. **kanthord task execution requires a git worktree** for isolation, recovery,
   provenance, and WIP-commit parking (worktrees + branch-per-task assume git). **fff
   does *not* impose this** — it indexes arbitrary directories and uses git only as an
   optional metadata layer (`.gitignore`, status filters via libgit2); frecency and the
   watcher are git-independent. Behavior for a non-git path is **unsupported for MVP**
   (rejected at repo registration), not silently indexed. *Correction: an earlier draft
   wrongly stated "fff assumes git-indexed directories" — the git requirement is
   kanthord's, not fff's (verified against fff's README).*
6. **VPN is trustworthy enough for MVP auth**, and the daemon can be bound to the
   VPN interface. TLS still applied inside it.
7. **Long-lived LLM contexts degrade** (accumulated tool noise, stale worldview) —
   the empirical basis for task-boundary teardown; consistent with the maintainer's
   Claude Code observation (500k-token day-two sessions).
8. **Provider prompt caches are not a durable asset** (minutes-scale expiry); the
   warm assets are distilled state files and the daemon-held fff index.
9. **The mobile disk-pressure observation (50% disk for two Flutter worktrees) was
   dominated by build artifacts**, not git objects. Unverified — flagged in §12 —
   but the `single_checkout` decision is sound either way.
10. **A human is reachable for escalations within a reasonable window.** Always-async
    + parked tasks make this non-blocking, but throughput assumes escalations don't
    sit for days.
11. **MVP intake = tickets explicitly assigned to the system.** No ambient
    message ingestion; this is what allowed deferring the routing envelope.
12. **pi and fff remain viable dependencies.** Both are actively developed and
    pre-1.0/fast-moving; versions are pinned and fff is wrapped behind an internal
    interface as mitigation, but continuity of the upstream projects is assumed.
13. **Inbound external content may be adversarial** (prompt injection) — the security
    model is designed for this even though MVP intake is narrow.
14. **TDD-shaped decomposition is an acceptable default plan shape for MVP**,
    explicitly known not to fit all features, with observation-then-adjustment as
    the correction mechanism.

### Added during the Plan Contract session

15. **Planners treat the feature directory as source code** (git discipline, no
    casual `mv`) — required because filenames carry plan semantics; the dirty flag
    contains mistakes but does not prevent them.
16. **The file-per-node TDD structure reflects the maintainer's practiced sweet
    spot**; it is adopted as given, to be re-evaluated against real features.
17. **RUNBOOK.md stays bounded** through human/retrospective curation — its
    injection into every spawn assumes the discipline actually happens.

---

## 14. Trade-offs Made During This Session

1. **Thin per-repo agent, thick orchestration layer.** Accepts being a commodity at
   the single-repo level (pi does that) to concentrate effort where nothing exists.
   Cost: kanthord's value is invisible on single-repo work.
2. **Typed broker verbs over a generic proxy.** Gains: security, audit, credential
   custody, enterprise compatibility, MCP swap seam. Cost: every new integration
   requires registry work — no ad-hoc API calls, ever.
3. **Always-async broker.** Gains: one normalized execution model, natural fit for
   long-running work, soak timers, parked tasks. Cost: extra latency and an extra
   roundtrip even for trivial calls — deliberately accepted ("waste 1s to normalize
   the design").
4. **Artifact-gated coordination instead of inter-agent communication.** Gains:
   auditability, resumability across teardowns, debuggable failures, security
   isolation. Cost: coordination latency (publish → gate → consume) and rigidity —
   agents cannot negotiate directly; ambiguity must surface as re-planning.
5. **`frozen` dependency semantics by default.** Less parallelism than `draft_ok`,
   in exchange for no wasted downstream work; parallelism is opt-in per edge.
6. **`breaking_allowed` contract policy for MVP.** Gains: speed and simplicity for a
   single user; the re-plan loop gets hardened early. Cost: rework is a normal
   event; policy must flip (and contract lint must be added) before company users.
7. **Escalate all diffs.** Gains: total observability during active development,
   trust built on evidence, metric data on which escalations are rubber stamps.
   Cost: high human interaction load *now* — accepted deliberately, and it
   temporarily works against the interaction metric.
8. **Markdown as source of truth + disposable SQLite, over a database-of-record.**
   Gains: trivial sync/diff/backup, human-readable truth, rebuildable index. Cost:
   no relational integrity on the truth itself; rebuild cost after loss of the
   index; all cross-file consistency is convention enforced by the single writer
   (drift-detected on demand by `kanthord verify`, §6.1).
9. **Single-writer daemon.** Gains: near-elimination of sync conflicts, simple
   mental model. Cost: no multi-machine active-active; documented constraint that
   will need real design work if two daemons are ever wanted.
10. **`single_checkout` for mobile repos.** Gains: disk safety on known-heavy repos.
    Cost: mobile work serializes (mitigated: mobile serializes badly anyway —
    signing, emulators).
11. **Task-boundary session teardown.** Gains: clean contexts, one code path for
    respawn/compaction/crash-recovery. Cost: any in-context nuance not captured by
    `checkpoint()` into STATE.md is lost — puts real pressure on STATE.md quality
    and the bounded-rewrite discipline.
12. **Compaction at ~50–60% of window, not the hard limit.** Gains: quality (models
    degrade well before the window fills). Cost: more frequent respawn overhead.
13. **Basic auth + VPN for MVP.** Gains: ships fast. Cost: known security debt,
    explicitly fenced ("upgrade before any non-VPN exposure") — an assumption
    future-you must not forget.
14. **Human keeps the merge/deploy button.** Gains: blast radius of a bad feature is
    zero; scariest verbs stay approval-tier. Cost: cycle time includes human
    latency; kanthord only automates the *watching* (observers + notify).
15. **Support/Q&A lane cut from MVP.** Gains: routing envelope (the hardest deferred
    design) shrinks to nothing; MVP focuses on the 60%-of-time activity. Cost:
    ~40% of the daily workload (support, questions, knowledge curation) is
    unaddressed by MVP, and the intake/routing design debt returns in v2.
16. **Byte-diff fallback for contract artifacts.** Gains: zero format work required
    to ship; safe default. Cost: noisy escalations (any byte change escalates) until
    format handlers are written per project.
17. **Planner optional / external.** Gains: smaller, more testable kanthord
    ("execution engine for validated plans"); leverages human planning strength.
    Cost: plan quality is an input kanthord can't control — garbage plans lint clean
    if structurally valid; the lint checks shape, not wisdom.
18. **Cross-repo verification = contract gates + observed deploys + manual e2e.**
    Gains: MVP-sized. Cost: integration bugs that pass contract checks but fail
    end-to-end are caught late (at deploy observation or by the human) — automated
    preview environments deferred.
19. **One wake-up mechanism (SQLite poll) instead of callbacks + polling.** Gains:
    simplicity, one scheduler to debug. Cost: wake latency bounded by poll interval;
    acceptable for long-running work.
20. **Chain-of-responsibility as the universal extension pattern.** Gains: one
    mental model for workflows/observers/contract handlers, easy modification.
    Cost: some problems fit chains awkwardly; the pattern is a commitment.

### Added during the Plan Contract session

21. **Frontmatter/body duplication.** Machine refs are declared in frontmatter and
    elaborated in prose. Gains: no prose parsing, exact machine layer. Cost: the
    same concept lives in two places; lint keeps ids consistent but cannot verify
    the prose matches the declaration.
22. **Semantics in filenames.** Gains: ordering + parallelism visible in `ls`,
    grammar shared across story and task levels, insertion room via number gaps.
    Cost: a rename is a plan edit; `id` vs filename split and `kanthord renumber`
    tooling are required to keep references stable.
23. **RUNBOOK as a shared mutable channel.** Gains: cross-task learning, cheap
    gotcha capture by both human and agents. Cost: first cross-task prompt-injection
    propagation vector in the system — mitigated by audited `runbook.append` tier,
    attribution, secret scanning, and the runbook hash chain (unjournaled changes
    detectable; spawn-time staleness notice), never by gating dispatch.
24. **One shape per feature.** Gains: simple compiler, no composition semantics.
    Cost: a feature that fits no shape needs a new shape authored, not a blend.
25. **Last-write-wins on RUNBOOK.** Acceptable because it is guidance, not truth,
    with a single automated writer; a lost concurrent edit costs a note, not
    correctness.
26. **Hardcode `tdd@1`, defer the Shape plugin framework (S7).** Gains: cuts the single
    largest piece of speculative infrastructure; MVP ships one shape without an
    interface/registry it cannot yet validate against a second case. Cost: a later
    refactor to extract the `PlanShape` seam from two concrete shapes instead of one
    imagined one; the framework design lives non-binding in Appendix A and must not be
    treated as pre-approved scope.

---

## Appendix A — Shape Framework (non-binding; post-MVP extraction target)

> **Status: NOT built for MVP.** This appendix preserves the Shape *plugin* design so the
> thinking is not lost. It is **non-binding** — do not treat it as approved scope. MVP
> hardcodes `tdd@1` in core (§7.1.1, §8). Extract this seam only when a real second shape
> arrives (§10 "start with two"). At that point the shape whose rules are already
> hardcoded (`tdd@1`) and the new one together reveal the true interface.

**Concept.** A **Shape** is the structural type of a plan — the strategy object that
defines how a feature is decomposed and what discipline its tasks follow. **Workflow** is
how one task executes; **Shape** is how a whole plan is structured. One shape per feature
(`shape: tdd@1` on the epic); composition is out of scope.

**Shape interface.**

```ts
interface PlanShape {
  name: string;
  version: number;
  nodeKinds: NodeKindSpec[];           // frontmatter schema per kind (epic/story/task)
  requiredDocs: DocSpec[];             // e.g. RUNBOOK.md for TDD (+ scaffold template)
  lint(fileSet: FeatureFiles): Diagnostic[];   // shape-specific rules, both layers
  compile(fileSet: FeatureFiles): CorePlan;    // lowering to IR
  defaults: { workflow: string; gates: GateSpec[]; policies?: Partial<Policies> };
}
```

Shapes would be the fifth extension family (workflows, observers, contract handlers,
model providers, **shapes**) and untrusted from the executor's perspective: compiled
output re-validated by core lint (a buggy shape cannot hand the executor an invalid
plan).

**Shape registry (yaml — configuration only).**

```yaml
## kanthord/shapes/tdd.yaml
shape: tdd
version: 1
module: ./shapes/tdd/index.ts        # code shape (full strategy)
## declarative: ./shapes/flat/shape.yaml   # trivial shapes: fields + lint only,
                                          # default compiler
```