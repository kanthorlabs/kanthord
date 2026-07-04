# Story 002 - Agent Session (spawn / teardown / respawn)

Epic: `.agent/plan/epics/006-workflow-and-agent-session.md`

## Goal

The agent-session seam realizing "ephemeral session": spawn from an assembled brief,
tear down at a task boundary, and respawn reading only STATE.md plus the durable
inputs — with a scripted fake agent and a `beforeToolCall` hook seam (enforcement is
Epic 007).

## Acceptance Criteria

- Spawning a session assembles the brief from **task body + epic body + RUNBOOK +
  STATE + repo AGENTS.md** (PRD §7.1.1 §6) and hands it to the (fake) agent.
- Tearing down at a task boundary disposes the session; no session state is carried
  into the next spawn beyond what STATE.md holds (PRD §3.2 — never reuse yesterday's
  session).
- Respawning reads **only** STATE.md (+ the durable brief inputs), not any retained
  in-memory context from the prior session (PRD §3.2 — re-warmed from distilled
  STATE.md).
- Every fake-agent tool call passes through a `beforeToolCall(call) → allow | block`
  seam; in this Story the seam's default is `allow` (a fake), and it is always
  consulted (the enforcement decision is Epic 007).
- A scripted fake agent runs a deterministic sequence of steps/tool calls with no
  LLM and no network (phases.md Phase 1).

## Constraints

- The session is disposable; the warm assets are STATE.md + the daemon-held inputs,
  not the live context (PRD §3.2; Trade-off #11).
- The `beforeToolCall` seam is defined here and **always** invoked before a tool call
  so Epic 007 can enforce write-scope/budget without changing this Story (PRD §4 ring
  1 — `beforeToolCall`).
- The fake agent is a hand-written scripted object (PROFILE.md fake/mock style); its
  "context size" for compaction is a reported number, not a real token count (Epic
  006 Non-Goals).
- Brief assembly reads through the Epic 003 store; no second parser.

## Verification Gate

- `npm test` green for `src/session/agent-session.test.ts`.

### Task T1 - Spawn assembles the brief; beforeToolCall always consulted

**Input:** `src/session/agent-session.ts`, `src/session/agent-session.test.ts`

**Action - RED:** Write a test that spawning assembles the brief from task+epic body +
RUNBOOK + STATE + AGENTS.md (assert each part present) and that every fake-agent tool
call invokes `beforeToolCall` (assert the seam is consulted, default allow).

**Action - GREEN:** Implement `spawnSession(taskId)` assembling the brief via the
store and routing tool calls through the `beforeToolCall` seam to the fake agent.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Teardown then respawn reads only STATE + durable inputs

**Input:** `src/session/agent-session.ts`, `src/session/agent-session.test.ts`

**Action - RED:** Write a test that after teardown, a respawn's brief reflects the
last-checkpointed STATE.md and carries **no** in-memory value set only in the prior
session (prove it reads from STATE, not retained context).

**Action - GREEN:** Implement `teardown(session)` and `respawn(taskId)` that
reconstruct solely from STATE.md + durable inputs.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
