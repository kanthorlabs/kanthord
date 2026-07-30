# Story S4 — project / initiative / objective / task write rows

Epic: `.agent/plan/epics/021-http-planning-writes.md`
Depends on: Story S1 (`location`, `readRow`, `ETag`), S2 (body reader), S3
(error mappings).

Seven rows. `ROUTES.length` becomes `31`.

## Change

### 1. `src/apps/http/views/shared.ts` — two identity views

Append:

```ts
export interface IdView {
  readonly id: string;
  readonly [key: string]: unknown;
}

/** The minimal identity DTO every create answers with (decision 1). */
export function idView(id: string): IdView {
  return { id };
}

export interface IdsView {
  readonly ids: string[];
  readonly [key: string]: unknown;
}

/** A bulk create has no single created resource, so it answers with the ids. */
export function idsView(ids: readonly string[]): IdsView {
  return { ids: [...ids] };
}
```

### 2. `src/apps/http/deps.ts` — seven fields

```ts
import type { CreateProject } from "../../app/project/create-project.ts";
import type { RenameProject } from "../../app/project/rename-project.ts";
import type { CreateInitiative } from "../../app/initiative/create-initiative.ts";
import type { RenameInitiative } from "../../app/initiative/rename-initiative.ts";
import type { CreateObjective } from "../../app/objective/create-objective.ts";
import type { RenameObjective } from "../../app/objective/rename-objective.ts";
import type { CreateTask } from "../../app/task/create-task.ts";
...
  readonly createProject: CreateProject;
  readonly renameProject: RenameProject;
  readonly createInitiative: CreateInitiative;
  readonly renameInitiative: RenameInitiative;
  readonly createObjective: CreateObjective;
  readonly renameObjective: RenameObjective;
  readonly createTask: CreateTask;
```

### 3. `src/apps/cli/commands/serve.ts:39-60` — populate them

Add to the `httpDeps` literal:

```ts
      createProject: deps.createProject,
      renameProject: deps.renameProject,
      createInitiative: deps.createInitiative,
      renameInitiative: deps.renameInitiative,
      createObjective: deps.createObjective,
      renameObjective: deps.renameObjective,
      createTask: deps.createTask,
```

### 4. `src/apps/http/routes.ts` — seven rows appended to `ROUTES`

Add to the `./decode.ts` import nothing new; add a new import:

```ts
import {
  requireBodyString,
  optionalBodyString,
  optionalBodyStringArray,
  optionalBodyBool,
  optionalBodyRecord,
} from "./body.ts";
```

and add `idView` to the `./views/shared.ts` import list (create the import if
`routes.ts` does not import from `shared.ts` yet).

| id                            | method | path                            | status | use case           | cliCommands             |
| ----------------------------- | ------ | ------------------------------- | ------ | ------------------ | ----------------------- |
| `project.create`              | POST   | `/api/project`                  | 201    | `CreateProject`    | `["create project"]`    |
| `project.patch`               | PATCH  | `/api/project/:id`              | 200    | `RenameProject`    | `["rename project"]`    |
| `project.initiative.create`   | POST   | `/api/project/:id/initiative`   | 201    | `CreateInitiative` | `["create initiative"]` |
| `initiative.patch`            | PATCH  | `/api/initiative/:id`           | 200    | `RenameInitiative` | `["rename initiative"]` |
| `initiative.objective.create` | POST   | `/api/initiative/:id/objective` | 201    | `CreateObjective`  | `["create objective"]`  |
| `objective.patch`             | PATCH  | `/api/objective/:id`            | 200    | `RenameObjective`  | `["rename objective"]`  |
| `objective.task.create`       | POST   | `/api/objective/:id/task`       | 201    | `CreateTask`       | `["create task"]`       |

```ts
  defineRoute({
    id: "project.create",
    method: "POST",
    path: "/api/project",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create project"],
    decode: ({ body }) => ({ name: requireBodyString(body, "name") }),
    run: async (deps, input) => deps.createProject.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/project/${result}`,
  }),
  defineRoute({
    id: "project.patch",
    method: "PATCH",
    path: "/api/project/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename project"],
    readRow: "project.get",
    decode: ({ params, body }) => ({
      id: requirePathParam(params, "id"),
      name: requireBodyString(body, "name"),
    }),
    run: async (deps, input) => deps.renameProject.execute(input),
  }),
  defineRoute({
    id: "project.initiative.create",
    method: "POST",
    path: "/api/project/:id/initiative",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create initiative"],
    decode: ({ params, body }) => {
      const after = optionalBodyStringArray(body, "after");
      return {
        projectId: requirePathParam(params, "id"),
        name: requireBodyString(body, "name"),
        paused: optionalBodyBool(body, "paused") ?? false,
        ...(after !== undefined ? { after } : {}),
      };
    },
    run: async (deps, input) => deps.createInitiative.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/initiative/${result}`,
  }),
  defineRoute({
    id: "initiative.patch",
    method: "PATCH",
    path: "/api/initiative/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename initiative"],
    readRow: "initiative.get",
    decode: ({ params, body }) => ({
      id: requirePathParam(params, "id"),
      name: requireBodyString(body, "name"),
    }),
    run: async (deps, input) => deps.renameInitiative.execute(input),
  }),
  defineRoute({
    id: "initiative.objective.create",
    method: "POST",
    path: "/api/initiative/:id/objective",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create objective"],
    decode: ({ params, body }) => {
      const after = optionalBodyStringArray(body, "after");
      return {
        initiativeId: requirePathParam(params, "id"),
        name: requireBodyString(body, "name"),
        ...(after !== undefined ? { after } : {}),
      };
    },
    run: async (deps, input) => deps.createObjective.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/objective/${result}`,
  }),
  defineRoute({
    id: "objective.patch",
    method: "PATCH",
    path: "/api/objective/:id",
    successStatus: 200,
    kind: "json",
    cliCommands: ["rename objective"],
    readRow: "objective.get",
    decode: ({ params, body }) => ({
      id: requirePathParam(params, "id"),
      name: requireBodyString(body, "name"),
    }),
    run: async (deps, input) => deps.renameObjective.execute(input),
  }),
  defineRoute({
    id: "objective.task.create",
    method: "POST",
    path: "/api/objective/:id/task",
    successStatus: 201,
    kind: "json",
    cliCommands: ["create task"],
    decode: ({ params, body }) => {
      const instructions = optionalBodyString(body, "instructions");
      const ac = optionalBodyStringArray(body, "ac");
      const verification = optionalBodyStringArray(body, "verification");
      const agent = optionalBodyString(body, "agent");
      const dependencies = optionalBodyStringArray(body, "dependencies");
      const context = optionalBodyRecord(body, "context");
      return {
        objectiveId: requirePathParam(params, "id"),
        title: requireBodyString(body, "title"),
        ...(instructions !== undefined ? { instructions } : {}),
        ...(ac !== undefined ? { ac } : {}),
        ...(verification !== undefined ? { verification } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(dependencies !== undefined ? { dependencies } : {}),
        ...(context !== undefined ? { context } : {}),
      };
    },
    run: async (deps, input) => deps.createTask.execute(input),
    present: (result) => idView(result),
    location: (result) => `/api/task/${result}`,
  }),
```

### 5. `src/apps/http/routes.test.ts:247-249` — the row count

```ts
test("ROUTES holds exactly 31 rows: 24 from 019+020, plus the 7 planning-write rows of EPIC 021", () => {
  assert.equal(ROUTES.length, 31);
});
```

### 6. `src/apps/http/cli-coverage.test.ts:67-93` — seven claimed leaves

Add to `expectedCovered`: `"create project"`, `"rename project"`,
`"create initiative"`, `"rename initiative"`, `"create objective"`,
`"rename objective"`, `"create task"`, and rename the test to
`"the CLI leaves claimed by EPIC 020 and 021 all appear across ROUTES' cliCommands"`.

## Constraints

- `paused` is **not** optional on `CreateInitiative` — it defaults to `false` in
  `decode` (`optionalBodyBool(body, "paused") ?? false`) and is always present in
  the decoded object. Do not weaken the use case's required flag.
- Every other optional field uses a conditional spread, never `key: undefined`:
  `CreateInitiative` ignores `after` only when the key is absent
  (`create-initiative.ts` takes the sequencing branch on `after.length > 0`).
- A rename PATCH requires `name`: `{}` is `400 invalid_input`, not a no-op.
- `project.patch`'s `readRow` is `project.get`, `initiative.patch`'s is
  `initiative.get`, `objective.patch`'s is `objective.get`. All three read rows
  decode the same single path param `id` (`routes.ts:173`, `:210`, `:247`), so the
  PATCH row's params satisfy them unchanged.
- No PATCH row declares `present`.
- No `as` cast in any row.
- `/api/project` now has two rows (`GET` + `POST`); `matchRoute` keys on
  method+path and the policy test asserts that pair unique, so nothing else
  changes. `POST /api/project` no longer answers `405` — the assertion at
  `routes.project.test.ts:1425-1438` ("POST /api/project is 405 with Allow: GET")
  must be REPLACED by the new `201` behaviour (see Verify).

## Verify

- New `src/apps/http/routes.write-planning.test.ts` (supertest + fakes, flat
  `test(...)`, the `makeDeps` pattern from `routes.project.test.ts`). Per row,
  the three assertions 020 required, plus the write-specific ones:
  - `POST /api/project` with `{"name":"alpha"}` → `201`,
    `Location: /api/project/<id>`, body `{ data: { id: "<id>" } }`, no `ETag`
    header, and the fake received exactly `{ name: "alpha" }`.
  - `POST /api/project` with `{"name":"  a  "}` → the fake received
    `{ name: "a" }` (trimmed).
  - `POST /api/project` with `{"name":"   "}` and with `{}` → `400 invalid_input`,
    and the fake's `execute` was never called (spy counter `0`).
  - `POST /api/project` where the fake throws
    `new DuplicateNameError("project","global","alpha")` → `409 duplicate_name`.
  - `PATCH /api/project/p1` with no `If-Match` → `428 precondition_required`, and
    `renameProject.execute` was never called.
  - `PATCH /api/project/p1` with `If-Match: "stale"` → `412 precondition_failed`,
    and `renameProject.execute` was never called.
  - `PATCH /api/project/p1` with the `ETag` from `GET /api/project/p1` → `200`,
    `renameProject.execute` received exactly `{ id: "p1", name: "alpha-2" }`
    once, the body is the re-read DTO (the fake `getProject` returns the new name
    on its second call) and the response `ETag` differs from the sent one.
  - `PATCH /api/project/%20` → `400 invalid_input` with no use case called.
  - `POST /api/project/p1/initiative` with `{"name":"i"}` → the fake received
    `{ projectId: "p1", name: "i", paused: false }` — assert with
    `assert.deepEqual`, so an extra `after: undefined` key fails.
  - the same with `{"name":"i","paused":true,"after":["x"," y "]}` → the fake
    received `{ projectId: "p1", name: "i", paused: true, after: ["x","y"] }`.
  - `POST /api/project/p1/initiative` → `Location: /api/initiative/<id>`.
  - `POST /api/project/p1/initiative` where the fake throws
    `new WrongTypeReferenceError("project","initiative","p1")` → `400
wrong_type_reference`; where it throws
    `new UnknownReferenceError("project","p1")` → `404 unknown_reference`.
  - `PATCH /api/initiative/i1` and `PATCH /api/objective/o1`: the `428`, `412` and
    `200`-with-fresh-`ETag` triple for each, and the fake received `{ id, name }`.
  - `POST /api/initiative/i1/objective` → `Location: /api/objective/<id>`, fake
    received `{ initiativeId: "i1", name: "o" }`.
  - `POST /api/objective/o1/task` with only `{"title":"t"}` → the fake received
    exactly `{ objectiveId: "o1", title: "t" }` (no other keys).
  - the same with every optional field present
    (`instructions`, `ac`, `verification`, `agent`, `dependencies`, `context`) →
    the fake received all eight keys with the trimmed values, and
    `Location: /api/task/<id>`.
  - `POST /api/objective/o1/task` where the fake throws
    `new InvalidTaskFieldError(...)` → `400 invalid_task_field`; where it throws
    `new UnknownAgentError(...)` → `400 unknown_agent`.
  - each of the seven rows' `present`/`location`: for the four creates,
    `row.present!("abc")` deep-equals `{ id: "abc" }` and
    `Object.keys(...)` is exactly `["id"]`; `row.location!("abc")` equals the
    exact path in the table above. For the three PATCHes, `row.present` and
    `row.location` are both `undefined`.
- `src/apps/http/routes.project.test.ts` — replace the `405` test: `POST /api/project`
  with a valid body now answers `201`; keep a `405` case using a method with no
  row on that path (`PUT /api/project` → `405` with
  `Allow: GET, POST`).
- `src/apps/http/views/shared.test.ts` — add: `idView("x")` gives exactly
  `["id"]`; `idsView(["a","b"])` gives exactly `["ids"]`, the array deep-equals
  `["a","b"]` and is a different reference from the input.
- `node --test src/apps/http/routes.write-planning.test.ts src/apps/http/routes.project.test.ts src/apps/http/routes.test.ts src/apps/http/views/shared.test.ts src/apps/http/cli-coverage.test.ts src/apps/http/app.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-writes-proof.sh` phases A, B, C in full (phase D is
  the first failure after this story).
