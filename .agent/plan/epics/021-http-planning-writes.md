# EPIC 021 — HTTP planning writes: the first non-GET rows

> Authored 2026-07-30, on top of EPIC 020 (commit `88b9df9`). 020 shipped the
> read surface: 22 `/api` GET rows beside `/healthz` and `/` (24 rows today),
> the generic `Route` via `defineRoute`, one view module per resource, and the
> `PATH_SEGMENTS` allowlist. Every 020 row is a `GET`, so the unsafe-method
> gates 019 shipped have never run against a real row.
>
> 021 is the third step of `.agent/plan/stories/019-http-server/retirement.md`
> ("Target 021 — planning writes"). It extends the 019/020 seams; it removes no
> CLI leaf.
>
> **021 does NOT depend on EPIC 022** (the event feed + `ack project`), which is
> not authored yet. No 021 row reads or writes the feed cursor: `CreateTask`,
> `AddDependency` and `RemoveDependency` append events through the `EventFeed`
> port that `composition.ts` already wires, and nothing in 021 needs
> `GET /api/event?after=…`. 021 can be built first, and that is the better
> order: 022's `POST /api/project/:id/acknowledgement` should inherit 021's
> POST/201/`Location` and `If-Match` conventions rather than invent its own.

## Goal

The running `kanthord serve` program answers every **planning write** — the
writes a human does before any agent runs — as REST over the same singular-noun
surface 020 established. A `POST` on a collection creates and answers `201` with
a `Location` that is a real, readable route; a `PATCH` on an item requires
`If-Match` and answers `200` with the item DTO and a fresh `ETag`; a dependency
is a sub-resource toggled by `POST`/`DELETE` on
`…/dependency/:dependencyId`. `import graph` becomes a `POST` carrying the graph
package as JSON, `export initiative` a `GET`, and the two `check` leaves split
by whether the computation is over the posted document (`POST`) or over stored
state (`GET`). After 021 the request-body reader exists with its `415`/`413`/
malformed-JSON behaviour, the `ETag`/`If-Match` convention 019 deferred is real
and proved, and the Host, CSRF and content-type gates 019 shipped are exercised
by actual rows. 27 CLI write leaves are covered by 28 rows and become retirable;
none is removed in 021.

## Decisions (binding; do not re-open at build time)

### 0. What 021 inherits and may NOT re-open

- **Singular path segments** and the `PATH_SEGMENTS` allowlist test (020
  decision 1 + 2). 021 adds four segments — see decision 8.
- **`defineRoute` / `RouteDefinition<Input, Output>`** (020 decision 3). No
  per-row `as` cast, no `route.present!`. 021 extends the definition type; it
  does not weaken it.
- **One view module per resource** under `src/apps/http/views/`, each with a
  LITERAL field list, no `domain/` import and no object spread (020 decision
  10).
- **The 019 envelope, Basic auth, the error registry and the middleware order.**
  021 adds no middleware and does not reorder the eight that exist.

### 1. `POST` on the collection → `201` + `Location`; `PATCH` on the item → `200` + the DTO

`POST /api/project` answers `201`, sets
`Location: /api/project/<newId>`, and its body is the minimal identity DTO
`{"id":"<ulid>"}` inside the 019 envelope. Rationale: every create use case
returns only the new id (`CreateProject.execute` →
`Promise<string>`, `src/app/project/create-project.ts:13`); presenting a full
entity would mean a second read the use case never did, and `Location` already
tells the client where the full representation lives.

**A row that answers `201` MUST declare how its `Location` is built** — a new
`location?: (result: Output) => string` field on `RouteDefinition`, required iff
`successStatus === 201`, enforced by the route-policy test exactly as `present`
is. No `Location` is ever derived from the row's `path` by string surgery: two
rows (`project.credential.create` → `/api/resource/<id>`,
`project.graph.create` → `/api/initiative/<id>`) point at a DIFFERENT resource
than the one they posted to, so a derived `Location` would be wrong for them.

**The item `PATCH` answers `200` with the item DTO** (Ulrich, 2026-07-30), not
`204`. All seven PATCH use cases return `Promise<void>`, so the body comes from
re-reading the paired GET row after the write — the same machinery decision 3
already needs for `If-Match`. The gain is that one round trip both applies the
change and hands the UI the new representation **with its new validator**;
`204` would force every editing screen into a second request to become able to
edit again.

`DELETE` answers `204` with no body. The dependency rows also answer `204` — see
decision 4.

### 2. The request-body reader

**Where it lives:** a new `src/apps/http/body.ts`, sibling to the existing
`decode.ts`, exporting the same _shape_ of helpers that file already
establishes — `requireBodyString(body, field)`,
`optionalBodyString`, `optionalBodyStringArray`, `optionalBodyBool`,
`requireBodyObject`, `optionalBodyRecord`. Each throws the existing
`InvalidInputError(field, reason)` → `400 invalid_input`. Rationale: `decode.ts`
holds the _params/query_ readers and 021's rows need the _body_ readers in the
same `decode` function; splitting by input location keeps both files small and
keeps `decode.ts` untouched by this epic.

`requireBodyString` trims and rejects blank, mirroring `requirePathParam`
(`src/apps/http/decode.ts:9-12`), so `{"name":"   "}` never reaches
`CreateProject` — which itself has no name validation
(`create-project.ts:14-20`).

**Size limit: unchanged at 1 MiB.** 019 already configured
`bodyParser({ enableTypes: ["json"], jsonLimit: "1mb" })`
(`src/apps/http/app.ts:200`). The largest 021 body is a graph package; the
biggest package in `scripts/e2e/` is a few KiB, so 1 MiB is ample and raising a
limit nobody has hit is speculative.

**`415` / `413` / malformed-JSON `400` all already exist and are NOT re-built.**
Verified in the current tree, not assumed:

- `415 unsupported_media_type` — the unsafe-method gate rejects a `POST`/`PATCH`
  whose type is not `application/json` BEFORE the body parser
  (`app.ts:170-176`).
- `413 body_too_large` and `400 malformed_body` — `mapError` recognises the
  `http-errors`-shaped status `@koa/bodyparser` throws
  (`error-registry.ts:92-96`), and the error boundary drains the request first
  (`app.ts:78-85`).

**So the only NEW registry codes 021 needs are the two preconditions of
decision 3** (`precondition_required`, `precondition_failed`) plus the domain
errors decision 6 enumerates. 021's job on `415`/`413`/`400` is to **prove** the
019 wiring over a real row, not to add code — the Proof's phase B does exactly
that.

**Body-less `POST` still sends `Content-Type: application/json`.** The gate at
`app.ts:170` keys off the method, not the presence of bytes, so
`POST /api/task/:id/dependency/:otherId` must carry the header (the Proof sends
`{}`). Deliberately unchanged: relaxing the gate to "only when a body is
present" trades a one-line client convention for a weaker CSRF-adjacent check,
and every `fetch` the UI makes sets the header anyway.

### 3. The `ETag` / `If-Match` convention 019 deferred

**No entity carries a version or `updatedAt` column** — `Project` is
`{id, name}` (`src/domain/project.ts:4-6`), and `Initiative`, `Objective` and
`Task` are equally version-free. So:

- **The ETag is a strong validator computed from the item's presented DTO:**
  `"` + `sha256(JSON.stringify(dto))` + `"`, computed in the dispatcher from the
  same `present` output the client received. Both sides run the identical view
  function with its literal field list, so key order is identical by
  construction and the hash is stable without a canonicaliser. It hashes the
  DTO, not the enveloped bytes, so the value is unaffected by envelope changes.
- **Every `200` `kind: "json"` response carries `ETag`.** One line in dispatch,
  no per-row configuration. `If-None-Match`/`304` is a non-goal (see Non-goals).
- **`If-Match` is REQUIRED on every `PATCH` row** (Ulrich, 2026-07-30). Absent →
  `428 precondition_required`; present but not equal to the current validator →
  `412 precondition_failed`. `POST` and the dependency rows require nothing:
  there is no prior state to be stale about.
- **Enforcement is declarative, never logic inside `run`.** `RouteDefinition`
  gains `readRow?: string` — the `id` of the GET row that IS this item's
  representation — required iff `method === "PATCH"`, forbidden otherwise. For
  such a row the dispatcher: (a) resolves `readRow`, runs its `decode` over the
  SAME params and its `run`+`present`, hashes the DTO and compares with
  `If-Match`; (b) runs the PATCH row's `run`; (c) repeats (a) and answers `200`
  with that DTO and the fresh `ETag`. A PATCH row therefore declares **no
  `present` of its own** — the route-policy test's "present required unless
  204" rule becomes "unless `204` **or** `readRow` is set".
  A missing entity 404s inside step (a), before any write.
- **`428` must be added to `ALLOWED_STATUSES`** in
  `src/apps/http/error-registry.test.ts:17-19` — 019 listed `412` there but not
  `428`. That one-line, reviewed edit is the intended discipline, the same as
  adding to `PATH_SEGMENTS`.
- The four resource PATCH rows all use `readRow: "resource.get"`, because 020
  decision 6 made `GET /api/resource/:id` the single, type-agnostic
  representation. `readRow` names a ROW, not a path, so this works even though
  the PATCH paths are typed (decision 5).
- **`If-Match` here is advisory, not a serializable compare-and-swap.** The
  pre-read → compare → `run` → re-read sequence spans three separate `await`s
  with no transaction and no per-entity lock, so two concurrent `PATCH`es
  carrying the same valid validator both pass the compare and both write. It
  guards a stale editor — a client that fetched the DTO, waited, and sent a
  write — which is the case the UI actually has. The Proof proves that one
  (phase E replays the old validator and gets `412`); it does not prove the
  concurrent one. A real CAS needs a version column or a write transaction, and
  neither is in 021's scope.

### 4. Dependencies are sub-resources, and they answer `204`

`POST /api/task/:id/dependency/:dependencyId` and `DELETE` on the same path;
the same shape for `initiative` and `objective`:

```
POST|DELETE /api/task/:id/dependency/:dependencyId
POST|DELETE /api/initiative/:id/dependency/:dependencyId
POST|DELETE /api/objective/:id/dependency/:dependencyId
```

Six use cases, six rows, `run` one line each. The CLI's three verb pairs
(`add dependency` / `remove dependency`, and the `initiative-` and `objective-`
variants) collapse into one path shape with two methods, so the "which noun does
this verb belong to" ambiguity disappears into the path.

**`204`, not `201` + `Location`** — the stated exception to decision 1. The edge
has no representation of its own: there is no `GET
…/dependency/:dependencyId` row and none is planned (the edge set is already
visible as `dependencies` on the task DTO and as edges in
`GET /api/initiative/:id/graph`). A `201 Location` pointing at a path that
404s would be a lie. Both use cases return `Promise<void>`, so there is nothing
to present either. `POST` (not `PUT`) because `PUT` is banned by the route-policy
test (`routes.test.ts:96-100`).

### 5. Typed PATCH paths for the four resource types

`PATCH /api/repository/:id`, `/api/credential/:id`, `/api/notification/:id`,
`/api/filesystem/:id` — four rows, one per use case (`UpdateRepository`,
`UpdateCredential`, `UpdateNotification`, `UpdateFilesystem`). Rejected
alternative: one `PATCH /api/resource/:id` with a `type` discriminator in the
body — its `run` would have to switch on the type, which is exactly the logic
`RouteDefinition.run` forbids, and no app-layer facade may fix it (a use case
never calls a use case, AGENTS.md). The type sits in the path for the same
reason 020 decision 6 put it there for the collections.

The asymmetry is deliberate and stated: reads use one type-agnostic item route,
writes use four typed ones, because reading a resource needs no knowledge of
which fields are mutable and writing one needs all of it.

The four resource PATCH rows accept `type` in the request body as an
immutable-field probe. `decode` passes it into `Update*Input`, whose runtime
guard throws `ImmutableFieldError`. Without this field, `409 immutable_field` is
unreachable, while the registry and Proof phase E both require it.

`create credential` carries the secret **in the request body** (`{"value":"…"}`)
because the CLI's `--value-file <path|->` reads it from a file or stdin and
neither exists over HTTP. This is the only 021 field that is a secret; it is
never presented back (020's credential view has no `value` field) and the Proof
asserts it appears in neither a response nor a log line.

### 6. Reads and writes among `import` / `export` / `check` — each decided from the code

| CLI leaf            | HTTP                                                      | why                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import graph`      | **POST** ×2 (create on a project, apply on an initiative) | `CreateGraph` and `ApplyGraph` both take an in-memory `GraphPackage` (`create-graph.ts:44`, `apply-graph.ts:222`), so the body carries the package as JSON. Two use cases → two rows.                                                                                                                                                         |
| `import resource`   | **POST** collection, `200` + ids                          | `ImportResources.execute({projectId, entries})` → `Promise<string[]>` (`import-resources.ts:40`). A bulk create has no single created resource, so no `Location` (Ulrich, 2026-07-30).                                                                                                                                                        |
| `export initiative` | **GET** `/api/initiative/:id/package`                     | `ExportInitiative.execute(id)` is read-only and returns the `GraphPackage`; every write in the CLI path is the adapter's file I/O (`src/apps/cli/export.ts:1-5` says so explicitly). An HTTP client receives the JSON and writes its own files.                                                                                               |
| `export diagnostic` | **POST** `/api/initiative/:id/diagnostic`, `200`          | Not a read: every call mints a fresh session ref through `getOrCreateSessionRef`, which `INSERT`s a row (`src/storage/sqlite/sqlite-observability-refs.ts:25-46`). It also must NOT accept the CLI's `--out` path — a client-supplied server filesystem path is an arbitrary-file-write primitive — so the document is returned, not written. |
| `check graph`       | **POST** `/api/graph/readiness`, `200`                    | `CheckGraph.execute({tasks})` computes over the CALLER's graph and stores nothing (`check-graph.ts:16-27`); the CLI reads the tasks from a YAML file, which has no HTTP twin. A document that does not fit a URL is a POST body. No `Location`: nothing was created.                                                                          |
| `check project`     | **GET** `/api/project/:id/readiness`                      | `CheckProject` is a pure read over stored state — with `probeRepositories:false, probeProvider:false` bound literally in `decode`.                                                                                                                                                                                                            |

**The two `check project` probe flags are deliberately NOT exposed** (Ulrich,
2026-07-30). `--probe-provider` makes a real, billable model call and
`--probe-repositories` runs `git ls-remote`; hanging outbound I/O off a `GET`
would break the read/write split 020 established and make this Proof
non-hermetic. Probing belongs with EPIC 024, which already owns
`POST /api/ai-provider/:id/probe`. `retirement.md` records that `check project
--probe-*` stays an operator CLI action until then; the route claims the leaf
for the UI's readiness screen.

`import graph --create` needs a `packageId` the caller mints
(`create-graph.ts:44`); the CLI passes `deps.newId`, so `HttpDeps` gains
`newId: () => string` and the row mints it. `--bind alias=name` resolution stays
CLI-only: over HTTP `bindings` is an alias → resource **id** map, so
`AmbiguousBindingNameError` and `UnknownBindingNameError` are unreachable and
(per 019 decision 11) are NOT registered. The CLI's markdown-package parsing and
manifest rewriting also stay CLI-only — the HTTP body is an already-parsed
package.

The JSON graph package is validated server-side by a new app-layer decoder
(`src/app/graph/decode-graph-package.ts`) that throws
`GraphPackageDocumentError`. The client-side `graph-codec.parseGraphPackage` is
not the server's validator.

### 7. App-layer changes 021 requires — found by reading the use cases

Two, both deliberate, both mirroring 020 decision 7's precedent:

1. **`ExportInitiative` must throw `UnknownReferenceError`.** It currently
   throws a bare `Error("Initiative not found: …")`
   (`src/app/graph/export-initiative.ts:46-48`), which `mapError` cannot
   classify, so `GET /api/initiative/<unknown>/package` would answer
   `500 internal` while every other unknown-id read answers
   `404 unknown_reference`. 021 changes it to
   `throw new UnknownReferenceError("initiative", initiativeId)`. The CLI
   inherits a better message; no backward-compatibility duty (AGENTS.md).
2. **`DiagnosticsExport` must separate building from writing.**
   `execute(input)` builds the export object and then writes it to
   `input.outPath` in one method (`diagnostics-export.ts:115-322`). 021 extracts
   `build(input: {initiativeId, taskId?, debug?}): Promise<SafeFactsExport>`
   and leaves `execute` as `build` + `writeFile` + preview, unchanged for the
   CLI. The HTTP row calls `build`, so no request can name a server path.

Checked and deliberately NOT changed:

- `CheckGraph.execute` is **synchronous** (`check-graph.ts:17`). `run` is
  `async`, so `run: async (deps, i) => deps.checkGraph.execute(i)` is legal as
  is. No signature change.
- `AddResource` takes a discriminated `AddResourceInput` whose `type` each row
  binds literally (`add-resource.ts:20-49`) — the same pattern as 020's four
  typed collections. `type` is not weakened to optional.
- `Update*Input` carries an `[key: string]: unknown` index signature
  (`update-resource.ts:5`) used by the runtime immutable-field guard. `decode`
  builds its object with a literal field list regardless, so nothing changes.
  That literal list includes `type`, the immutable-field probe — see decision 5.
- `UpdateCredential` calls `addResource(cred.projectId ?? "", …)`
  (`update-credential.ts:39`). Harmless: the upsert's `ON CONFLICT` clause never
  updates `projectId`
  (`src/storage/sqlite/sqlite-project-repository.ts:56-63`), so a PATCH cannot
  move a resource out of its project. Recorded here so a reviewer need not
  re-derive it; not changed.
- `InvalidObjectiveIdError` is thrown by the SQLite task repository
  (`sqlite-task-repository.ts`), but `CreateTask` resolves the objective's kind
  first and 404s on a bad id (`create-task.ts:57-60`), so it is unreachable from
  a 021 row and is NOT registered.

### 8. Four new path segments, and the first use of 020's escape hatch

`PATH_SEGMENTS` gains `dependency`, `package`, `diagnostic` and `readiness`.
`readiness` ends in `s` and is genuinely singular, so it is the **first entry in
`NOT_PLURAL`** — the escape hatch 020 decision 2 built, used exactly as designed
(an explicit named entry a reviewer sees). None of the four is in
`BANNED_VERBS`, and note what never appears as a segment: `import`, `export`,
`check`, `create`, `update`, `rename`, `add`, `remove`. The verbs live in the
method; the operation, when it is neither a create nor a state read, is named in
the row `id` (`initiative.graph.apply`, `initiative.diagnostic.export`,
`graph.readiness.check`) — ids are not paths.

### 9. The unsafe-method gates: what actually runs now

021 is the first epic with non-GET rows, so state exactly which of 019's gates
each write passes through, in middleware order:

| gate              | where            | behaviour on a 021 row                                                                                                                                                                                                                                                                           |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host check        | `app.ts:138-145` | Runs on every method. A `Host` that is not `127.0.0.1`/`localhost` → `403 host_not_allowed`. Already ran for GETs; unchanged.                                                                                                                                                                    |
| `@koa/cors`       | `app.ts:148-156` | `allowMethods` already lists `GET, POST, PATCH, DELETE`, so a preflight for a 021 row is answered correctly with no change.                                                                                                                                                                      |
| Basic auth        | `app.ts:159-166` | Covers writes with no per-route work (019 decision 4).                                                                                                                                                                                                                                           |
| content-type gate | `app.ts:170-176` | **First time it fires.** `POST`/`PATCH` (`requiresJsonContentType`) without `application/json` → `415`. `DELETE` is exempt.                                                                                                                                                                      |
| CSRF origin gate  | `app.ts:177-195` | **First time it fires.** For `POST`/`PATCH`/`DELETE` (`requiresOriginCheck`), a present `Origin` must equal the server's own scheme+host+port → else `403 origin_not_allowed`. An ABSENT `Origin` passes, by design: a non-browser client (curl, the CLI) sends none, and a browser always does. |
| `@koa/bodyparser` | `app.ts:200`     | **First time it matters.** `413`/`400` per decision 2.                                                                                                                                                                                                                                           |

No middleware is added, removed or reordered. The Proof's phase I exercises the
Host check, both CSRF outcomes, the `415` gate, the preflight and an
unauthenticated write, and asserts the rejected write changed nothing.

## Route table (28 rows covering 27 CLI leaves)

`kind` is `"json"` for every row. `If-Match` is required exactly on the six
`PATCH` rows.

| id                             | path                                           | method | status | use case                              | `cliCommands`                  |
| ------------------------------ | ---------------------------------------------- | ------ | ------ | ------------------------------------- | ------------------------------ |
| `project.create`               | `/api/project`                                 | POST   | 201    | `CreateProject`                       | `create project`               |
| `project.patch`                | `/api/project/:id`                             | PATCH  | 200    | `RenameProject`                       | `rename project`               |
| `project.initiative.create`    | `/api/project/:id/initiative`                  | POST   | 201    | `CreateInitiative`                    | `create initiative`            |
| `initiative.patch`             | `/api/initiative/:id`                          | PATCH  | 200    | `RenameInitiative`                    | `rename initiative`            |
| `initiative.objective.create`  | `/api/initiative/:id/objective`                | POST   | 201    | `CreateObjective`                     | `create objective`             |
| `objective.patch`              | `/api/objective/:id`                           | PATCH  | 200    | `RenameObjective`                     | `rename objective`             |
| `objective.task.create`        | `/api/objective/:id/task`                      | POST   | 201    | `CreateTask`                          | `create task`                  |
| `project.repository.create`    | `/api/project/:id/repository`                  | POST   | 201    | `AddResource` (`type` bound)          | `create repository`            |
| `project.credential.create`    | `/api/project/:id/credential`                  | POST   | 201    | `AddResource` (`type` bound)          | `create credential`            |
| `project.notification.create`  | `/api/project/:id/notification`                | POST   | 201    | `AddResource` (`type` bound)          | `create notification`          |
| `project.filesystem.create`    | `/api/project/:id/filesystem`                  | POST   | 201    | `AddResource` (`type` bound)          | `create filesystem`            |
| `repository.patch`             | `/api/repository/:id`                          | PATCH  | 200    | `UpdateRepository`                    | `update repository`            |
| `credential.patch`             | `/api/credential/:id`                          | PATCH  | 200    | `UpdateCredential`                    | `update credential`            |
| `notification.patch`           | `/api/notification/:id`                        | PATCH  | 200    | `UpdateNotification`                  | `update notification`          |
| `filesystem.patch`             | `/api/filesystem/:id`                          | PATCH  | 200    | `UpdateFilesystem`                    | `update filesystem`            |
| `project.resource.create`      | `/api/project/:id/resource`                    | POST   | 200    | `ImportResources`                     | `import resource`              |
| `task.dependency.create`       | `/api/task/:id/dependency/:dependencyId`       | POST   | 204    | `AddDependency`                       | `add dependency`               |
| `task.dependency.delete`       | `/api/task/:id/dependency/:dependencyId`       | DELETE | 204    | `RemoveDependency`                    | `remove dependency`            |
| `initiative.dependency.create` | `/api/initiative/:id/dependency/:dependencyId` | POST   | 204    | `AddInitiativeDependency`             | `add initiative-dependency`    |
| `initiative.dependency.delete` | `/api/initiative/:id/dependency/:dependencyId` | DELETE | 204    | `RemoveInitiativeDependency`          | `remove initiative-dependency` |
| `objective.dependency.create`  | `/api/objective/:id/dependency/:dependencyId`  | POST   | 204    | `AddObjectiveDependency`              | `add objective-dependency`     |
| `objective.dependency.delete`  | `/api/objective/:id/dependency/:dependencyId`  | DELETE | 204    | `RemoveObjectiveDependency`           | `remove objective-dependency`  |
| `project.graph.create`         | `/api/project/:id/graph`                       | POST   | 201    | `CreateGraph`                         | `import graph`                 |
| `initiative.graph.apply`       | `/api/initiative/:id/graph`                    | POST   | 200    | `ApplyGraph`                          | `import graph`                 |
| `initiative.package.get`       | `/api/initiative/:id/package`                  | GET    | 200    | `ExportInitiative`                    | `export initiative`            |
| `initiative.diagnostic.export` | `/api/initiative/:id/diagnostic`               | POST   | 200    | `DiagnosticsExport.build`             | `export diagnostic`            |
| `graph.readiness.check`        | `/api/graph/readiness`                         | POST   | 200    | `CheckGraph`                          | `check graph`                  |
| `project.readiness.get`        | `/api/project/:id/readiness`                   | GET    | 200    | `CheckProject` (probes bound `false`) | `check project`                |

`ROUTES` goes from 24 rows to **52**; `routes.test.ts`'s row-count assertion
(currently `24`) is updated in the story that lands the last row.

`Location` targets, all pointing at an EXISTING 020 row: `project.create` →
`/api/project/:id`; `project.initiative.create` → `/api/initiative/:id`;
`initiative.objective.create` → `/api/objective/:id`; `objective.task.create` →
`/api/task/:id`; the four resource creates → `/api/resource/:id`;
`project.graph.create` → `/api/initiative/:id`.

Request-body fields per row, from the use-case inputs (`decode` names them
literally):

- `project.create` `{name}` · `project.patch` `{name}` · the other two renames
  `{name}`
- `project.initiative.create` `{name, after?, paused?}` (`paused` defaults
  `false`; `CreateInitiative` requires it)
- `initiative.objective.create` `{name, after?}`
- `objective.task.create`
  `{title, instructions?, ac?, verification?, agent?, dependencies?, context?}`
- `project.repository.create`
  `{name, remoteUrl, branch, path?, auth}` (`path` defaults `""`, which
  `AddResource` derives from `remoteUrl`)
- `project.credential.create` `{name, provider, value}` ·
  `project.notification.create` `{name, provider, destination}` ·
  `project.filesystem.create` `{name, path}`
- `repository.patch` `{name?, branch?, path?, remoteUrl?, auth?, reclone?}` ·
  `credential.patch` `{name?, value?}` · `notification.patch`
  `{name?, destination?}` · `filesystem.patch` `{name?, path?}`
- `project.resource.create` `{entries: object[]}`
- the six dependency rows: no body (`:dependencyId` is the path)
- `project.graph.create` `{pkg, paused?, bindings?}` (`packageId` from
  `deps.newId`) · `initiative.graph.apply`
  `{pkg, dryRun?, deleteMissing?, confirmDelete?}`
- `initiative.diagnostic.export` `{task?, debug?}` — never a path
- `graph.readiness.check` `{tasks: [{id, dependencies?}]}`

Field-name mismatches `decode` must get right (the 020 note continues):
`CreateTask` takes `{objectiveId}` from the path; `AddDependency` /
`RemoveDependency` take `{taskId, dependencyId}`; the initiative and objective
dependency use cases take `{initiativeId|objectiveId, dependencyId}`;
`ExportInitiative` and `CheckProject` take a POSITIONAL string and `{id, …}`
respectively; `ApplyGraph` takes `{pkg, initiativeId, …}` while `CreateGraph`
takes `{pkg, projectId, packageId, paused, bindings?}`.

## Error registry additions (019 decision 11: only what a row can raise)

Two transport codes (thrown by dispatch):
`precondition_required` → `428`, `precondition_failed` → `412`. `428` joins
`ALLOWED_STATUSES` in the registry test.

Domain mappings, each justified by the module that throws it:

| class                       | code                    | status |
| --------------------------- | ----------------------- | ------ |
| `WrongTypeReferenceError`   | `wrong_type_reference`  | 400    |
| `CycleError`                | `cycle_detected`        | 409    |
| `DuplicateTaskError`        | `duplicate_task`        | 409    |
| `UnknownDependencyError`    | `unknown_dependency`    | 400    |
| `DependenciesLockedError`   | `dependencies_locked`   | 409    |
| `SequencingScopeError`      | `sequencing_scope`      | 400    |
| `SequencingLockedError`     | `sequencing_locked`     | 409    |
| `UnknownAgentError`         | `unknown_agent`         | 400    |
| `InvalidTaskFieldError`     | `invalid_task_field`    | 400    |
| `EmbeddedCredentialError`   | `embedded_credential`   | 400    |
| `ImmutableFieldError`       | `immutable_field`       | 409    |
| `CacheConflictError`        | `cache_conflict`        | 409    |
| `ImportValidationError`     | `import_validation`     | 400    |
| `CreateModeIdError`         | `create_mode_id`        | 400    |
| `UnboundAliasError`         | `unbound_alias`         | 400    |
| `ExecutorBindingSetError`   | `executor_binding_set`  | 400    |
| `UnknownNodeError`          | `unknown_node`          | 404    |
| `CrossInitiativeError`      | `cross_initiative`      | 409    |
| `StaleManifestError`        | `stale_manifest`        | 409    |
| `UncreatableObjectiveError` | `uncreatable_objective` | 409    |
| `GraphPackageDocumentError` | `invalid_package`       | 400    |

Deliberately NOT registered, with the reason: `AmbiguousNameError` (020
decision 5 — no route calls `Find*`); `AmbiguousBindingNameError`,
`UnknownBindingNameError`, `IncompatibleBindingTypeError`,
`IncompatibleProviderCredentialError`, `DriftConflictError` (no production
module throws them — `grep -rn "throw new <class>" src` finds only tests);
`DuplicateRefError` (thrown by `graph-codec.parseGraphPackage`, which runs in
the client, not on the server); `InvalidObjectiveIdError` (decision 7).
`InvalidTaskFieldError`, `DuplicateTaskError` and `UnknownDependencyError` live
in `domain/` or are re-exported from a use-case module, so the registry story
adds the missing `app/errors.ts` re-exports rather than importing `domain/`
from `apps/`.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **The write contract in `routes.test.ts`**, iterating `ROUTES`: `location` is
  a function iff `successStatus === 201`; `readRow` is set iff
  `method === "PATCH"` and names a real row whose method is `GET`; `present` is
  set unless `successStatus === 204` or `readRow` is set; the four new
  `PATH_SEGMENTS` entries with `readiness` in `NOT_PLURAL`; the existing verb
  ban and no-plural assertions passing over all 28 new rows; the row count is 52.
- **Dispatch tests with fakes (no SQLite, no server):** a `201` row sets
  `Location` from `location()`; a `PATCH` row with no `If-Match` yields `428`
  and calls its `run` ZERO times; with a stale `If-Match` yields `412` and calls
  `run` zero times; with a matching `If-Match` calls `run` once and answers
  `200` with the re-read DTO and an `ETag` different from the sent one; a `204`
  row sends no body and no `ETag`; a `200` json row's `ETag` equals
  `sha256(JSON.stringify(dto))` quoted; two identical DTOs hash equal and one
  changed field hashes different.
- **Body-reader unit tests** (`body.test.ts`): each helper's happy path;
  missing, blank, wrong-typed and array-vs-scalar inputs → `400 invalid_input`
  naming the field; a `null` body and a non-object body rejected.
- **Per row, three unit tests with fakes**, exactly as 020 required: `decode`
  maps params + body to the exact use-case input (including every field-name
  mismatch above, `requirePathParam` rejecting a blank id, and the `type` bound
  literally on the four resource creates); `run` calls the injected fake once
  with that input; `present` returns an object whose `Object.keys()` equal the
  declared literal list, asserted key-by-key.
- **No secret ever presented:** the `credential.patch` and
  `project.credential.create` tests assert `value` is absent from every
  response DTO even when the fake returns one.
- **App-layer changes (decision 7):** `ExportInitiative` throws
  `UnknownReferenceError` for an unknown initiative (and the existing export
  tests still pass); `DiagnosticsExport.build` returns the same document
  `execute` writes, and `execute` still writes it with mode `0o600` — asserted
  by building both from one fixture and comparing.
- **Registry hygiene** (019's existing test) passes with the 22 new codes, `428`
  added to `ALLOWED_STATUSES`, and a test asserting each new code maps from
  exactly one class.
- **CLI-retirement inventory** (`cli-coverage.test.ts`): every `cliCommands`
  entry names a real Commander leaf, and the uncovered set shrinks by the 27
  leaves this epic claims.
- **Boundary lint:** no file under `src/apps/http/` imports from `src/domain/`
  or `src/apps/cli/` — including the new views for the graph package, the apply
  report, the readiness report and the diagnostic document, all of which have
  types rooted in `app/` or `domain/`.

Proof: `scripts/e2e/http-writes-proof.sh` — deterministic, no model, no
outbound network (loopback only), no server left running. Run from the repo
root:

```bash
scripts/e2e/http-writes-proof.sh
```

It must print `021 ok: …`. Phases:

- **A** — a temp `KANTHORD_DB` is migrated and `serve --port 0` starts in an
  isolated working directory carrying its own `.env`; the bound port is read
  from the `listening` JSON log line and `/healthz` answers `200`. **No CLI
  fixture is created:** apart from `db migrate`, every row later phases read was
  written over HTTP. The fixture IS the proof.
- **B** — `POST /api/project` twice: `201`, `Location` followed to a `200` with
  the same id, both projects visible in the 020 collection. Then the body
  reader: blank name and missing name → `400 invalid_input`, duplicate →
  `409 duplicate_name`, truncated JSON → `400 malformed_body`,
  `Content-Type: text/plain` → `415`, a 1.1 MB body → `413 body_too_large`.
- **C** — the planning tree over HTTP: initiative, objective, two tasks, each
  `201` + a followed `Location`; the tasks appear in
  `GET /api/initiative/:id/task`; `{"paused":true}` at creation is readable as
  `paused`; an unknown parent → `404 unknown_reference`; a project id used as an
  objective → `400 wrong_type_reference`.
- **D** — the four typed resource creates, each `201` with
  `Location: /api/resource/<id>`; the posted credential secret appears in no
  response and no DTO carries `value`; the bulk import
  `POST /api/project/:id/resource` → `200` with two ids, no `Location`, both
  readable; a duplicate entry name → `400 import_validation`.
- **E** — the precondition convention: an item `GET` carries an `ETag`; `PATCH`
  without `If-Match` → `428 precondition_required`; with a wrong validator →
  `412 precondition_failed`; with the real one → `200` carrying the new name and
  a DIFFERENT `ETag`; **replaying the same request with the old validator →
  `412`** (the lost update, proved). Then the other five PATCH rows, an
  immutable field → `409 immutable_field`, and a credential value rotation whose
  response contains neither the old nor the new secret.
- **F** — dependencies: `POST …/dependency/:id` → `204` and the edge appears in
  the task DTO; `DELETE` → `204` and it is gone; a self edge →
  `409 cycle_detected`; an unknown dependency → `404 unknown_reference`; the
  initiative and objective pairs both directions; a cross-project initiative
  edge → `400 sequencing_scope`.
- **G** — graph over the wire: a three-file package (authored in the temp dir
  and turned into the request body by the SAME parser the CLI uses, so the phase
  proves the route and not a hand-written package) is posted to
  `POST /api/project/:id/graph` → `201`, `Location: /api/initiative/<id>`, the
  initiative and its task readable, a `refToId` map returned. Then
  `GET /api/initiative/:id/package` → `200` with `formatVersion`, the manifest's
  `initiativeId` and the task; that exported package is posted back to
  `POST /api/initiative/:id/graph` with `dryRun:true` → `200`,
  `applied === false`, every node classified.
- **H** — `POST /api/graph/readiness` classifies a two-node graph
  (`ready` / `blocked`), rejects a cycle with `409 cycle_detected` and an
  unknown dependency with `400 unknown_dependency`;
  `GET /api/project/:id/readiness` returns the report shape;
  `POST /api/initiative/:id/diagnostic` returns a document with `records` and
  `schemaVersion === "007.1"` (a string — `src/domain/safe-facts.ts:1` is
  `export const SCHEMA_VERSION = "007.1"`), **no `outPath` field** (no server
  path is ever named) and an `initiativeRef` that is not the real initiative id.
- **I** — the gates of decision 9: `Host: evil.example` → `403
host_not_allowed`; `Origin: http://127.0.0.1:1` → `403 origin_not_allowed` on
  `POST` and on `DELETE`; no `Origin` → `201`; the server's own `Origin` →
  `201`; a preflight `OPTIONS` advertises `PATCH`; an unauthenticated `POST` →
  `401 unauthenticated` **and the collection proves nothing was written**; `PUT`
  → `405`.
- **J** — the `API_KEY`, the posted secret and the rotated secret appear in no
  log line; `SIGTERM` shuts the server down and the port stops accepting.

Ran against the CURRENT tree (2026-07-30, commit `88b9df9`): the script exits
`1` in phase B at the first write —

```
--- A: migrate, then serve on an ephemeral port (no CLI fixture at all)
    bound port: 54017
--- B: POST /api/project — 201 + Location, and the body reader's failures
FAILED: create project status — expected '201', got '405'
FAILED: scripts/e2e/http-writes-proof.sh line 211
```

Phase A passes in full — the migration runs, `serve` binds, and an
authenticated `/healthz` answers `200` — so the first failure is the missing
capability, not a broken fixture. `405` (not `404`) is the exactly right
failure: `/api/project` IS a route, as a `GET` only, so `matchRoute` reports
`method_not_allowed` for `POST`. The missing thing is the write row.

## Stories

Each story keeps `npm run verify` green on its own.

- **S1 — the write contract in dispatch.** `RouteDefinition` gains `location`
  and `readRow`; `app.ts` sets `Location` on `201`, emits `ETag` on every `200`
  json response, and implements the `readRow` pre-read → `If-Match` →
  `run` → re-read → `200` sequence; `error-registry.ts` gains
  `precondition_required`/`precondition_failed` and the test's
  `ALLOWED_STATUSES` gains `428`; `routes.test.ts` gains the three contract
  assertions. No new row lands, so `verify` proves the refactor
  behaviour-preserving apart from the intended new `ETag` header.
- **S2 — the body reader.** `src/apps/http/body.ts` + `body.test.ts`;
  `PATH_SEGMENTS` gains the four segments and `NOT_PLURAL` gains `readiness`.
- **S3 — app-layer changes and the registry.** Decision 7's two changes with
  their tests, the `app/errors.ts` re-exports, and the 20 domain mappings with
  the one-class-per-code test.
- **S4 — project / initiative / objective / task writes.** Rows
  `project.create`, `project.patch`, `project.initiative.create`,
  `initiative.patch`, `initiative.objective.create`, `objective.patch`,
  `objective.task.create`, their `HttpDeps` fields and view additions.
- **S5 — resource writes.** The four typed creates, the four typed PATCHes and
  the bulk import (`project.resource.create`), including the no-secret
  assertions.
- **S6 — dependency rows.** All six, plus the `204`-with-no-`ETag` dispatch
  assertion.
- **S7 — graph rows.** `project.graph.create`, `initiative.graph.apply`,
  `initiative.package.get`, with `views/graph-package.ts` and
  `views/graph-apply.ts`.
- **S8 — diagnostic and readiness rows.** `initiative.diagnostic.export`,
  `graph.readiness.check`, `project.readiness.get`, with their views.
- **S9 — composition wiring + the Proof.** `composition.ts` injects every new
  `HttpDeps` field including `newId`; `routes.test.ts`'s row count becomes 52;
  `cli-coverage.test.ts` records the 27 claimed leaves;
  `scripts/e2e/http-writes-proof.sh` (already written, already failing for the
  right reason) must print `021 ok: …`; `retirement.md` marks Target 021 covered
  and records that `check project --probe-*` and the interactive `import graph`
  form stay CLI-only.

## Non-goals

- **State transitions** (`approve`, `reject`, `retry`, `abandon`, `pause`,
  `resume`) — EPIC 023. 021 writes only the plan, never the run state. The one
  exception that is NOT a transition: an initiative may be created `paused`,
  because `CreateInitiative` requires the flag at creation.
- **High-impact operations** (`land`, `publish`, every `ai-provider` write) —
  EPIC 024. Nothing in 021 touches a remote, a credential store or a provider.
- **The event feed and `ack project`** — EPIC 022, which owns the cursor
  convention. 021 does not depend on it (see the header).
- **`DELETE` on an entity.** Only the dependency edges are deletable in 021;
  deleting a project, initiative, objective or task has no use case today and
  inventing one here is out of scope.
- **`If-None-Match` / `304`, `PUT`, content negotiation, pagination, OpenAPI or
  client codegen, a `/v1` prefix** — still deferred exactly as 019 and 020
  recorded them. 021 adds `ETag` and `If-Match` only.
- **`check project --probe-repositories` / `--probe-provider` over HTTP** —
  decision 6. Probing joins EPIC 024.
- **The interactive `import graph` form** (a graph directory, `--bind name=…`
  resolution, manifest rewriting) — the HTTP body is an already-parsed package
  with id-valued bindings; the markdown and file work stays CLI-only until the
  async job API (EPIC 025).
- **`export diagnostic --out`** — a client-supplied server path is never
  accepted; the document is returned instead (decision 6).
- **Actually retiring any CLI leaf.** 021 makes 27 leaves retirable and updates
  the inventory; removal happens when the UI uses the routes.
- **Any UI work.** The Preact editing screens that consume these writes are a
  later epic; 021's UI-facing deliverable is the typed request/response surface
  and the `ETag` the editors need.
- **Any change to auth, CORS, the Host check, the CSRF gate, the middleware
  order, the logger or the envelope.** 021 proves those gates; it does not
  modify them.
