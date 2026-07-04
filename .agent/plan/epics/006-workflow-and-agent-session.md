# 006 Workflow & Agent-Session Interfaces (fakes) + Respawn-Equivalence

## Outcome

**One reviewable outcome:** the fake workflow seam and the fake agent-session seam
**jointly prove durable-slot / ephemeral-session respawn semantics** — the three
stories are subordinate to that single proof, not three independent deliverables.

Concretely, the two seams plus the respawn machinery that ties them to the
scheduler: a **workflow interface**
(`phases[]`, `currentPhase()`, `gateCheck(phase) → pass|fail|needs_human`,
`checkpoint() → writes STATE.md`, status events) with a **fake TDD workflow** driving
the gate pair; an **agent-session interface** (spawn from the injected brief /
teardown at task boundary / respawn from STATE.md) with a **scripted fake agent**;
and **respawn-equivalence** — after any respawn the pending-task set, lease
ownership, current phase, and injected STATE match the pre-respawn state, while live
model context is *not* required to match. Threshold-triggered respawn,
task-boundary respawn, and crash recovery are **one code path**. No LLM, no network.

## Decision Anchors

- PRD §6.3 — re-hash the source at every workflow **phase boundary** (not only at
  completion); on drift signal the human and keep working unless halted.
- PRD §10 — the workflow interface: `phases[]`, `currentPhase()`,
  `gateCheck(phase) → pass/fail/needs-human`, `checkpoint() → writes STATE.md`,
  status events; versioned (`workflow@version`).
- PRD §3.2 — durable slot, ephemeral session; sessions torn down at task boundaries
  and re-warmed from distilled STATE.md + repo map + AGENTS.md; compaction at
  ~50–60% of the model window (per-model config) runs `checkpoint()`, kills, respawns;
  threshold-triggered respawn, task-boundary respawn, and crash recovery are the
  **same code path**.
- PRD §7.7 — **respawn-equivalence, explicit definition:** after a respawn the
  pending-task set, lease ownership, current phase, and injected STATE must match the
  pre-respawn state; live model context is *not* required to match.
- PRD §7.1.1 §6 — the spawn brief = task body + epic body + RUNBOOK + STATE + repo
  AGENTS.md.
- phases.md Phase 1 Deliverable 5 — workflow interface + fake TDD workflow; agent
  session interface with a scripted fake agent.

## Stories

- `001-workflow-interface.md` — the workflow interface + a fake `tdd@1` workflow
  driving the entry `failing_test_exists` / exit `tests_pass` gate pair and writing
  STATE via `checkpoint()`.
- `002-agent-session.md` — spawn from the assembled brief / teardown at task boundary
  / respawn from STATE.md, with a scripted fake agent and a `beforeToolCall` seam
  (ring-1 enforcement is Epic 007).
- `003-respawn-equivalence.md` — a single **respawn coordinator** shared by threshold
  / task-boundary / crash, asserting field-by-field equivalence per PRD §7.7 at the
  **contract level** (fake seams). *(Epic 010 owns the end-to-end compaction-respawn
  scenario through the full harness; this Epic owns the contract-level proof — do not
  defer the whole guarantee to 010, that would weaken Deliverable 5.)*
- `004-phase-boundary-drift-hook.md` — the §6.3 phase-boundary half of source-drift
  detection: at each workflow phase-boundary transition, re-hash the source-of-truth
  (against the Epic 002 clone-on-sign-off snapshot) and, on drift, signal the human and
  keep working. *(Added per the Epic 010 debate — this is workflow phase-boundary
  behavior, not harness assembly; Epic 010 only runs the scenario.)*
- `005-artifact-handoff-gates.md` — the runtime artifact handoff: the workflow records
  the publisher **exit** gate "artifact published" (with the artifact's content hash)
  and the consumer **entry** gate "artifact consumed" (hash-identity check) to the
  gate-result sink, so the scheduler (Epic 004) dispatches the handoff on fakes.
  *(Added per the Phase-1 comparison debate — closes gap B1: the gate was compiled as
  data in Epic 002 and used in the Epic 010 golden scenario, but no story owned the
  runtime evaluation. Byte-hash identity only — semantic diff handlers are Phase 2B.)*

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green for all Story suites.
- The fake `tdd@1` workflow reports its phases, advances `currentPhase()`, returns
  each of pass / fail / needs_human from `gateCheck`, and `checkpoint()` writes a
  bounded STATE.md read back through the Epic 003 store.
- A session spawns with a brief assembled from task+epic body + RUNBOOK + STATE +
  AGENTS.md; tears down at a task boundary; and respawns reading only STATE.md (+ the
  durable inputs), never yesterday's context.
- **Respawn-equivalence:** for a mid-task respawn, the post-respawn pending-task set,
  lease ownership, current phase, and injected STATE equal the pre-respawn values
  (asserted field-by-field); the three triggers (threshold, task-boundary, crash) all
  invoke the identical respawn function (asserted to be one path).
- **Phase-boundary drift:** a changed source at a phase boundary records a human-signal
  escalation and the task keeps working; an unchanged source produces no event (PRD
  §6.3 — the workflow half of the drift mechanism Epic 010 later scenario-tests).
- **Artifact handoff:** a publisher task's exit gate "artifact published" passes once
  its artifact is recorded (with content hash) to the registry; a consumer task's entry
  gate "artifact consumed" passes only when that artifact is published and its hash
  matches the expected value — asserted to the gate-result sink the scheduler reads
  (PRD §7.2 coordination via artifacts; hash-identity only, semantic diff is Phase 2B).

## Dependencies

- **Epic 001** (clock, store seams), **Epic 003** (markdown store — STATE.md
  read/write and `checkpoint`), **Epic 004** (scheduler — pending-task set + lease
  ownership are what respawn-equivalence compares), **Epic 002** (compiled gates —
  `gateCheck` reads/writes the gate status the scheduler dispatches on).

## Non-Goals

- No **real** pi agent, no LLM call, no real repo checkout — the fake agent is
  scripted; real pi sessions are Phase 2 (phases.md). Compaction "context size" is a
  fake-reported number, not a real token count.
- No **ring-1 enforcement** — the `beforeToolCall` seam exists and is called, but
  write-scope blocking + budget reservation are Epic 007 (enforce against fakes).
- No real TDD execution (running actual tests) — the fake workflow *reports* gate
  outcomes; the real `tdd@1` execution workflow is Phase 2B.
- No model-policy resolution chain (Phase 2B).

## Findings Out

- none as a TDD-task output. The workflow + session interfaces and the
  respawn-equivalence field list are documented in this Epic's stories and asserted
  by their tests; Epic 010's harness drives the compaction-respawn scenario through
  them.
