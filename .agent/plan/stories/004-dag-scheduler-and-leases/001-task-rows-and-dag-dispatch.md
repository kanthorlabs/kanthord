# Story 001 - Task Rows & DAG Dispatch

Epic: `.agent/plan/epics/004-dag-scheduler-and-leases.md`

## Goal

Task rows keyed to the feature and their dependencies, and the poll's dispatch
predicate: a task becomes dispatchable exactly when every dependency's exit gate has
passed. Dispatch order is a deterministic function of the DAG, testable without a
real workflow.

## Acceptance Criteria

- Compiling the golden feature yields task rows each carrying `feature_id`,
  `depends_on[]` (the edge set from Epic 002), a `status`, and the `generation` it
  compiled under (PRD §7.3; Epic 002 schema).
- A task with no dependencies is dispatchable immediately; a task with dependencies
  is dispatchable only after **all** its dependencies' exit gates read passed (PRD
  §7.3 — dispatch when dependency exit gates pass).
- Running one poll pass returns the set of currently-dispatchable tasks; across
  successive passes (as dependency gates are marked passed) the observed dispatch
  order is DAG-valid — no task dispatches before a dependency (assert against a
  fixed expected sequence for the golden fixture).
- Parallel-lane siblings (no edge between them) both become dispatchable together
  once their shared dependency passes (PRD §7.1.1 §4 rule 2; lease arbitration is
  Story 002, not here).
- A task already `done` is never re-dispatched.
- Dispatch keys on the dependency's **exit gate**, not on task completion: a
  dependency whose task is `done` but whose exit gate is **not** passed does **not**
  unblock its dependents (nails the gate seam; prevents coupling to workflow
  completion — debate finding).

## Constraints

- Dispatch is a `WHERE`-clause-style predicate over the existing poll, not new
  infrastructure (PRD §7.3). One poll pass is a **pure function of persisted state**
  — it returns the dispatchable set with no event callback, live session, timer, or
  broker loop required (debate finding — this is the polling seam the PRD anchors on;
  do not over-test SQL text, do test statelessness of the pass).
- Gate pass/fail is **read** here, not produced — tests set dependency exit-gate
  status directly (a Mock value the Story names) to drive ordering; the real gate
  producer is Epic 006 (Epic 004 Non-Goals).
- The clock is the injected Epic 001 seam; a poll pass takes no real time.

## Verification Gate

- `npm test` green for `src/scheduler/dispatch.test.ts` on the golden fixture.

### Task T1 - Task rows from the compiled plan

**Input:** `src/scheduler/dispatch.ts`, `src/scheduler/dispatch.test.ts`

**Action - RED:** Write a test compiling the golden feature and asserting the task
rows expose `feature_id`, `depends_on[]` matching the edge set, `status`, and
`generation`.

**Action - GREEN:** Add the scheduler's task-row view/migration over the Epic 002
compiled-plan tables and a `loadTasks(feature_id)` accessor.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.

### Task T2 - Dispatch predicate honors dependency exit gates

**Input:** `src/scheduler/dispatch.ts`, `src/scheduler/dispatch.test.ts`

**Action - RED:** Write a test that, over the golden fixture, asserts: with all gates
unset only root tasks are dispatchable; after marking a root's exit gate passed, its
dependents become dispatchable; parallel-lane siblings become dispatchable together;
a `done` task never reappears; and a dependency whose task is `done` but whose exit
gate is **not** passed does not unblock its dependents. Assert the full dispatch
sequence equals a fixed expected list. Also assert two calls to the poll over
unchanged persisted state return the identical set (pure-function-of-state).

**Action - GREEN:** Implement `dispatchable(feature_id)` selecting tasks whose every
`depends_on` node has a passed exit gate and whose status is pending.

**Action - REFACTOR:** none.

**Verify:** `npm test` green; `npm run typecheck` exits 0.
