# Story 003 - domain entities — the canonical model

Epic: `.agent/plan/epics/002-domain-core.md`

## Goal

The work-graph hierarchy exists as data + creation helpers: Project,
Initiative → Objective → Task. This story file is also the **canonical
domain-model reference** — it replaces the `### Abstraction` sketch in
`README.md` (removed by maintainer M4, story 008, after the epic closes).

## Canonical domain model

Implemented in this epic (field names are verbatim contract names — external
formats like the graph YAML must use them exactly):

| Entity | Fields | Where |
|---|---|---|
| `Entity` | `id: string` (ULID) | story 001 |
| `Project` | `id`, `name: string` | this story |
| `Initiative` | `id`, `projectId: string`, `name: string` | this story |
| `Objective` | `id`, `initiativeId: string`, `name: string` | this story |
| `Task` | `id`, `objectiveId: string`, `title: string`, `status: TaskStatus`, `dependencies: string[]` (task ids) | this story |
| `Resource` union | base `{ id, type, name }` + vendor fields per variant | story 002 |
| `Event` | `id`, `type: EventType`, `taskId: string` | story 006 |

`TaskStatus` = `pending | running | completed | failed`.
`EventType` = `task.created | task.ready | task.started | task.completed |
task.failed`.

**Locked divergences from the README sketch (by decision, not convenience):**

- **Flat id references, not nested object graphs.** The sketch nests
  `Project.resources[]`, `Task.dependencies: Task[]`, `Task.events[]`. The
  code uses parent-id fields (`projectId`, `objectiveId`) and id arrays
  (`dependencies: string[]`) — pure functions and SQLite persistence
  (EPIC 003) need id refs, not cyclic object graphs.
- **No `execute()` on entities** (binding `AGENTS.md` decision) — execution
  happens in use cases via the agent-runner port.
- **No `createdAt` / `Event.timestamp`** — the ULID id carries the timestamp.
- **`Event.payload?`** deferred to EPIC 003 (no consumer yet).

**Deferred fields/entities (kept from the sketch, owned by later epics):**

| Sketch item | Owner |
|---|---|
| `Agent` entity (`AgentType`, name) — without `execute()` | EPIC 005/006 |
| `Task.agent` (assigned agent) | EPIC 005/006 |
| `Task.context` / `TaskContext` (Project Resource bindings) | EPIC 005 |
| `Task` workflow field (`tdd@1`, `pr@1`) | shape-only per this epic's non-goals; semantics later |
| `TaskResult` | EPIC 005 |

## Acceptance Criteria

- `newProject(name)` → `{ id, name }`.
- `newInitiative(projectId, name)` → `{ id, projectId, name }`;
  `newObjective(initiativeId, name)` → `{ id, initiativeId, name }`.
- `TASK_STATUSES` lists exactly `pending`, `running`, `completed`, `failed`;
  `TaskStatus` is their union.
- `newTask({ objectiveId, title, dependencies? })` → status `pending`,
  `dependencies` defaults to `[]`; `dependencies` holds task ids.
- No entity exposes methods — plain data returned by helpers.

## Constraints

- Files: `project.ts`, `initiative.ts` (Initiative + Objective — one
  aggregate), `task.ts`. Imports only `./entity.ts`.
- Transition rules are story 004, not here.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green.

### Task T1 - Project / Initiative / Objective

**Requires:** S001-T1 (`newId`, `Entity`).

**Input:** `src/domain/project.ts` (new), `src/domain/initiative.ts` (new),
`src/domain/project.test.ts` (new), `src/domain/initiative.test.ts` (new);
consumes `newId`/`Entity` from `./entity.ts`.

**Action - RED:** tests assert the three creation helpers return the shapes
in the model table with ULID-format ids and the given parent ids. Fails
today: modules do not exist.

**Action - GREEN:** implement the two modules with the three helpers.

**Action - REFACTOR:** none.

**Output:** `src/domain/project.ts` exports `Project`, `newProject`;
`src/domain/initiative.ts` exports `Initiative`, `Objective`,
`newInitiative`, `newObjective` — all per the model table.

**Verify:** `npm test` green; `npm run typecheck` exit 0.

### Task T2 - Task entity

**Requires:** S001-T1 (`newId`, `Entity`).

**Input:** `src/domain/task.ts` (new), `src/domain/task.test.ts` (new);
consumes `newId`/`Entity` from `./entity.ts`.

**Action - RED:** test asserts: (a) `TASK_STATUSES` deep-equals the four
literals in the model order; (b) `newTask({ objectiveId, title })` has status
`pending` and `dependencies: []`; (c) a passed `dependencies` array is kept
as given. Fails today: module does not exist.

**Action - GREEN:** implement `task.ts`: `TASK_STATUSES`, `TaskStatus`,
`Task`, `newTask`.

**Action - REFACTOR:** none.

**Output:** `src/domain/task.ts` exports `TASK_STATUSES`, `TaskStatus`,
`Task { id, objectiveId, title, status, dependencies }`, and `newTask`.

**Verify:** `npm test` green; `npm run typecheck` exit 0.
