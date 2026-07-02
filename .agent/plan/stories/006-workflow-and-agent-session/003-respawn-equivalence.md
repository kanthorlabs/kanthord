# Story 003 - Respawn-Equivalence (one code path)

Epic: `.agent/plan/epics/006-workflow-and-agent-session.md`

## Goal

One respawn function shared by all three triggers — compaction threshold,
task-boundary, crash recovery — such that after respawn the pending-task set, lease
ownership, current phase, and injected STATE match the pre-respawn state, exactly as
PRD §7.7 defines equivalence.

## Acceptance Criteria

- All three triggers — crossing the compaction threshold, hitting a task boundary,
  crash recovery — dispatch a normalized `RespawnRequest` into a **single respawn
  coordinator** that is the only component allowed to kill/recreate a session. For
  all three, the **observable transition stages** are identical: (checkpoint policy →)
  teardown → reconstruction → injected brief → equivalence snapshot (PRD §3.2 — same
  code path). This is asserted by observable postconditions, **not** by a spy on a
  function name (debate finding — "same function called" can still diverge before/
  after the call).
- After a mid-task respawn, **field-by-field**: the pending-task set (Epic 004 view),
  lease ownership (Epic 004 lease view), the workflow's durable `currentPhase()`, and
  the **injected STATE as embedded in the post-respawn spawn brief handed to the fake
  agent** — not merely STATE.md on disk — each equal their pre-respawn values (PRD
  §7.7; debate finding — assert the brief, or a stale/wrong injection could pass).
- Live model/session context is **not** required to match — a key set only in the
  prior in-memory fake-agent session is absent from the post-respawn fake-agent
  session, and that is correct (PRD §7.7 — the point of teardown).
- **Only the threshold trigger** runs `checkpoint()` before teardown; task-boundary
  and crash reconstruct from the already-persisted STATE. After a threshold respawn
  the injected STATE equals that checkpoint (PRD §3.2 — compaction = checkpoint +
  kill + respawn).
- The compaction threshold is **per-model config**, proven with two model configs:
  model A (window/ratio giving a 55%-of-window threshold) triggers at a reported
  size; model B with a larger window does **not** trigger for the same reported size
  (PRD §3.2 — per-model config, not a constant; debate finding — force it, else
  `if size > 1000` passes a vague test).

## Constraints

- The three triggers converge on **one respawn coordinator** (PRD §3.2); a
  normalized `RespawnRequest` carries the durable inputs, and the coordinator is the
  sole session kill/recreate authority — closing the risk that crash recovery
  diverges from compaction. Proof is by identical observable postconditions, not a
  white-box call spy (debate finding).
- Equivalence is compared on the four named fields only; live context is explicitly
  excluded (PRD §7.7). "Injected STATE" means the STATE embedded in the post-respawn
  spawn brief (Epic 006 Story 002 brief assembly), not just the on-disk file.
- Equivalence is a **contract-level** proof over fake scheduler/state/workflow/session
  seams; the full end-to-end compaction-respawn scenario is Epic 010 (do not defer
  the contract proof there).
- Everything is driven on the fake clock; "threshold crossed" is the fake agent
  reporting a context size over the configured per-model threshold (PRD §3.2 —
  per-model config, not a constant).

## Verification Gate

- `npm test` green for `src/session/respawn.test.ts` for all three triggers.

### Task T1 - Field-by-field equivalence after respawn

**Input:** `src/session/respawn.ts`, `src/session/respawn.test.ts`

**Action - RED:** Write a test that captures the pending-task set, lease ownership,
current phase, and the STATE embedded in the spawn brief mid-task, sends a
`RespawnRequest` to the coordinator, and asserts each of the four equals its captured
value (STATE compared as embedded in the **post-respawn brief**); and asserts a
prior-session-only in-memory fake-agent key is absent afterward.

**Action - GREEN:** Implement the respawn coordinator reconstructing session +
workflow state from STATE + scheduler rows so the four fields are preserved and the
brief re-embeds the current STATE.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Identical transition stages across triggers + per-model threshold

**Input:** `src/session/respawn.ts`, `src/session/respawn.test.ts`

**Action - RED:** Write tests: (a) task-boundary, crash-recovery, and
threshold-crossing each produce the identical observable transition stages
(teardown → reconstruction → injected brief → equivalence snapshot) and an equivalent
respawn, with **only** the threshold trigger running `checkpoint()` first and its
post-respawn injected STATE equal to that checkpoint; (b) two model configs — model A
triggers at its 55%-window size, model B (larger window) does not trigger at the same
reported size.

**Action - GREEN:** Route all triggers through the coordinator via `RespawnRequest`;
gate the checkpoint step to the threshold trigger; read the compaction threshold from
per-model config.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
