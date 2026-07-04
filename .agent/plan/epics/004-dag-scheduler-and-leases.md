# 004 DAG Scheduler & Lease Manager

## Outcome

The polling scheduler that turns a compiled plan into ordered execution: task rows
carry `feature_id` + `depends_on[]`; a task is dispatchable when its dependency
exit gates have passed **and** its required leases are free; **capability leases**
(write-scope + declared resources) with expiry + heartbeat serialize colliding
tasks and free themselves when a holder crashes; a task awaiting a broker op parks
via `blocked_on: op_id` and is re-dispatched only when the completion row appears;
and a **dirty plan** halts new dispatch while running tasks stay pinned to the
generation they started under. Everything runs on the **fake clock** — no real
waiting — and against fake gate/broker state; no LLM, no network.

## Decision Anchors

- PRD §7.3 — the DAG executor is a `WHERE` clause on the existing poll: dispatch
  when dependency exit gates pass **and** the required lease is free.
- PRD §7.3 — leases are **per capability, not per repo**; `write_scope` is one
  capability; `resources:` (ports, test DBs, build caches, dep-manifest writes) are
  others; the lease manager serializes on **any** shared capability; disjoint
  scopes may run concurrently.
- PRD §7.3 — leases have **expiry + heartbeat**, never plain flags; a crashed task
  must not hold a lease forever.
- PRD §7.3 — awaiting an async op is a **scheduler-owned transition**: the task
  records `blocked_on: op_id` (durable), its session is torn down, and it is
  re-dispatched only when the op's completion row appears in SQLite (one wake-up
  mechanism).
- PRD §7.1.1 §7 dirty detection — a dirty plan halts **new** dispatch; running
  tasks are pinned to the generation they started under.
- phases.md Phase 1 Deliverable 2 + gate (DAG-ordered dispatch respecting leases;
  dirty-plan recompile with generation pinning).

## Stories

- `001-task-rows-and-dag-dispatch.md` — task rows (`feature_id`, `depends_on[]`,
  status, generation); the poll's dispatch predicate over dependency exit-gate
  status.
- `002-capability-leases.md` — write-scope + resource leases with expiry +
  heartbeat; disjoint concurrency, shared serialization, crash-release on expiry.
- `003-blocked-on-park-resume.md` — `blocked_on: op_id` park (session torn down) and
  re-dispatch when the op completion row appears, injecting the result.
- `004-generation-pinned-dispatch.md` — running tasks pinned to their start
  generation; a dirty plan (changed `compile_hash`) halts new dispatch.
- `005-scheduler-poll.md` — the **composed poll**: one persisted-state pass that
  dispatches only tasks whose gates pass **and** leases are atomically acquirable
  **and** not parked **and** generation rules permit — the real "WHERE clause on the
  poll" (the promise §7.3 makes, not four separately-tested parts).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- Given a compiled golden feature, the scheduler dispatches nodes in a DAG-valid
  order (a dependent never dispatches before its dependency's **exit gate** passes —
  not merely before the dependency task is `done`), asserted against a fixed
  expected dispatch sequence on the fake clock.
- **Combined poll (Story 005):** two DAG-ready tasks that collide on a capability —
  one poll dispatches only the one that can acquire the lease; the loser dispatches
  after release. This proves dispatch = gates ∧ leases in one pass, not two libraries.
- Two tasks with disjoint `write_scope` may hold leases simultaneously; two sharing
  a capability serialize; multi-capability acquisition is all-or-nothing; a lease
  whose heartbeat lapses past expiry is reclaimed and the waiter then dispatches
  (fake clock, no real delay).
- A task that records `blocked_on: op_id` is not dispatched until a matching
  completion row exists; parking **releases** the task's leases and resume
  **reacquires** them before dispatch, with the op result available.
- Marking the plan dirty halts fresh dispatch of not-started nodes and stamps them
  `G+1` only after recompile; a node already `running` under `G` is not cancelled,
  not restamped, and not returned as a fresh dispatch candidate.

## Dependencies

- **Epic 001** (SQLite store + migration seam, injectable clock).
- **Epic 002** (compiled-plan rows: nodes, edges, gates, generation — the scheduler
  reads them; column contract in Epic 002's schema section).

## Non-Goals

- No real workflow/gate evaluation — gate **pass/fail** is produced by the workflow
  (Epic 006); this Epic reads a gate-status field and, in its own tests, sets it
  directly (fake) to drive dispatch ordering. Wiring the real fake workflow is Epic
  010.
- No real broker — the op completion row is written by a fake in tests; the real
  broker/ledger is Epic 005.
- No **generation-pinned continuation optimization** (running task continues only if
  the edit lies outside its subgraph) and no **post-completion compatibility check**
  before merge — those are Phase 3 (phases.md Phase 3 Deliverable 3). Phase 1 does
  the **reduced** behavior: dirty ⇒ halt new dispatch, running tasks pinned and
  allowed to finish. This is **not** a safety proof — a task finishing against a
  superseded generation is not compatibility-verified (PRD §7.1.1 §7: continuation is
  an optimization, not a safety promise). The compatibility check is Phase 3 and
  merge is a human/Phase-2 action, so Phase 1 never auto-acts on such a completion.
- No actual concurrency/threads — the scheduler is a deterministic poll; leases
  model mutual exclusion as data, not OS locks (PRD §7.3 — leases prevent concurrent
  writes to *declared* resources only; they do not prove runtime independence).

## Findings Out

- none as a TDD-task output. The task-row + lease + `blocked_on` column additions
  are documented in this Epic's stories and asserted by their tests; Epic 010's
  harness reads them.
