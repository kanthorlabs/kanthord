# Story 001 - Workflow Interface & Fake TDD Workflow

Epic: `.agent/plan/epics/006-workflow-and-agent-session.md`

## Goal

The workflow extension interface every workflow satisfies, and a fake `tdd@1`
workflow that exercises it: phases, current-phase advance, a gate check returning
pass / fail / needs-human, and a checkpoint that writes a bounded STATE.md.

## Acceptance Criteria

- The interface exposes `phases[]`, `currentPhase()`, `gateCheck(phase) → pass |
  fail | needs_human`, `checkpoint() → writes STATE.md`, and emits status events
  (PRD §10 workflow interface).
- The fake `tdd@1` workflow reports its ordered phases and advances `currentPhase()`
  through them.
- `gateCheck` returns each of the three outcomes on demand: the **entry** gate
  `failing_test_exists` and the **exit** gate `tests_pass` for `tdd@1`, plus a
  `needs_human` case (PRD §7.1.1 §8 gate pair; §10 pass/fail/needs-human).
- `checkpoint()` **rewrites** a bounded STATE.md **and appends a JOURNAL.md event**
  via the Epic 003 store; reading STATE back returns the checkpointed state and the
  journal gained one event (PRD §3.2 — checkpoint rewrites STATE + appends JOURNAL;
  §6.2).
- The workflow carries a `workflow@version` identifier (PRD §10 — versioned).
- `gateCheck` records its outcome through a **gate-result sink** seam (not by writing
  the compiled-plan schema directly); the sink is what the scheduler (Epic 004) reads
  — this closes the gate seam the scheduler faked, without coupling the workflow to
  the compiled-plan persistence (debate finding).
- **Status events are a named contract**, at minimum: `phase_started`,
  `phase_changed`, `gate_checked{phase, outcome}`, `checkpoint_written` (PRD §10 —
  status events; enumerated so the seam is protected, not "some events").
- **Crash-mid-gate durability:** a gate result is durable only after a **complete**
  `gateCheck` write to the sink; a half-run/interrupted `gateCheck` leaves the gate
  status unchanged (re-checked after respawn), so `currentPhase()` never advances on a
  partial gate (debate finding — current phase is a respawn-equivalence field).

## Constraints

- The interface is the PRD §10 extension seam; the fake is a permanent test double
  (phases.md — fakes never deleted). No real test execution — the fake **reports**
  gate outcomes (Epic 006 Non-Goals).
- Gate outcomes flow to a **gate-result sink** seam that records them; the scheduler
  (Epic 004) reads that sink to dispatch. The workflow evaluates `gateCheck`; the sink
  owns persistence — the workflow does not know the compiled-plan/scheduler internals
  (debate finding — decouple evaluation from persistence). The sink is the concrete
  producer Epic 004 Story 001 faked.
- STATE writes go through the Epic 003 single-writer store; STATE is rewritten,
  JOURNAL is appended (PRD §6.2, §3.2).

## Verification Gate

- `npm test` green for `src/workflow/tdd-workflow.test.ts`.

### Task T1 - Interface + phases + gateCheck three outcomes

**Input:** `src/workflow/workflow.ts`, `src/workflow/tdd-workflow.ts`,
`src/workflow/tdd-workflow.test.ts`

**Action - RED:** Write a test that the fake `tdd@1` workflow reports ordered phases,
advances `currentPhase()`, and returns `pass`, `fail`, and `needs_human` from
`gateCheck` for the scripted conditions (entry `failing_test_exists`, exit
`tests_pass`, and a needs-human case), recording each outcome to the gate-result
sink; and that an interrupted (partial) `gateCheck` leaves the sink's gate status
unchanged and `currentPhase()` un-advanced.

**Action - GREEN:** Define the `Workflow` interface, a `GateResultSink` seam, and the
fake `tdd@1` workflow implementing phases/currentPhase/gateCheck (recording via the
sink, atomic write) with a `workflow@version`.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - checkpoint writes bounded STATE + status events

**Input:** `src/workflow/tdd-workflow.ts`, `src/workflow/tdd-workflow.test.ts`

**Action - RED:** Write a test that `checkpoint()` rewrites STATE.md **and** appends
one JOURNAL.md event via the store (assert both), reading STATE back returns the
checkpointed content; and that transitions emit the named status events
(`phase_started`, `phase_changed`, `gate_checked{phase,outcome}`,
`checkpoint_written`) observable to a caller.

**Action - GREEN:** Implement `checkpoint()` (rewrite STATE + append JOURNAL via Epic
003 store) and emission of the enumerated status events on transitions.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
