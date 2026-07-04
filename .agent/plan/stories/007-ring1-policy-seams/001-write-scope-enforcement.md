# Story 001 - Write-Scope Enforcement (`beforeToolCall`)

Epic: `.agent/plan/epics/007-ring1-policy-seams.md`

## Goal

Fill the Epic 006 `beforeToolCall` seam with the deterministic write-scope guardrail:
a tool call that writes outside the task's declared `write_scope` is blocked and
escalated (and flagged as a re-planning signal); an in-scope write passes; the
decision does not depend on the model.

## Acceptance Criteria

- A fake tool call writing a path **outside** the task's `write_scope` is **blocked**
  — the write does not occur — and an escalation event is recorded (PRD §4 — writes
  outside declared scope are blocked and escalated).
- A fake tool call writing a path **inside** the `write_scope` passes through.
- The escalation event carries a **re-planning-signal** tag (PRD §4 — a blocked
  out-of-scope write usually means the decomposition was wrong).
- The block/allow decision is identical regardless of which fake model is configured
  (PRD §4 — deterministic guardrails are model-independent; a permissive model must
  not weaken ring one).
- Scope matching uses the same normalized path-prefix semantics as the lease manager
  (Epic 004 Story 002), so scope decisions are consistent across the system.

## Constraints

- Enforcement lives in the Epic 006 `beforeToolCall` seam and is **deterministic** —
  no model call, no judgment (PRD §4 ring 1). This is ring 1, not the ring-2
  classifier (Epic 007 Non-Goals).
- The escalation is recorded as an event (jsonl, Epic 001) attributed to the task;
  no approval UI here (Phase 2).
- `write_scope` is read from the task's compiled frontmatter (Epic 002); path
  normalization matches Epic 004 Story 002 (single overlap semantics).

## Verification Gate

- `npm test` green for `src/ring1/write-scope.test.ts`.

### Task T1 - Block out-of-scope write, allow in-scope

**Input:** `src/ring1/write-scope.ts`, `src/ring1/write-scope.test.ts`

**Action - RED:** Write tests: (a) a `beforeToolCall` for a write outside
`write_scope` returns `block` and the write is not performed; (b) an in-scope write
returns `allow`; (c) the blocked case records an escalation event tagged as a
re-planning signal.

**Action - GREEN:** Implement the write-scope `beforeToolCall` handler using the Epic
004 normalized-prefix matcher against the task's `write_scope`, recording the
escalation on block.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Model-independence

**Input:** `src/ring1/write-scope.ts`, `src/ring1/write-scope.test.ts`

**Action - RED:** Write a test that the same out-of-scope write is blocked under two
different fake model configs (including a "permissive" one) — the decision does not
change.

**Action - GREEN:** Ensure the handler takes no model input and depends only on the
declared scope + path (no code change beyond confirming the seam signature if T1
already satisfies it — otherwise remove any model coupling).

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
