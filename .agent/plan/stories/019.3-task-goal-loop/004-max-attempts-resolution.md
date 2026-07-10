# Story 004 - max_attempts resolution: task frontmatter → system default

Epic: `.agent/plan/epics/019.3-task-goal-loop.md`

## Goal

The retry limit is configurable where the plan lives: a task frontmatter
`max_attempts` overrides the system default (**3**), invalid values fail at
lint/compile time with a typed planner-vocabulary diagnostic — never
silently at runtime. `max_attempts` counts **dispatched attempts** (debate
finding 2026-07-10 — `max_attempts: 3` means at most three sessions are
dispatched for the goal; lifecycle respawns do not count). This is the MVP slice of the condition hierarchy; the
feature/repo-slot tiers join when Epic 024 Story 003 builds the model-policy
resolution chain (B2 join point, epic anchor).

## Acceptance Criteria

- A task with no `max_attempts` frontmatter resolves to 3 (the system
  default — fixed contract value).
- A task with `max_attempts: 5` resolves to 5; the resolved value is what
  the Story 003 termination decision receives (asserted through the
  run-loop, not just the resolver).
- `max_attempts: 0`, a negative value, or a non-integer fails shape lint
  with a planner-vocabulary diagnostic naming the task and the field; a
  plan containing it cannot sign off.
- The resolved value is recorded on the scheduler task row at load, so the
  running system and the dashboard read one value (no re-resolution drift).

## Constraints

- **Lint in the existing shape-lint pass** — the diagnostic lands in the
  Epic 002 planner-vocabulary lint (same diagnostic shape the sign-off flow
  renders verbatim — Epic 026/027 contract); no second validation layer.
- **Resolution is two-tier by design** — task frontmatter → system default
  only; do NOT pre-build the feature/slot tiers (epic Non-Goals, B2 join
  point cited).
- The system default lives with the scheduler load path
  (`src/scheduler/dispatch.ts` discipline), a named constant.

## Verification Gate

- `npm test` green for the resolution + lint suites; `npm run typecheck`
  exits 0.

### Task T1 - resolver + task-row recording

**Input:** `src/scheduler/dispatch.ts`, `src/scheduler/dispatch.test.ts`

**Action - RED:** tests: loading a feature whose task has no `max_attempts`
records 3 on the task row; an explicit `max_attempts: 5` records 5; the
recorded value survives a reload (idempotent load does not re-default an
explicit value).

**Action - GREEN:** resolve at `loadTasks` time and record the value on the
scheduler task row.

**Action - REFACTOR:** none.

**Verify:** `node --test src/scheduler/dispatch.test.ts` green.

### Task T2 - shape-lint diagnostic for invalid values

**Input:** `src/compiler/shape-lint.ts`, `src/compiler/shape-lint.test.ts`
(the Epic 002 shape-lint pass — exact file verified 2026-07-10, debate
finding: a vague Input blocks the lane check)

**Action - RED:** tests: `max_attempts: 0`, `-1`, and `"two"` each produce
a planner-vocabulary diagnostic naming the task file and the field; a valid
value produces no diagnostic; sign-off with the invalid plan fails.

**Action - GREEN:** add the field check to the existing shape-lint pass.

**Action - REFACTOR:** none.

**Verify:** `node --test` on the touched lint suite; full `npm test` no
regression.

### Task T3 - resolved value drives the loop

**Input:** `src/daemon/run-loop.ts`, `src/daemon/run-loop.test.ts`

**Action - RED:** end-to-end: a task with `max_attempts: 1` and an
always-failing fake gate parks with the `attempts-exhausted` item after
exactly one attempt; a sibling task without frontmatter retries up to the
default 3.

**Action - GREEN:** the tick reads the recorded value from the task row and
passes it to the Story 003 decision function.

**Action - REFACTOR:** none.

**Verify:** `node --test src/daemon/run-loop.test.ts` green.
