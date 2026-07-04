# Story 002 - Write-Scope on the SU3-Documented Hook Shape

Epic: `.agent/plan/epics/015-full-ring1-agents.md`

## Goal

The ring-1 policy chain (role policy + Epic 007 write-scope check) is bound to
the pi `beforeToolCall` signature **as recorded by the SU3 spike** — compatibility
with the documented shape; live-runtime fidelity is proven by Epic 016's smoke
gate (debate finding — the claim is scoped to what this story can prove).

## Acceptance Criteria

- A binding adapter converts the pi hook invocation (signature per the SU3
  findings) into the policy chain's (role, operation, path) input and converts a
  block decision into the hook's documented blocking return/throw — a blocked
  call demonstrably does not execute its tool effect.
- An out-of-scope write through the real signature is blocked and escalated with
  the re-planning tag; an in-scope, role-allowed write executes (Epic 007
  semantics preserved on the new seam).
- Tool calls that do not touch paths (a pure computation tool) pass through
  unchanged — the adapter only gates effectful calls it can classify, and
  **unclassifiable effectful calls are blocked fail-closed** with an escalation
  naming the tool.
- Swapping the configured (fake) model does not change any decision
  (model-independence re-asserted at this seam — PRD §4).

## Constraints

- The hook signature, blocking semantics, and tool-classification info come from
  `.agent/plan/feedback/016-real-agent-sessions/pi-session-surface.md` (Epic 011
  SU3) — the Story is blocked until that findings file exists.
- The caller in tests is scripted (drives the hook exactly as pi would per the
  findings); no live pi session (Epic 016's job).
- No changes to Epic 007's check logic — binding only (Epic anchor: bound, not
  rebuilt).

## Verification Gate

- `npm test` green for `src/ring1/hook-binding.test.ts`.

### Task T1 - Hook binding adapter

**Input:** `src/ring1/hook-binding.ts`, `src/ring1/hook-binding.test.ts`

**Action - RED:** Write tests driving the SU3-shaped hook: (a) out-of-scope write
⇒ blocking return per the documented semantics, effect not executed, escalation
with re-planning tag; (b) in-scope allowed write ⇒ executes; (c) pathless tool ⇒
passes; (d) unclassifiable effectful tool ⇒ blocked + escalated naming the tool.

**Action - GREEN:** Implement the adapter mapping hook input → policy chain →
hook blocking output.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Model-independence on the bound seam

**Input:** `src/ring1/hook-binding.ts`, `src/ring1/hook-binding.test.ts`

**Action - RED:** Write a test running the same call set under two different fake
model configurations, asserting identical block/pass decisions.

**Action - GREEN:** none expected beyond T1 (the assertion should hold by
construction); fix any leak the test exposes.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
