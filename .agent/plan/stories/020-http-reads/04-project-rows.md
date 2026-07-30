# Story S4 — project rows, shared view mirrors, `optionalQueryString`

Epic: `.agent/plan/epics/020-http-reads.md`
Depends on: Story S1 (`defineRoute`), S2 (`PATH_SEGMENTS`), S3 (`name` filter).

## Change

### 1. `src/apps/http/decode.ts` — add one helper (after `optionalQueryInt`)

```ts
export function optionalQueryString(
  query: Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  const raw = query[name];
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    throw new InvalidInputError(name, "must be a single value");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidInputError(name, "must not be blank");
  }
  return trimmed;
}
```

### 2. `src/apps/http/views/shared.ts` (new) — mirrors of `domain/` shapes

`apps/` may not import `src/domain/**`, so `Action`
(`src/domain/actionability.ts:23-30`), `UnsatisfiedEdge`
(`src/domain/sequencing.ts:4-7`) and `Event` (`src/domain/event.ts:37-45`) are
re-declared here once and mapped literally. Later stories import from this file.

```ts
export interface ActionView {
  readonly kind: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly targetDependencyId?: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
  readonly [key: string]: unknown;
}

export interface ActionResult {
  readonly kind: string;
  readonly target: { readonly type: string; readonly id: string };
  readonly targetDependencyId?: string;
  readonly requiresInput: readonly string[];
  readonly command?: string;
}

export function actionView(result: ActionResult): ActionView {
  return {
    kind: result.kind,
    target: { type: result.target.type, id: result.target.id },
    ...(result.targetDependencyId !== undefined
      ? { targetDependencyId: result.targetDependencyId }
      : {}),
    requiresInput: [...result.requiresInput],
    ...(result.command !== undefined ? { command: result.command } : {}),
  };
}

export function nullableActionView(
  result: ActionResult | null,
): ActionView | null {
  return result === null ? null : actionView(result);
}

export interface UnsatisfiedEdgeView {
  readonly id: string;
  readonly neverSatisfies: boolean;
  readonly [key: string]: unknown;
}

export function unsatisfiedEdgeView(result: {
  readonly id: string;
  readonly neverSatisfies: boolean;
}): UnsatisfiedEdgeView {
  return { id: result.id, neverSatisfies: result.neverSatisfies };
}

export interface EventView {
  readonly id: string;
  readonly type: string;
  readonly taskId?: string;
  readonly objectiveId?: string;
  readonly initiativeId?: string;
  readonly repositoryId?: string;
  readonly payload?: Record<string, string>;
  readonly [key: string]: unknown;
}

export interface EventResult {
  readonly id: string;
  readonly type: string;
  readonly taskId?: string;
  readonly objectiveId?: string;
  readonly initiativeId?: string;
  readonly repositoryId?: string;
  readonly payload?: Record<string, string>;
}

export function eventView(result: EventResult): EventView {
  return {
    id: result.id,
    type: result.type,
    ...(result.taskId !== undefined ? { taskId: result.taskId } : {}),
    ...(result.objectiveId !== undefined
      ? { objectiveId: result.objectiveId }
      : {}),
    ...(result.initiativeId !== undefined
      ? { initiativeId: result.initiativeId }
      : {}),
    ...(result.repositoryId !== undefined
      ? { repositoryId: result.repositoryId }
      : {}),
    ...(result.payload !== undefined ? { payload: { ...result.payload } } : {}),
  };
}
```

### 3. `src/apps/http/views/project.ts` (new)

`Project` is a `domain/` entity (`src/domain/project.ts:4-6`: `id`,
`projectId?`, `name`) → local `ProjectResult` mirror, and the view emits `id` +
`name` ONLY (`projectId` is never populated on a project and must not appear).

`GetProjectOverviewOutput` lives in `src/app/project/get-project-overview.ts:101-134`
→ import it `import type`.

```ts
import type { GetProjectOverviewOutput } from "../../../app/project/get-project-overview.ts";
import {
  actionView,
  eventView,
  nullableActionView,
  type ActionView,
  type EventView,
} from "./shared.ts";

export interface ProjectResult {
  readonly id: string;
  readonly name: string;
}

export interface ProjectView {
  readonly id: string;
  readonly name: string;
  readonly [key: string]: unknown;
}

export function projectView(result: ProjectResult): ProjectView {
  return { id: result.id, name: result.name };
}
```

Then `projectOverviewView(result: GetProjectOverviewOutput): ProjectOverviewView`
with this EXACT field structure — every field of the app DTO, nothing added,
nothing dropped:

- `projectId`
- `initiatives`: `result.initiatives.map((i) => ({ id, name, status, paused,
taskCounts: { pending, running, completed, failed, awaiting_confirmation,
discarded }, needsHuman, action: nullableActionView(i.action) }))`
- `lanes`: `result.lanes.map((l) => ({ repositoryId: l.repositoryId,
objectiveIds: [...l.objectiveIds], initiativeIds: [...l.initiativeIds] }))`
- `decisions`: `result.decisions.map((d) => ({ action: actionView(d.action),
initiativeId, objectiveId, taskId, downstream, actionableSince }))`
- `digest`: `{ since, latest, totalCount, byType: { ...result.digest.byType },
events: result.digest.events.map(eventView), hasMore, pageCursor }`

Declare `ProjectOverviewView` with the matching literal interface (nested object
types written out; `action: ActionView | null`, `events: EventView[]`) plus the
`readonly [key: string]: unknown;` index signature on the TOP-LEVEL interface
only.

### 4. `src/apps/http/deps.ts` — three fields

```ts
import type { GetProject } from "../../app/project/get-project.ts";
import type { ListProjects } from "../../app/project/list-projects.ts";
import type { GetProjectOverview } from "../../app/project/get-project-overview.ts";
...
  readonly getProject: GetProject;
  readonly listProjects: ListProjects;
  readonly getProjectOverview: GetProjectOverview;
```

### 5. `src/apps/cli/commands/serve.ts:39` — populate them

```ts
const httpDeps: HttpDeps = {
  logger: deps.httpLogger,
  getProject: deps.getProject,
  listProjects: deps.listProjects,
  getProjectOverview: deps.getProjectOverview,
};
```

### 6. `src/apps/http/routes.ts` — three rows appended to `ROUTES`

| id                     | method | path                        | successStatus | kind | cliCommands                        |
| ---------------------- | ------ | --------------------------- | ------------- | ---- | ---------------------------------- |
| `project.list`         | GET    | `/api/project`              | 200           | json | `["list project", "find project"]` |
| `project.get`          | GET    | `/api/project/:id`          | 200           | json | `["get project"]`                  |
| `project.overview.get` | GET    | `/api/project/:id/overview` | 200           | json | `["get overview"]`                 |

```ts
  defineRoute({
    id: "project.list",
    method: "GET",
    path: "/api/project",
    successStatus: 200,
    kind: "json",
    cliCommands: ["list project", "find project"],
    decode: ({ query }) => {
      const name = optionalQueryString(query, "name");
      return name === undefined ? {} : { name };
    },
    run: async (deps, input) => deps.listProjects.execute(input),
    present: (result) => result.map(projectView),
  }),
  defineRoute({
    id: "project.get",
    method: "GET",
    path: "/api/project/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get project"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getProject.execute(input),
    present: (result) => projectView(result),
  }),
  defineRoute({
    id: "project.overview.get",
    method: "GET",
    path: "/api/project/:id/overview",
    successStatus: 200,
    kind: "json",
    cliCommands: ["get overview"],
    decode: ({ params }) => ({ projectId: requirePathParam(params, "id") }),
    run: async (deps, input) => deps.getProjectOverview.execute(input),
    present: (result) => projectOverviewView(result),
  }),
```

## Constraints

- `project.list`'s decode returns `{}` when `name` is absent — never
  `{ name: undefined }`.
- `project.overview.get` decodes the path param `id` into the field `projectId`
  (`GetProjectOverview.execute({ projectId })`,
  `src/app/project/get-project-overview.ts:174`).
- No `as` cast in any row.
- Views never spread an entity; `byType` and `payload` are value maps and are
  spread deliberately.

## Verify

- New `src/apps/http/views/project.test.ts`:
  - `projectView` leak test — cast `{ id, name, projectId, secret }` through
    `as unknown as ProjectResult`, assert `Object.keys(view).sort()` is exactly
    `["id","name"]`.
  - `projectOverviewView` — build a full `GetProjectOverviewOutput` fixture with
    one initiative (with an `action`), one lane, one decision, one digest event,
    plus an injected extra field on each nested object; assert the top-level key
    set, the initiative key set, the lane key set, the decision key set, the
    digest key set and the event key set are each exactly the declared list, and
    that no injected extra survives.
  - `actionView` with and without `targetDependencyId` / `command`: the optional
    keys are ABSENT (not `undefined`) when the source omits them.
- New `src/apps/http/views/shared.test.ts` — `eventView` with all optional ids
  absent gives exactly `["id","type"]`; with all present gives the full 7-key
  set; `unsatisfiedEdgeView` gives exactly `["id","neverSatisfies"]`.
- `src/apps/http/decode.test.ts` — add: `optionalQueryString` returns
  `undefined` when absent, trims, throws `InvalidInputError` naming the field for
  an array value and for a blank/whitespace value.
- New `src/apps/http/routes.project.test.ts` (supertest, fake deps per the
  index.md pattern):
  - `GET /api/project` → `200`, body `{ data: [ {id,name} ] }`; the fake
    `listProjects.execute` received `{}`.
  - `GET /api/project?name=alpha` → the fake received `{ name: "alpha" }`.
  - `GET /api/project?name=alpha&name=beta` → `400 invalid_input`.
  - `GET /api/project/p1` → `200`, fake received `{ id: "p1" }`.
  - `GET /api/project/%20` → `400 invalid_input`, and the fake's `execute` was
    NOT called (spy counter is 0).
  - `GET /api/project/p1` where the fake throws
    `new UnknownReferenceError("project","p1")` → `404 unknown_reference`.
  - `GET /api/project/p1/overview` → `200`, fake received `{ projectId: "p1" }`.
  - `POST /api/project` → `405` with `Allow: GET`.
- `node --test src/apps/http/views/project.test.ts src/apps/http/views/shared.test.ts src/apps/http/decode.test.ts src/apps/http/routes.project.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-reads-proof.sh` phase B in full, and phase E's
  `overview` block.
