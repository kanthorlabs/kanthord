# Story 001 - Chain Executor (ordered handlers, pass/fail/escalate)

Epic: `.agent/plan/epics/008-deploy-chain-executor.md`

## Goal

The generic deploy-chain executor: for a stage, run its observer handlers in declared
order, and resolve pass / fail / escalate — a failing handler halts the chain and
escalates with evidence; later stages never run before earlier ones.

## Acceptance Criteria

- The chain definition is the **compiled** deploy-stage nodes (Epic 002, from epic
  frontmatter), and the executor is invoked by the scheduler continuing past PR-open
  into those DAG nodes — not a standalone entry point (PRD §7.4 — DAG continues into
  deploy stages; debate finding).
- A stage's handlers run in the **declared order** (assert order via recorded
  invocation sequence) (PRD §7.4 — ordered handlers).
- There is **one** stage lifecycle: ordered handler collection → criteria+soak
  (Story 002) → resolve. This Story owns ordering + halt/escalate mechanics; a stage
  is not finally `pass` until Story 002's criteria+soak — there are **not** two
  independent pass paths (debate finding — unify the lifecycle).
- A handler failing resolves `halt_and_escalate`: the chain stops, **no later stage
  runs**, and an escalation event is recorded with the failing handler's evidence
  attached (PRD §7.4 — on_fail halt_and_escalate with evidence).
- The chain definition (stages, ordered handlers, criteria) is **read from the plan**
  (feature-level), not hardcoded (PRD §7.4 — chain definitions live in the plan).
- The executor is generic: it calls the handler interface and applies pass/fail/
  escalate over **generic observer names + plan-declared predicates**; it embeds no
  Sentry/SigNoz/k8s/error-rate/rollout vocabulary (PRD §7.4, §10 — engine ships
  generic; debate finding).
- Fail evidence includes which observer failed, its observed value, the fake-clock
  instant, and the stage id (PRD §7.4 — observation evidence; debate finding — not
  just the final handler output).

## Constraints

- Chain-of-responsibility with pass/fail/escalate is the mandated pattern (PRD §7.4,
  §10, Trade-off #20). Handlers are fakes here (phases.md Phase 1).
- Evidence attached on fail is the failing handler's observed output, recorded as an
  escalation event (jsonl, Epic 001) (PRD §7.4).
- Ordering is strict: a later handler/stage must not start until the earlier one
  passed (PRD §7.4 chain semantics).

## Verification Gate

- `npm test` green for `src/deploy/chain.test.ts`.

### Task T1 - Ordered handler execution + proceed on all-pass

**Input:** `src/deploy/chain.ts`, `src/deploy/chain.test.ts`

**Action - RED:** Write a test that loads a stage from a **compiled** deploy-stage
node (Epic 002 fixture, generic observer names) with three fake handlers recording
call order; assert they run in declared order and the executor is driven via the
scheduler's continuation into the deploy DAG node (not a bare call); all passing, the
stage proceeds to criteria+soak (Story 002) then the next stage runs.

**Action - GREEN:** Implement `runStage(stageNode, handlers)` invoking handlers in
declared order over generic predicates; `runChain` proceeding stage by stage, invoked
from the scheduler's post-PR continuation.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Halt + escalate with evidence on handler failure

**Input:** `src/deploy/chain.ts`, `src/deploy/chain.test.ts`

**Action - RED:** Write a test where the second of three handlers fails; assert the
chain halts (third handler and any later stage never run) and an escalation event is
recorded carrying evidence = {which observer, observed value, fake-clock instant,
stage id}.

**Action - GREEN:** Add the `halt_and_escalate` path: stop on first failure, record
the escalation with evidence, do not run subsequent handlers/stages.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
