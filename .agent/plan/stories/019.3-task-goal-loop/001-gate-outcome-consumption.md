# Story 001 - GateResult contract + gate-outcome consumption in the tick

Epic: `.agent/plan/epics/019.3-task-goal-loop.md`

## Goal

The run-loop tick stops being dispatch-once: after a dispatched session
completes **cleanly**, the tick evaluates the task's exit gate via the
workflow seam and routes the outcome — `pass` marks the exit gate passed
(the existing completion path is unchanged), `needs_human` parks the task
with an escalation inbox item, `fail` hands off to the corrective path
(Stories 002/003). This story also owns the epic's named contract change:
`gateCheck` returns a structured `GateResult { outcome, summary? }` so a
`fail` can carry the evidence the retry depends on (debate finding
2026-07-10 — the bare enum could not produce it). This is the L2→L3 wiring
that no epic owned.

## Acceptance Criteria

- `gateCheck` returns `GateResult { outcome, summary? }`: `outcome` keeps
  the existing three values; `summary` is an optional bounded string
  present on `fail`; the gate-result sink records both. All existing
  `GateOutcome` consumers (Epic 006 fake, harness) stay green under the
  changed shape.
- A session that ended aborted or errored is NOT gate-checked: it routes to
  the existing lifecycle/crash path, and no gate-result record is written
  for it (debate finding 2026-07-10 — idle alone is not "attempt
  complete").
- After a session for a dispatchable task completes cleanly, the tick calls
  the workflow's `gateCheck` for the task's exit phase exactly once per
  attempt and records the result to the gate-result sink.
- On `pass`, the task's exit gate is marked passed so downstream tasks
  become dispatchable, and the task proceeds on the existing completion
  path (PR-merge observation, Epic 019.2 Story 004 — unchanged).
- On `needs_human`, the task is parked and an escalation inbox item exists
  naming the task and the gate phase; the task is not re-dispatched by
  subsequent ticks while parked.
- On `fail`, the task does NOT advance and does NOT park; it is handed to
  the corrective path (observable in this story as: status returns to a
  dispatchable state — evidence/ledger behavior is owned by Stories
  002/003).
- A task whose session is still mid-attempt (lifecycle respawn pending) is
  not gate-checked — gate evaluation happens only at session completion.

## Constraints

- **Workflow seam only** — gate results come from the Epic 006 `Workflow`
  interface (`src/workflow/workflow.ts`), extended here to `GateResult`
  (the epic's named contract change — cite the epic anchor, debate finding
  2026-07-10); driven by the fake `tdd@1`; no real test execution (Epic 024
  owns real gates; epic Non-Goals).
- **Session-end classification via pi's observable state** — clean vs
  aborted/errored comes from the session handle's exposed end state (pi
  `stopReason: "aborted" | "error"` / `errorMessage` — verified in
  pi-agent-core `agent.ts`; the double scripts all three endings); the
  run-loop adds no heuristic of its own.
- **Run-loop is the caller** — wiring lands in `src/daemon/run-loop.ts`
  tick, after `waitForIdle` (Epic 019.2 contract); the session double is the
  injected `piSurface` (Epic 016 hermetic rule).
- **Escalation shape unchanged** — `needs_human` parks via the existing
  scheduler status + Epic 017 inbox contract (`createEscalationItem`); no
  new escalation mechanism.
- Statuses use the existing scheduler vocabulary
  (`src/scheduler/dispatch.ts` — `pending`/`running`/`parked`/`complete`);
  no new status table.

## Verification Gate

- `npm test` green for `src/daemon/run-loop.test.ts` gate-outcome cases;
  `npm run typecheck` exits 0.

### Task T1 - GateResult contract change on the workflow seam

**Input:** `src/workflow/workflow.ts`, `src/workflow/tdd-workflow.ts`,
`src/workflow/tdd-workflow.test.ts`, plus the existing `GateOutcome`
consumers the typecheck names (`src/harness/golden.ts`,
`src/harness/scenarios/2a-golden.ts`)

**Action - RED:** tests: `gateCheck` returns `{ outcome, summary? }`; the
fake `tdd@1` scripted to fail carries a summary and scripted to pass
carries none; the sink records outcome + summary; existing fake-workflow
suites still pass under the changed shape.

**Action - GREEN:** extend the seam to `GateResult`, update the fake and
the named consumers; no behavior change beyond the added field.

**Action - REFACTOR:** none.

**Verify:** `node --test src/workflow/tdd-workflow.test.ts` green; full
`npm test` no regression.

### Task T2 - exit-gate evaluation after clean session completion

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test seeds one dispatchable task, ticks with a session
double ending cleanly and a fake workflow scripted to return `pass`;
asserts `gateCheck` was called exactly once for the exit phase, the result
was recorded to the gate-result sink, the exit gate is marked passed, and a
downstream task becomes dispatchable on the next tick. Companion cases: no
`gateCheck` call for a task whose session has not completed; a session
double ending aborted and one ending errored are each NOT gate-checked and
leave no gate-result record.

**Action - GREEN:** classify the session ending from the handle's end
state, and only on clean completion wire the injected workflow's
`gateCheck` into the tick after `waitForIdle`, record to the sink, and call
the existing `markExitGatePassed` on `pass`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T2 cases green.

### Task T3 - needs_human parks with an inbox item

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** the fake workflow returns `needs_human`; the test asserts
the task status is `parked`, an escalation inbox item exists naming the task
and gate phase, and two further ticks spawn no session for it.

**Action - GREEN:** route `needs_human` to park + `createEscalationItem`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T3 cases green.

### Task T4 - fail returns the task to a dispatchable state

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** the fake workflow returns `fail`; the test asserts the
task is neither complete nor parked, and the next tick dispatches it again
(a second session spawn happens).

**Action - GREEN:** route `fail` back to the dispatchable state so the next
tick re-dispatches (evidence and attempt accounting arrive in Stories
002/003).

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T4 cases green.
