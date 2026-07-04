# Story 001 - Deploy Stages Are Schedulable (uniform predecessor gating)

Epic: `.agent/plan/epics/008.1-deploy-stage-scheduler-integration.md`

## Goal

Deploy-stage nodes become first-class DAG nodes the scheduler can dispatch, gated by
one uniform predecessor rule: the first deploy stage does not become ready until the
upstream work (the last-major story's tasks) is complete — the PR-open boundary —
and each later deploy stage does not become ready until its predecessor deploy stage
has passed. Task-node dispatch is unchanged.

## Acceptance Criteria

- Given a compiled plan (Epic 002) with tasks under a last-major story and a
  chain of deploy stages: the first deploy stage does **not** become ready to
  dispatch while any upstream task's exit gate is unpassed, and becomes ready
  **exactly once** all those upstream task gates have passed — the PR-open boundary
  (PRD §7.4 — DAG continues past PR-open).
- A later deploy stage does **not** become ready until the earlier deploy stage's
  exit gate has passed (stage-to-stage chaining).
- **Regression:** a plan with **no** deploy stages schedules its task nodes exactly
  as before — same dispatch order, gating, and generation behavior; task readiness
  still depends only on its task predecessors' gates.
- **Generation isolation:** a deploy-stage node from a stale generation is **not**
  dispatched after a plan recompile, and its dispatched generation is pinned — the
  same generation/dirty-plan guard that governs task dispatch.

## Constraints

- **Story→deploy gating model (decided, not deferred):** the compiler emits DAG
  edges from the last-major story's **terminal task node(s)** (its tasks with no
  successor task) to the **first** deploy-stage node, so deploy gating uses the
  **identical** task-predecessor rule. Keep the existing `story→deploy` grammar edge
  as structural documentation (inert for scheduling). Do **not** implement an
  aggregate "story is done when its tasks are done" rule inside readiness SQL
  (debate finding, 2026-07-05 — that hides domain semantics in the scheduler).
- The scheduler generalizes node loading and the predecessor-gate join to
  `kind IN ('task','deploy-stage')` — one rule for both kinds — so a `deploy-stage`
  predecessor gates a later stage exactly as a task predecessor gates a task. No
  separate deploy-only readiness query (debate finding — avoid a divergent frontier
  rule). Cite Epic 004 readiness/generation machinery.
- Reuse the existing `scheduler_task` table and `exit_gate_passed` column; deploy
  -stage rows live in it (no table rename this epic — Epic Non-Goals).

## Verification Gate

- `npm test` green for `src/compiler/*.test.ts` (terminal-task→deploy edge) and
  `src/scheduler/dispatch.test.ts` (deploy-stage dispatchability + generation
  isolation); `npm run typecheck` exits 0.

### Task T1 - Compiler wires terminal task(s) of the last-major story to the first deploy stage

**Input:** `src/compiler/compile.ts`, `src/compiler/*.test.ts` (name the exact test
file in the turn).

**Action - RED:** Write a test that compiles a plan whose last-major story has tasks
(some terminal, i.e. no successor task) and a deploy chain; assert the compiled
edges include an edge from each terminal task node of the last-major story to the
first deploy-stage node. Assert the pre-existing story→deploy grammar edge is still
present (additive, not a regression to Epic 002/008).

**Action - GREEN:** In the deploy-stage edge emission, add edges from the last-major
story's terminal task node(s) to the first deploy-stage node.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Scheduler dispatches deploy-stage nodes under the uniform gate rule

**Input:** `src/scheduler/dispatch.ts`, `src/scheduler/dispatch.test.ts`, and, if the
generation guard ripples, `src/scheduler/generation.ts` +
`src/scheduler/generation.test.ts` (name them in the turn).

**Action - RED:** Write a test that loads a compiled plan (with the T1 edges) into
the scheduler and asserts: (a) the first deploy stage is not ready while its upstream
terminal-task gates are unpassed; (b) after `markExitGatePassed` on those tasks it
becomes ready; (c) the second deploy stage is not ready until the first stage's gate
passes; (d) a deploy-free plan dispatches tasks unchanged; (e) a deploy-stage node
from a stale generation is not dispatched after a recompile.

**Action - GREEN:** Generalize node loading and the predecessor-gate join to
`kind IN ('task','deploy-stage')`, reusing the existing `exit_gate_passed` and
generation/dirty guards so deploy-stage dispatch inherits them.

**Action - REFACTOR:** Optional: fold the schedulable-kind list into one shared
constant so the task and deploy rules cannot diverge; otherwise `none`.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
