# Story 3 — the projection opens, refreshes and closes occurrences

Epic: `.agent/plan/epics/026.8-decision-identity-and-inbox.md`
Depends on: Story 1, Story 2.

## Change

1. **Verdict-event query** — add a method to `SqliteEventFeed` in
   `src/events/sqlite.ts`, immediately after
   `#latestActionableEventIdsByElement` (`:247-269`), copying its shape (empty
   input → empty map, `COALESCE`, `GROUP BY entity`, absent ids absent from the
   map):

```ts
latestVerdictEventIds(elementIds: readonly string[]): Map<string, string>
```

with the type list pinned to exactly:

```
'task.ready','task.approved','task.rejected','task.discarded','task.abandoned',
'objective.integrated','objective.discarded','initiative.discarded',
'repository.published'
```

Keys are **typed**, never a bare id — a `COALESCE` key would let a task and an
objective with the same textual id consume each other's verdict:

```sql
CASE WHEN taskId       IS NOT NULL THEN 'task:'       || taskId
     WHEN objectiveId  IS NOT NULL THEN 'objective:'  || objectiveId
     WHEN repositoryId IS NOT NULL THEN 'repository:' || repositoryId
     ELSE 'initiative:' || initiativeId END AS key
```

with `MAX(id)` grouped by `key`, `key IN (…)` from the caller's list, and empty
input touching nothing. `src/events/port.ts` is **not** changed — like
`latestActionableEventIds`, this method is consumed structurally.

`repository.published` carries only `repositoryId`
(`src/app/repository/publish-repository.ts:112-115`), which is why a
`publication` item stores `verdictLookupId = <its repository id>` (Story 1) —
the repository id is already in hand in the initiative branch of the walk
(`get-decision-queue.ts:249-259`). Without it a real publish would close the
decision as `expired`, which contradicts epic decision 4.

2. **One reconciler, shared by both reads** — new
   `src/app/project/reconcile-decisions.ts`:

```ts
export class ReconcileDecisions {
  constructor(
    private readonly verdicts: QueueVerdictSource,
    private readonly occurrences: QueueOccurrenceStore,
    private readonly newId: () => string,
  ) {}
  /** Reconciles the given UNFILTERED item set; returns subjectKey -> id. */
  run(items: readonly ReconcileItem[]): ReadonlyMap<string, string>;
}
```

`run` does all of its work inside `this.occurrences.transaction(() => …)`:
`listOpen()` → `reconcileOccurrences(...)` → apply `opened`, `refreshed`,
`closed`. This is not a use case (no `execute`, not reachable from an app or a
route); it is the collaborator both queue reads inject, so `GetDecisionQueue` and
`GetDecision` share one lifecycle rule without one use case calling another.

3. **The item computation moves into a shared collaborator** — new
   `src/app/project/decision-projection.ts`:

```ts
export class DecisionProjection {
  constructor(
    projects: QueueProjectSource,
    initiatives: QueueInitiativeSource,
    tasks: QueueTaskSource,
    publications: QueuePublicationSource,
    activity: QueueActivitySource,
    evidence: QueueEvidenceSource,
    candidates: QueueCandidateSource,
    commitPresence: QueueCommitPresenceSource,
  ) {}
  /** The full, UNFILTERED, unranked decision set plus degradation notices. */
  async project(): Promise<{ items: DecisionItem[]; warnings: string[] }>;
}
```

Move, without behaviour change, out of `get-decision-queue.ts`:

- the eight source interfaces (`:33-68`) and `PendingPresenceCheck` (`:71-76`) —
  re-export the types from `decision-projection.ts` so existing importers keep
  compiling;
- `#rawEvidence` (`:139-155`) and `#resolvePresence` (`:173-223`), including its
  warning string (`:205`);
- the per-project walk and the batched activity call (`:233-356`), ending with
  the concatenated `items` (`:358-361`).

`project()` returns items in the same per-project order as today; it does **not**
rank, count, filter or slice, and it writes nothing.

4. **`GetDecisionQueue` becomes composition + policy** —
   `src/app/project/get-decision-queue.ts`:

- Constructor (`:111-129`) becomes exactly
  `(projection: DecisionProjection, reconciler: ReconcileDecisions)`. The eight
  source parameters are gone — they now belong to `DecisionProjection`.
- `execute` keeps `GetDecisionQueueOutput`, `DEFAULT_LIMIT` (`:94`) and the step
  order pinned in Story 6, starting from
  `const { items, warnings } = await this.#projection.project();`.
- Structural types the reconciler needs (these stay in this story's new files):

```ts
export interface QueueVerdictSource {
  /** keys: `task:<id>` | `objective:<id>` | `initiative:<id>` | `repository:<id>` */
  latestVerdictEventIds(keys: readonly string[]): Map<string, string>;
}
export interface QueueOccurrenceStore {
  listOpen(): DecisionOccurrenceRowLike[];
  open(row: DecisionOccurrenceRowLike): void;
  refresh(
    id: string,
    patch: {
      kind: string;
      projectName: string;
      initiativeName: string | null;
      objectiveName: string | null;
      taskTitle: string | null;
    },
  ): void;
  close(
    id: string,
    patch: {
      state: "resolved" | "expired";
      closedReason: "verdict" | "superseded" | "vanished";
      closingEventId: string | null;
    },
  ): void;
  transaction<T>(fn: () => T): T;
}
```

`DecisionOccurrenceRowLike` is declared in `reconcile-decisions.ts` with the
same 17 fields as `DecisionOccurrenceRow` (`src/storage/port.ts`) — `app/` may
not import an adapter, and every source in this layer is structural.

- In `execute`, after `project()` returns and **before** ranking, run the
  reconcile:

```ts
const idBySubjectKey = this.#reconciler.run(items.map(toReconcileItem));
```

then attach identity to every item:
`id = idBySubjectKey.get(subjectKey(subject))!`, `kind` = the item's machine
kind, `state = "open"`.

- **Reconcile is always over the unfiltered item set** — it runs before Story
  6's filters and before `limit`. A filtered read must never close an occurrence
  the filter hid.
- The machine kind for an item is the `kind` field Story 4 puts on
  `DecisionItem`, produced by `decisionKind` (Story 1). Never cast `kindLabel`.

5. **Wiring** — `src/composition.ts:1025-1056`: the eight adapters currently
   passed to `GetDecisionQueue` move into
   `const decisionProjection = new DecisionProjection(…)`; then

```ts
const decisionReconciler = new ReconcileDecisions(
  { latestVerdictEventIds: (keys) => eventFeed.latestVerdictEventIds(keys) },
  decisionOccurrenceRepository,
  newId,
);
const getDecisionQueue = new GetDecisionQueue(
  decisionProjection,
  decisionReconciler,
);
```

Both `decisionProjection` and `decisionReconciler` are then passed to
`GetDecision` (Story 5) — **no use case receives another use case**, and no
bare method reference is ever injected. Update the comment at `:1020-1024`:
the queue is no longer read-only; it reconciles occurrences.

## Constraints

- The reconcile writes rows only. It appends **no events** and takes no
  `UnitOfWork`.
- The `poison` fakes in `get-decision-queue.test.ts:82-92` prove read-only
  behaviour of the eight existing sources; that must stay true — only the new
  occurrence store may be written to.
- Ranking, `warnings`, evidence and `downstream` behaviour are unchanged. The
  move into `DecisionProjection` is a **pure move**: no logic edit inside the
  walked code, so every existing queue test keeps its expectations.
- `DecisionProjection` and `ReconcileDecisions` are collaborators, not use cases:
  no `execute`, no route, no CLI command reaches them directly.

## Verify

- `node --test src/app/project/reconcile-decisions.test.ts` — `run` performs
  every write inside one `transaction` call (a fake store records the ordering
  and fails the test if a write happens outside it); a store whose `open` throws
  leaves nothing applied; the returned map covers every item's subject key.
- `node --test src/app/project/decision-projection.test.ts` — the existing
  `buildSources` fixture (`get-decision-queue.test.ts:66-190`, including the
  `poison` writes guard) moves here and now builds a `DecisionProjection`;
  `project()` returns the same items and warnings the queue tests asserted before
  the move, and writes nothing.
- `node --test src/app/project/get-decision-queue.test.ts`, now building
  `new GetDecisionQueue(projection, reconciler)` over a fake projection returning
  a fixed item list plus an in-memory occurrence store and verdict source, both
  recording calls. Assertions:
  - a first `execute({})` opens exactly one occurrence per item, and every
    returned item carries that `id`, its `kind`, and `state: "open"`.
  - a second `execute({})` with the same fixture opens nothing and returns the
    **same ids** (stability across recomputation).
  - a fixture whose task is no longer failing closes the occurrence; with a
    verdict event id greater than the bound the close is
    `resolved`/`verdict`/that id, and without one it is
    `expired`/`vanished`/`null`.
  - a subject whose kind changed between calls keeps its id.
  - a subject whose `actionableSince` event changed between calls (retry then
    fail again, with **no** intervening empty read) closes the first occurrence
    `expired`/`superseded` and returns a **new** id.
  - a `publication` item stores `verdictLookupId` = its repository id, and a
    `repository.published` verdict closes it `resolved`/`verdict`.
  - `actionableSince: null` items still get an occurrence (minting on first
    sight).
  - `execute({ kind })` (after Story 6) reconciles over the **unfiltered** set:
    with two items of different kinds and a `kind` filter, neither occurrence is
    closed.
  - `newId` is called exactly once per opened occurrence and not at all on the
    second call.
- `node --test src/events/sqlite.test.ts` — `latestVerdictEventIds([])` is
  empty and touches no statement; a task with `task.failed` then `task.ready`
  returns the `task.ready` id; an element with no verdict event is absent from
  the map; the eight types above are matched and `task.failed` /
  `repository.published` are not.
- `npm run verify` exits 0.
- Proof: phase C (`the id survives recomputation of the projection`) and phase E
  (the close).
