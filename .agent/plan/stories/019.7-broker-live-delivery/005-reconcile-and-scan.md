# Story 005 - reconcile-on-boot + outbound secret-scan on the live push

Epic: `.agent/plan/epics/019.7-broker-live-delivery.md`

## Goal

Two safety properties the live delivery path must hold: restart safety
(reconcile held ops at boot so a kill mid-`create_pr` never yields a duplicate PR
— LP-A4) and the outbound secret-scan armed on the real push (LP-A2 family). Both
reuse existing mechanism (`reconcileHeldOps`, the push `diffScanGuard`); this
story invokes them in the live path.

## Acceptance Criteria

- On daemon boot, `runDaemon` calls `reconcileHeldOps` over the live verb
  adapters before (or as part of) the first tick, so any op left `held` by a
  previous crash is resolved by head-branch lookup (no duplicate submit). After
  reconcile, a `create_pr` whose branch already has an open PR resolves to that
  PR's terminal identity rather than creating a second one.
- A `git.push` whose branch diff matches a configured secret pattern is
  **blocked** by the `diffScanGuard`: the push op does not reach the remote, the
  block is durably recorded, and an escalation is raised. When `patternRegistry`
  is `null` (absent) the push is blocked fail-closed with `scan-unavailable`.
- Neither property changes the success path: a clean push with no matching pattern
  and no held op proceeds normally.

## Constraints

- **Reuse `reconcileHeldOps` + the push `diffScanGuard`** — Story 003 already sets
  the guard; this story asserts the block/escalate behavior and the boot-time
  reconcile call. No new scan or reconcile mechanism.
- **Fail-closed on missing registry** — `patternRegistry: null` blocks every push
  (existing `run-loop` contract), so the secret-scan can never silently no-op on
  the live path.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — reconcile-on-boot and
  secret-scan-block tests pass on doubles; guard green.

### Task T1 - reconcile held ops at daemon boot

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic test seeds a `held` create_pr op (crash mid-submit)
and a reconcile adapter double whose head-branch lookup finds an existing open PR;
it asserts `runDaemon` boot calls `reconcileHeldOps` and the op resolves to the
existing PR identity with **no** second submit.

**Action - GREEN:** in `runDaemon` startup, call `reconcileHeldOps` over the live
verb adapters (Story 003) before the first delivery.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green; `2a-kill-mid-create-pr` scenario still green.

### Task T2 - secret-scan blocks the live push

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic test drives a delivery whose push branch diff matches
a seeded pattern and asserts the push is blocked (never reaches the remote
double), the block is recorded, and an escalation is raised; and that
`patternRegistry: null` blocks with `scan-unavailable`.

**Action - GREEN:** ensure the live delivery path routes the push through the
`diffScanGuard` (Story 003 wiring) and that a blocked scan halts delivery +
escalates rather than proceeding to create_pr.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green; `2a-out-of-scope-write` + `2a-golden`
scenarios still green.
