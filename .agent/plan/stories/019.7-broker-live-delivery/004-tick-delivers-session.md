# Story 004 - tick() delivers a completed session through the broker

Epic: `.agent/plan/epics/019.7-broker-live-delivery.md`

## Goal

Wire the run-loop so that a cleanly completed session's local commits are
delivered through the broker — `git.push` then `github.create_pr` — using the
Story 003 registry. Today `deliverSession` exists as a handle method but `tick()`
never calls it.

## Acceptance Criteria

- After a session completes cleanly (stopReason absent) and the task branch has
  ≥1 local commit ahead of the base, `tick()` calls `deliverSession` with: the
  `git.push` adapter/entry and a push input targeting the task branch + configured
  remote; the `github.create_pr` adapter/entry and a create_pr input with base
  `main`, head = task branch, and a title derived from the task; and stable
  idempotency keys (so a re-tick after a crash does not double-submit).
- The delivered op chain is recorded in the broker ledger (push op → create_pr
  op); the create_pr op id is tracked so `tick()` observes its completion.
- The task reaches **complete** only when the create_pr op observes the PR
  **merged** (the daemon polls; it never merges). A still-open PR leaves the task
  in its delivered/awaiting-merge state, not complete.
- When the session ends without commits (nothing to deliver), `tick()` does not
  submit a push/create_pr and the task routes by its normal gate/escalation path.

## Constraints

- **Reuse `deliverSession`/`submitBrokerVerb` unchanged** (run-loop Story 003) —
  this story supplies the params and the trigger, not new delivery mechanism.
- **Idempotency keys are deterministic** from task + branch (Epic 014 broker
  contract) so restart/re-tick reconciles instead of duplicating (LP-A4 pairs
  with Story 005 reconcile-on-boot).
- **Daemon never merges** — completion is gated on observing a human merge via
  create_pr poll (PRD §7.4 human-keeps-the-button).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — the delivery-trigger test passes
  on doubles; the 2A golden harness scenario still passes; guard green.

### Task T1 - trigger deliverSession after a committed session

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic test drives `tick()` with a fake pi surface that
completes a session and a fake git store whose task branch has a commit ahead of
base, plus recording push/create_pr adapters (doubles). It asserts `tick()` calls
`deliverSession` once with a push input for the task branch and a create_pr input
(base `main`, head = branch, non-empty title) and stable idempotency keys; that
the ledger shows push→create_pr ops; and that with **no** commit ahead, no
delivery is submitted.

**Action - GREEN:** in `tick()`, after a clean session, detect commits ahead of
base on the task branch, build the push + create_pr inputs and idempotency keys,
and call `deliverSession` with the Story 003 adapters/entries; track the create_pr
op for completion observation.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green; `2a-golden` scenario still green.

### Task T2 - complete the task only on observed merge

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** a hermetic test asserts that while the create_pr poll reports an
**open** PR the task is not marked complete, and once the poll reports **merged**
the task transitions to complete (via the existing broker_completion observation
path). A closed-unmerged PR routes to escalation, not complete.

**Action - GREEN:** extend the `tick()` broker-completion observation so a tracked
create_pr op reaching merged completes the task, open leaves it pending-merge, and
closed-unmerged escalates.

**Action - REFACTOR:** none.

**Verify:** `node --import ./src/harness/no-network-guard.ts --test
src/daemon/run-loop.test.ts` green.
