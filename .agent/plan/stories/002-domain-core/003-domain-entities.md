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
| `Task` | `id`, `objectiveId: string`, `title: string`, `status: TaskStatus`, `dependencies: string[]` (task ids), `agent: string` (versioned ref, e.g. `generic@1` — EPIC 006), `instructions: string` + `ac: string[]` (task specification, both REQUIRED — EPIC 006 S02) | this story + EPIC 006 S02 |
| `Resource` union | base `{ id, type, name }` + vendor fields per variant | story 002 |
| `Event` | `id`, `type: EventType`, `taskId: string` | story 006 |

`TaskStatus` = `pending | running | completed | failed |
awaiting_confirmation | discarded` (the last two appended by EPIC 006
D3/D4 — Ulrich, 2026-07-16, debate-reviewed: escalation parking + terminal
abandonment; originally four statuses).
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
| `Agent` entity (`AgentType`, name) — without `execute()` | superseded by EPIC 006 D2 (Ulrich, 2026-07-16): no Agent entity — `Task.agent` is a versioned ref resolved by `AgentRunnerResolver`; role behavior lives in adapter-private profiles |
| `Task.agent` (assigned agent) | SHIPPED in EPIC 006 S02 (was EPIC 005/006) |
| `Task.instructions` / `Task.ac` (task specification: prose body + acceptance-criteria list) | SHIPPED in EPIC 006 S02 (Ulrich, 2026-07-16, debate-reviewed): both REQUIRED non-empty pure data (`newTask` throws a named validation error on empty, like `agent`); the runner renders them into the user prompt. No `approach` field, no `spec` blob (debate: over-structuring). Consequence: `title`-only task creation is NO LONGER valid from EPIC 006 on — migration 5 backfills pre-006 rows; the CLI `--instructions`/`--ac` flags become required. `ac` is carried + prompted this epic; wiring it into `verify()` is future |
| `Task.context` / `TaskContext` (Project Resource bindings) | EPIC 005 |
| `Task` workflow field (`tdd@1`, `pr@1`) | shape-only per this epic's non-goals; semantics later |
| `TaskResult` | EPIC 005 (extended by EPIC 006: completed fields + `escalated` variant) |

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
