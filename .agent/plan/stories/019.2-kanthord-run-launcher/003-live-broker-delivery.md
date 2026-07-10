# Story 003 - live broker delivery + kill/reconcile

Epic: `.agent/plan/epics/019.2-kanthord-run-launcher.md`

## Goal

The session's collected commits reach GitHub **only** through the broker: a `push`
op then a `github.create_pr` op, recorded as a ledger op chain and driven to
terminal by the poller. A daemon killed mid-`create_pr` at the hold-point
reconciles on restart via head-branch lookup with no duplicate PR (LP4).

## Acceptance Criteria

- Given a collected commit set from a completed session, the run-loop submits a
  broker `push` op and then a `github.create_pr` op; both appear in the ledger op
  chain for the task, and the poller drives each to a terminal state. The PR is
  created via the create_pr adapter — there is no direct agent push.
- **LP4 (kill mid-create_pr):** with the hold-point set at the create_pr cutpoint,
  simulating a kill after the ledger write but before adapter completion and then
  restarting causes reconciliation to resolve the op via a **head-branch lookup**
  (`listByHead`) with **no second `create_pr` call**; the op reaches a terminal
  state consistent with the existing (double's) open PR, and the ledger before/after
  restart is observable.
- Delivery is idempotent: replaying the `create_pr` submit for the same head branch
  does not create a duplicate PR (dedup on the broker idempotency key + head-branch
  reconcile).

## Constraints

- **Broker-only delivery** (PRD §5) — `makePushAdapter` (`src/broker/verbs/
  git-push.ts`) then `makeCreatePrAdapter` (`src/broker/verbs/github-create-pr.ts`)
  via `submit`; the poller is `startPolling` (`src/broker/poller.ts`); reconcile is
  `reconcileOp` (`src/broker/reconcile.ts`) on the corrected `{status}` contract
  (Epic 019 IC-1). No new broker mechanism.
- **Hermetic gate** — the adapters run against a temp bare remote + a github double;
  the real PAT-backed adapters are constructed only in `src/cli/run.ts` (no real
  GitHub in the automated gate).
- **Hold-point reuse** — the kill cutpoint is the existing broker hold-point (Story
  001 flag), not a new pause.

## Verification Gate

- `npm test` green for `src/daemon/run-loop.test.ts` delivery + reconcile cases;
  typecheck 0.
- The op chain, no-duplicate-PR, and terminal-state assertions are on observable
  ledger + github-double state.

### Task T1 - deliver commits via push then create_pr

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a test hands the run-loop a collected commit set and runs delivery
with `makePushAdapter` on a temp bare remote + a github double; asserts a `push` op
and a `github.create_pr` op appear in the ledger op chain for the task, the poller
drives both to terminal, and the github double recorded exactly one `createPr`.

**Action - GREEN:** the run-loop submits `push` then `github.create_pr` via `submit`
and runs `startPolling` to terminal.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T1 case green.

### Task T2 - LP4 kill mid-create_pr + reconcile

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** with the hold-point set at the create_pr cutpoint, the test
simulates a kill after the ledger write, constructs a fresh run-loop (restart), and
asserts reconciliation calls `listByHead` (no second `createPr` on the double) and
the op reaches a terminal state consistent with the existing open PR; the ledger
before/after restart is asserted.

**Action - GREEN:** on boot the run-loop reconciles in-flight `github.create_pr` ops
via `reconcileOp` (head-branch lookup); a replayed submit dedups on the idempotency
key.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T2 case green (no duplicate
PR on the double).
