# Story 002 - Checkpoint & Phase Events

Epic: `.agent/plan/epics/024-real-tdd-workflow-model-policy.md`

## Goal

The real workflow's `checkpoint()` rewrites bounded STATE.md through the store,
phase transitions emit status events and fire the phase-boundary drift hook,
and the workflow identifies as `tdd@1` in frontmatter.

## Acceptance Criteria

- `checkpoint()` rewrites the task's STATE.md through the Epic 012 store
  (operational commit class); the written STATE stays under the configured size
  bound, and exceeding it is a typed error, not a silent truncation (PRD §6.2 —
  bounded, aggressively rewritten); on any checkpoint failure the **previous
  STATE remains intact** and the workflow reports `needs_human` (debate finding
  — a failed checkpoint must not corrupt the respawn source).
- The full interface is pinned on the real workflow: `phases[]` lists the
  `tdd@1` phases, `currentPhase()` advances in order, an out-of-order
  transition is a typed error, and status events carry the workflow version in
  emission order (debate finding).
- Each phase transition appends a status event (jsonl) and invokes the Epic 006
  phase-boundary drift hook (source re-hash; drift ⇒ human signal, work
  continues — re-asserted through the real workflow).
- Task frontmatter records `workflow: tdd@1` and the workflow version appears
  in status events (PRD §10 — versioned so retrospectives can compare).
- The Epic 010 compaction-respawn scenario passes with the real workflow in
  place of the fake (the respawn path reads the real `checkpoint()` output).

## Constraints

- No new drift logic — the hook is Epic 006 Story 004's; this story calls it at
  real transitions.
- STATE content structure is the workflow's concern; the store only persists
  (separation held from Epic 003).

## Verification Gate

- `npm test` green for `src/workflow/tdd-checkpoint.test.ts`.

### Task T1 - Bounded checkpoint through the store

**Input:** `src/workflow/tdd-checkpoint.ts`, `src/workflow/tdd-checkpoint.test.ts`

**Action - RED:** Write tests: (a) `checkpoint()` writes STATE via the store
with operational class; (b) content over the bound ⇒ typed error; (c) respawn
reads back exactly what checkpoint wrote.

**Action - GREEN:** Implement checkpoint over the store seam with the size
bound.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Phase events + drift hook + scenario

**Input:** `src/workflow/tdd-checkpoint.ts`, `src/workflow/tdd-checkpoint.test.ts`

**Action - RED:** Write tests: (a) a phase transition appends a status event
carrying `tdd@1` and fires the drift hook (changed source ⇒ human-signal event,
work continues); (b) the compaction-respawn harness scenario passes with the
real workflow substituted.

**Action - GREEN:** Wire transitions to events + the Epic 006 hook.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
