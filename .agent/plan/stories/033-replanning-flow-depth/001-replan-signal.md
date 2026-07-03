# Story 001 - Replan Signal

Epic: `.agent/plan/epics/033-replanning-flow-depth.md`

## Goal

A running task can tell the feature "this plan can't express what I found",
and the feature reacts deterministically: replanning state, new dispatch
halted, running work generation-pinned — with a scope-violation escalation
convertible into the same signal.

## Acceptance Criteria

- A running task raises a typed replan signal carrying: reason (prose),
  proposed change summary, and the artifact/node ids it believes affected;
  the signal is journaled at feature level and appears as an inbox item of
  the replan class.
- On the signal, the feature enters `replanning`: the scheduler dispatches no
  **new** tasks for that feature from the next poll onward; tasks already
  running continue under their pinned generation (both directions asserted).
  The halt holds through the whole signal→edit→approval window even though
  the plan is not yet dirty (debate finding — the leak window between signal
  and first file edit is the case under test).
- A scope-violation escalation is tagged a **replan candidate** on creation
  (PRD §4 — a blocked write is a re-planning signal); the blocked task does
  not proceed while the item is open (Epic 015 behavior, unchanged), but the
  feature-level `replanning` transition stays a human decision via the
  conversion below (deliberate divergence, debate-reviewed: auto-halting the
  whole feature on every scope violation would over-trigger).
- Other features are unaffected (asserted with a two-feature fixture).
- A human response converting a scope-violation escalation into a replan
  signal (PRD §4 — a blocked write is a re-planning signal) yields the same
  feature state and inbox/journal shape as a task-raised signal, and the
  conversion is captured as a typed interaction (Epic 017).
- A second replan signal on an already-`replanning` feature attaches to the
  open replan item as a distinct signal record — proposer, reason, and
  affected ids preserved per signal, affected-id sets unioned on the item —
  no duplicate state transition (debate finding — attachment needs merge
  rules so the second signal cannot hide behind the first).
- Dismissing the replan item (human rejects the premise, no plan edit)
  returns the feature to normal dispatch with the dismissal journaled **per
  attached signal** (each proposer's signal is visibly addressed).

## Constraints

- The replanning halt extends the **existing dispatch predicate** (Epic 004
  generation machinery): the predicate becomes "dirty generation OR feature
  in `replanning`" — one predicate with two inputs, no second gate on the
  scheduler poll (PRD §7.1.1; debate finding — the dirty flag alone cannot
  carry the signal-before-edit window).
- Signal raised via the workflow's action surface (Epic 006 workflow
  interface), stored durably (survives restart — asserted).
- Inbox/conversion via Epic 017 respond mechanics; no new response channel.

## Verification Gate

- `npm test` green for `src/replan/signal.test.ts`; `npm run typecheck`
  exits 0.

### Task T1 - Signal, state, and halt

**Input:** `src/replan/signal.ts`, `src/scheduler/dispatch.ts`,
`src/replan/signal.test.ts`

**Action - RED:** Write tests: (a) task-raised signal ⇒ feature `replanning`,
journal + inbox item with reason/summary/ids; (b) next poll dispatches no new
task for that feature; a running task continues; (c) two-feature fixture:
other feature dispatches normally; (d) restart mid-`replanning` preserves the
state and the open item; (e) duplicate signal attaches, no duplicate
transition.

**Action - GREEN:** Implement the signal type, durable feature state, and the
dispatch-halt reuse.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Scope-violation conversion + dismissal

**Input:** `src/replan/signal.ts`, `src/inbox/respond.ts`,
`src/replan/signal.test.ts`

**Action - RED:** Write tests: (a) responding to a scope-violation item with
the convert-to-replan action produces the same feature state, journal, and
inbox shape as T1's task-raised path, plus a typed interaction record;
(b) dismissing the replan item resumes normal dispatch with a journaled
dismissal.

**Action - GREEN:** Implement the conversion response action and dismissal
transition.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
