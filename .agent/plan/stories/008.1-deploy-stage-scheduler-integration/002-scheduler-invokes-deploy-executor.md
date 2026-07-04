# Story 002 - Scheduler Dispatch Lifecycle Owns Deploy Execution

Epic: `.agent/plan/epics/008.1-deploy-stage-scheduler-integration.md`

## Goal

The existing `pollOnce` dispatch lifecycle owns deploy-stage execution: dispatching a
deploy-stage node invokes the deploy executor for that one stage; a passing stage
marks the node's exit gate so the next stage becomes dispatchable; a failing stage
(handler **or** soak) records `halt_and_escalate`, leaves the gate unpassed, and
downstream stages never run; the last stage's passed gate is the chain's completion.
Merge / deploy / rollback verbs are never called.

## Acceptance Criteria

- A deploy stage is executed **only** when the scheduler dispatches its node through
  the existing dispatch pass (`pollOnce`: gate/generation filter → lease acquire →
  `pending`→`running` → generation pin → execute) — not by a bare `runChain`/
  `runStage` call. This is the observable closure of Epic 008 blocker B2.
- A stage whose ordered handlers pass and whose observers stay healthy across the
  soak window marks that node's exit gate as passed, and **only then** does the next
  deploy stage become dispatchable; on pass the stage emits a `notify_human` event
  carrying the stage context (PRD §7.4 — on_pass notify_human).
- A stage that fails — **either** a handler unhealthy **or** an observer that flips
  unhealthy during the soak — resolves `halt_and_escalate` with evidence (which
  observer, observed value, fake-clock instant, stage id, soak-window history), does
  **not** mark its exit gate, and the downstream deploy stage is never dispatched or
  executed (PRD §7.4 — on_fail halt_and_escalate with evidence).
- A passed stage is never re-executed, and a `running` stage is never dispatched
  twice within a poll cycle (idempotent dispatch — falls out of the `running` status
  + exit-gate guards).
- The **last** deploy stage's passed exit gate is the observable completion of the
  deploy chain: after it, no further deploy-stage node is dispatched.
- Across the whole scheduler-driven run the fake broker's recorded command log shows
  **no** merge/deploy/rollback verb (asserted against the recorded log, not a vacuous
  absence); the soak advances only on the injected **fake clock** — no real elapsed
  time (PRD §7.4, §9; Phase-1 determinism).

## Constraints

- **`pollOnce` owns dispatch.** Deploy-stage execution is driven from the existing
  `src/scheduler/poll.ts` dispatch lifecycle (lease/status/generation), not from a
  scheduler-adjacent helper that merely queries dispatchables and calls the executor
  (debate finding, 2026-07-05 — otherwise it is Solution B in disguise). Wiring may
  live in `poll.ts` or a small `src/scheduler/deploy-dispatch.ts` invoked *inside*
  the dispatch pass — name it in the turn.
- **One executor primitive.** Decompose the Epic 008 executor to a per-node
  primitive (execute a single deploy-stage node: ordered handlers → `soakStage` over
  that node's soak window → pass/`halt_and_escalate` with evidence). `runChain` must
  **delegate to the same primitive** rather than keep an independent whole-chain
  loop, so Epic 008's `runChain` behavior and scheduler-driven execution cannot
  diverge (debate finding — duplication/consistency risk). Cite Epic 008.
- Mark the node's exit gate on pass via the existing `markExitGatePassed`; a fail
  leaves it unpassed so `dispatchable` keeps downstream deploy nodes blocked
  (Epic 004). No auto-merge: `on_pass` emits a `notify_human` event only; merge /
  deploy / rollback stay human (PRD §7.4, §9; Trade-off #14).

## Verification Gate

- `npm test` green for the scheduler-driven deploy tests under `src/scheduler/`
  and/or `src/deploy/`; `npm run typecheck` exits 0.

### Task T1 - pollOnce-driven per-stage execution; pass marks gate + unblocks next + completes chain

**Input:** `src/deploy/chain.ts` (extract the per-node primitive; `runChain`
delegates to it), the dispatch wiring (`src/scheduler/poll.ts` or new
`src/scheduler/deploy-dispatch.ts`), and their co-located `*.test.ts`.

**Action - RED:** Write a test on the fake clock that runs the scheduler dispatch
pass over a compiled plan's deploy frontier (upstream gates already passed) and
asserts: the deploy executor runs for the dispatched deploy-stage node **via the
`pollOnce` lifecycle** (recorded and tied to the node id — not a bare call, and only
after lease + `running`); a healthy stage marks its exit gate and the **next** deploy
stage then becomes dispatchable; on pass a `notify_human` event with the stage
context is emitted; the fake broker's recorded command log has **no** merge/deploy/
rollback verb; and after the **last** stage passes no further deploy node is
dispatched.

**Action - GREEN:** Extract the per-node deploy primitive (`runChain` delegates to
it), and wire the `pollOnce` dispatch pass to invoke it for `kind='deploy-stage'`
nodes, calling `markExitGatePassed` on pass so the downstream stage unblocks.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Failing stage halts, gate unpassed, downstream never runs (handler fail AND soak flip)

**Input:** same as T1.

**Action - RED:** Write two failure cases on the fake clock, both driven through the
`pollOnce` dispatch pass: (a) a dispatched stage whose **handler** is unhealthy; (b)
a dispatched stage whose observer stays healthy at soak start but **flips unhealthy
during** the soak. For each, assert the scheduler-driven execution resolves
`halt_and_escalate` with full evidence (observer, observed value, fake-clock instant,
stage id, and — for the soak case — soak-window history), the node's exit gate is
**not** set, and the downstream deploy-stage node is **never** dispatched or executed.

**Action - GREEN:** On an executor fail (handler or soak), record the escalation with
evidence and do **not** mark the node's exit gate, leaving `dispatchable` to keep
downstream deploy nodes blocked.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
