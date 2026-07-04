# Story 002 - pi Session Lifecycle

Epic: `.agent/plan/epics/016-real-agent-sessions.md`

## Goal

A real pi session implements the Epic 006 agent-session seam: spawned in a task
worktree with the assembled brief, the ring-1 policy chain, and the filtered tool
manifest; torn down at the task boundary; respawned from STATE.md through the
existing coordinator.

## Acceptance Criteria

- The pi session adapter implements the Epic 006 agent-session interface; the
  Phase-1 scripted fake still satisfies the same interface (fakes are permanent
  doubles — phases.md guiding rule).
- Spawn passes to the pi surface: the brief assembled per PRD §7.1.1 §6
  (task body + epic body + RUNBOOK + STATE + repo AGENTS.md), the
  `ring1PolicyChain` as `beforeToolCall`, the filtered tool manifest, and the
  credential-free env — asserted against the faked pi surface's captured spawn
  arguments (SU3 shape).
- Attempting to spawn without a ring-1 chain attached is a typed error — the
  security invariant is structural (phases.md: no real session without full
  ring-1).
- Brief assembly is contract-precise (debate finding): parts are injected in a
  fixed documented order; a missing STATE (first spawn) uses the documented
  empty-state default; a missing repo `AGENTS.md` is tolerated and journaled;
  each spawn gets fresh adapter state — nothing from a prior session object can
  leak beside the injected brief (asserted with a poisoned prior adapter).
- Given a realistic inherited process env that **contains** the SU4 credential
  values, the spawn env excludes them (the filter is proven against a hostile
  baseline, not an empty one), and the passed manifest is asserted to **lack**
  the prohibited tool names, not merely to exist (debate finding — sharper
  negative tests).
- A scripted session model-call sequence charges the Epic 013 budget ledger
  through the session's model path (the breaker is on the wire, not only
  declared a dependency; debate finding).
- Teardown at a task boundary destroys the live session and runs `checkpoint()`
  first (STATE written through the real store); respawn reads only STATE.md +
  durable inputs — asserted by a respawn whose faked pi surface receives no
  prior-session content beyond the injected STATE.
- Session lifecycle events (spawned, torn down, respawned, with task id + reason)
  are appended to the task journal.
- Epic 006's respawn-equivalence test suite passes with the pi adapter
  substituted for the scripted fake (same interface, same coordinator).

## Constraints

- The pi surface in tests is a hand-written fake implementing the SU3-recorded
  API (`.agent/plan/feedback/016-real-agent-sessions/pi-session-surface.md`);
  the default suite makes no model call and needs no credentials (PROFILE.md
  hermetic tests).
- The live smoke test lives under `test/live/` outside the `npm test` discovery
  glob and is documented maintainer-run only (Epic 016 gate).
- No workflow logic here — gates stay with the (fake) workflow until Epic 024.

## Verification Gate

- `npm test` green for `src/agent/pi-session.test.ts`.

### Task T1 - Spawn contract

**Input:** `src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`

**Action - RED:** Write tests: (a) spawn captures brief parts in the documented
order, ring-1 chain, and a manifest lacking prohibited tool names, with an env
that excludes credential values present in the inherited baseline; (b) spawn
without a ring-1 chain ⇒ typed error; (c) missing STATE ⇒ documented default;
missing AGENTS.md ⇒ tolerated + journaled; (d) a poisoned prior adapter leaks
nothing into a fresh spawn; (e) a scripted model-call sequence charges the
Epic 013 ledger; (f) spawn events journaled.

**Action - GREEN:** Implement the pi session adapter's spawn path over the SU3
surface behind the Epic 006 interface, wiring the model path through the
breaker.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Teardown/respawn through the coordinator

**Input:** `src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`

**Action - RED:** Write tests: (a) task-boundary teardown runs `checkpoint()`
then destroys the session; (b) respawn injects only STATE + durable inputs;
(c) the Epic 006 respawn-equivalence assertions pass with this adapter.

**Action - GREEN:** Implement teardown/respawn delegating to the Epic 006
coordinator (no parallel path).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
