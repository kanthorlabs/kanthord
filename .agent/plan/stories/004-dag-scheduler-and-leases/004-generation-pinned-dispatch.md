# Story 004 - Generation-Pinned Dispatch

Epic: `.agent/plan/epics/004-dag-scheduler-and-leases.md`

## Goal

Apply clone-on-sign-off to the plan itself: a dirty plan halts dispatch of
not-yet-started tasks, while tasks already running stay pinned to the generation
they started under. This is the Phase-1 **reduced** behavior, not a safety proof
(the compatibility check is Phase 3).

## Acceptance Criteria

- A task is stamped with the current generation `G` when it is first dispatched, and
  that stamp does not change on subsequent polls (PRD §7.1.1 §7 — running tasks
  pinned to their start generation).
- When the plan is marked dirty (its live `compile_hash` differs from the compiled
  generation's hash, before any recompile), tasks with status `pending`/not-started
  are **not** dispatched (PRD §7.1.1 §7 — a dirty plan halts new dispatch).
- A task with status `running` under `G` is **not cancelled, not restamped, and not
  returned as a fresh dispatch candidate** while the plan is dirty — it simply
  continues (PRD §7.1.1 §7). The distinction running-vs-fresh-dispatch is asserted.
- After a recompile mints `G+1`, a previously-halted pending task is **stamped
  `G+1`** on its next dispatch (not merely allowed through); a still-running `G` task
  keeps its `G` stamp (PRD §7.1.1 §7).
- A task that finishes against a superseded generation is **not** marked
  compatibility-proven by this Story — no such flag is set; the compatibility check
  is Phase 3 (debate finding — do not bake a false safety claim).

## Constraints

- Dirty = the feature's live `compile_hash` (over covered files) differs from the
  stored generation's hash (Epic 002 computes the hash; this Story compares) (PRD
  §7.1.1 §7).
- Phase-1 behavior is the **safe** rule only: dirty ⇒ halt new dispatch, running
  tasks pinned and allowed to finish. The **continuation optimization** (continue a
  new task only if the edit is outside its subgraph) and the **post-completion
  compatibility check before merge** are Phase 3 — explicitly not built here
  (phases.md Phase 3 Deliverable 3; Epic 004 Non-Goals).
- Generation is read/stamped on the task row; the clock is the injected seam.

## Verification Gate

- `npm test` green for `src/scheduler/generation.test.ts`.

### Task T1 - Pin running tasks to their start generation

**Input:** `src/scheduler/generation.ts`, `src/scheduler/generation.test.ts`

**Action - RED:** Write a test: a task dispatched under generation `G` keeps its `G`
stamp across further polls; after a recompile to `G+1`, that still-running task's
stamp remains `G`.

**Action - GREEN:** Stamp `generation = current G` on first dispatch; never rewrite
it while the task runs.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Dirty plan halts new dispatch, running tasks continue

**Input:** `src/scheduler/generation.ts`, `src/scheduler/generation.test.ts`

**Action - RED:** Write a test: with the plan marked dirty (live `compile_hash` ≠
stored generation hash), a `pending` task is excluded from dispatch while a
`running` `G` task is not cancelled, not restamped, and not returned as a fresh
candidate; after recompile to `G+1`, the previously-halted task is dispatched **and
stamped `G+1`**.

**Action - GREEN:** Add a dirty check (compare live hash to stored generation hash
via Epic 002) to the dispatch predicate: exclude `pending` tasks when dirty; leave
`running` rows untouched; stamp `G+1` on the halted task's next dispatch.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
