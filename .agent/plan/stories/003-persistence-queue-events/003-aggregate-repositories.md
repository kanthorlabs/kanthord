# Story 003 - aggregate repositories

Epic: `.agent/plan/epics/003-persistence-queue-events.md`

## Goal

`storage/port.ts` gains one repository interface per aggregate — Project
(incl. resources), Initiative (incl. objectives), Task (incl.
dependencies) — with SQLite implementations proven by round-trip tests on
temp databases.

## Acceptance Criteria

- Ports (owned by the core, `storage/port.ts`):
  - `ProjectRepository { save(project: Project): void; get(id: string):
    Project | undefined; addResource(projectId: string, resource:
    Resource): void; listResources(projectId: string): Resource[] }`
  - `InitiativeRepository { save(initiative: Initiative): void; get(id:
    string): Initiative | undefined; saveObjective(objective: Objective):
    void; listObjectives(initiativeId: string): Objective[] }`
  - `TaskRepository { save(task: Task): void; saveAll(tasks: Task[]):
    void; get(id: string): Task | undefined; listByInitiative(
    initiativeId: string): Task[] }`
- `save` inserts (duplicate id throws); updates arrive with the epic that
  needs them (EPIC 004/005). `get` returns `undefined` when absent.
- `saveAll` is one transaction: all task rows first, then all dependency
  rows — so tasks inside the batch may depend on each other regardless of
  array order; any failure persists nothing. (This is the atomic graph
  store story 006 builds on.)
- `Task.dependencies` round-trips in declared order via `position`;
  `listByInitiative` joins through `objectives` and returns tasks ordered
  by `id`, each with dependencies rehydrated.
- Resources round-trip the discriminated union: vendor fields serialize
  into `attributes` JSON verbatim and rehydrate to the exact variant.
- FK violations (unknown parent id) propagate as thrown errors — named
  domain errors are EPIC 004's concern.

## Constraints

- Adapters `src/storage/sqlite/sqlite-project-repository.ts`,
  `sqlite-initiative-repository.ts`, `sqlite-task-repository.ts`; each
  takes an open `DatabaseSync` by constructor. `TaskRepository.save` /
  `saveAll` write task + dependency rows in one transaction.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - ProjectRepository

**Requires:** S002-T1 (schema).

**Input:** `src/storage/port.ts` (extend),
`src/storage/sqlite/sqlite-project-repository.ts` (new) + test (new);
consumes `Project`, `Resource` from `domain/`, `openDatabase`,
`MIGRATIONS`.

**Action - RED:** temp-DB tests: (a) `save` then `get` deep-equals the
project; (b) `get` unknown id → `undefined`; (c) duplicate `save` throws;
(d) `addResource` + `listResources` round-trips one resource per union
variant with vendor fields intact (guards from `domain/resource.ts`
narrow each); (e) `addResource` with an unknown `projectId` throws. Fails
today: port/adapter do not exist.

**Action - GREEN:** add the port; implement the adapter (serialize vendor
fields to `attributes`, rehydrate by `type`).

**Action - REFACTOR:** none.

**Output:** `ProjectRepository` port + `SqliteProjectRepository`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 - InitiativeRepository

**Requires:** S002-T1 (schema).

**Input:** `src/storage/port.ts` (extend),
`src/storage/sqlite/sqlite-initiative-repository.ts` (new) + test (new).

**Action - RED:** temp-DB tests: (a) initiative `save`/`get` round-trip;
(b) `saveObjective` + `listObjectives` round-trips in `id` order; (c)
unknown parent ids throw (FK); (d) `get` unknown → `undefined`. Fails
today: port/adapter do not exist.

**Action - GREEN:** add the port; implement the adapter.

**Action - REFACTOR:** none.

**Output:** `InitiativeRepository` port + `SqliteInitiativeRepository`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T3 - TaskRepository

**Requires:** S002-T1 (schema).

**Input:** `src/storage/port.ts` (extend),
`src/storage/sqlite/sqlite-task-repository.ts` (new) + test (new).

**Action - RED:** temp-DB tests (hierarchy rows seeded via the other
adapters or raw SQL): (a) a task with two dependencies `save`/`get`
round-trips with `dependencies` in declared order (stored `position`
0,1); (b) `save` is transactional — dependencies referencing a missing
task id throw and leave no `tasks` row behind; (c) `saveAll` of two tasks
where the second depends on the first succeeds regardless of array order;
a `saveAll` whose last row violates (duplicate id) persists nothing; (d)
`listByInitiative` returns the initiative's tasks across two objectives,
`id`-ordered, dependencies rehydrated; another initiative's tasks
excluded; (e) unknown initiative → `[]`. Fails today: port/adapter do not
exist.

**Action - GREEN:** add the port; implement the adapter (rows +
dependency rows with `position` in one transaction; `saveAll` inserts all
task rows before any dependency rows; reads order dependencies by
`position`).

**Action - REFACTOR:** none.

**Output:** `TaskRepository` port + `SqliteTaskRepository`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
