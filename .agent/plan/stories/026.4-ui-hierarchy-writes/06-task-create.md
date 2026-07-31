# Story 06 — task create, the full-page form

Epic: `.agent/plan/epics/026.4-ui-hierarchy-writes.md` (decisions 8, 9, 12)
Depends on: Stories 01, 03, 05.

## Change

### 1. `ui/src/lib/api-client.ts` — the create helper

```ts
export interface TaskCreateBody {
  readonly title: string;
  readonly instructions?: string;
  readonly ac?: readonly string[];
  readonly verification?: readonly string[];
  readonly agent?: string;
  readonly dependencies?: readonly string[];
  readonly context?: Readonly<Record<string, string>>;
}
export async function createTask(
  objectiveId: string,
  body: TaskCreateBody,
): Promise<Created<{ id: string }>>;
// apiPostCreated(`/api/objective/${enc(objectiveId)}/task`, body)
```

**A task is created under its objective** — `POST /api/objective/:id/task`
(`src/apps/http/routes.ts:641`), not under the initiative.

### 2. `ui/src/lib/task-create-body.ts` — new file, the field contract

```ts
export interface TaskDraft {
  readonly title: string;
  readonly instructions: string;
  readonly ac: readonly string[];
  readonly verification: readonly string[];
  readonly agent: string;
  readonly dependencies: readonly string[];
  readonly context: readonly { readonly key: string; readonly value: string }[];
}
export const EMPTY_TASK_DRAFT: TaskDraft;
export function taskCreateBody(draft: TaskDraft): TaskCreateBody;
```

`taskCreateBody` is pure and pinned:

- `title` is `draft.title.trim()` and is always present;
- a key is **omitted entirely** when it collected nothing: `instructions` when
  blank after trim; `ac` / `verification` / `dependencies` when the array is empty
  after dropping blank-after-trim entries; `agent` when blank after trim;
  `context` when no row has a non-blank key;
- `ac` and `verification` keep the operator's order — the array order is the
  submitted order, no sort, no dedupe;
- `context` folds the rows into an object in row order; a later row with the same
  key overwrites an earlier one; rows with a blank key are dropped, and a blank
  value is kept;
- `paused` and `after` are **never** produced — they are not fields of this DTO
  (epic decision 9).

### 3. `ui/src/pages/entity-task-create.tsx` — new page

```ts
export function EntityTaskCreatePage(): ReactElement;
```

- Reads `projectId`, `initiativeId`, `objectiveId` from `useParams`.
- Reuses 026.3's `useObjectiveChain(...)` for the gate and breadcrumb segments,
  and renders inside `ProjectShell` with segments
  `[...objectiveSegments, "New task"]`. A scope mismatch or missing objective
  renders 026.3's `ScopeMismatch` / `AsyncBoundary` exactly as the objective page
  does, and **no form**.
- The form is a full-page section, never a `Sheet`
  (`docs/ui-design.md:255-257`): `<form data-testid="create-task-form">` with
  `preventDefault`.

Fields and ids, in this order:

| field                         | ids                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title` (`Input`, required)   | `task-title`                                                                                                                                       |
| `instructions` (`Textarea`)   | `task-instructions`                                                                                                                                |
| `ac[]` ordered list           | `ac-add`; per row `ac-row` + `data-index`, `ac-input`, `ac-remove`, `ac-up`, `ac-down`                                                             |
| `verification[]` ordered list | `verification-add`; per row `verification-row` + `data-index`, `verification-input`, `verification-remove`, `verification-up`, `verification-down` |
| `context{}` key/value rows    | `context-add`; per row `context-row` + `data-index`, `context-key`, `context-value`, `context-remove`                                              |
| `dependencies[]` picker       | `task-dependency-picker`; one control per candidate, `task-dependency-option` + `data-task-id`                                                     |
| `agent` (`Input`, free text)  | `task-agent`, plus `task-agent-hint`                                                                                                               |
| submit                        | `create-task-submit`                                                                                                                               |

- `ac-up` on index 0 and `ac-down` on the last index are `disabled`; reorder moves
  the row by exactly one position. Same for `verification-*`.
- The dependency picker lists the initiative's tasks from
  `taskKeys.list(initiativeId)` (026.3's `fetchTasks`), **in the server's order**,
  each a checkbox labelled with the task title. Toggling collects the id into
  `draft.dependencies` **in the order the API returned**, so the same selections
  always produce the same body.
- `task-agent-hint` renders the fixed text
  `Free text — the daemon validates the agent name. There is no agent list API
yet.` (epic decision 8; the gap is listed for 026.8).
- Submit is `disabled` while `title` is blank after trim or a request is in
  flight. On success: `await invalidateFor(client, "task.create", {projectId,
initiativeId})`, then `navigate` to
  `#/project/<projectId>/initiative/<initiativeId>/objective/<objectiveId>/task/<id>`
  using `data.id` from the response body. (`Location` is asserted present by the
  transport in story 01; the **body's `id` is the authoritative value** used
  here.)
- On `ApiError`: render the server's `message` in
  `<p data-testid="create-task-error" role="alert" data-role="danger">`; the whole
  draft stays on screen. `unknown_agent`, `invalid_task_field` and
  `unknown_dependency` all surface this way — no field is silently dropped.

### 4. `ui/src/app/routes.tsx` — register the route (two edits, one file)

`AppRoute` is `{path, kind, epic?}` with no `element`, so registering a screen
means editing **both** `ROUTE_TABLE` and `createAppRouter()`:

- add
  `{ path: "/project/:projectId/initiative/:initiativeId/objective/:objectiveId/task/new", kind: "screen" }`
  to `ROUTE_TABLE` **immediately before** the `.../task/:taskId` entry, keeping
  `path: "*"` last;
- add the matching route object to `createAppRouter()` as a **top-level
  sibling** of 026.3's four entity routes — not a child of `ProjectRoute` —
  rendering `<EntityTaskCreatePage />`.

React Router 7 ranks a static segment above a dynamic one, so `new` never
resolves to `:taskId`; the table order is pinned anyway so it reads top-down.

### 5. `ui/src/pages/entity-objective.tsx` — the entry point

In the existing `tasks` tab panel, above the task list, render a `Link`
`data-testid="create-task"` to the route above, labelled `New task`. **Add no
tab.**

## Constraints

- Task create is the only task write in this epic: **no task rename** (epic
  decision 12) and no delete.
- The form holds no derived state: `ac`, `verification` and `context` are plain
  arrays in `useState`; ordering comes from the array, never from a sort.
- No new dependency: the picker is a shadcn `Checkbox` list, not a combobox
  library (F7).
- Do not touch the four 026.3 entity pages beyond the one `create-task` link.

## Verify

`npm run test --workspace ui -- src/lib/task-create-body.test.ts` — new file:

- a draft with only a title produces exactly `{title}` — assert
  `Object.keys(body)` has length 1, so `paused`/`after`/empty arrays can never
  leak;
- `ac: ["a","b","c"]` submits in that exact order; after `ac-down` on index 0 the
  order is `["b","a","c"]`;
- blank-after-trim entries are dropped from `ac`, `verification` and
  `dependencies`; an all-blank array omits the key;
- `context` rows `[{k:"a",v:"1"},{k:"",v:"x"},{k:"a",v:"2"}]` produce
  `{a: "2"}`; no rows with a key produce **no** `context` key;
- `instructions` and `agent` are trimmed, and omitted when blank.

`npm run test --workspace ui -- src/pages/entity-task-create.test.tsx` — new file:

- the page renders `create-task-form` with every id in the table above;
- `ac-add` appends a row; `ac-remove` on index 1 removes that row only;
  `ac-up`/`ac-down` move by one and are disabled at the ends;
- the dependency picker lists the initiative's tasks in the fetched order and
  excludes nothing (the task does not exist yet, so there is no self to exclude);
- submitting calls `createTask` once with the exact body from
  `taskCreateBody(draft)`;
- a blank title keeps `create-task-submit` disabled and issues no request;
- a `400 unknown_agent` renders `create-task-error` with the server's message and
  the draft is still in the DOM;
- on success `invalidateFor("task.create", {projectId, initiativeId})` ran and
  the navigation target is the created task's URL built from the response body's
  `id`;
- a scope mismatch from `useObjectiveChain` renders `scope-mismatch` and **no**
  `create-task-form`.

`npm run test --workspace ui -- src/app/routes.test.tsx` — extended:

- the `/…/task/new` pattern is present exactly once and sits before
  `/…/task/:taskId`; `path: "*"` is still last;
- a memory-router render of `/project/p1/initiative/i1/objective/o1/task/new`
  mounts the create page, and `/…/task/t1` still mounts 026.3's task page;
- **the two registries agree** — a new guard test: every `ROUTE_TABLE` path
  resolves to a route in `createAppRouter()`, and every leaf path the factory
  registers appears in `ROUTE_TABLE`. `AppRoute` carries no `element`, so the
  table and the factory are two hand-kept lists; without this guard a future
  entry can exist in one and not the other. Build the factory's path set by
  walking its route objects, joining a child's `path` onto its parent's.

`npm run test --workspace ui -- src/pages/entity-objective.test.tsx` — extended:
`create-task` links to the `new` URL and the tab set is unchanged.

`npm run verify` exits 0.

Proof: the task created through the UI in story 08's phase C, and its API
verification.
