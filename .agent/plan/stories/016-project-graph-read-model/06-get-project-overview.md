# Story 6 — `GetProjectOverview` + `get overview --project <id>`

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: Story 2, Story 3, Story 5, and EPIC 011 story 3 (`events.projectId`).

## Change

### A. `src/events/sqlite.ts` — two more adapter-only read methods

Add to `SqliteEventFeed` beside `latestEventIdByTask` (Story 3 §B). Neither goes
on the `EventFeed` port.

```ts
/** Aggregate over ALL project events after `after` (exclusive). `after` null = from the start. */
countProjectEventsAfter(
  projectId: string,
  after: string | null,
): { totalCount: number; byType: Record<string, number> };

/** One capped page of the same rows, ascending by id. */
readProjectEventsAfter(
  projectId: string,
  after: string | null,
  limit: number,
): Event[];
```

- `countProjectEventsAfter` SQL:
  `SELECT type, COUNT(*) AS c FROM events WHERE projectId = ? AND (? IS NULL OR id > ?) GROUP BY type ORDER BY type ASC`.
  `totalCount` is the sum of `c`. `byType` keys are inserted in ascending type
  order, so the JSON key order is deterministic.
- `readProjectEventsAfter` SQL: the same `WHERE`, plus
  `ORDER BY id ASC LIMIT ?`. Row → `Event` mapping is identical to `readAfter`
  (`src/events/sqlite.ts:51-72`) — extract that mapping into a private helper and
  call it from both, rather than duplicating it.
- `limit` must be a positive integer; otherwise throw `RangeError`, matching
  `readAfter` (`src/events/sqlite.ts:31-33`).

### B. New file `src/app/project/get-project-overview.ts`

Use-case-local structural sources:

```ts
interface OverviewProjectSource {
  get(id: string): Project | undefined;
}
interface OverviewInitiativeSource {
  listInitiatives(projectId: string): Initiative[];
  listObjectives(initiativeId: string): Objective[];
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
}
interface OverviewTaskSource {
  listByInitiative(initiativeId: string): Task[];
  getTaskContext(taskId: string): Record<string, string>;
}
interface OverviewAckSource {
  getAck(projectId: string): string | undefined;
}
interface OverviewEventSource {
  countProjectEventsAfter(
    projectId: string,
    after: string | null,
  ): { totalCount: number; byType: Record<string, number> };
  readProjectEventsAfter(
    projectId: string,
    after: string | null,
    limit: number,
  ): Event[];
  latestProjectEventId(projectId: string): string | undefined;
  latestActionableEventIds(initiativeId: string): Map<string, string>;
}
```

`latestActionableEventIds` is a **third** adapter-only method on
`SqliteEventFeed`, added in this story:

```sql
SELECT type, taskId, objectiveId, MAX(id) AS latest
  FROM events
 WHERE type IN ('task.failed','task.escalated','objective.awaiting_confirmation','objective.conflict')
   AND initiativeId = ?
 GROUP BY type, taskId, objectiveId
```

It returns a `Map` keyed `"<type>:<taskId|objectiveId>"` → latest event id.
Fallback: when `initiativeId` is NULL on those rows, also match by joining through
`taskId`; if the join is unavailable the entry is simply absent and
`actionableSince` becomes `null` (rule 6 below).

### Output type (exact)

```ts
export interface OverviewDecision {
  action: Action;
  initiativeId: string;
  objectiveId: string | null;
  taskId: string | null;
  downstream: number;
  actionableSince: number | null;
}

export interface GetProjectOverviewOutput {
  projectId: string;
  initiatives: Array<{
    id: string;
    name: string;
    status: InitiativeStatus;
    paused: boolean;
    taskCounts: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
      awaiting_confirmation: number;
      discarded: number;
    };
    needsHuman: number;
    action: Action | null;
  }>;
  lanes: Array<{
    repositoryId: string | null;
    objectiveIds: string[];
    initiativeIds: string[];
  }>;
  decisions: OverviewDecision[];
  digest: {
    since: string | null;
    latest: string | null;
    totalCount: number;
    byType: Record<string, number>;
    events: Event[];
    hasMore: boolean;
    pageCursor: string | null;
  };
}
```

### Pinned rules

1. `projects.get(projectId) === undefined` → throw
   `new UnknownReferenceError("project", projectId)`.
2. `initiatives` order = `listInitiatives(projectId)` order, unchanged.
   `paused` from `listAllInitiatives()`, `false` when absent — same reader as
   Story 3 rule 4.
3. `taskCounts` per initiative from `listByInitiative(id)`. `needsHuman` = the
   number of that initiative's **nodes plus groups** whose action is non-null,
   computed with `nodeAction` / `groupAction` from Story 2 over the same facts
   Story 3 assembles. Node facts need `blockedForever` and `deadDependencyId`, so
   call `permanentlyBlockedTasks` and `unsatisfiedTaskEdges` (Story 1) per
   initiative.
4. `initiatives[].action` = `initiativeAction` (Story 2) with `publication: null`.
   The overview does not resolve publication state; `get graph` does. Pinned so the
   two calls cannot disagree by accident: a `publish` action appears only in the
   graph payload.
5. `decisions` = one entry per non-null action found in rule 3, across all
   initiatives. `objectiveId` and `taskId` are set from the action's target:
   `target.type === "task"` → `taskId = target.id`, `objectiveId` = that task's
   `objectiveId`; `target.type === "objective"` → `objectiveId = target.id`,
   `taskId = null`; `target.type === "initiative"` → both `null`.
   `downstream` = `dependentClosure(nodes, taskId).length` for task targets, and
   for an objective target the **sum** of `dependentClosure` counts over that
   objective's own tasks. For an initiative target, `0`.
6. `actionableSince` = `eventTimeMs(id)` where `id` comes from
   `latestActionableEventIds(initiativeId)` using the key matching the action:
   `retry` → `task.failed:<taskId>`; `approve` on a task →
   `task.escalated:<taskId>`; `approve` on an objective →
   `objective.awaiting_confirmation:<objectiveId>`; `retry` on an **objective**
   (the conflict verdict — **AMENDED**, formerly `resolve-conflict`) →
   `objective.conflict:<objectiveId>`; `remove-dependency` and
   `resume-initiative` → `null` (no event marks them). Absent key → `null`.
   **Never** derive it from the entity ULID — a task id can be days older than its
   failure.
7. `decisions` sort, in this exact order: `downstream` **descending**; then
   `actionableSince` **ascending** with `null` last (longest-waiting first); then
   `taskId ?? objectiveId ?? initiativeId` **ascending**. Total order, so the
   result is deterministic.
8. `lanes`: group objectives by their repository set. For each objective compute
   its repositories exactly as Story 3 rule 16. Emit one lane per **distinct
   single** repository id, plus one lane with `repositoryId: null` collecting
   objectives that name none. An objective naming two repositories appears in the
   lane of **each** repository it names. Lanes sorted by `repositoryId` ascending
   with the `null` lane last; `objectiveIds` and `initiativeIds` ascending and
   deduplicated.
9. `digest.since` = `acks.getAck(projectId) ?? null`.
   `digest.latest` = `events.latestProjectEventId(projectId) ?? null`.
   `totalCount` / `byType` = `countProjectEventsAfter(projectId, since)`.
   `events` = `readProjectEventsAfter(projectId, since, DIGEST_PAGE_LIMIT)`.
   `hasMore` = `totalCount > events.length`. `pageCursor` = the last returned
   event's id, or `null` when `events` is empty.
10. `DIGEST_PAGE_LIMIT` is a named exported constant in the same module, value
    **50**. `totalCount` and `byType` are aggregates over **all** matching rows and
    must not be recomputed from the capped `events` array.

### C. CLI leaf

New handler `runGetProjectOverview` appended to `src/apps/cli/project.ts`, same
shape as `runGetInitiativeGraph` (Story 4 §A): `args["project"]` → the use case's
`projectId`; `--json` emits `JSON.stringify(output)`.

Text mode line order:

1. `project: <projectId>`
2. `since: <since|never acknowledged>`
3. `activity: <totalCount> event(s)` and, when `hasMore`, ` (showing <n>)`
4. one `initiative <id> <name> [<status>] paused=<bool> needs-human=<n>` line per
   initiative, in order
5. one `lane <repositoryId|-> objectives=<n>` line per lane
6. one `decision <action.kind> <target.type>:<target.id> down=<n>` line per
   decision, in ranked order

New leaf `src/apps/cli/commands/get/overview.ts`, copying
`src/apps/cli/commands/get/initiative.ts`:

```ts
new Command("overview")
  .description("Get a project's initiative overview and activity digest.")
  .configureHelp({ commandUsage: () => "kanthord get overview" })
  .requiredOption("--project <id>", "ID of the project to summarise")
  .option("--json", "print the overview as JSON")
  .addHelpText(
    "after",
    "\nExample:\n  kanthord get overview --project project-1 --json\n",
  );
```

Register in `src/apps/cli/commands/get.ts` (import after Story 4's line,
`addCommand` after Story 4's line). Add `getProjectOverview: GetProjectOverview;`
to `CliDeps`. Wire in `src/composition.ts` beside `getInitiativeGraph` (Story 3 §D)
and add it to the returned bundle.

### D. Bump the architecture counters

- `src/apps/cli/architecture.test.ts:28` — `EXPECTED_LEAF_FILE_COUNT` **67 → 68**.
- `src/apps/cli/architecture.test.ts:33` — `EXPECTED_LEAF_COUNT` **70 → 71**.

## Constraints

- Read-only: no `setAck`, no `append`, no `save*`. `GetProjectOverview` must never
  advance the cursor — that is Story 5's `AckProject` alone.
- `byType` keys come from the SQL `GROUP BY … ORDER BY type ASC`, not from a
  client-side object literal, so key order is stable across runs.
- Do not reuse `ListEvents` (`src/app/task/list-events.ts`): its cursor is a
  required non-null string and it has no project scope.
- Do not compute `actionableSince` from any entity id.

## Verify

`node --test src/app/project/get-project-overview.test.ts` — new file, fakes only:

- unknown project id throws `UnknownReferenceError` with `kind === "project"`.
- `initiatives` order equals the source order; `paused` defaults to `false` when
  absent from `listAllInitiatives()`.
- `taskCounts` exact object equality on a fixture with one task in each of the six
  statuses.
- `needsHuman` counts nodes **and** groups: a fixture with one `failed` task and
  one `awaiting_confirmation` objective reports `2`.
- `initiatives[].action` for a paused initiative is `resume-initiative`, and is
  **never** `publish` even when the initiative is `landed` (rule 4).
- `decisions` ranking: three decisions with `downstream` 5/2/2, where the two ties
  have `actionableSince` 1000 and 2000 → order is `[down5, since1000, since2000]`.
- `decisions` ranking: a `null` `actionableSince` sorts after a non-null one at the
  same `downstream`.
- `decisions` ranking: a full three-way tie is broken by ascending id.
- `actionableSince` comes from the event, not the entity: a task whose id encodes
  an old time but whose `task.failed` event id encodes a recent time reports the
  **recent** value.
- `actionableSince` is `null` for a `remove-dependency` decision.
- `lanes`: an objective naming two repositories appears in both lanes; an objective
  naming none lands in the `repositoryId: null` lane, which sorts last.
- `digest.since` is `null` with no stored ack, and equals the stored ack otherwise.
- `digest`: `totalCount` 120 with `DIGEST_PAGE_LIMIT` 50 → `events.length === 50`,
  `hasMore === true`, `pageCursor` equals the 50th event's id, and `byType` sums to
  **120**, not 50. This is the aggregate-vs-page assertion.
- `digest`: `totalCount` 0 → `events: []`, `hasMore: false`, `pageCursor: null`.
- **no writes**: fakes throw on `setAck`, `append`, `save`, `saveObjective`.

`node --test src/events/sqlite.test.ts` — add:

- `countProjectEventsAfter` with `after: null` counts all of that project's events
  and excludes another project's; `byType` key order is ascending.
- `countProjectEventsAfter` with a mid-feed cursor is exclusive of that cursor.
- `readProjectEventsAfter` returns ascending ids, respects `limit`, and steps past
  another project's interleaved events.
- `readProjectEventsAfter` with a non-positive or non-integer `limit` throws
  `RangeError`.
- `latestActionableEventIds` returns the maximum id per `(type, entity)` pair and
  omits types outside the four-type list.

`node --test src/apps/cli/get-project-overview.test.ts` — handler tests: `--json`
round-trip, text-mode line order, `since: never acknowledged` when `since` is
`null`, and the unknown-project error path returning `exitCode: 1`.

`node --test src/apps/cli/commands/read.test.ts` — `["overview", "--project",
"p-1", "--json"]` passes `{ projectId: "p-1" }` to the fake use case.

`node --test src/apps/cli/architecture.test.ts` — passes with 68/71.

`npm run verify` exits 0.

Proof: delivers phase **H** in full, and contributes to phase **I**.
