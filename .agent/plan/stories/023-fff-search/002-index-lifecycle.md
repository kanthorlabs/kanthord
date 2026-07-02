# Story 002 - Index Lifecycle

Epic: `.agent/plan/epics/023-fff-search.md`

## Goal

One index per repo slot, owned by the daemon: started at slot registration,
warm across session respawns, stopped at deregistration.

## Acceptance Criteria

- Registering a repo slot starts its index; the slot exposes the `Search`
  handle (PRD §6.4 — the index lives in the daemon).
- Two sessions on the same slot receive the same index instance; a session
  teardown + respawn does not restart or rebuild the index (instance identity
  and no-restart asserted via the lifecycle seam — the "warm index for free"
  promise).
- Deregistering the slot stops the watcher and releases the index; a query
  after deregistration is a typed `slot-deregistered` error; a deregistration
  racing an in-flight query lets it finish or fail typed — never a crash
  (debate finding).
- A daemon restart restarts indexes for all registered slots as part of the
  boot path (Epic 009 entrypoint wiring; the index is runtime state, rebuilt —
  never synced, PRD §6.1); a slot whose path is missing / not-git / engine-
  failing at boot is marked **degraded** + escalated while the daemon boots
  (fail-soft; debate finding).
- The agent-facing search tool is classified `pure` in the Epic 015 registry,
  routes through this interface, is **scoped to the session's slot**, and its
  results are filtered through the ring-1 role read policy (a role-read-denied
  path never appears — asserted; debate finding: classification alone does not
  scope content).

## Constraints

- Lifecycle tests run on the fake engine (hermetic); only instance
  identity/lifecycle is asserted here — query behavior is Story 001.

## Verification Gate

- `npm test` green for `src/search/index-lifecycle.test.ts`.

### Task T1 - Slot-bound start/stop + warm across respawn

**Input:** `src/search/index-lifecycle.ts`, `src/search/index-lifecycle.test.ts`

**Action - RED:** Write tests: (a) register ⇒ index started; (b) same instance
across two sessions and across a respawn (no restart call on the engine fake);
(c) deregister ⇒ stopped, further query ⇒ typed error.

**Action - GREEN:** Implement slot-bound index ownership wired into the
Epic 016 slot lifecycle.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Boot restart + agent tool routing

**Input:** `src/search/index-lifecycle.ts`, `src/search/index-lifecycle.test.ts`

**Action - RED:** Write tests: (a) a daemon boot on a config with two slots
starts two indexes; a third slot with a missing path boots the daemon with the
slot degraded + escalated; (b) the agent search tool resolves through the
interface, is registry-classified pure, is slot-scoped, and drops
role-read-denied paths from results; (c) a deregistration racing an in-flight
fake query ends typed, not crashed.

**Action - GREEN:** Wire index startup (fail-soft) into the Epic 009 boot path
and the policy-filtered tool into the Epic 015 registry.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
