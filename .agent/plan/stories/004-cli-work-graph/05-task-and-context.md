# Story 05 — Task creation, dependencies & context

Epic: `.agent/plan/epics/004-cli-work-graph.md`

## Goal

`create task` with repeatable `--depends-on` (multiple deps) and repeatable
`--context <type>=<resource-id>` (Project Resource bindings, **stored, not
interpreted**). This story adds the `task_context` table (migration 3) and
persists bindings — the domain `Task` entity is **not** changed; the
`TaskContext` resolver stays EPIC 005.

## Acceptance Criteria

- New migration 3 `task_context(task_id, type, resource_id)`, PK
  `(task_id, type)`, FKs on. Appended to the ordered migration list (no new
  runner). One resource id per type (README `getResource(type)` returns one).
- `CreateTask.execute({ objectiveId, title, dependencies?, context? })`:
  - `resolveKind(objectiveId)` must be `objective`
    (unknown/`WrongTypeReferenceError`);
  - every `--depends-on` id must be an existing `task` in the **same
    initiative** (unknown → `UnknownReferenceError{kind:'task'}`; non-task →
    `WrongTypeReferenceError`);
  - every `--context` value must be a `resource` of the keyed type belonging to
    the objective's project (unknown → `UnknownReferenceError`; wrong type →
    `WrongTypeReferenceError`);
  - persists `newTask({objectiveId, title, dependencies})` + its dependency
    edges + context rows; returns the ULID.
- `create task --objective <id> --title "x" [--depends-on <id> …]
  [--context <type>=<id> …]` → stdout `[ulid]`.

## Constraints

- Domain unchanged — `newTask` already defaults `dependencies: []` (EPIC 002).
  Context has no domain representation in EPIC 004; it lives only in
  `task_context`.
- The migration-list append is the only lane-forbidden touch — confirm against
  EPIC 001 lane rules; if denied for engineers, split it as a maintainer
  sub-task.
- `TaskRepository` gains `getTask`, `saveTaskContext`, `getTaskContext`
  (dependency edges already persist via EPIC 003's `task_dependencies` +
  `position`).

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 — migration 3 `task_context` + repo persistence

**Requires:** EPIC 003 (migration runner, `tasks` + `task_dependencies`).

**Input:** the ordered migration list module, `src/storage/sqlite/task-repository.ts`
(+ tests).

**Action — RED:** temp-DB test: `db migrate` creates `task_context`; saving a
task with 2 deps + 2 context entries then `getTask` + `getTaskContext`
round-trips the dependencies (declared order preserved via `position`) and the
context map. Fails today: table/methods absent.

**Action — GREEN:** append migration 3; extend `TaskRepository` with
`getTask`, `saveTaskContext`, `getTaskContext`.

**Action — REFACTOR:** none.

**Output:** task rows persist dependencies + context on a temp DB; migration 3
is registered.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 — CreateTask use case

**Requires:** T1; S02 (`resolveKind`, errors); S03 (objective exists);
S04-T1 (`getResource`, `resolveResourceByName`).

**Input:** `src/app/task/create-task.ts` (+ test).

**Action — RED:** hermetic tests with fakes: create with no deps/context →
pending task + ULID; unknown `--objective` → `UnknownReferenceError`; a task id
as `--objective` → `WrongTypeReferenceError`; `--depends-on` unknown id →
`UnknownReferenceError{kind:'task'}`; `--context credential=<repository-id>` →
`WrongTypeReferenceError`; a context resource in another project →
`UnknownReferenceError`. Fails today: module absent.

**Action — GREEN:** implement `CreateTask` — validate objective, deps (same
initiative), and context, then persist task + edges + context rows.

**Action — REFACTOR:** none.

**Output:** `CreateTask` validates all references and persists task + edges +
context.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 — CLI `create task` handler

**Requires:** T2; S01; S02.

**Input:** `src/apps/cli/task.ts` (+ test).

**Action — RED:** handler tests: repeatable `--depends-on` and `--context`
parse into an array / a `type→id` map; valid → `{ exitCode: 0, stdout: [ulid]
}`; `--context` missing the `=` → one-line CLI parse error; a bad reference →
exit 1 one line. Fails today: module absent.

**Action — GREEN:** implement `runCreateTask` (`parseArgs` `multiple: true` for
`--depends-on`/`--context`, split `key=value`) → `CreateTask`; register
`create task` in `COMMANDS`.

**Action — REFACTOR:** none.

**Output:** `create task` runs end to end with multiple deps + context
bindings.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
