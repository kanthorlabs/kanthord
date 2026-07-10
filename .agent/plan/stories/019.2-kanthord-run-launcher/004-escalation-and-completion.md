# Story 004 - escalation response loop + completion

Epic: `.agent/plan/epics/019.2-kanthord-run-launcher.md`

## Goal

Escalations raised during a run surface as inbox items on the Epic 017 HTTP/JSON
surface; a response through the respond RPC resumes or halts the parked task; the
feature reaches `complete` after the human merges the PR (the loop observes the
terminal PR state); and a budget halt survives a daemon restart.

## Acceptance Criteria

- An escalation raised during a run (diff / re-planning / budget) is retrievable as
  an inbox item through the Epic 017 status/respond HTTP surface hosted by the run
  daemon.
- A **resume** response through the respond RPC un-parks the task and the next
  run-loop tick resumes it; a **halt** response leaves the task stopped and it is
  not resumed. (`park`/`resume` semantics.)
- The feature reaches `complete` **after** the PR is merged: the run-loop observes
  the terminal (merged) PR state through the broker/github adapter poll and marks
  the feature complete. The daemon never merges the PR itself (human-only merge).
- **LP3 respawn clause:** a task halted on a budget breach does not resume spending
  after a daemon restart — the halt is durable, and the restarted run-loop does not
  re-dispatch it into a new session.

## Constraints

- **Responses via the Epic 017 surface** — the run daemon hosts
  `src/daemon/status-server.ts`, which routes to `resumeEscalationItem` /
  `haltEscalationItem` (`src/rpc/inbox-respond.ts`); the run-loop reacts to the
  resulting task state via `park`/`resume` (`src/scheduler/blocked-on.ts`). No new
  response path.
- **Completion by observation, not action** — the loop marks complete only after
  observing the terminal PR state via the broker adapter; it issues no merge call
  (branch protection + human merge, Epic 019 SU5 posture).
- **Durable halt** — the budget halt persists in the ledger so a restart does not
  resume spending (Epic 019 IC-2/IC-3 schema at boot; PRD §7.7 respawn).

## Verification Gate

- `npm test` green for `src/daemon/run-loop.test.ts` escalation/completion/restart
  cases; typecheck 0.
- Escalation surfacing, resume/halt reaction, completion-after-merge, and
  halt-survives-restart are asserted on observable inbox + task state, driven by
  doubles (no real HTTP client needed — the RPC handlers are called directly).

### Task T1 - escalation surfaces + response resumes/halts

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a run parks a task on an escalation; the test reads the inbox item
through the Epic 017 surface (or its handler), calls the respond RPC `resume`, and
asserts the next tick resumes the task; a second case calls `halt` and asserts the
task stays stopped.

**Action - GREEN:** the run-loop surfaces escalations as inbox items and, on the
next tick, resumes tasks whose escalation was resumed and leaves halted ones
stopped (`resume`/`park`).

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T1 both cases green.

### Task T2 - completion after PR merge observed

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** with the github double reporting the PR `merged`, the test runs a
tick and asserts the feature/task reaches `complete`, and that the run-loop issued
**no** merge call on the double.

**Action - GREEN:** the run-loop polls the PR state via the broker/github adapter
and marks the feature complete on observed merge; it never calls merge.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T2 case green.

### Task T3 - budget halt survives restart

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a task halted on a budget breach; the test constructs a fresh
run-loop against the same store (restart) and asserts the halted task is not
re-dispatched into a new session and no new spending reservation occurs.

**Action - GREEN:** the run-loop reads the durable budget halt on boot and excludes
halted tasks from dispatch until responded.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T3 case green.
