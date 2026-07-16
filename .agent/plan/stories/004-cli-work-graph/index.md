# EPIC 004 — CLI manages the work graph · story index

Epic: `.agent/plan/epics/004-cli-work-graph.md`

**Format:** every task states **Requires → Input → Action (RED/GREEN/REFACTOR)
→ Output → Verify**. Dispatched through `/work` (engineer lanes). One story per
file; one use case per file (verb-first), per `AGENTS.md`.

## Stories (build order = dependency order)

1. [CLI argument layer](01-cli-argument-layer.md)
2. [Error surface & reference resolution](02-error-and-reference-resolution.md)
3. [Command use cases — project / initiative / objective](03-command-use-cases.md)
4. [Typed resource commands](04-typed-resource-commands.md)
5. [Task creation, dependencies & context](05-task-and-context.md)
6. [Graph mutation — insert / re-arrange](06-graph-mutation.md)
7. [Query use cases — list / get / readiness](07-query-use-cases.md)
8. [Identity contract & find](08-find-and-identity.md)
9. [End-to-end smoke test](09-e2e-smoke.md)

## Locked decisions

- **Command grammar: verb-first** `<verb> <object> <flags>` (k8s-style). Each
  command key maps 1:1 to a use-case class (`create task` → `CreateTask`).
  Verbs: `create`, `rename`, `list`, `get`, `find`, `add`, `remove`. Subsystem
  commands (`db migrate`, `db status`) keep their form; EPIC 002's
  `check graph --path` is already verb-first.
- **Handler contract:** every handler `run<Command>(argv, deps)` returns
  `{ exitCode, stdout: string[], stderr: string[] }`; `main.ts` prints the two
  streams and sets `process.exitCode` (same shape as EPIC 002 `runGraphCheck`).
- **Identity output:** a successful `create` writes the new ULID as the **only**
  stdout line; human messages go to stderr.
- **Reference flags** take ULIDs only. `resolveKind(id)` (story 02) reports the
  owning aggregate: `undefined` → `UnknownReferenceError`; a different aggregate
  → `WrongTypeReferenceError`.
- **Flag = field name, verbatim** (kebab is the canonical rendering:
  `--secret-ref` → `secretRef`). No aliases (`--org`, `--repo` are gone).
- **Repository flags:** `--organization --branch` (+ `--name` as the repo slug).
- **Task context is persistence-only** — new `task_context` table (migration 3);
  the domain `Task` entity is unchanged. The `TaskContext` resolver stays
  EPIC 005.
- **Aggregate-owned repos** (no new repository types): resources live on
  `ProjectRepository`, objectives on `InitiativeRepository` (per `AGENTS.md`).

## Storage capability map (defined once; each story implements its slice)

EPIC 003 delivers `ProjectRepository`, `InitiativeRepository`, `TaskRepository`
(save/get + `StoreGraph`/`CheckStoredGraph`) and the 8-table schema. EPIC 004
adds only these methods:

```
ReferenceResolver:    resolveKind(id) -> 'project'|'initiative'|'objective'|'task'|'resource'|undefined
ProjectRepository:    listProjects(), resolveProjectByName(name)->id[],
                      saveResource(r), getResource(id), listResources(projectId),
                      resolveResourceByName(projectId,name)->id[]
InitiativeRepository: listInitiatives(projectId), resolveInitiativeByName(projectId,name)->id[],
                      saveObjective(o), getObjective(id), listObjectives(initiativeId),
                      resolveObjectiveByName(initiativeId,name)->id[]
TaskRepository:       getTask(id), listTasksByObjective(objectiveId),
                      listTasksByInitiative(initiativeId),   # join task->objective->initiative
                      addDependency(taskId,dependsOn), removeDependency(taskId,dependsOn),
                      saveTaskContext(taskId,context), getTaskContext(taskId)
```

## Cross-epic dependency (resolved)

- **B1 - RESOLVED - events CHECK lists 6 event types** — EPIC 002 declares
  `task.dependencies_changed` (6th `EVENT_TYPES`). EPIC 003's migration-2
  `events.type` CHECK now includes it (`003/002-schema.md`), so story 06 can
  emit the audit event without a later CHECK rebuild.

## Non-goals (from the epic)

No task execution (EPIC 005), no agent/workflow semantics, no HTTP/TUI, no
resource config-file import.
