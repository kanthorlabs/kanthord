# Story S6 — the six dependency sub-resource rows

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decision 4)
Depends on: Story S1, S3, S5 (`ROUTES.length` continuity).

Six rows, all `204`, no response body, no `present`, no `location`, no
`readRow`. The three `POST` rows take a request body carrying `dependencyId`;
the three `DELETE` rows take it in the path.
`ROUTES.length` becomes `46`.

## Change

### 1. `src/apps/http/deps.ts` — six fields

```ts
import type { AddDependency } from "../../app/task/add-dependency.ts";
import type { RemoveDependency } from "../../app/task/remove-dependency.ts";
import type { AddInitiativeDependency } from "../../app/initiative/add-initiative-dependency.ts";
import type { RemoveInitiativeDependency } from "../../app/initiative/remove-initiative-dependency.ts";
import type { AddObjectiveDependency } from "../../app/objective/add-objective-dependency.ts";
import type { RemoveObjectiveDependency } from "../../app/objective/remove-objective-dependency.ts";
...
  readonly addDependency: AddDependency;
  readonly removeDependency: RemoveDependency;
  readonly addInitiativeDependency: AddInitiativeDependency;
  readonly removeInitiativeDependency: RemoveInitiativeDependency;
  readonly addObjectiveDependency: AddObjectiveDependency;
  readonly removeObjectiveDependency: RemoveObjectiveDependency;
```

### 2. `src/apps/cli/commands/serve.ts` — populate them

```ts
      addDependency: deps.addDependency,
      removeDependency: deps.removeDependency,
      addInitiativeDependency: deps.addInitiativeDependency,
      removeInitiativeDependency: deps.removeInitiativeDependency,
      addObjectiveDependency: deps.addObjectiveDependency,
      removeObjectiveDependency: deps.removeObjectiveDependency,
```

### 3. `src/apps/http/routes.ts` — six rows appended to `ROUTES`

| id                             | method | path                                           | use case                     | cliCommands                        |
| ------------------------------ | ------ | ---------------------------------------------- | ---------------------------- | ---------------------------------- |
| `task.dependency.create`       | POST   | `/api/task/:id/dependency`                     | `AddDependency`              | `["add dependency"]`               |
| `task.dependency.delete`       | DELETE | `/api/task/:id/dependency/:dependencyId`       | `RemoveDependency`           | `["remove dependency"]`            |
| `initiative.dependency.create` | POST   | `/api/initiative/:id/dependency`               | `AddInitiativeDependency`    | `["add initiative-dependency"]`    |
| `initiative.dependency.delete` | DELETE | `/api/initiative/:id/dependency/:dependencyId` | `RemoveInitiativeDependency` | `["remove initiative-dependency"]` |
| `objective.dependency.create`  | POST   | `/api/objective/:id/dependency`                | `AddObjectiveDependency`     | `["add objective-dependency"]`     |
| `objective.dependency.delete`  | DELETE | `/api/objective/:id/dependency/:dependencyId`  | `RemoveObjectiveDependency`  | `["remove objective-dependency"]`  |

All six are `successStatus: 204`, `kind: "json"`.

```ts
  defineRoute({
    id: "task.dependency.create",
    method: "POST",
    path: "/api/task/:id/dependency",
    successStatus: 204,
    kind: "json",
    cliCommands: ["add dependency"],
    decode: ({ params, body }) => ({
      taskId: requirePathParam(params, "id"),
      dependencyId: requireBodyString(body, "dependencyId"),
    }),
    run: async (deps, input) => deps.addDependency.execute(input),
  }),
  defineRoute({
    id: "task.dependency.delete",
    method: "DELETE",
    path: "/api/task/:id/dependency/:dependencyId",
    successStatus: 204,
    kind: "json",
    cliCommands: ["remove dependency"],
    decode: ({ params }) => ({
      taskId: requirePathParam(params, "id"),
      dependencyId: requirePathParam(params, "dependencyId"),
    }),
    run: async (deps, input) => deps.removeDependency.execute(input),
  }),
  defineRoute({
    id: "initiative.dependency.create",
    method: "POST",
    path: "/api/initiative/:id/dependency",
    successStatus: 204,
    kind: "json",
    cliCommands: ["add initiative-dependency"],
    decode: ({ params, body }) => ({
      initiativeId: requirePathParam(params, "id"),
      dependencyId: requireBodyString(body, "dependencyId"),
    }),
    run: async (deps, input) => deps.addInitiativeDependency.execute(input),
  }),
  defineRoute({
    id: "initiative.dependency.delete",
    method: "DELETE",
    path: "/api/initiative/:id/dependency/:dependencyId",
    successStatus: 204,
    kind: "json",
    cliCommands: ["remove initiative-dependency"],
    decode: ({ params }) => ({
      initiativeId: requirePathParam(params, "id"),
      dependencyId: requirePathParam(params, "dependencyId"),
    }),
    run: async (deps, input) => deps.removeInitiativeDependency.execute(input),
  }),
  defineRoute({
    id: "objective.dependency.create",
    method: "POST",
    path: "/api/objective/:id/dependency",
    successStatus: 204,
    kind: "json",
    cliCommands: ["add objective-dependency"],
    decode: ({ params, body }) => ({
      objectiveId: requirePathParam(params, "id"),
      dependencyId: requireBodyString(body, "dependencyId"),
    }),
    run: async (deps, input) => deps.addObjectiveDependency.execute(input),
  }),
  defineRoute({
    id: "objective.dependency.delete",
    method: "DELETE",
    path: "/api/objective/:id/dependency/:dependencyId",
    successStatus: 204,
    kind: "json",
    cliCommands: ["remove objective-dependency"],
    decode: ({ params }) => ({
      objectiveId: requirePathParam(params, "id"),
      dependencyId: requirePathParam(params, "dependencyId"),
    }),
    run: async (deps, input) => deps.removeObjectiveDependency.execute(input),
  }),
```

### 4. `src/apps/http/routes.test.ts` — the row count

```ts
test("ROUTES holds exactly 46 rows: 40 after the resource writes, plus the 6 dependency rows", () => {
  assert.equal(ROUTES.length, 46);
});
```

### 5. `src/apps/http/cli-coverage.test.ts` — six more claimed leaves

Add `"add dependency"`, `"remove dependency"`, `"add initiative-dependency"`,
`"remove initiative-dependency"`, `"add objective-dependency"`,
`"remove objective-dependency"`.

## Change notes that are binding

- `204`, not `201` + `Location` (decision 4's stated exception to decision 1):
  the edge has no representation of its own, there is no
  `GET …/dependency/:dependencyId` row and none is planned, and both use cases
  return `Promise<void>` — a `Location` pointing at a path that 404s would be a
  lie. The edge set is already visible as `dependencies` on the task DTO and as
  edges in `GET /api/initiative/:id/graph`.
- `POST`, not `PUT`: `PUT` is banned by the route-policy test
  (`routes.test.ts:96-100`) and absent from `HttpMethod`.
- **`POST` addresses the edge collection and carries the id in the body**
  (`/api/task/:id/dependency` + `{"dependencyId":"…"}`); only `DELETE` names the
  edge in its path (review, 2026-07-30). A `POST` to
  `…/dependency/:dependencyId` with an empty body names the thing it is about to
  create — the `PUT` idiom under a banned method — and leaves the body
  meaningless. The two paths therefore carry one method each.

## Constraints

- No row declares `present` (forbidden for `204`), `location` (forbidden unless
  `201`) or `readRow` (forbidden unless `PATCH`).
- The path param is `:id`; the field name it decodes into differs per aggregate:
  `taskId`, `initiativeId`, `objectiveId` (see the use-case inputs). The three
  `DELETE` rows take a second param `:dependencyId`; the three `POST` rows read
  `dependencyId` from the body with `requireBodyString`, so a missing or blank id
  answers `400 invalid_input` naming the field before `run`.
- `POST` needs `Content-Type: application/json` — the gate at `app.ts:170` keys
  off the method (decision 2). `DELETE` is exempt from that gate but not from the
  CSRF origin gate.
- `dependency` is already in `PATH_SEGMENTS` from Story S2.
- No `as` cast in any row.

## Verify

- New `src/apps/http/routes.dependency.test.ts` (supertest + fakes):
  - `POST /api/task/t2/dependency` with `Content-Type: application/json` and
    body `{"dependencyId":"t1"}` → `204`, an empty response body
    (`res.text === ""`), **no** `ETag` header and no `Content-Type` header; the
    fake received exactly `{ taskId: "t2", dependencyId: "t1" }`.
  - `DELETE /api/task/t2/dependency/t1` (no body, no `Content-Type`) → `204`, the
    fake received exactly `{ taskId: "t2", dependencyId: "t1" }`.
  - the same happy pair for the initiative rows (`initiativeId`) and the
    objective rows (`objectiveId`), asserting the decoded field name.
  - `POST /api/task/%20/dependency` → `400 invalid_input` (blank path id);
    `POST /api/task/t2/dependency` with `{"dependencyId":"   "}` → `400
invalid_input` naming `dependencyId`; and with `{}` → `400 invalid_input`
    naming `dependencyId`. The fake was never called in any of the three.
  - `POST /api/task/t1/dependency` with `{"dependencyId":"t1"}` where the fake
    throws `new CycleError([...])` → `409 cycle_detected`.
  - where the fake throws `new UnknownReferenceError("task","x")` → `404
unknown_reference`; `new WrongTypeReferenceError("task","project","x")` →
    `400 wrong_type_reference`; `new DependenciesLockedError(...)` → `409
dependencies_locked`.
  - `POST /api/initiative/i2/dependency` with `{"dependencyId":"i1"}` where the fake throws
    `new SequencingScopeError(...)` → `400 sequencing_scope`; where it throws
    `new SequencingLockedError(...)` → `409 sequencing_locked`.
  - `POST /api/task/t2/dependency` WITHOUT `Content-Type` → `415
unsupported_media_type`, and the fake was never called (the 019 gate, first
    proved over a real row here).
  - `PUT /api/task/t2/dependency/t1` → `405` with `Allow: DELETE`, and
    `PUT /api/task/t2/dependency` → `405` with `Allow: POST` — each path carries
    one method.
  - each of the six rows: `route.present === undefined`,
    `route.location === undefined`, `route.readRow === undefined`.
- `src/apps/http/routes.test.ts` — the amended policy test passes over the six
  `204` rows.
- `node --test src/apps/http/routes.dependency.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts src/apps/http/app.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-writes-proof.sh` phases A through F in full (phase G
  is the first failure after this story).
