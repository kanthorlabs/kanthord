# Story 3 — `GetInitiativeGraph` use case

Epic: `.agent/plan/epics/016-project-graph-read-model.md`
Depends on: Story 1, Story 2.

## Change

### A. `src/domain/event.ts` — append at end of file

```ts
import { decodeTime } from "ulid";

/** Milliseconds encoded in an event's ULID. `events` has no timestamp column. */
export function eventTimeMs(eventId: string): number;
```

Returns `decodeTime(eventId)`. The `ulid` package is already a direct dependency
(`package.json:41`) and is already imported inside `src/domain/`
(`src/domain/entity.ts:1`). Keeping this in `domain/` keeps `app/` free of the
dependency.

### B. `src/events/sqlite.ts` — add one adapter-only read method

Add to `SqliteEventFeed` (after `readAfter`, which ends at line 73). It is **not**
added to the `EventFeed` port — the port stays `append` + `readAfter`
(`src/events/port.ts:10-13`). This mirrors `getTaskResult`, which lives only on
`SqliteTaskRepository` (`src/storage/sqlite/sqlite-task-repository.ts:531`) and is
consumed through a use-case-local structural interface.

```ts
/** Latest event id per task id, for the given task ids. Missing tasks are absent. */
latestEventIdByTask(taskIds: readonly string[]): Map<string, string>;
```

SQL: `SELECT taskId, MAX(id) AS latest FROM events WHERE taskId IN (…) GROUP BY taskId`.
Build the `IN` list with one `?` placeholder per id. `taskIds` empty → return an
empty `Map` **without** touching the database.

### C. New file `src/app/initiative/get-initiative-graph.ts`

Declare use-case-local structural sources, exactly mirroring the pattern at
`src/app/task/get-task.ts:6-20` (never import `storage/port.ts` interfaces
wholesale):

```ts
interface GraphTaskSource {
  listByInitiative(initiativeId: string): Task[];
  getTaskContext(taskId: string): Record<string, string>;
}
interface GraphResultSource {
  getTaskResult(taskId: string): TaskResultRow | undefined;
}
interface GraphInitiativeSource {
  get(id: string): Initiative | undefined;
  listObjectives(initiativeId: string): Objective[];
  listAllInitiatives(): Array<{ id: string; paused: boolean }>;
}
interface GraphSequencingSource {
  listObjectiveAfter(objectiveId: string): string[];
}
interface GraphLandingSource {
  getCandidateByTask(taskId: string): ChangeCandidate | undefined;
}
interface GraphActivitySource {
  latestEventIdByTask(taskIds: readonly string[]): Map<string, string>;
}
interface GraphPublicationSource {
  getPublication(
    repoId: string,
    branch: string,
  ):
    | {
        state: "unpublished" | "published" | "diverged";
        remoteOID: string | null;
      }
    | undefined;
}
```

Constructor takes, in this order: `tasks: GraphTaskSource`,
`results: GraphResultSource`, `initiatives: GraphInitiativeSource`,
`sequencing: GraphSequencingSource`, `landing: GraphLandingSource`,
`activity: GraphActivitySource`, `publications: GraphPublicationSource`,
`repositoryBranch: (repositoryId: string) => string | undefined`.

`execute({ id }: { id: string }): Promise<GetInitiativeGraphOutput>`.

### Output type (exact)

```ts
export interface GraphNodeOutput {
  id: string;
  groupId: string;
  title: string;
  status: TaskStatus;
  dependencyState: "ready" | "blocked";
  executionState: "runnable" | "paused";
  dependencies: string[];
  waiting: UnsatisfiedEdge[];
  blockedForever: boolean;
  downstream: number;
  lastEventId: string | null;
  lastEventAtMs: number | null;
  agent: string | null;
  instructions: string | null;
  ac: string[];
  verificationRequested: string[];
  verificationResults: Array<{
    command: string;
    exitCode: number;
    output: string;
  }>;
  failureReason: string | null;
  rejection: { resolution: string; reason: string | null } | null;
  produced: { summary: string | null; evidenceCount: number } | null;
  note: string | null;
  candidate: {
    candidateSHA: string;
    baseSHA: string | null;
    target: string | null;
    state: "pending" | "landed" | "conflict" | null;
    source: "landing_candidate" | "task_result";
  } | null;
  action: Action | null;
}

export interface GraphGroupOutput {
  id: string;
  name: string;
  status: ObjectiveStatus;
  repositories: string[];
  commitOid: string | null;
  conflictReason: string | null;
  after: string[];
  waiting: UnsatisfiedEdge[];
  action: Action | null;
}

export interface GetInitiativeGraphOutput {
  projectId: string;
  initiative: {
    id: string;
    name: string;
    status: InitiativeStatus;
    paused: boolean;
    branch: string;
    action: Action | null;
  };
  groups: GraphGroupOutput[];
  nodes: GraphNodeOutput[];
  edges: Array<{ from: string; to: string }>;
  criticalPath: RemainingChain;
  counts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    awaiting_confirmation: number;
    discarded: number;
    blocked: number;
    blockedForever: number;
    actionable: number;
  };
}
```

### Assembly rules — all pinned, no build-time choices

1. `initiatives.get(id)` returns `undefined` → throw
   `new UnknownReferenceError("initiative", id)` from `src/domain/errors.ts:19`.
   Its message is `no initiative with id <id>` (`src/domain/errors.ts:24`), which
   Proof phase A greps for. Do **not** invent a new error.
2. `projectId` = `initiative.projectId`. `branch` = `` `kanthord/init/${id}` ``,
   the same convention as `src/app/initiative/get-initiative.ts:52`.
3. `initiative.status` = `initiative.status ?? "building"`.
4. `paused` = the `paused` value of the entry with a matching `id` in
   `initiatives.listAllInitiatives()`; `false` when absent. There is **no**
   per-initiative paused read on the port — `listAllInitiatives()` is the only
   reader, exactly as `src/app/task/enqueue-ready-tasks.ts:58-60` uses it. Do
   **not** add a port method and do **not** add `paused` to the `Initiative`
   entity.
5. **Node order** = `tasks.listByInitiative(id)` order, unchanged. That adapter is
   `ORDER BY t.id ASC` (`src/storage/sqlite/sqlite-task-repository.ts:324`). Never
   re-sort.
6. **Group order** = `initiatives.listObjectives(id)` order, unchanged
   (`ORDER BY id ASC`, `src/storage/sqlite/sqlite-initiative-repository.ts:139`).
7. **Edges**: for each node in node order, for each `d` in `node.dependencies`
   order, push `{ from: d, to: node.id }`. `from` is the **dependency**, `to` is
   the **dependent**. No dedup, no sort.
8. `waiting` per node = `unsatisfiedTaskEdges(nodes)` (Story 1) looked up by id.
   `blockedForever` = `permanentlyBlockedTasks(nodes).has(node.id)`.
9. `dependencyState` = `"blocked"` when `waiting.length > 0`, else `"ready"`.
10. `executionState` = `"paused"` when the initiative's `paused` is `true`, else
    `"runnable"` — for every node, regardless of status.
11. `downstream` = `dependentClosure(nodes, node.id).length`
    (`src/domain/graph.ts:157`).
12. `criticalPath` = `longestRemainingChain(nodes)` (Story 1).
13. `lastEventId` from `activity.latestEventIdByTask(allTaskIds)`; `null` when
    absent. `lastEventAtMs` = `eventTimeMs(lastEventId)` or `null`.
14. Detail fields, from the sources named — **not** from events:
    - `agent`, `instructions`, `note` → the `Task` fields, `?? null`.
    - `ac` → `task.ac ?? []`. `verificationRequested` → `task.verification ?? []`.
    - **`verificationResults` = `taskResult.evidence ?? []`.** Per-command
      outcomes (`command`, `exitCode`, `output`) live **only** in
      `task_results.evidence` (written at
      `src/app/task/run-next-task.ts:399`, serialised at
      `src/storage/sqlite/sqlite-task-repository.ts:513`, read back at `:562-568`).
      `task.verification` **events** carry only `verifierKind`, `phase`,
      `exitClass`, `durationMs`, `timedOut` — no command, no exit code, no output
      (`src/agent-runner/pi.ts:730,738`), so they cannot serve this field. The EPIC
      states the same rule in the note under its field-to-source table.
      Evidence is populated only on the `completed` outcome; every
      other write path stores `null` (`run-next-task.ts:430,466,506,549`), so `[]`
      is the honest value for a failed or escalated task.
    - `failureReason` → `taskResult.reason ?? null`.
    - `rejection` → `taskResult.rejectionResolution === null ? null :
{ resolution, reason: taskResult.rejectionReason }`.
    - `produced` → `null` when `taskResult === undefined`, else
      `{ summary: taskResult.summary, evidenceCount: (taskResult.evidence ?? []).length }`.
15. `candidate`: when `landing.getCandidateByTask(id)` returns a row, use
    `{candidateSHA, baseSHA, target, state, source:"landing_candidate"}`.
    Otherwise, when `taskResult` has a non-null `commitSha` **or**
    `proposalCommit`, use
    `{candidateSHA: commitSha ?? proposalCommit, baseSHA: baseCommit, target: null,
state: null, source:"task_result"}` — `commitSha` takes precedence. Otherwise
    `null`.
16. `groups[].repositories` = the **distinct, ascending-sorted** set of
    `tasks.getTaskContext(taskId)["repository"]` over the tasks whose
    `objectiveId` equals the group id, skipping `undefined`. Do **not** call
    `resolveInitiativeRepository` (`src/composition.ts:687-697`) — it returns the
    first task's repository for the WHOLE initiative and would collapse a
    cross-repo initiative to one value.
17. `groups[].after` = `sequencing.listObjectiveAfter(groupId)`;
    `groups[].waiting` = `unsatisfiedObjectiveEdges` over those ids with each
    objective's status, exactly as `src/app/objective/get-objective.ts:51-57`.
18. `groups[].status` = `objective.status ?? "building"`; `commitOid` and
    `conflictReason` are `?? null`.
19. Actions: `nodeAction`, `groupAction`, `initiativeAction` from Story 2. Node
    facts: `objectiveStatus` is the node's own group's status; `deadDependencyId`
    is the **first** entry of that node's `waiting` array with
    `neverSatisfies === true`, else `null`.
20. `initiativeAction` publication facts: `repositoryId` = the **lowest**
    (string-ascending) id in the union of all groups' `repositories`; `null` when
    that union is empty. `branch` = `repositoryBranch(repositoryId)`; when it is
    `undefined`, pass `publication: null`. Otherwise
    `publications.getPublication(repositoryId, branch)` — `undefined` result maps
    to state `"unpublished"`.
21. `counts`: the six status counts over `nodes`; `blocked` = nodes with
    `dependencyState === "blocked"`; `blockedForever` = nodes with
    `blockedForever === true`; **`actionable` = nodes with `action !== null`**
    (nodes only — group and initiative actions are not counted).

### D. `src/composition.ts` — wire it

Construct after `getObjective` (which ends at line 766) and add the field to the
returned bundle beside `getObjective` (line 866):

```ts
const getInitiativeGraph = new GetInitiativeGraph(
  taskRepository,
  taskRepository,
  {
    get: (id) => initiativeRepository.get(id),
    listObjectives: (initiativeId) =>
      initiativeRepository.listObjectives(initiativeId),
    listAllInitiatives: () => initiativeRepository.listAllInitiatives(),
  },
  sequencingRepository,
  landingRepository,
  events,
  publicationRepository,
  (repositoryId) => {
    /* resource lookup → branch, see below */
  },
);
```

- `landingRepository` is already built at `src/composition.ts:371`;
  `publicationRepository` at `:223`; `events` at `:176`;
  `sequencingRepository` at `:180`.
- `repositoryBranch`: read `projectRepository.getResource(repositoryId)` and
  return its repository branch, or `undefined` when the resource is missing or is
  not a repository. Use the existing `isRepository` guard already imported in
  `composition.ts`.
- **Never pass a bare method reference** for the arrow-wrapped sources: an unbound
  method loses `this` and crashes on the adapter's `#private` fields (AGENTS.md).
  `taskRepository`, `landingRepository`, `events`, `publicationRepository` and
  `sequencingRepository` are passed as whole objects, which is safe.

### E. `src/apps/cli/deps.ts` — declare the field

Add `import type { GetInitiativeGraph } from "../../app/initiative/get-initiative-graph.ts";`
to the import block (lines 1-62), and `getInitiativeGraph: GetInitiativeGraph;`
to `CliDeps` immediately after `getInitiative: GetInitiative;` (line 143).

## Constraints

- The use case is **read-only**: no `save*`, no `append`, no `transaction`. It
  must not import `EventFeed`'s `append`.
- `app/` imports `domain/` and `import type` ports only — declare the structural
  sources locally, never `import { TaskRepository } from "../../storage/port.ts"`
  as a value.
- Do not modify `GetInitiative`, `GetObjective`, `GetTask` or `ListTasks` in this
  story. Story 7 owns the `get task` change.
- One `execute()` per use case (AGENTS.md). No helper class.

## Verify

`node --test src/app/initiative/get-initiative-graph.test.ts` — new file. Build
in-memory fakes implementing the seven structural sources (no SQLite, no git),
mirroring the fake style at `src/app/initiative/get-initiative.test.ts`. Tests:

- unknown initiative id throws `UnknownReferenceError` with
  `err.kind === "initiative"` and a message containing `no initiative with id`.
- `projectId`, `initiative.branch` (`kanthord/init/<id>`), and
  `initiative.status` defaulting to `"building"` when the entity's status is
  `undefined`.
- node order equals the source order; the sources return ids out of alphabetical
  order and the output does **not** re-sort.
- `edges` direction: a dependent D with `dependencies: ["R"]` produces exactly
  `{from:"R", to:"D"}` — asserted explicitly so the direction cannot regress.
- `dependencyState`/`waiting`: pending dependent of a pending root → `"blocked"`
  with one `waiting` entry, `neverSatisfies: false`.
- `blockedForever` + `deadDependencyId`: pending node depending on a discarded
  task → `blockedForever: true`, `waiting[0].neverSatisfies: true`, and
  `action.kind === "remove-dependency"` with
  `targetDependencyId` equal to the discarded id.
- `downstream`: a root with four dependents reports `4`; a leaf reports `0`.
- `executionState`: with `listAllInitiatives()` reporting `paused: true`, every
  node is `"paused"` and `initiative.action.kind === "resume-initiative"`; with
  `paused: false`, every node is `"runnable"` and the action is `null`.
- `paused` defaults to `false` when the initiative id is absent from
  `listAllInitiatives()`.
- `groups[].repositories`: a group whose two tasks name two different
  repositories reports **both**, ascending-sorted; a group whose tasks name none
  reports `[]`; the same repository named twice is deduplicated.
- `groups[].waiting` uses objective-edge semantics: a `discarded` predecessor
  objective yields `neverSatisfies: true`.
- `verificationResults` equals `taskResult.evidence` verbatim, and is `[]` when
  `evidence` is `null` and when the result row is absent.
- `candidate`: a landing-candidate row wins over `task_result`
  (`source: "landing_candidate"`); with no candidate row and only
  `proposalCommit` set, `source: "task_result"` and `candidateSHA` equals
  `proposalCommit`; with both `commitSha` and `proposalCommit`, `commitSha` wins;
  with neither, `candidate` is `null`.
- `produced` is `null` with no result row, and reports `evidenceCount` otherwise.
- `rejection` is `null` when `rejectionResolution` is `null`.
- `lastEventId`/`lastEventAtMs`: a task with a known ULID event id reports that
  id and `eventTimeMs` of it; a task with no event reports `null`/`null`.
- `counts`: exact object equality on a fixture with one node in each of the six
  statuses plus one permanently blocked node.
- `actionable` counts nodes only — a fixture where the group has an `approve`
  action but every node's action is `null` reports `actionable: 0`.
- **no writes**: the fakes' `save`, `saveObjective`, `append`, `saveTaskResult`
  and `setPublication` throw if called; the test asserts `execute` resolves.

`node --test src/events/sqlite.test.ts` — add to the existing file:

- `latestEventIdByTask([])` returns an empty `Map` and issues no query (assert on
  the returned size; the empty-input short-circuit is the pinned behaviour).
- `latestEventIdByTask` returns the **maximum** id per task for a task with three
  events, and omits a task id that has no events.

`node --test src/domain/event.test.ts` — add: `eventTimeMs` of a known ULID equals
that ULID's `decodeTime`, asserted against a literal millisecond value.

`npm run verify` exits 0.

Proof: delivers phases **A** (error message), **B**, **C**, **D**, **E**, **F**
and **G** node/group/initiative assertions, and contributes to **I** (no writes).
