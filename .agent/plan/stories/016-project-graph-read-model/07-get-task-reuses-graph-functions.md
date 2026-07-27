# Story 7 — `get task` reuses the same functions (no second copy of the rules)

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: Story 1, Story 2.

## Change

### A. `src/app/task/get-task.ts`

Extend the existing local sources (lines 6-20) with what the new fields need:

- `TaskSource` (line 6-8) gains `listByInitiative(initiativeId: string): Task[];`
  and `getInitiativeId(taskId: string): string | undefined;` — both already exist
  on `SqliteTaskRepository` (`listByInitiative` at `sqlite-task-repository.ts:317`,
  `getInitiativeId` on the port at `src/storage/port.ts:118`), so
  `composition.ts:372-377` keeps passing `taskRepository` unchanged.
- Add a new local source:
  ```ts
  interface ObjectiveStatusSource {
    getObjective(id: string): { status?: ObjectiveStatus } | undefined;
  }
  ```
  passed as a **fifth, optional** constructor parameter, after `landing`.

Extend `GetTaskOutput` (lines 29-44) with exactly four fields:

```ts
  waiting: UnsatisfiedEdge[];
  blockedForever: boolean;
  downstream: number;
  action: Action | null;
```

Assembly, pinned:

1. `const initiativeId = this.#tasks.getInitiativeId(id)`. When it is `undefined`,
   the task has no readable initiative: set `waiting: []`,
   `blockedForever: false`, `downstream: 0`, `action` computed with
   `blockedForever: false` and `deadDependencyId: null`. Do **not** throw.
2. Otherwise `const siblings = this.#tasks.listByInitiative(initiativeId)`, mapped
   to `TaskEdgeNode`s. `waiting` = `unsatisfiedTaskEdges(siblings).get(id) ?? []`;
   `blockedForever` = `permanentlyBlockedTasks(siblings).has(id)`;
   `downstream` = `dependentClosure(siblings, id).length`.
3. `action` = `nodeAction({ taskId: id, status: task.status,
objectiveId: task.objectiveId,
objectiveStatus: objectives?.getObjective(task.objectiveId)?.status,
blockedForever, deadDependencyId })`, where `deadDependencyId` is the first
   entry of `waiting` with `neverSatisfies === true`, else `null`.
4. When the optional `objectives` source is absent, `objectiveStatus` is
   `undefined` — `nodeAction` rules 4 and 5 then cannot fire, and the result is
   `null` for a completed task. That is the documented degraded shape for callers
   that do not inject it; `composition.ts` **must** inject it.
5. Keep `dependencyStatus` (lines 79-86) exactly as it is. It is a different
   shape (`{id, status}` with `"unknown"` fallback) and existing tests assert it.

### B. `src/composition.ts` — inject the fifth argument

At `src/composition.ts:372-377`, add the fifth argument:

```ts
const getTask = new GetTask(
  taskRepository,
  taskRepository,
  taskRepository,
  landingRepository,
  { getObjective: (id) => initiativeRepository.getObjective(id) },
);
```

An arrow wrapper, never a bare `initiativeRepository.getObjective` reference — an
unbound method loses `this` and crashes on the adapter's `#private` fields
(AGENTS.md).

## Constraints

- This is the story that closes the divergence risk: `get task` and `get graph`
  must produce **identical** `waiting`, `blockedForever`, `downstream` and `action`
  values for the same task. No second implementation of any rule — import from
  `src/domain/sequencing.ts`, `src/domain/graph.ts` and
  `src/domain/actionability.ts` only.
- Do not remove or rename any existing `GetTaskOutput` field. `src/apps/cli/task.ts`
  (`runGetTask`, lines 250-330) and its tests read them.
- `src/apps/cli/task.ts` text output: append the new fields as additional lines
  after the existing block (line 304-309 onwards) — `blocked forever: yes
(dependency <id> can never clear)` only when `blockedForever` is `true`, and
  `action: <kind> <target.type>:<target.id>` only when `action !== null`. Do not
  reorder or reword the existing lines; `src/apps/cli/task.test.ts` asserts them.

## Verify

`node --test src/app/task/get-task.test.ts` — add to the existing file:

- a `pending` task whose only dependency is `completed` → `waiting: []`,
  `blockedForever: false`, `action: null`.
- a `pending` task whose dependency is `pending` → one `waiting` entry with
  `neverSatisfies: false`, `blockedForever: false`.
- a `pending` task whose dependency is `discarded` → `waiting[0].neverSatisfies:
true`, `blockedForever: true`, `action.kind === "remove-dependency"` with
  `targetDependencyId` equal to the discarded id.
- a `failed` task → `action.kind === "retry"`.
- a `completed` task whose objective is `awaiting_confirmation` →
  `action.kind === "approve"` and `action.target` is
  `{type:"objective", id:<objectiveId>}`.
- `downstream` equals the dependent-closure size (root with three dependents → 3).
- `getInitiativeId` returning `undefined` → `waiting: []`, `blockedForever: false`,
  `downstream: 0`, and no throw.
- the optional `objectives` source omitted → a completed task under an awaiting
  objective yields `action: null` (documented degraded shape).
- every pre-existing assertion in the file still passes unchanged, including
  `dependencyStatus`.

`node --test src/app/initiative/get-initiative-graph.test.ts` — add one
**cross-check** test: for a single fixture graph, build both `GetTask` and
`GetInitiativeGraph` over the same fakes and assert that, for every task id, the
graph node's `waiting`, `blockedForever`, `downstream` and `action` deep-equal
`GetTask`'s. This is the regression guard against two divergent copies.

`node --test src/apps/cli/task.test.ts` — the new text lines appear only in the
conditions above, and every existing assertion still passes.

`npm run verify` exits 0.

Proof: no dedicated phase. Story 7 is asserted by the cross-check test above, and
Proof phase **F** reads `get task --json`'s `result.proposalCommit` to confirm the
graph's `candidate.candidateSHA` is not invented.
