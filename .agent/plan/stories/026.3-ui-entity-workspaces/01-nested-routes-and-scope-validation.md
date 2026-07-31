# Story 01 — nested routes, the scope verdict, the gate, `ScopeMismatch`, `EntityWorkspace`

Epic: `.agent/plan/epics/026.3-ui-entity-workspaces.md` (decisions 1, 2, 3, 9)
Depends on: Story 00 (the detail views' ancestry and `conflictCause` are on the
wire, so this story's DTO types can declare them);
EPIC 026.2 Story 02 (`dto.ts`, `query-keys.ts`, the `api-client` helpers) and
Story 06 (`/project/:id/resource/:type` is registered);
EPIC 026.1 Stories 03, 04, 05.

## Change

### 1. Append to `ui/src/lib/dto.ts` (026.2 S2's file)

Type-only, mirroring index.md F3/F5 exactly. Reuse `ActionDto` and `ResourceDto`
already declared there; declare nothing twice.

```ts
export interface UnsatisfiedEdgeDto {
  readonly id: string;
  readonly neverSatisfies: boolean;
}

export interface InitiativeRowDto {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly paused: boolean;
  readonly status?: string;
  readonly workspace?: string;
}

export interface InitiativeDetailDto {
  readonly id: string;
  /** On the wire from Story 00 onward. */
  readonly projectId: string;
  readonly name: string;
  readonly status: string;
  readonly paused: boolean;
  readonly branch: string;
  readonly workspace?: string;
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeDto[];
}

export interface ObjectiveRowDto {
  readonly id: string;
  readonly initiativeId: string;
  readonly name: string;
  readonly status?: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly note?: string;
  readonly conflictReason?: string;
}

export interface IntegrationDto {
  readonly repository: string;
  readonly state: string;
}

export interface ObjectiveDetailDto {
  readonly id: string;
  /** On the wire from Story 00 onward. */
  readonly initiativeId: string;
  readonly name: string;
  readonly status: string;
  readonly commitOid?: string;
  readonly parentOid?: string;
  readonly integrations: readonly IntegrationDto[];
  readonly after: readonly string[];
  readonly waiting: readonly UnsatisfiedEdgeDto[];
  /** On the wire from Story 00 onward; always present, `null` when unset. */
  readonly conflictCause: string | null;
  readonly conflictReason: string | null;
  readonly note: string | null;
}

export interface TaskRowDto {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly state: string;
  readonly dependencies: readonly string[];
  /** Bare ids on a list row — NOT `UnsatisfiedEdgeDto` (index.md F6). */
  readonly waiting: readonly string[];
}

export interface EvidenceDto {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export interface TaskResultDto {
  readonly workspace: string | null;
  readonly branch: string | null;
  readonly baseCommit: string | null;
  readonly proposalCommit: string | null;
  readonly commitSha: string | null;
  readonly summary: string | null;
  readonly reason: string | null;
  readonly rejectionResolution: string | null;
  readonly rejectionReason: string | null;
  readonly evidence: readonly EvidenceDto[] | null;
}

export interface LandingCandidateDto {
  readonly state: "pending" | "landed" | "conflict";
  readonly baseSHA: string;
  readonly candidateSHA: string;
  readonly target: string;
}

export interface TaskDetailDto {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly agent?: string;
  readonly objectiveId: string;
  /** On the wire from Story 00 onward; `null` is the degraded shape. */
  readonly initiativeId: string | null;
  readonly dependencies: readonly string[];
  readonly note?: string;
  readonly instructions?: string;
  readonly ac?: readonly string[];
  readonly verification?: readonly string[];
  readonly result: TaskResultDto | null;
  readonly dependencyStatus?: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
  }>;
  readonly context?: Readonly<Record<string, string>>;
  readonly landingCandidate: LandingCandidateDto | null;
  readonly abandoning: boolean;
  readonly waiting: readonly UnsatisfiedEdgeDto[];
  readonly blockedForever: boolean;
  readonly downstream: number;
  readonly action: ActionDto | null;
}
```

### 2. Append to `ui/src/lib/query-keys.ts` (026.2 S2's file)

```ts
export const initiativeKeys = {
  list: (projectId: string) => ["project", projectId, "initiative"] as const,
  detail: (id: string) => ["initiative", id] as const,
};

export const objectiveKeys = {
  list: (initiativeId: string) =>
    ["initiative", initiativeId, "objective"] as const,
  detail: (id: string) => ["objective", id] as const,
};

export const taskKeys = {
  list: (initiativeId: string, objectiveId?: string) =>
    objectiveId === undefined
      ? (["initiative", initiativeId, "task"] as const)
      : ([
          "initiative",
          initiativeId,
          "task",
          { objective: objectiveId },
        ] as const),
  detail: (id: string) => ["task", id] as const,
};
```

Add no invalidation helper: 026.2's `invalidateOverview` is `exact: true` and
this epic writes nothing.

### 3. Append to `ui/src/lib/api-client.ts`

Keep `ApiError`, `apiUrl`, `apiGet`, `apiPath` and 026.2's helpers untouched.
`apiGet` stays the only `fetch` caller (R3). Add **no** write helper.

```ts
export function fetchInitiatives(
  projectId: string,
  init?: RequestInitLike,
): Promise<InitiativeRowDto[]>;
export function fetchInitiative(
  id: string,
  init?: RequestInitLike,
): Promise<InitiativeDetailDto>;
export function fetchObjectives(
  initiativeId: string,
  init?: RequestInitLike,
): Promise<ObjectiveRowDto[]>;
export function fetchObjective(
  id: string,
  init?: RequestInitLike,
): Promise<ObjectiveDetailDto>;
export function fetchTasks(
  initiativeId: string,
  objectiveId?: string,
  init?: RequestInitLike,
): Promise<TaskRowDto[]>;
export function fetchTask(
  id: string,
  init?: RequestInitLike,
): Promise<TaskDetailDto>;
```

Pinned paths, every id through `encodeURIComponent`, the query built by 026.2's
`apiPath`:

| call                     | path                                   |
| ------------------------ | -------------------------------------- |
| `fetchInitiatives("p1")` | `/api/project/p1/initiative`           |
| `fetchInitiative("i1")`  | `/api/initiative/i1`                   |
| `fetchObjectives("i1")`  | `/api/initiative/i1/objective`         |
| `fetchObjective("o1")`   | `/api/objective/o1`                    |
| `fetchTasks("i1")`       | `/api/initiative/i1/task`              |
| `fetchTasks("i1","o1")`  | `/api/initiative/i1/task?objective=o1` |
| `fetchTask("t1")`        | `/api/task/t1`                         |

### 4. New file `ui/src/lib/entity-scope.ts`

Pure — no React, no `fetch`, no hooks. This is where decision 3 lives.

```ts
export type ScopeLevel =
  | "chain"
  | "initiative"
  | "objective"
  | "task"
  | "resource-type"
  | "resource-project";

export interface ScopeMismatchInfo {
  readonly level: ScopeLevel;
  /** The noun the sentence names, e.g. "task". */
  readonly what: string;
  /** The value the URL claims. */
  readonly expected: string;
  /** The entity's real value, or `null` when it cannot be read. */
  readonly actual: string | null;
  /** A router path (no leading `#`), or `null` when it cannot be computed. */
  readonly correctHref: string | null;
}

export function initiativeScope(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly rows: readonly InitiativeRowDto[];
}): ScopeMismatchInfo | null;

export function objectiveScope(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly rows: readonly ObjectiveRowDto[];
}): ScopeMismatchInfo | null;

export function taskScope(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
  readonly task: TaskDetailDto;
  readonly objectiveRows: readonly ObjectiveRowDto[] | undefined;
}): ScopeMismatchInfo | null;

export function resourceScope(args: {
  readonly projectId: string;
  readonly type: string;
  readonly resource: ResourceDto;
}): ScopeMismatchInfo | null;
```

Pinned rules — evaluate top to bottom, first match wins, `null` means in scope:

**`initiativeScope`** (the project's initiative collection must contain it)

1. no row with `id === initiativeId` →
   `{level:"initiative", what:"initiative", expected:projectId, actual:null, correctHref:null}`
2. that row's `projectId !== projectId` →
   `{level:"initiative", what:"initiative", expected:projectId, actual:row.projectId, correctHref:"/project/" + row.projectId + "/initiative/" + initiativeId}`
3. otherwise `null`

**`objectiveScope`** (the row carries `initiativeId`)

1. no row with `id === objectiveId` →
   `{level:"objective", what:"objective", expected:initiativeId, actual:null, correctHref:null}`
2. that row's `initiativeId !== initiativeId` →
   `{level:"objective", what:"objective", expected:initiativeId, actual:row.initiativeId, correctHref:"/project/" + projectId + "/initiative/" + row.initiativeId + "/objective/" + objectiveId}`
3. otherwise `null`

**`taskScope`** (the direct field)

1. `task.objectiveId === objectiveId` → `null`
2. otherwise
   `{level:"task", what:"task", expected:objectiveId, actual:task.objectiveId, correctHref:H}`
   where `H` is
   `"/project/" + projectId + "/initiative/" + initiativeId + "/objective/" + task.objectiveId + "/task/" + taskId`
   **iff** `objectiveRows !== undefined && objectiveRows.some(r => r.id === task.objectiveId)`, and `null` otherwise.
   (The real objective's own initiative is unknowable from `GET /api/objective/:id`
   — index.md F4 — so a link is offered only when the real objective is in the
   URL's initiative.)

**`resourceScope`**

1. `resource.type !== type` →
   `{level:"resource-type", what:"resource", expected:type, actual:resource.type, correctHref:"/project/" + projectId + "/resource/" + resource.type + "/" + resource.id}`
2. `resource.projectId !== undefined && resource.projectId !== projectId` →
   `{level:"resource-project", what:"resource", expected:projectId, actual:resource.projectId, correctHref:"/project/" + resource.projectId + "/resource/" + type + "/" + resource.id}`
3. otherwise `null` (a DTO without `projectId` cannot be checked at that level —
   index.md F5)

Also in this file, the gate — decision 2's ordering, pure and table-testable:

```ts
export interface GateQuery {
  /** The noun AsyncBoundary names, e.g. "initiative". */
  readonly what: string;
  readonly state: AsyncState;
  readonly message?: string;
  /** Exactly one query in the array is the `"entity"`; the rest are ancestors. */
  readonly role: "ancestor" | "entity";
}

export type Gate =
  | {
      readonly kind: "async";
      readonly state: AsyncState;
      readonly what: string;
      readonly message: string | undefined;
    }
  | { readonly kind: "mismatch"; readonly info: ScopeMismatchInfo }
  | null;

export function resolveGate(input: {
  /** Ancestors first, the entity last. */
  readonly queries: readonly GateQuery[];
  readonly mismatch: ScopeMismatchInfo | null;
}): Gate;
```

Pinned order — first match wins:

1. the **first** query with `state === "loading"` →
   `{kind:"async", state:"loading", what: q.what, message: undefined}`
2. the query with `role === "entity"` has `state === "missing"` →
   `{kind:"async", state:"missing", what: q.what, message: undefined}`
3. the **first** query with `role === "ancestor"` and `state === "missing"` →
   `{kind:"mismatch", info:{level:"chain", what:q.what, expected:"", actual:null, correctHref:null}}`
4. the **first** query with `state === "error"` →
   `{kind:"async", state:"error", what:q.what, message:q.message}`
5. `mismatch !== null` → `{kind:"mismatch", info: mismatch}`
6. otherwise `null`

Rule 2 before rule 3 is what makes a made-up entity id `missing` while a wrong
chain is `mismatch`. `"empty"`, `"expired"` and `"truncated"` never reach
`resolveGate` (026.1 S5: `asyncStateOf` produces neither of the last two, and
this epic passes no `isEmpty` predicate to it), so they fall through to rule 6 —
do not add a branch for them.

### 5. New file `ui/src/lib/status-display.tsx`

The index.md F7 guard. One place, used by Stories 03/04/05/07.

```ts
export type StatusAxis = "task" | "initiative";
export interface EntityStatusProps {
  readonly axis: StatusAxis;
  readonly value: string;
}
/**
 * `StatusChip` when the value is in that axis's role map, otherwise the raw
 * string — a `dependencyStatus` of `"unknown"` (index.md F7) must render, not
 * crash.
 */
export function EntityStatus({ axis, value }: EntityStatusProps): ReactElement;
```

- `axis === "task"` and `value in TASK_STATUS_ROLE` →
  `<StatusChip axis="task" value={value as TaskStatus} />`
- `axis === "initiative"` and `value in INITIATIVE_STATUS_ROLE` →
  `<StatusChip axis="initiative" value={value as InitiativeStatus} />`
- otherwise `<span data-testid="status-raw">{value}</span>`

`TASK_STATUS_ROLE`, `INITIATIVE_STATUS_ROLE`, `TaskStatus`, `InitiativeStatus`
and `StatusChip` all come from EPIC 026.1 — resolve each import mechanically
(`rg -n "export (const|type|function) <Name>" ui/src`) and import from the one
file that matches. If a name does not exist, 026.1 did not ship it: raise an
`OPEN:` blocker instead of writing a second copy.

### 6. New file `ui/src/components/scope-mismatch.tsx`

```ts
export interface ScopeMismatchProps {
  readonly info: ScopeMismatchInfo;
}
export function ScopeMismatch({ info }: ScopeMismatchProps): ReactElement;
```

Renders exactly one element:

```tsx
<div
  data-testid="scope-mismatch"
  data-level={info.level}
  data-role="attention"
  className={cn(
    "flex flex-col gap-2 rounded-md border p-4 text-sm",
    ROLE_CLASS.attention,
  )}
>
  <p data-testid="scope-mismatch-sentence">{sentence}</p>
  {info.actual !== null && (
    <p>
      It belongs to{" "}
      <code data-testid="scope-mismatch-actual">{info.actual}</code>, not{" "}
      <code data-testid="scope-mismatch-expected">{info.expected}</code>.
    </p>
  )}
  {info.correctHref !== null && (
    <Link data-testid="scope-mismatch-link" to={info.correctHref}>
      Open this {info.what} at its real location
    </Link>
  )}
</div>
```

`sentence` by `info.level`, exact strings:

| level              | sentence                                             |
| ------------------ | ---------------------------------------------------- |
| `chain`            | `This URL names a {what} that does not exist.`       |
| `initiative`       | `This initiative exists, but not in this project.`   |
| `objective`        | `This objective exists, but not in this initiative.` |
| `task`             | `This task exists, but not under this objective.`    |
| `resource-type`    | `This resource exists, but it is not of this type.`  |
| `resource-project` | `This resource exists, but not in this project.`     |

`Link` is `react-router-dom`'s, so the hash router turns `/project/…` into
`#/project/…`. `ROLE_CLASS` and `cn` come from `@/lib/status-role` and
`@/lib/utils`.

### 7. New file `ui/src/components/entity-workspace.tsx`

The W2 frame. It owns every selector in index.md F17 that Story 01 owns.

```ts
export interface EntityTab {
  /** Stable slug for `Tabs`, e.g. "summary". */
  readonly value: string;
  /** The visible tab label, e.g. "Summary". */
  readonly label: string;
  readonly panel: ReactNode;
}

export interface EntityWorkspaceProps {
  readonly projectId: string;
  readonly segments: readonly string[];
  readonly gate: Gate;
  /** The entity kind, e.g. "Initiative". Rendered beside the name. */
  readonly kindLabel: string;
  /** The entity's real name. Read only when `gate === null`. */
  readonly name: string;
  /** Fixed per page; `[]` until Stories 03/04/05/07 fill it. */
  readonly tabs: readonly EntityTab[];
}
export function EntityWorkspace(props: EntityWorkspaceProps): ReactElement;
```

Body, pinned:

```tsx
<ProjectShell projectId={projectId} segments={segments}>
  {gate !== null ? (
    gate.kind === "mismatch" ? (
      <ScopeMismatch info={gate.info} />
    ) : (
      <AsyncBoundary
        state={gate.state}
        what={gate.what}
        message={gate.message}
      />
    )
  ) : (
    <div className="flex flex-col gap-4">
      <header data-testid="entity-header" data-kind={kindLabel}>
        <p className="text-muted-foreground text-xs">{kindLabel}</p>
        <h1 className="text-lg font-semibold">{name}</h1>
      </header>
      {tabs.length > 0 && (
        <Tabs defaultValue={tabs[0].value}>
          <TabsList data-testid="entity-tabs">
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.value} value={t.value} data-testid="tab-panel">
              {t.panel}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )}
</ProjectShell>
```

- Never pass `forceMount` (index.md F13): exactly one `tab-panel` is mounted, so
  a hidden tab's query never runs.
- The first tab is always the default. Tab selection is component state, never
  the URL — 026.1 S4 forbids new route params.
- When `gate !== null` there is **no** `entity-header`, no `entity-tabs` and no
  `tab-panel` in the DOM, and exactly one of `scope-mismatch` / `async-*`.

### 8. New file `ui/src/app/entity-chain.ts`

The chain reads and the verdict, one hook per entity. `staleTime: Infinity` and
no `refetchInterval` on every query in this epic — there is no freshness
requirement here and 026.2's polling engine is wired to the Overview only.

```ts
export interface InitiativeChain {
  readonly gate: Gate;
  readonly initiative: InitiativeDetailDto | undefined;
  readonly objectiveRows: readonly ObjectiveRowDto[] | undefined;
  readonly projectName: string | undefined;
}
export function useInitiativeChain(args: {
  readonly projectId: string;
  readonly initiativeId: string;
}): InitiativeChain;

export interface ObjectiveChain extends InitiativeChain {
  readonly objective: ObjectiveDetailDto | undefined;
}
export function useObjectiveChain(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
}): ObjectiveChain;

export interface TaskChain extends ObjectiveChain {
  readonly task: TaskDetailDto | undefined;
}
export function useTaskChain(args: {
  readonly projectId: string;
  readonly initiativeId: string;
  readonly objectiveId: string;
  readonly taskId: string;
}): TaskChain;

export interface ResourceChain {
  readonly gate: Gate;
  readonly resource: ResourceDto | undefined;
  readonly projectName: string | undefined;
}
export function useResourceChain(args: {
  readonly projectId: string;
  readonly type: string;
  readonly resourceId: string;
}): ResourceChain;
```

Each hook's queries, in the exact order they are passed to `resolveGate`
(ancestors first, entity last). Every query uses the 026.2/026.3 key factories
and the matching `api-client` helper with `queryFn: ({signal}) => …(…, {signal})`:

| hook                 | **gate** queries (`what`, key, role), ancestors first                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useInitiativeChain` | `project`/`projectKeys.detail(projectId)`/ancestor · `initiative list`/`initiativeKeys.list(projectId)`/ancestor · `initiative`/`initiativeKeys.detail(initiativeId)`/**entity**        |
| `useObjectiveChain`  | the three above with `initiative` demoted to `ancestor`, then `objectives`/`objectiveKeys.list(initiativeId)`/ancestor, then `objective`/`objectiveKeys.detail(objectiveId)`/**entity** |
| `useTaskChain`       | the five above with `objective` demoted to `ancestor`, then `task`/`taskKeys.detail(taskId)`/**entity**                                                                                 |
| `useResourceChain`   | `project`/`projectKeys.detail(projectId)`/ancestor · `resource`/`resourceKeys.detail(resourceId)`/**entity**                                                                            |

The objective collection (`objectiveKeys.list(initiativeId)`) is run by all three
initiative-rooted hooks — one key, one request, react-query dedupes — but it is a
**gate** query only on `useObjectiveChain` and `useTaskChain`, which need it for
`objectiveScope` and for `taskScope`'s `correctHref`. On `useInitiativeChain` it
is **ungated**: it feeds only the Objectives tab (Story 03), and a failed tab
query must never blank the whole page. Every initiative-rooted hook therefore
also exposes `readonly objectivesState: AsyncState` and
`readonly objectivesMessage: string | undefined` beside `objectiveRows`, so
Story 03 can render that tab's own async states.

Use `useProjectSummary(projectId)` (026.1 S5) for the project query rather than
a second `["project", id]` query — the key is identical.

`mismatch` passed to `resolveGate`, computed only from resolved data
(`undefined` data → pass `null`, because rule 1 or 4 already fired):

- `useInitiativeChain` → `initiativeScope({projectId, initiativeId, rows})`
- `useObjectiveChain` → the initiative verdict first; when it is `null`,
  `objectiveScope({projectId, initiativeId, objectiveId, rows})`
- `useTaskChain` → the initiative verdict, then the objective verdict, then
  `taskScope({…, task, objectiveRows})` — first non-`null` wins
- `useResourceChain` → `resourceScope({projectId, type, resource})`

`projectName` is the resolved project query's `name`, else `undefined`.
`segments` are Story 02's; Story 01 passes `segments={[]}` from every page.

### 9. Four new page files

Each reads its params with `useParams()` (index.md F10 — the project param is
`:projectId` on these four routes), calls its hook, and renders
`EntityWorkspace` with `segments={[]}` and `tabs={[]}`.

| file                                 | export                 | `kindLabel`  | `name`                   |
| ------------------------------------ | ---------------------- | ------------ | ------------------------ |
| `ui/src/pages/entity-initiative.tsx` | `EntityInitiativePage` | `Initiative` | `initiative?.name ?? ""` |
| `ui/src/pages/entity-objective.tsx`  | `EntityObjectivePage`  | `Objective`  | `objective?.name ?? ""`  |
| `ui/src/pages/entity-task.tsx`       | `EntityTaskPage`       | `Task`       | `task?.title ?? ""`      |
| `ui/src/pages/entity-resource.tsx`   | `EntityResourcePage`   | `Resource`   | `resource?.name ?? ""`   |

`entity-resource.tsx` reads `:type` and **does not** pre-validate it against
`isResourceType` (026.2 S2): `resourceScope` compares against the fetched
resource's own `type`, so `#/project/p1/resource/not-a-type/<realId>` is a
`resource-type` mismatch, not a missing page. A missing `:resourceId` is the
entity query's `missing`.

### 10. Edit `ui/src/app/routes.tsx` (026.1 S4's `ROUTE_TABLE` **and** `createAppRouter()`)

The table carries no `element` field, so this is two edits in the one file:
insert four `kind: "screen"` entries into `ROUTE_TABLE` **immediately before the
`path: "*"` entry**, and add four route objects to `createAppRouter()` as
**top-level siblings** — not children of `ProjectRoute` (index.md F11) — each
rendering the element below. Change nothing else:

| path                                                                               | element                    |
| ---------------------------------------------------------------------------------- | -------------------------- |
| `/project/:projectId/initiative/:initiativeId`                                     | `<EntityInitiativePage />` |
| `/project/:projectId/initiative/:initiativeId/objective/:objectiveId`              | `<EntityObjectivePage />`  |
| `/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/:taskId` | `<EntityTaskPage />`       |
| `/project/:projectId/resource/:type/:resourceId`                                   | `<EntityResourcePage />`   |

No `epic` key (that is `not-built-yet`-only). No `ProjectRoute` wrapper
(index.md F11) — each page renders its own `<ProjectShell>`. `ui/src/main.tsx`
does not change.

## Constraints

- **No writes.** `api-client.ts` gains read helpers only; no story in this epic
  adds `apiPost`/`apiPatch`/`apiDelete`, and no component in this epic renders a
  control that issues one (decision 9, index.md F15).
- `entity-scope.ts` stays pure: no React import, no `fetch`, no hook. That is
  what lets Story 01's rules be tested as a table.
- **`AsyncBoundary`'s union is not extended** (decision 2). `scope-mismatch` is
  its own component and never renders an `async-*` test id.
- When `gate.kind === "mismatch"` the DOM contains **zero**
  `[data-testid="async-missing"]`; when the gate is `missing` it contains zero
  `[data-testid="scope-mismatch"]`. The Proof asserts both directions.
- `ProjectShell` renders in every gate state, so the operator keeps the nav.
- Do not touch `ProjectRoute` or `GlobalShellLayout` in `ui/src/app/routes.tsx`
  (026.1 kept them internal to that file), `ui/src/components/shell.tsx`,
  `ui/src/pages/project-overview.tsx` or `ui/src/pages/project-resources.tsx`.
- Do not add `forceMount` to `TabsContent`, and do not put the tab in the URL.

## Verify

- New `ui/src/lib/entity-scope.test.ts` —
  `npm run test --workspace ui -- src/lib/entity-scope.test.ts`:
  - `initiativeScope`: row present with matching `projectId` → `null`; row
    absent → `level:"initiative"`, `actual === null`, `correctHref === null`;
    row present with `projectId:"p2"` → `actual === "p2"` and
    `correctHref === "/project/p2/initiative/i1"`.
  - `objectiveScope`: row present with matching `initiativeId` → `null`; row
    absent → `actual === null`, `correctHref === null`; row with
    `initiativeId:"i2"` → `correctHref === "/project/p1/initiative/i2/objective/o1"`.
  - `taskScope`: `task.objectiveId === objectiveId` → `null`; mismatch with the
    real objective present in `objectiveRows` →
    `correctHref === "/project/p1/initiative/i1/objective/oA/task/t1"`; the same
    mismatch with `objectiveRows: []` → `correctHref === null`; with
    `objectiveRows: undefined` → `correctHref === null`; in all three
    `actual === "oA"` and `expected === "oB"`.
  - `resourceScope`: matching type and `projectId` → `null`; a DTO with **no**
    `projectId` key and a matching type → `null`; wrong type →
    `level:"resource-type"` and
    `correctHref === "/project/p1/resource/credential/r1"`; right type with
    `projectId:"p2"` → `level:"resource-project"` and
    `correctHref === "/project/p2/resource/repository/r1"`; wrong type **and**
    wrong project → `level:"resource-type"` (type wins).
  - `resolveGate`, one test per rule and in the pinned order:
    an ancestor `loading` before an entity `error` → `loading` naming the
    ancestor; entity `missing` **with** a non-null `mismatch` → `kind:"async"`,
    `state:"missing"` (rule 2 beats rule 5); ancestor `missing` → `kind:"mismatch"`,
    `info.level === "chain"` and `info.what` is that ancestor's `what`;
    an ancestor `error` with `message:"boom"` → `kind:"async"`, `state:"error"`,
    `message === "boom"`; all `resolved` with a non-null `mismatch` →
    `kind:"mismatch"` carrying that exact info object; all `resolved` with
    `mismatch: null` → `null`; a query with `state:"empty"` and everything else
    resolved → `null`.
- New `ui/src/components/scope-mismatch.test.tsx` —
  `npm run test --workspace ui -- src/components/scope-mismatch.test.tsx`
  (wrap in `MemoryRouter`, the `shell.test.tsx:3,14` convention):
  - one test per `ScopeLevel`: `[data-testid="scope-mismatch"]` carries
    `data-level` and its `scope-mismatch-sentence` text is exactly the pinned
    string.
  - `actual: null` → no `scope-mismatch-actual` element; `actual: "x"` → the
    element contains `x`.
  - `correctHref: null` → `screen.queryAllByRole("link")` is length 0;
    `correctHref: "/project/p1/initiative/i2/objective/o1"` → exactly one link
    whose `getAttribute("href")` ends with that path.
  - the element carries `data-role="attention"` and no `async-` test id is in
    the DOM.
- New `ui/src/components/entity-workspace.test.tsx` —
  `npm run test --workspace ui -- src/components/entity-workspace.test.tsx`:
  - `gate: null` with three tabs: `[data-testid="entity-header"]` contains the
    name and the `kindLabel`; `[data-testid="entity-tabs"] [role="tab"]` is
    exactly 3; `[data-testid="tab-panel"]` count is exactly **1** and holds the
    first tab's panel; after `userEvent.click` on the second tab the single
    `tab-panel` holds the second panel and the first panel's text is gone.
  - `gate: null` with `tabs: []` → no `entity-tabs` and no `tab-panel`, and the
    header still renders.
  - `gate: {kind:"async", state:"missing", what:"task"}` → exactly one
    `[data-testid="async-missing"]`, **zero** `[data-testid="scope-mismatch"]`,
    zero `entity-header`, and `[data-testid="project-shell"]` still present.
  - `gate: {kind:"mismatch", info:{level:"task", …}}` → exactly one
    `[data-testid="scope-mismatch"]`, **zero** `[data-testid="async-missing"]`,
    zero `entity-header`.
  - `gate: {kind:"async", state:"error", what:"task", message:"boom"}` →
    `getByRole("alert")` text contains `boom`.
  - `segments: ["alpha","init-1"]` reaches `[data-testid="breadcrumb"]`, whose
    text contains both and contains neither `projectId` nor any tab label.
- New `ui/src/lib/status-display.test.tsx` —
  `npm run test --workspace ui -- src/lib/status-display.test.tsx`:
  `axis="task" value="pending"` → `[data-testid="status-chip"]` with
  `data-axis="task"`; `axis="task" value="unknown"` →
  `[data-testid="status-raw"]` with text `unknown` and **no** `status-chip`;
  `axis="initiative" value="landed"` → a chip with `data-axis="initiative"`;
  `axis="initiative" value="weird"` → `status-raw`.
- New `ui/src/pages/entity-routes.test.tsx` —
  `npm run test --workspace ui -- src/pages/entity-routes.test.tsx`, rendering
  the real `ROUTE_TABLE` through `createMemoryRouter` + `initialEntries` with
  `vi.mock("@/lib/api-client")`:
  - `ROUTE_TABLE` contains the four new paths, each with `kind === "screen"` and
    `epic === undefined`, and the entry at index `length - 1` still has
    `path === "*"`.
  - happy path: with the mocks answering a project `{id:"p1",name:"alpha"}`, an
    initiative list `[{id:"i1",projectId:"p1",name:"init-1",paused:false}]`, an
    objective list `[{id:"o1",initiativeId:"i1",name:"obj-1"}]`, an initiative
    detail, an objective detail and a task detail with `objectiveId:"o1"` —
    each of the four URLs renders `[data-testid="entity-header"]` containing
    that entity's name.
  - `/project/p1/initiative/i1/objective/o1/task/t1` where the task detail
    answers `objectiveId:"oA"` and the objective list contains `oA` →
    `[data-testid="scope-mismatch"]` with `data-level="task"`, **zero**
    `async-missing`, and a link to
    `/project/p1/initiative/i1/objective/oA/task/t1`.
  - the same URL where `fetchTask` rejects with `new ApiError(404,"unknown_reference","no task")`
    → `[data-testid="async-missing"]` and **zero** `scope-mismatch`.
  - `/project/p1/initiative/iZZZ` where the initiative list does not contain
    `iZZZ` → `scope-mismatch` with `data-level="initiative"`.
  - `/project/p1/initiative/i1/objective/oZZZ` where the objective list does not
    contain `oZZZ` → `scope-mismatch` with `data-level="objective"` and
    `entity-header` absent.
  - `/project/p1/resource/credential/r1` where `fetchResource` answers
    `{type:"repository", id:"r1", name:"repo-1"}` → `scope-mismatch` with
    `data-level="resource-type"`.
  - `/project/p1/resource/repository/r1` where the resource answers
    `projectId:"p2"` → `data-level="resource-project"`.
  - **no mutation**: across every case above, `document.querySelectorAll("form")`
    is empty and no accessible button or link is named
    `/new|create|edit|rename|delete|retry|approve|reject|abandon|publish|resume/i`.
- Existing `ui/src/app/routes.test.tsx` (026.1 S4) must stay green: update its
  path-list assertion to the new table and replace its "no `path` other than the
  five `/project/:id/*` leaves contains a `:` parameter" assertion with: every
  `:`-carrying path is one of the 026.2 resource paths or the four 026.3 paths
  above, and no path matches `/^\/inbox\//`.
- `npm run verify` exits 0.
- Proof: **phase F** in full (`scope-mismatch` for a real task under the wrong
  objective with zero `async-missing`; `async-missing` for a made-up task id
  with zero `scope-mismatch`), and the `[data-testid="entity-header"]` half of
  phases **C** and **G**.
