# Story 3 — Readiness gate at both enqueue sites

Epic: `.agent/plan/epics/007.17-follow-up-sequencing-edges.md`
Depends on: Story 1 (`unsatisfied*Edges`), Story 2 (`SequencingRepository`)

## Change

### 3a. `src/app/task/enqueue-ready-tasks.ts`

Extend the two local structural interfaces (`enqueue-ready-tasks.ts:8-14`) and add
a third:

```ts
interface InitiativeSource {
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
  get(id: string): { status?: InitiativeStatus } | undefined;
  getObjective(id: string): { status?: ObjectiveStatus } | undefined;
}

interface TaskSource {
  listByInitiative(initiativeId: string): Task[];
}

interface SequencingSource {
  listInitiativeAfter(initiativeId: string): string[];
  listObjectiveAfter(objectiveId: string): string[];
}
```

`SqliteInitiativeRepository` already has `get` and `getObjective`
(`sqlite-initiative-repository.ts:45`, `:95`), so the composition wiring keeps
passing `initiativeRepository` unchanged.

Add `sequencing: SequencingSource` as the **last** positional constructor
parameter (after `uow`), stored as `readonly #sequencing: SequencingSource`.

Replace the body of the `for (const initiative of initiatives)` loop
(`enqueue-ready-tasks.ts:41-53`) with exactly this shape:

```ts
for (const initiative of initiatives) {
  if (initiative.paused) continue;

  // Initiative-level gate: every `after` prerequisite must be `landed`.
  const initAfter = this.#sequencing
    .listInitiativeAfter(initiative.id)
    .map((id) => ({ id, status: this.#initSrc.get(id)?.status }));
  if (unsatisfiedInitiativeEdges(initAfter).length > 0) continue;

  const tasks = this.#taskSrc.listByInitiative(initiative.id);

  // Objective-level gate: every `after` prerequisite must be `integrated`.
  const blockedObjectives = new Set<string>();
  for (const objectiveId of new Set(tasks.map((t) => t.objectiveId))) {
    const objAfter = this.#sequencing
      .listObjectiveAfter(objectiveId)
      .map((id) => ({
        id,
        status: this.#initSrc.getObjective(id)?.status,
      }));
    if (unsatisfiedObjectiveEdges(objAfter).length > 0) {
      blockedObjectives.add(objectiveId);
    }
  }

  const objectiveOf = new Map(tasks.map((t) => [t.id, t.objectiveId]));

  const entries = readiness(tasks);
  for (const entry of entries) {
    if (entry.state !== "ready") continue;
    const objectiveId = objectiveOf.get(entry.id);
    if (objectiveId !== undefined && blockedObjectives.has(objectiveId)) {
      continue;
    }
    const inserted = this.#queue.enqueue(entry.id);
    if (inserted) {
      this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
      enqueued.push(entry.id);
    }
  }
}
```

Import `unsatisfiedInitiativeEdges`, `unsatisfiedObjectiveEdges` from
`../../domain/sequencing.ts`, and `InitiativeStatus` / `ObjectiveStatus` as
`import type` from `../../domain/initiative.ts`.

**Determinism, pinned:** initiative order = `listAllInitiatives()` order
(`SELECT id, paused FROM initiatives`); objective set iteration =
first-appearance order in `listByInitiative`; task order = `readiness(tasks)`
order, which is `tasks` input order (`graph.ts:193`). A gated task is skipped —
it is **not** enqueued and **no** `task.ready` event is appended for it.

### 3b. `src/app/task/run-next-task.ts` — the inline re-scan

Two byte-identical re-scan blocks exist: `run-next-task.ts:257-268` (completed
branch) and `:333-344` (candidate-completes-directly branch). Replace **both**
with a single call to one new private method:

```ts
  /**
   * Re-scan the initiative for newly-ready tasks, skipping tasks whose objective
   * has an unsatisfied `after` set — a completing task must not unblock work in a
   * still-blocked objective.
   */
  #enqueueNewlyReady(initiativeId: string | undefined): void {
    const refreshed = initiativeId
      ? this.#store.listByInitiative(initiativeId)
      : [];
    const blockedObjectives = new Set<string>();
    for (const objectiveId of new Set(refreshed.map((t) => t.objectiveId))) {
      const after = (this.#store.listObjectiveAfter?.(objectiveId) ?? []).map(
        (id) => ({ id, status: this.#store.getObjective?.(id)?.status }),
      );
      if (unsatisfiedObjectiveEdges(after).length > 0) {
        blockedObjectives.add(objectiveId);
      }
    }
    const objectiveOf = new Map(refreshed.map((t) => [t.id, t.objectiveId]));
    for (const entry of readiness(refreshed)) {
      if (entry.state !== "ready") continue;
      const objectiveId = objectiveOf.get(entry.id);
      if (objectiveId !== undefined && blockedObjectives.has(objectiveId)) {
        continue;
      }
      const inserted = this.#queue.enqueue(entry.id);
      if (inserted) {
        this.#feed.append(newEvent("task.ready", { taskId: entry.id }));
      }
    }
  }
```

Call site in both branches, keeping the existing comment line:

```ts
// Re-scan the initiative for newly-ready tasks.
this.#enqueueNewlyReady(initiativeId);
```

Add one member to the `TaskStore` structural interface (`run-next-task.ts:23-37`),
**optional** so the existing in-file fakes (`SimpleTaskStore`,
`run-next-task.test.ts:46-117`) keep conforming:

```ts
  listObjectiveAfter?(objectiveId: string): string[];
```

`getObjective?(id)` already exists at `run-next-task.ts:34`. When
`listObjectiveAfter` is absent the gate degrades to "no edges" — identical to
today's behaviour, so no existing test changes.

### 3c. `src/app/task/approve-task.ts` — the third re-scan

`approve-task.ts:359-371` is a **full-initiative re-scan of the same shape** as the
two above:

```ts
      const initiativeId = this.#store.getInitiativeId(taskId);
      const allTasks = initiativeId
        ? this.#store.listByInitiative(initiativeId)
        : [];
      for (const entry of readiness(allTasks)) {
        if (entry.state === "ready") { … }
      }
```

Ungated, `approve task` on a task in objective O1 enqueues ready tasks in a
sibling objective O2 whose `after` set is unsatisfied — which makes the epic's own
claim ("the daemon must NOT enqueue B's task while A is still building",
epic:99) false through a command the Proof itself drives.

Apply the identical objective gate: compute `blockedObjectives` from
`this.#store.listObjectiveAfter?.(objectiveId) ?? []` +
`this.#store.getObjective?.(id)?.status`, then `continue` on a gated task —
exactly as `#enqueueNewlyReady` does in 3b. `ApproveTask` reads through its own
local store interface; add the same two optional members
(`listObjectiveAfter?`, `getObjective?`) there, and add the two delegating
entries to whichever composition literal builds `approveTask`
(`src/composition.ts:292-312` region).

**Not in scope** (verified as _not_ the same defect):

- `retry-task.ts:120-123` and `:137-140` call `this.#queue.enqueue(taskId)` — the
  retried task itself only. No `listByInitiative`, no `readiness`. Retrying one
  named failed task is a targeted human action, not a daemon re-scan.
- `recover-interrupted-tasks.ts:40-43` re-enqueues `job.taskId` for jobs already
  in `listRunningJobs()`. A running job's objective was necessarily unblocked when
  it was claimed.

### 3d. Composition — `src/composition.ts`

At `composition.ts:373-379` append the new argument:

```ts
const enqueueReady = new EnqueueReadyTasks(
  initiativeRepository,
  taskRepository,
  jobQueue,
  events,
  unitOfWork,
  sequencingRepository,
);
```

In the `taskStoreWithObjectives` literal (`composition.ts:391-407`) add:

```ts
        listObjectiveAfter: (objectiveId: string) =>
          sequencingRepository.listObjectiveAfter(objectiveId),
```

## Constraints

- Do not change `readiness()` (`src/domain/graph.ts:186-207`) — task-level
  sequencing is a Non-goal.
- No new status is stored. A gated task stays `pending`; a gated initiative /
  objective stays `building`.
- A `discarded` prerequisite blocks forever and does **not** cascade: no status
  transition, no event, no throw — the dependent's tasks simply stay `pending`.
- Everything stays inside the single existing `uow.transaction` in
  `EnqueueReadyTasks` and inside `tx2` in `RunNextTask`. Do not add a transaction.
- Out of scope (do not touch): `retry-task.ts:120-123`/`:137-140` and
  `recover-interrupted-tasks.ts:40-43` — verified in 3c as a different shape, not
  ungated re-scans.

## Verify

`src/app/task/enqueue-ready-tasks.test.ts` — add `get` / `getObjective` to the
local `InitiativeSource` and to `makeInitSrc` (`:109-117`), add a
`makeSequencingSource(initAfter, objAfter)` factory returning a
`SequencingSource`, thread it through all five existing tests as an empty-edge
source (proving no behaviour change), then add:

1. Initiative B has `after: [A]` and A is `building` → B's ready task is **not**
   enqueued (`assert.ok(!queue.enqueued.includes(...))`) and **no** `task.ready`
   event is appended for it (`feed.events` contains no entry with that `taskId`).
2. Same graph, A is `landed` → B's ready task **is** enqueued and one
   `task.ready` event is appended.
3. A is `discarded` → B's ready task is still not enqueued, B's task status is
   untouched (`pending`), and no event is appended (blocks, does not cascade).
4. Objective O2 has `after: [O1]`, O1 is `awaiting_confirmation` → O2's ready
   task is not enqueued, while a ready task belonging to sibling objective O1 in
   the same initiative **is** enqueued (the gate is per-objective, not
   per-initiative).
5. Same graph, O1 is `integrated` → O2's ready task is enqueued.
6. A paused initiative is still skipped before any edge lookup: with
   `paused: true` and no edges, `sequencing.listInitiativeAfter` is never called
   (record calls on the fake and assert the recorded list is empty).
7. `uow.txCount === 1` for every case above (the gate added no transaction).
8. Determinism: two initiatives each with two ready tasks and no edges →
   `execute()` returns the ids in `listAllInitiatives` order then task order;
   assert the exact array, and assert two successive fresh runs over the same
   seed produce the identical array.

`src/app/task/run-next-task.test.ts` — add:

9. A completing task whose initiative holds a second objective O2 with
   `after: [O1]` (O1 `building`): after `execute()`, O2's pending task is **not**
   in `queue.enqueued` and no `task.ready` event carries its id.
10. Same setup with O1 `integrated`: O2's pending task **is** enqueued with a
    `task.ready` event.
11. Regression: the existing test at `run-next-task.test.ts:298-327`
    (parent completes → child enqueued) passes unchanged with a `SimpleTaskStore`
    that does not implement `listObjectiveAfter`.
12. The candidate-completes-directly branch (the second former re-scan site) is
    gated too: drive the branch that previously used `run-next-task.ts:333-344`
    with a blocked O2 and assert its task is not enqueued.

`src/app/task/failure-semantics.test.ts` style, new integration test in
`src/app/task/sequencing-gate.integration.test.ts` (real SQLite + real
`SqliteSequencingRepository` + `FakeRunner`):

13. Two initiatives A and B in one project, B `after: [A]`, each with one
    zero-dependency task. `runUntilIdle` → A's task reaches a terminal state and
    B's task is still `pending`; the `events` table holds **zero** `task.ready`
    rows for B's task id.
14. Then transition A to `landed` and `runUntilIdle` again → B's task is
    `completed` and exactly one `task.ready` row exists for it.

`src/app/task/approve-task.test.ts` — add:

15. Approving a task in objective O1 does **not** enqueue a ready task in sibling
    objective O2 when O2's `after` set is unsatisfied, and appends no
    `task.ready` event for it.
16. With O2's prerequisite `integrated`, the same approval **does** enqueue O2's
    ready task.
17. Regression: an approval in an initiative with no sequencing edges enqueues
    newly-ready dependents exactly as today (existing tests pass unchanged with a
    store that implements neither optional member).

Commands:

- `node --test src/app/task/enqueue-ready-tasks.test.ts src/app/task/run-next-task.test.ts src/app/task/approve-task.test.ts src/app/task/sequencing-gate.integration.test.ts`
- `npm run verify` exits 0

Proof: delivers steps 3, 4 and 8 (`BTASK` stays `pending` with no `task.ready`
event while A is `building`; becomes `completed` once A is `landed`; `T2` stays
`pending` until `O1` is `integrated`).
