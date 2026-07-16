# Story 06 — Graph mutation (insert / re-arrange)

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

Edit the task DAG after creation: `add dependency` / `remove dependency`. The
model has no positions, so re-arranging work is edge editing and inserting work
is just `create task`. Every mutation is cycle-guarded (`validateGraph`) and
pending-gated (`setDependencies` / `DependenciesLockedError`), leaves the graph
unchanged on rejection, and emits `task.dependencies_changed`. Task-level
dependencies only.

## Acceptance Criteria

- `AddDependency.execute({ taskId, dependsOn })` and
  `RemoveDependency.execute({ taskId, dependsOn })`
  (`app/task/add-dependency.ts`, `remove-dependency.ts`):
  - both ids must resolve to `task` (`resolveKind`) — else
    `Unknown`/`WrongTypeReferenceError`;
  - load the task, compute the proposed `dependencies`, call
    `setDependencies(task, proposed)` — throws `DependenciesLockedError` if the
    task is not `pending` (EPIC 002);
  - build the initiative's task set with the proposed edge and run
    `validateGraph` — a cycle → `CycleError`, an unknown dep →
    `UnknownDependencyError` (EPIC 002); on any throw **nothing is persisted**;
  - on success: persist the edge (`addDependency`/`removeDependency` on
    `TaskRepository`) and append a `task.dependencies_changed` event for the
    task.
- `remove dependency` for an edge that does not exist is a no-op success (exit
  0, no event) — idempotent.
- Handlers `runAddDependency` / `runRemoveDependency` → `{ exitCode: 0, stdout:
  [], stderr: ["dependency added: <task> → <dependsOn>"] }` on success; every
  rejection → exit 1 + one `error:` line, graph unchanged.

## Constraints

- Edges are rows in EPIC 003's `task_dependencies` (with `position`); no new
  migration.
- Emitting `task.dependencies_changed` requires the `events.type` CHECK to
  include the 6th `EVENT_TYPE` (see index blocker B1) — a schema precondition,
  not code in this story.
- Insert-a-task mid-graph reuses `create task` (story 05); this story only adds
  edge mutation.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — TaskRepository edge mutation

**Requires:** EPIC 003 (`task_dependencies` with `position`); S05-T1.

**Input:** `src/storage/sqlite/task-repository.ts` (+ test).

**Action — RED:** temp-DB test: `addDependency(t, d)` inserts an edge with the
next `position`; `getTask(t)` shows it; `removeDependency(t, d)` deletes it;
removing a missing edge is a no-op. Fails today: methods absent.

**Action — GREEN:** implement `addDependency`/`removeDependency` on
`TaskRepository`.

**Action — REFACTOR:** none.

**Output:** `TaskRepository` mutates single dependency edges on a temp DB.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — AddDependency / RemoveDependency use cases

**Requires:** T1; EPIC 002 S004-T2 (`setDependencies`, `DependenciesLockedError`),
S005-T1 (`validateGraph`), S006 (`task.dependencies_changed`); S02
(`resolveKind`, errors).

**Input:** `src/app/task/add-dependency.ts`, `remove-dependency.ts` (+ tests).

**Action — RED:** hermetic tests with fakes on a small initiative graph:
(a) add a valid edge → persisted + one `task.dependencies_changed` event;
(b) an edge that closes a cycle → `CycleError`, nothing persisted, no event;
(c) `--task` or `--depends-on` a non-task id → `WrongTypeReferenceError`;
(d) adding a dependency to a `completed` task → `DependenciesLockedError`;
(e) `remove dependency` of a non-existent edge → success, no event. Fails
today: modules absent.

**Action — GREEN:** implement both use cases: resolve kinds → load task →
`setDependencies` (pending gate) → `validateGraph` over the mutated initiative
set (cycle/unknown) → persist edge → append event. Order matters: gate + cycle
checks precede any write.

**Action — REFACTOR:** none.

**Output:** both use cases mutate the DAG safely, rejecting cycles and
non-pending mutations with named errors and leaving the graph unchanged.

**Verify:** `npm test` green (all five cases); `npm run typecheck` exit 0.

### Task T3 — CLI `add` / `remove dependency` handlers

**Requires:** T2; S01; S02.

**Input:** `src/apps/cli/dependency.ts` (+ test).

**Action — RED:** handler tests: `add dependency --task <id> --depends-on <id>`
→ `{ exitCode: 0 }`; a cycle-closing edge → exit 1 with the locked cycle
message; a non-pending task → exit 1 with the `DependenciesLockedError`
message. Fails today: module absent.

**Action — GREEN:** implement the two handlers → the use cases; register
`add dependency` / `remove dependency` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `add dependency` / `remove dependency` run end to end; the epic
Proof's re-arrange + cycle-rejection steps pass.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
