# Story 002 - Failure evidence recorded and injected into the next brief

Epic: `.agent/plan/epics/019.3-task-goal-loop.md`

## Goal

A retry is informed, not amnesiac: on gate `fail` the gate's failure
evidence is durably recorded, bounded, and the NEXT spawn brief carries it
as a documented brief element — so the fresh session knows what the last
attempt got wrong without inheriting its context.

## Acceptance Criteria

- On a `fail` outcome, a durable evidence record exists for the task
  carrying exactly the fixed MVP shape: the gate phase, the attempt number,
  and the `GateResult.summary` the workflow reported (the Story 001
  contract — debate finding 2026-07-10: evidence comes from the structured
  gate result, never an out-of-band channel); it survives a daemon restart.
  The shape is the contract Epic 024's real gates must fill — documented in
  the evidence module.
- The evidence is **bounded**: a failure summary longer than the documented
  cap is truncated (cap value asserted in the test), never unbounded into
  the brief.
- The next spawn for that task carries the evidence in the brief as a
  distinct documented element appended after the existing five (task body,
  epic body, RUNBOOK, STATE, AGENTS.md — Epic 006/019.2 order unchanged);
  the evidence names the attempt it came from.
- Only the LATEST attempt's evidence is injected (prior attempts remain in
  the durable record for audit, not in the brief).
- A task that never failed spawns with an unchanged brief (no empty
  evidence section).
- A lifecycle respawn mid-attempt does NOT change the injected evidence —
  it re-reads the same brief inputs (respawn-equivalence, Epic 006).

## Constraints

- **Brief assembly via the existing seam** — the evidence element is added
  in `spawnPiSession`/`respawnPiSession` (`src/agent/pi-session.ts`), which
  owns the documented brief order (Epic 019.2 anchor); STATE stays
  workflow-owned and is NOT mutated to carry evidence (epic anchor —
  evidence is a brief element, not a STATE write).
- **Durability in the scheduler store** — the evidence record lives in
  SQLite next to the scheduler task rows (`src/scheduler/` schema
  discipline, Epic 004); DDL follows the IF-NOT-EXISTS idempotency rule.
- Truncation cap is a named constant with a code-comment rationale; no
  config knob for it in MVP (smallest complete change, epic Non-Goals).

## Verification Gate

- `npm test` green for the evidence suites in `src/scheduler/` and
  `src/agent/`; `npm run typecheck` exits 0.

### Task T1 - durable bounded evidence record

**Input:** `src/scheduler/attempt-evidence.ts`,
`src/scheduler/attempt-evidence.test.ts`

**Action - RED:** tests: recording evidence for (task, attempt, phase,
summary) persists a row readable after a simulated restart (fresh store
handle on the same file); an over-cap summary is stored truncated to the
cap; recording attempt 2 leaves attempt 1 readable; the latest-evidence
query returns only attempt 2.

**Action - GREEN:** implement the evidence store module (record + latest
query) with idempotent DDL.

**Action - REFACTOR:** none.

**Verify:** `node --test src/scheduler/attempt-evidence.test.ts` green.

### Task T2 - evidence element in the spawn brief

**Input:** `src/agent/pi-session.ts`, `src/agent/pi-session.test.ts`

**Action - RED:** tests: spawning with a latest-evidence value present
produces a system prompt whose sixth element is the evidence (order of the
first five asserted unchanged, attempt number present); spawning with no
evidence produces the unchanged five-element brief; respawn re-injects the
same evidence unchanged.

**Action - GREEN:** thread an optional evidence input through
`spawnPiSession`/`respawnPiSession` and append it as the documented sixth
brief element.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/pi-session.test.ts` green.

### Task T3 - run-loop wires record + inject

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** end-to-end on the tick: a fake workflow scripted
fail-then-pass (the fail carrying a `GateResult.summary`); the test asserts
the first `fail` records evidence, the second dispatch's session double
received a brief containing that evidence, and after the `pass` the task
proceeds on the completion path.

**Action - GREEN:** on `fail`, record evidence from the gate result (Story
001's T4 hand-off point); on dispatch, read latest evidence and pass it to
`spawnPiSession`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` — T3 cases green.
