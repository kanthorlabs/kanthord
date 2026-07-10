# Story 002 - live dispatch to a ring-1-guarded pi session

Epic: `.agent/plan/epics/019.2-kanthord-run-launcher.md`

## Goal

One run-loop tick turns a signed-off, dispatchable task into a real agent run: the
scheduler selects it, a pi session is spawned in the slot worktree with the ring-1
write-scope hook and the budget breaker **active**, and the session's commits are
collected for broker delivery. The two live-safety behaviors hold: an out-of-scope
write is blocked + escalated (LP2), and a budget breach halts before the model call
(LP3).

## Acceptance Criteria

- Given a slot whose repo has exactly one signed-off dispatchable task, one
  run-loop tick spawns **exactly one** pi session in a worktree for that task with
  the ring-1 hook and budget breaker attached, marks the task in-progress, and on
  session completion collects the session's commit set (handed to Story 003). A
  second tick with no remaining dispatchable task spawns nothing.
- **LP2 (out-of-scope write):** when the session attempts a file-mutating tool call
  (`edit`/`write`) whose path is outside the task `write_scope`, the write does not
  land, the blocked call is durably recorded, and a re-planning-tagged escalation
  inbox item appears; the task does not advance past the block.
- **LP3 (budget breach):** with the task hard ceiling set below the session's first
  reservation, the breaker halts the session **before** the model call executes (no
  provider-call effect is recorded after the reservation attempt), and a budget
  interaction is recorded with cost attribution.
- A read-only tool call (`read`/`ls`/`grep`/`find`) to a path outside `write_scope`
  is **not** blocked (Epic 019.1 classifier), so the session is not falsely halted.

## Constraints

- **Ring-1 via existing seams** — attach `makeRing1HookAdapter` (write-scope,
  `src/ring1/hook-binding.ts`) and `makeBudgetBreaker` (`src/ring1/budget.ts`) to
  the spawn; the session manifest excludes `bash` (Epic 015 + 019.1). No new
  enforcement logic in the run-loop.
- **Injected pi surface** — the session is spawned via the injected
  `piSurface.spawnAgent` seam (`spawnPiSession`, `src/agent/pi-session.ts`); the
  automated gate uses a double that emits scripted tool calls, never a real model
  call (cite Epic 016 hermetic rule).
- **Worktree via the slot strategy** — the session runs in a worktree created by
  `src/slots/worktree.ts`; agents have no direct effect (PRD §4).
- **Escalation shape unchanged** — blocked writes escalate through the Epic 007 /
  Epic 017 inbox contract; this story wires it live, it does not redefine it.

## Verification Gate

- `npm test` green for `src/daemon/run-loop.test.ts` LP2/LP3 cases; typecheck 0.
- The block, the escalation item, and the pre-call halt are asserted on observable
  state (worktree fs, inbox item, ledger/interaction rows), driven by a pi-session
  double — no real model call.

### Task T1 - dispatch to one guarded session, collect commits

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test seeds a slot with one signed-off dispatchable task and runs
one tick with a pi-session double that produces a commit; asserts exactly one
`spawnAgent` call carrying a ring-1 hook and a budget breaker, the task marked
in-progress, and the collected commit set returned/persisted for delivery. A second
tick with no dispatchable task asserts zero `spawnAgent` calls.

**Action - GREEN:** the run-loop tick calls the scheduler dispatch (`pollOnce`/
`dispatchable`), creates a worktree via `src/slots/worktree.ts`, and calls
`spawnPiSession` with `makeRing1HookAdapter` + `makeBudgetBreaker` attached, then
collects the session commit set.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T1 cases green.

### Task T2 - LP2 out-of-scope write blocked + escalated (live)

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** the pi-session double emits an `edit`/`write` tool call to a path
outside the task `write_scope`; the test asserts the write did not land in the
worktree, a durable block record exists, and a re-planning-tagged inbox item
appears, and the task is parked (not advanced). A companion assertion: a `read`
call to the same out-of-scope path is allowed (not blocked).

**Action - GREEN:** wire the ring-1 hook decision into the run-loop so a blocked
write parks the task and creates the escalation inbox item; read-only classes pass
(Epic 019.1 classifier).

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T2 cases green.

### Task T3 - LP3 budget breach halts before the call (live)

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** the task hard ceiling is set below the session's first
reservation; the pi-session double records whether its model-call effect fired. The
test asserts the breaker halted the session before that effect (the effect did not
fire after the reservation attempt) and a budget interaction row with cost
attribution exists.

**Action - GREEN:** wire `makeBudgetBreaker` so the reservation gate runs before the
model-call effect and a breach halts the session and records the budget interaction.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T3 case green.
