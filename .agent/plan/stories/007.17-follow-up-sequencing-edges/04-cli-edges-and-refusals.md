# Story 4 — CLI: create-with-edge, add/remove edge, and the refusals

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: Story 1 (`validateDag`, `SequencingLockedError`, `SequencingScopeError`), Story 2 (`SequencingRepository`)

## Change

### 4a. Four new use cases

Each is one file, one class, one `execute()`, verb-first (AGENTS.md).

**`src/app/initiative/add-initiative-dependency.ts`** — `AddInitiativeDependency`

Constructor: `(initiatives: InitiativeRepository, tasks: TaskSource, sequencing: SequencingRepository, resolver: ReferenceResolver, tx: Transactor)`
where `TaskSource` is the local structural interface
`{ listByInitiative(initiativeId: string): Task[] }`.

`execute(input: { initiativeId: string; dependencyId: string }): Promise<void>`,
steps in this exact order (mirroring `src/app/task/add-dependency.ts:40-86`):

1. `resolver.resolveKind(input.initiativeId)` — `undefined` →
   `UnknownReferenceError("initiative", id)`; not `"initiative"` →
   `WrongTypeReferenceError("initiative", kind, id)`.
2. Same two checks for `input.dependencyId`.
3. `initiatives.get()` both ids; `undefined` → `UnknownReferenceError`.
4. **Scope:** the two `projectId`s must be equal, else
   `SequencingScopeError(initiativeId, dependencyId, "project")`.
5. **Self-edge:** `initiativeId === dependencyId` →
   `CycleError([initiativeId, initiativeId])`.
6. **Idempotence:** if `sequencing.listInitiativeAfter(initiativeId)` already
   contains `dependencyId`, `return` — success, no write, no gate (mirrors
   `src/app/task/remove-dependency.ts:64-71`).
7. **Retroactive refusal:** `startedTaskIds` = ids of
   `tasks.listByInitiative(input.initiativeId)` whose `status !== "pending"`,
   sorted ascending. If non-empty →
   `SequencingLockedError(input.initiativeId, startedTaskIds)`.
8. **Cycle:** `const nodes = sequencing.listInitiativeDag(projectId)`, then splice
   the proposed edge in:
   `nodes.map(n => n.id === initiativeId ? { ...n, dependencies: [...n.dependencies, dependencyId] } : n)`,
   then `validateDag(proposed)` — throws `CycleError` / `UnknownDependencyError`.
9. `tx.run(() => sequencing.addInitiativeAfter(initiativeId, dependencyId))`.
   **No event is appended** (this epic adds no event types).

**`src/app/initiative/remove-initiative-dependency.ts`** — `RemoveInitiativeDependency`

Same constructor. Steps 1-4 identical; then: if the edge is **absent**, `return`
(idempotent no-op, no gate); else apply the step-7 retroactive gate; then
`tx.run(() => sequencing.removeInitiativeAfter(...))`. No cycle check (removal
cannot create a cycle).

**`src/app/objective/add-objective-dependency.ts`** — `AddObjectiveDependency`

Constructor: `(initiatives: InitiativeRepository, tasks: ObjectiveTaskSource, sequencing: SequencingRepository, resolver: ReferenceResolver, tx: Transactor)`
where `ObjectiveTaskSource` is `{ listTasksByObjective(objectiveId: string): Task[] }`
(`SqliteTaskRepository` already has it).

`execute(input: { objectiveId: string; dependencyId: string })`. Same nine steps,
substituting:

- kind must be `"objective"`; entities read with `initiatives.getObjective()`.
- Scope: the two `initiativeId`s must be equal, else
  `SequencingScopeError(objectiveId, dependencyId, "initiative")`.
- Retroactive gate scope: `tasks.listTasksByObjective(input.objectiveId)`.
- Cycle: `sequencing.listObjectiveDag(initiativeId)`.
- Write: `sequencing.addObjectiveAfter(...)`.

**`src/app/objective/remove-objective-dependency.ts`** — `RemoveObjectiveDependency`

Objective twin of `RemoveInitiativeDependency`.

### 4b. `--after` on `create initiative` / `create objective`

`src/app/initiative/create-initiative.ts` — `execute` input becomes
`{ projectId: string; name: string; after?: string[] }`. After
`this.#repo.save(initiative)` and inside a new `tx.run(...)` wrapping both writes:
for each id of `[...new Set(input.after ?? [])].sort()`, run the **same steps 1-5
and 8** as `AddInitiativeDependency` (kind check, existence, same-project scope,
self-edge, cycle over the DAG that now includes the new initiative), then
`sequencing.addInitiativeAfter(initiative.id, dependencyId)`. Step 7 (retroactive
gate) is skipped — a brand-new initiative has no tasks.

Constructor gains `sequencing: SequencingRepository` and `tx: Transactor` as the
last two parameters.

`src/app/objective/create-objective.ts` — identical treatment with
`sequencing.addObjectiveAfter`, same-initiative scope, and
`sequencing.listObjectiveDag(input.initiativeId)`.

### 4c. Four new CLI leaf files

`src/apps/cli/commands/add/initiative-dependency.ts`:

```ts
export function buildAddInitiativeDependencyCommand(
  deps: CliDeps,
  io: CliIo,
): Command {
  return new Command("initiative-dependency")
    .description("Sequence one initiative after another.")
    .configureHelp({ commandUsage: () => "kanthord add initiative-dependency" })
    .requiredOption(
      "--initiative <id>",
      "ID of the initiative that must run later",
    )
    .requiredOption("--after <id>", "ID of the initiative that must land first")
    .addHelpText(
      "after",
      "\nExample:\n  kanthord add initiative-dependency --initiative initiative-3 --after initiative-2\n",
    )
    .action(async (opts: { initiative: string; after: string }) => {
      emitResult(
        await runAddInitiativeDependency(
          { initiative: opts.initiative, after: opts.after },
          deps.addInitiativeDependency,
        ),
        io,
      );
    });
}
```

Siblings, same shape:

- `commands/add/objective-dependency.ts` — `--objective <id>` + `--after <id>`.
- `commands/remove/initiative-dependency.ts` — help text
  `"ID of the initiative to stop waiting for"`.
- `commands/remove/objective-dependency.ts`.

Register them: `src/apps/cli/commands/add.ts:16` gains
`command.addCommand(buildAddInitiativeDependencyCommand(deps, io));` and
`buildAddObjectiveDependencyCommand`; `commands/remove.ts:16` gains the two
`remove` twins.

New handlers in `src/apps/cli/sequencing.ts`, mirroring
`src/apps/cli/dependency.ts:5-55` exactly (hand `MissingFlagError` validation for
each flag, `try` → success result, `catch` → `{ ...toResult(err), stdout: [] }`):

| handler                         | success `stderr`                                                           |
| ------------------------------- | -------------------------------------------------------------------------- |
| `runAddInitiativeDependency`    | ``[`initiative dependency added: ${initiativeId} after ${dependencyId}`]`` |
| `runRemoveInitiativeDependency` | `[]`                                                                       |
| `runAddObjectiveDependency`     | ``[`objective dependency added: ${objectiveId} after ${dependencyId}`]``   |
| `runRemoveObjectiveDependency`  | `[]`                                                                       |

`stdout` is `[]` and `exitCode` is `0` for all four on success.

`--after` on the two `create` leaves (`commands/create/initiative.ts:16`,
`commands/create/objective.ts`) is a **repeatable** option, using the collector
`import graph --bind` uses (`commands/import/graph.ts:19-24`):

```ts
    .option(
      "--after <id>",
      "sequence this node after an existing one; repeat for each prerequisite",
      (value, values: string[]) => (values.push(value), values),
      [],
    )
```

and the action passes `after: opts.after` through to
`runCreateInitiative` / `runCreateObjective`, which forward it to the use case.

### 4d. Error catalogue + exit mapping

- `src/app/errors.ts` — add
  `export { SequencingLockedError, SequencingScopeError } from "../domain/sequencing.ts";`
  beside the existing `DependenciesLockedError` re-export (`errors.ts:5`).
- `src/apps/cli/error-map.ts:42-73` — add both classes to the `instanceof` chain
  in `toResult` so they render as `error: <message>` at exit 1. `CycleError`,
  `UnknownReferenceError` and `WrongTypeReferenceError` are already listed.

### 4e. Composition — `src/composition.ts`

Construct the four use cases beside the existing dependency wiring
(`composition.ts:240-253`), update `CreateInitiative` (`:165-168`) and
`CreateObjective` (`:179-182`) with their two new arguments, and return
`addInitiativeDependency`, `removeInitiativeDependency`,
`addObjectiveDependency`, `removeObjectiveDependency` on the deps bundle. Declare
the four keys on `CliDeps` (`src/apps/cli/deps.ts:118-155`).

## Constraints

- No new event types and no `events` CHECK change.
- No new status. "Blocked" is never stored.
- Do not touch `src/app/task/add-dependency.ts` / `remove-dependency.ts` or
  `assertDependenciesEditable` — task-level sequencing is unchanged.
- Cross-project initiative edges are refused (`SequencingScopeError`), not
  supported.
- Reuse `validateDag` from Story 1. Do not write a second cycle detector.

## Verify

`src/apps/cli/architecture.test.ts` — bump `EXPECTED_LEAF_FILE_COUNT` from `55` to
`59` and `EXPECTED_LEAF_COUNT` from `57` to `61` (`architecture.test.ts:27-31`);
its existing help-completeness assertions then cover the four new leaves'
`description` / `Usage:` / `Example` text.

New test file `src/app/initiative/add-initiative-dependency.test.ts` (in-file
fakes, `node:test` + `node:assert/strict`), asserting:

1. Happy path: two `building` initiatives in one project, no tasks past
   `pending` → `sequencing.addInitiativeAfter` called once with
   `(initiativeId, dependencyId)`; the recording event feed is untouched (no
   event appended); the write happened inside `tx.run` (`txCount === 1`).
2. `resolveKind` returns `undefined` → `UnknownReferenceError`; returns `"task"`
   → `WrongTypeReferenceError`. Both for the `--initiative` id and for the
   `--after` id.
3. Different `projectId`s → `SequencingScopeError` with `scope === "project"`;
   nothing written.
4. `initiativeId === dependencyId` → `CycleError`.
5. Edge already present → resolves without throwing, `addInitiativeAfter` **not**
   called, and the retroactive gate is not consulted (a task in `running` does
   not turn the no-op into an error).
6. Retroactive refusal: the dependent has one `running` and one `completed` task →
   `SequencingLockedError`; `.startedTaskIds` deep-equals both ids **sorted
   ascending**; `.message` contains `has already started` and
   `ordering can no longer be guaranteed`; nothing written.
7. A `pending`-only task list does not trip the gate.
8. Cycle refusal: DAG already holds `A after B`; adding `B after A` throws
   `CycleError` and writes nothing.

`src/app/initiative/remove-initiative-dependency.test.ts`:

9. Removing an existing edge on an all-`pending` initiative calls
   `removeInitiativeAfter` once inside `tx.run`.
10. Removing an absent edge resolves, writes nothing, and does **not** throw even
    when a task is `running` (no-op precedes the gate).
11. Removing an existing edge when a task is `running` throws
    `SequencingLockedError`.

`src/app/objective/add-objective-dependency.test.ts` and
`remove-objective-dependency.test.ts` — the same 1-11 matrix at objective scope,
with `SequencingScopeError.scope === "initiative"` for objectives in different
initiatives, and the gate scoped to `listTasksByObjective`.

`src/app/initiative/create-initiative.test.ts` / `create-objective.test.ts` — add:

12. `--after` absent → behaviour identical to today (existing tests pass
    unchanged, no `sequencing` call).
13. `after: ["B","A","B"]` → `addInitiativeAfter` called exactly twice, with
    `A` before `B` (deduped + sorted ascending); assert the exact recorded call
    order.
14. `after` naming an initiative in another project → `SequencingScopeError`,
    and the initiative row is **not** left behind (both writes are in one
    `tx.run`).
15. `after` naming a non-existent id → `UnknownReferenceError`.

`src/apps/cli/commands/mutation.test.ts` — following the
`capture()` + `parseAsync([...], { from: "user" })` convention at
`mutation.test.ts:202-248`:

16. `buildAddCommand` with `["initiative-dependency","--initiative","i1","--after","i2"]`
    passes `{ initiativeId: "i1", dependencyId: "i2" }` to the use case,
    `cap.out` is `[]`, `cap.err` is
    `["initiative dependency added: i1 after i2\n"]`, exit code `0`.
17. The `objective-dependency` twin passes `{ objectiveId, dependencyId }`.
18. `buildRemoveCommand` for both nouns passes the same inputs and leaves
    `cap.err` `[]`, exit code `0`.
19. Omitting `--after` exits non-zero (commander `requiredOption`).

`src/apps/cli/commands/create.test.ts`:

20. `create initiative --project p --name n --after i1 --after i2` passes
    `after: ["i1","i2"]` through to the use case; omitting `--after` passes `[]`.

`src/apps/cli/error-map.test.ts`:

21. `toResult(new SequencingLockedError("I1", ["T1"]))` returns `exitCode: 1` and
    a single `stderr` line starting `error: ` — it does not re-throw.
22. Same for `SequencingScopeError`.

Commands:

- `node --test src/app/initiative/ src/app/objective/ src/apps/cli/commands/mutation.test.ts src/apps/cli/commands/create.test.ts src/apps/cli/architecture.test.ts src/apps/cli/error-map.test.ts`
- `npm run verify` exits 0

Proof: delivers steps 1 (`add initiative-dependency` on already-existing
initiatives), 5 (the retroactive refusal and its two message fragments) and 6
(cycle refusal).
