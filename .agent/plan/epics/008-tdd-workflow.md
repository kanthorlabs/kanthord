# EPIC 008 — tdd@1: native role agents + durable workflow executor

> **DRAFT — blocked on EPIC 006.** Do not dispatch through `/work`. Every
> surface below extends an EPIC 006 seam (PiAgentRunner, profiles, escalation,
> workspace, provider session); author the detailed Story/Task files only once
> EPIC 006 has shipped and those seams are re-verified. Design debated
> 2026-07-17 (opencode/gpt-5.6, 10 blockers + 7 suggestions merged) — see the
> decision notes at the end. Decisions D-A and D-B need Ulrich's explicit
> ruling before story authoring.

## Goal

A Task can name `tdd@1` as its executor and the daemon runs it as a **durable
multi-step workflow** over three kanthord-native role agents — TestEngineer
(test operations only, no production code), SoftwareEngineer (implementation
only; verifies only that its work compiles/lints), ReviewerEngineer (read-only
judgment against project conventions) — all implemented as profiles on the ONE
shared pi-agent-core `Agent` loop from EPIC 006 (reuse-pi-first: same loop,
same pi-coding-agent tool factories; kanthord adds role policy, never a second
agent loop). The workflow ports the `/work` MVP mechanics into the daemon:
RED → GREEN alternation with engine-owned verification after every step, a
reviewer gate whose `action:YES` findings route back through the loop once,
attempt-limit escalation, and a human review gate that reuses the EPIC 006
`awaiting_confirmation` / `approve` / `reject` machinery verbatim. The epic
fixes two extension points: a **role registry** (more agents later, coding or
not) and a **workflow registry** (`pr@1`, `answer@1` later) — adding either is
a new module plus a registration line, nothing else changes (OCP).

## Verification Gate

Gates: `npm run typecheck && npm test` (hermetic — the full tdd@1 cycle
runs against EPIC 006's `FakeSessionFactory` with scripted turns for
all three roles: real pi `Agent`, real tools, real git in temp dirs,
no network. The suite includes: the pure `tdd@1` transition function
covered state-by-state; a crash-resume test that kills the engine
between two steps and proves idempotent resume from the step ledger;
and a lane test proving an out-of-lane SE write fails the step.)

Proof: (fresh EPIC 006-style setup shell: `KANTHORD_DB`, `db migrate`,
PROJECT/INITIATIVE/OBJECTIVE creates, `SANDBOX` throwaway git repo,
AIPROV `gpt-5.5`, CRED with a real key, REPO — exactly as the EPIC 006
Proof preamble.)

```bash
TASK=$(node src/main.ts create task --objective "$OBJECTIVE" \
  --title "greeting module with tests" \
  --instructions "Create src/greet.js exporting greet(name) returning 'hello <name>', with a node:test unit test." \
  --ac "a unit test covers greet('world') === 'hello world'" \
  --ac "node --test passes" \
  --agent tdd@1 \
  --context repository=$REPO --context ai_provider=$AIPROV --context credential=$CRED)

node src/main.ts daemon run --until-idle; echo "exit=$?"
# exit=0 + "1 task(s) awaiting confirmation" — tdd@1 finished its cycle and
# parked at its human review gate (NOT completed: the human gate is part of
# the workflow definition).

node src/main.ts list workflow-steps --task "$TASK"
# prints the step ledger in order, one row per step:
#   1 test-engineer     RED       succeeded  <commit-sha>
#   2 software-engineer GREEN     succeeded  <commit-sha>
#   3 test-engineer     CONFIRM   succeeded  <commit-sha-or-->
#   4 reviewer-engineer REVIEW    succeeded  --            (empty diff)
#   ... (extra RED/GREEN rows appear if the reviewer routed action:YES findings)

node src/main.ts get task --id "$TASK"
# awaiting_confirmation; TaskResult shows workspace, branch kanthord/<task-id>,
# proposal commit, and a summary naming the review verdict.

git -C "<printed workspace path>" log --oneline
# one commit per mutating step (kanthord git identity): the test commit(s)
# precede the implementation commit(s) — the TDD order is visible in history.

node src/main.ts approve task "$TASK"
node src/main.ts get task --id "$TASK"     # completed; commitSha = proposal
node src/main.ts events --after 0
# task.started → workflow.step.started/finished per step (role + kind in the
# payload) → task.escalated → task.approved → task.completed

# attempt-limit path (deterministic, no LLM roulette): a task whose
# instructions demand an impossible AC is driven by the scripted fake in the
# hermetic suite, not the Proof; the Proof's failure check is the cheap one:
node src/main.ts create task --objective "$OBJECTIVE" --title x \
  --instructions x --ac x --agent nope@1 \
  --context repository=$REPO --context ai_provider=$AIPROV --context credential=$CRED
# exit 1 — RunnerNotResolvableError at creation (AgentCatalog gate), proving
# the executor-ref namespace is validated up front.
```

## Stories

- **Shared agent core extraction.** Refactor EPIC 006's `PiAgentRunner`
  internals into an adapter-private shared core (loop setup, provider session,
  instruction loading, evidence normalization, escalate tool) consumed by BOTH
  the task-level runner (`generic@1`) and the new role-step execution — the
  pi loop exists exactly once. No behavior change for `generic@1` (its EPIC
  006 tests keep passing unmodified — the regression anchor).
- **Role profiles + role registry.** `test-engineer@1`, `software-engineer@1`,
  `reviewer-engineer@1` as declarative profiles: persona system prompt (ported
  from the `.claude/agents/*.md` MVP personas: role boundary, authority chain),
  tool policy (RE: read/grep/find/ls only — no write/edit/bash, which IS
  preventive; TE/SE: full coding set), and the layer-2 repo instructions via
  the existing `InstructionLoader`. Role refs live in a **role registry**
  consumed by workflow definitions; they are NOT task-assignable executor refs
  (D-A). Profile shape carries nothing coding-specific — a future non-coding
  role is persona + tool policy + output schema.
- **RoleStepRunner port (debate B8).** A narrow internal port for ONE bounded
  role run: `execute(step: StepSpec, ctx): Promise<StepResult>` — no task
  lifecycle, no proposal freezing, no TaskResult. `StepResult` carries
  evidence plus typed artifacts `{ kind; schemaVersion; payload }` (debate
  S4) so future roles add artifact kinds without widening a universal type.
  The task-level `AgentRunner` contract stays untouched for solo agents.
- **Step contracts (debate B4/S2).** Verification is per-STEP, not per-role:
  each workflow step declares its role ref, expected mutation policy (RED:
  test-lane files only, diff required; GREEN: production-lane only, diff
  required; CONFIRM: no diff expected; REVIEW: empty diff + structured
  findings), trusted verification commands, retry policy, and output schema.
  Role profiles hold persona and general capability; step-specific rules never
  leak into the role.
- **Engine-owned verification + trusted commands (debate B5/S5).** The engine
  itself runs each step's verification commands (`npm run typecheck` after
  GREEN, the test command for RED-fails / CONFIRM-passes) via
  `node:child_process` and captures structured `CommandEvidence`
  (command, exit, tail) — an agent's _claim_ that tests pass is never
  evidence. Commands are owned by the workflow definition's config (repo-level
  override is a later epic), never taken from model output or repo instruction
  files.
- **Lane enforcement: post-step diff is the boundary; ring-1 is advisory
  (debate B6).** Authoritative check: after every step the engine diffs the
  workspace against the step's base commit and fails the step on any
  out-of-lane path (per the step's mutation policy — the MVP `lane-check`
  semantics). Best-effort fast feedback: a `beforeToolCall` gate on write/edit
  path args returns a structured tool error so the agent self-corrects early;
  it is explicitly NOT the security boundary (bash can bypass it — documented).
- **Durable workflow run (debate B1/B2/B3/B9/S7).** Migration adds
  `workflow_runs` (task_id, workflow ref, status, cursor, review-cycle count)
  and `workflow_steps` (run_id, seq, role, kind, status
  scheduled|running|succeeded|failed, base_commit, result_commit, attempt,
  evidence JSON) — explicit state, transactional; turns/transcript are audit
  payload on the step rows, never replayed to derive state. Every mutating
  step ends with a **workspace git commit** (kanthord identity) recorded as
  `result_commit` — stable before-state for the next step's lane diff,
  attribution, and retry cleanup (reset to last good commit). Resume protocol:
  on restart a `running` step is reconciled against the workspace (commit
  present → mark succeeded; absent → reset + retry), making
  `execute(task)` idempotent — that idempotency is what makes registering the
  workflow behind the task-executor seam honest (D-C).
- **Pure tdd@1 definition (domain).** `domain/workflow/` gets the transition
  function: typed step outputs drive RED → GREEN → CONFIRM (loop while the
  TE opens further REDs within the task's ACs) → REVIEW → route `action:YES`
  findings back as blocker input exactly ONCE per review cycle, bounded review
  cycles (default 2, then park for the human regardless — debate S6), per-step
  attempt limit 3 → park with the failure transcript as the escalation reason.
  All terminal outcomes enumerated; hermetically tested state-by-state.
  Zero I/O.
- **Workflow executor + registry.** `TddWorkflowRunner` implements the
  task-executor contract and registers as `tdd@1` in the EPIC 005/006 resolver
  — the daemon/queue/claim path changes zero lines. Internally: loop { pure
  next-step → ledger transition → dispatch via RoleStepRunner → engine
  verification → commit + persist }. `pr@1`/`answer@1` later = new definition
  module + registration line. Workflow-owned submission (D-B): on the terminal
  gate the workflow freezes the proposal and parks the task through the
  existing escalation machinery; `reject --resolution retry` re-enters the
  workflow with the rejection reason as blocker input (EPIC 006 retry-feedback
  path). Mid-run, member agents keep the `escalate` tool — a role escalation
  parks the WHOLE workflow run.
- **Reviewer structured output (debate S3).** The reviewer profile gets a
  runner-owned `submit_review` tool with a JSON schema
  (findings: severity blocker|suggestion, action yes|no, file, note; verdict).
  The accepted tool payload IS the typed `ReviewFindings` artifact; prose in
  the final response stays explanatory. Missing/invalid submission → step
  rejected with a structured code, attempt counted.
- **CLI + events surface.** `list workflow-steps --task <id>` (ledger view,
  read-only query); `workflow.step.started` / `workflow.step.finished`
  (role, kind, status, commit) events through the existing feed;
  `get task --id` summary names the workflow, step count, and review verdict.
- **End-to-end smoke.** Hermetic full-cycle test on scripted fakes: happy path
  (RED→GREEN→CONFIRM→REVIEW→park→approve), reviewer `action:YES` re-route
  once, attempt-limit park, crash-resume mid-cycle. Plus the Proof runbook.

## Decision notes (debated 2026-07-17, opencode/gpt-5.6 — 10 blockers, 7 suggestions merged)

- **D-A (needs Ulrich): executor-ref namespace.** Recommended: keep ONE
  required `Task.agent` field; its value space is **executor refs** —
  single agents (`generic@1`) and workflows (`tdd@1`, `pr@1`) — validated by
  `AgentCatalog.has` at creation. Role refs (`test-engineer@1`, …) are
  workflow-internal bindings in a separate role registry and NOT
  task-assignable — this preserves the domain distinction the debate demanded
  (S1: "tdd@1 is a process definition; test-engineer@1 is an actor policy")
  without two nullable task fields and a precedence rule. Alternative: a
  separate `Task.workflow` field per the README sketch — rejected as two
  fields where one determines the other. The README tree collapses
  Agent/Workflow into the one executor ref if D-A holds.
- **D-B (needs Ulrich): escalation-authority amendment.** EPIC 006 D3 rules
  "escalation is solely the agent's decision" — scoped to SOLO agent runs.
  For workflow-run tasks the **workflow definition owns submission**: parking
  at the human gate is a process rule (tdd@1 always ends at human review),
  not a member agent's choice. Member agents keep `escalate` for mid-run help;
  the parking machinery (proposal freeze, `awaiting_confirmation`,
  approve/reject, retry feedback) is reused verbatim either way. This honors
  the EPIC 006 cross-epic constraint (confirmers trigger on
  proposal-readiness, never as completion dependents).
- **D-C: one claimed job + internal durable ledger (v1).** The whole tdd@1 run
  executes inside one claimed job; crash-safety comes from the step ledger +
  per-step commits + idempotent resume, not from splitting steps into queue
  jobs. Steps-as-jobs (each step its own `jobs` row) is the documented
  evolution if the single-process assumption breaks — the ledger schema is
  designed so that split changes the dispatcher, not the tables.
- **Composite claim, corrected (debate B1/B8).** The original "a workflow is
  a composite AgentRunner" over-claimed LSP. Merged position: the workflow
  registers behind the same task-executor seam (daemon unchanged — the locked
  EPIC 005 boundary), but it is a **durable workflow executor**, and it never
  invokes the task-level `AgentRunner` for member roles — roles run through
  the narrow `RoleStepRunner` port that cannot touch task lifecycle.
- **Verification is step-scoped (debate B4).** EPIC 006's pre-ruled per-role
  verify policies (TE/SE non-empty diff; RE empty diff) survive as step
  defaults but the STEP owns the policy — a CONFIRM step by the TE correctly
  expects an empty diff.
- **Enforcement boundary (debate B6).** The post-step diff against the step's
  base commit is the lane boundary; the `beforeToolCall` gate is advisory
  UX. Full bash/network sandboxing stays the dedicated security epic.

## Debate record (2026-07-17, opencode/gpt-5.6 — pending Ulrich's review)

All findings from the design debate, with how the draft resolved each. Every
merged item is reflected in the Stories/Decision notes above; this list is the
audit trail for the human review.

- `B1 - action:YES - false-LSP - A multi-step workflow is not behaviorally
substitutable for one agent run. Merged: "durable workflow executor" behind
the same task-executor seam; idempotent resume is what makes the
substitution honest.`
- `B2 - action:YES - queue-durability - One composite run occupies a worker
for the whole cycle; a crash between file changes and persistence is
ambiguous. Merged: durable workflow_steps ledger with per-step idempotency.`
- `B3 - action:YES - cursor-protocol - Persist-before-dispatch loses steps;
persist-after duplicates them. Merged: step states
(scheduled/running/succeeded/failed) + per-step commits; resume reconciles
ledger vs workspace.`
- `B4 - action:YES - step-scoped-verify - A role-level verify policy is wrong
(TE CONFIRM step expects an EMPTY diff). Merged: verification lives on the
step contract; EPIC 006 per-role policies survive only as step defaults.`
- `B5 - action:YES - trusted-evidence - Agent claims that tests pass are not
proof. Merged: the engine runs typecheck/test commands itself and captures
structured CommandEvidence.`
- `B6 - action:YES - shell-gate-is-not-prevention - beforeToolCall path checks
cannot constrain arbitrary bash. Merged: post-step diff against the step's
base commit is the enforcement boundary; the gate is advisory UX only.`
- `B7 - action:YES - escalation-authority-conflict - EPIC 006 D3 says
escalation is solely the agent's decision; a workflow-owned human gate is a
different authority. Merged as pending decision D-B below.`
- `B8 - action:YES - runner-recursion - A workflow must not invoke the
task-level AgentRunner for member roles (it owns task lifecycle). Merged:
narrow RoleStepRunner port returning StepResult only.`
- `B9 - action:YES - workspace-recovery - A shared mutable tree gives no
stable before-state after crashes/retries. Merged: every mutating step ends
with a workspace git commit recorded on the ledger row.`
- `B10 - action:YES - non-coding-overstated - Mandatory baseCommit/finalDiff +
lanePolicy make the contract coding-shaped. Merged partially: step artifacts
{kind, schemaVersion, payload} reserve the extension point; generic
non-coding evidence is an explicit non-goal, shipped with answer@1.`
- `S1 - action:YES - workflow-identity - tdd@1 is a process definition,
test-engineer@1 an actor policy; do not collapse them silently. Merged as
pending decision D-A below (one executor-ref field + separate role
registry).`
- `S2 - action:YES - step-contracts - Steps declare role, mutation policy,
trusted commands, retry policy, output schema; role profiles keep persona +
general capability. Merged (own story).`
- `S3 - action:YES - structured-submission - Reviewer reports via a
runner-owned submit_review tool with a JSON schema, not parsed prose.
Merged (own story).`
- `S4 - action:YES - versioned-artifacts - No growing RoleOutput union on
VerificationResult; typed artifacts {kind, schemaVersion, payload} decoded
by the requesting step. Merged.`
- `S5 - action:YES - command-ownership - Verification commands come from the
workflow definition's config, never from model output or repo instruction
files. Merged; repo-level override is a later epic.`
- `S6 - action:YES - bound-review-routing - "Auto-route once" needs cycle
limits and terminal outcomes. Merged: bounded review cycles (default 2,
then park for the human), all terminals enumerated in the pure definition.`
- `S7 - action:YES - state-vs-transcript - Do not derive state by replaying
turns. Merged: explicit run/step state is transactional; turns are audit
payload on the step rows.`

Not merged (kept on record):

- `N1 - action:NO - steps-as-jobs - Splitting each step into its own jobs row.
Deferred as D-C: v1 is one claimed job + internal ledger; the tables are
shaped so a later split changes only the dispatcher.`
- `N2 - action:NO - deny-general-shell - Replacing bash with narrow command
tools for TE/SE. The post-step diff boundary covers the lane risk; revisit
if bash misuse shows up in practice.`
- `N3 - action:NO - generic-evidence-union-now - Designing the full non-coding
evidence union in this epic. Deferred to the answer@1 epic; only the
artifact extension point ships.`

### Pending rulings for Ulrich (block story authoring)

- `D-A - action:PENDING - executor-ref-namespace - Recommended: ONE required
Task.agent field holding executor refs (generic@1, tdd@1, pr@1); role refs
live in a separate workflow-internal role registry and are not
task-assignable. Rationale: a workflow fully determines its roles; two task
fields need a precedence rule and invite mismatches. Alternative: a separate
nullable Task.workflow field, faithful to the README tree but redundant with
agent. Consequence of the recommendation: the README's Agent/Workflow nodes
collapse into the one executor ref.`
- `D-B - action:PENDING - escalation-authority-amendment - Recommended: for
workflow-run tasks the workflow definition owns submission to the human gate
(tdd@1 always parks at human review — a process rule); member agents keep
the escalate tool for mid-run help, which parks the whole run. This amends
EPIC 006 D3 ("escalation is solely the agent's decision") for workflow tasks
only; the parking machinery is reused verbatim either way. Alternative: no
amendment — the final TE step must call escalate itself; keeps D3 intact but
the gate then depends on prompt obedience, not the engine.`

## Non-goals

- **No `pr@1` / `answer@1` implementation** — the registries and the
  artifact/evidence extension points are the deliverable; the next workflow
  proves them. Non-coding evidence (no git, no diff) is designed for via
  step artifacts but not shipped.
- **No parallel or cross-task steps** — one workflow run, one workspace,
  sequential steps.
- **No per-role AIProvider/model** — all roles use the task's `ai_provider`
  context this epic (per-role bindings are a Resource-resolver extension
  later).
- **No workflow-authoring DSL or config-file workflows** — definitions are
  code modules (pure + typed); a DSL is speculative until a third workflow
  exists.
- **No mid-run human steering** — human touchpoints are exactly the parked
  gate (approve/reject) and attempt-limit parks; answer-and-resume stays the
  later quality-loop epic.
- **No OS sandboxing / ring-1 security hardening** — the advisory gate ships;
  the security boundary epic stays separate (EPIC 006 non-goal carried over).
- **No MVP journal/gotcha-memory port** — role personas ship without the
  `.agent/tdd/memory` machinery; a shared agent-memory capability is its own
  epic.
- **No steps-as-jobs queue split** (see D-C) and no workflow GC/retention
  policy beyond EPIC 006's workspace rules.
