# EPIC 020 — HTTP reads: the first `/api` surface (singular REST)

> Authored 2026-07-30, on top of EPIC 019 (commit `98b2558`). 019 shipped the
> transport: koa on `127.0.0.1`, Basic auth against `API_KEY`, the JSON
> envelope, the error registry, the static `ROUTES` table, pino logging, and a
> UI shell at `GET /`. No `/api/*` route exists yet — 020 ships the first ones.
>
> 020 is the first step of the CLI → HTTP migration described in
> `.agent/plan/stories/019-http-server/retirement.md` ("Target 020 — reads").
> It extends the 019 seams; it does not rebuild a server, and it removes no CLI
> command.
>
> **020 supersedes two earlier texts on one point.** EPIC 019 decision 2 says
> "Plural noun collections" and `retirement.md` wrote `GET /api/<plural>`.
> Ulrich decided on 2026-07-30 that resource path segments are **singular**.
> Decision 1 below is now the binding rule; `retirement.md` was rewritten to
> singular the same day, and the plural wording left in EPIC 019 is dead text.
> The change costs nothing: no `/api` route exists
> yet, and nothing in code enforced plural (`src/apps/http/routes.test.ts` bans
> verbs in path segments, not plurals).

## Goal

The running `kanthord serve` program answers every read the UI's first screens
need, as REST resources with singular path segments: collections and items for
project, initiative, objective, task, resource (repository / credential /
notification / filesystem), ai-provider and model, plus the computed reads
`overview`, `graph`, `queue` and `conflict`. `find <kind> --name` disappears
into a `?name=` filter on the collection, so no `/find` path exists. Each row
carries its own `decode` / `run` / `present` and a literal DTO field list, and
after 020 the `Route` type is generic (`Route<Input, Output>`), so a row's input
and output types are checked instead of cast — which is also what lets the
Preact UI import the response types. 25 CLI read leaves are covered by 22 rows
and become retirable; none is removed in 020.

## Decisions (binding; do not re-open at build time)

1. **Resource path segments are SINGULAR nouns.** Collection:
   `GET /api/project`. Item: `GET /api/project/:id`. Not `/projects`.
   Sub-resources follow the same rule: `/api/project/:id/initiative`,
   `/api/initiative/:id/task`, `/api/project/:id/repository`. Ulrich,
   2026-07-30. **This supersedes EPIC 019 decision 2 and `retirement.md`**,
   both of which say plural. Every later epic inherits this decision from here.
   Rationale recorded so it is not re-litigated: one spelling per resource,
   identical between the collection path, the item path and the route `id`
   prefix (`project.list`, `project.get`), with no English pluralisation rules
   (`ai-provider` → `ai-providers`? `filesystem` → `filesystems`?) to get wrong.
2. **A machine check keeps decision 1 true, built as a curated vocabulary — not
   a regex over arbitrary paths.** `src/apps/http/routes.test.ts` gains a
   `PATH_SEGMENTS` const: the explicit allowlist of every legal STATIC segment
   (`api`, `healthz`, `project`, `initiative`, `objective`, `task`, `resource`,
   `repository`, `credential`, `notification`, `filesystem`, `ai-provider`,
   `model`, `queue`, `overview`, `graph`, `conflict`). Three assertions iterate
   `ROUTES`:
   - every static segment of every row's path is in `PATH_SEGMENTS`;
   - no member of `PATH_SEGMENTS` ends in `s`, unless it is named in a second
     const `NOT_PLURAL` (empty today);
   - a negative control: the predicate rejects `/api/projects` and accepts
     `/api/project/:id`.

   **Why this rule and not `/s$/` over the paths:** a naive `/s$/` has real
   false positives (`status`, `progress`, `analysis`, and 019's own `healthz`
   is only safe by luck), and a test people must disable is worse than no test.
   Applied to a ~17-word curated list instead, the `s` rule is reliable, and
   the escape hatch is an explicit named entry a reviewer sees. The allowlist
   also does the second job the verb ban cannot: adding a new resource segment
   is a deliberate, reviewed edit, exactly like adding to `BANNED_VERBS`. The
   existing verb ban stays untouched and both run.

3. **`Route` becomes generic in 020, via a `defineRoute` helper.** This settles
   the open decision recorded in memory `route-generics-pending`; it is not
   deferred to build time. `src/apps/http/routes.ts` declares
   `RouteDefinition<Input, Output>` (`decode: (i: RouteInput) => Input`,
   `run: (deps: HttpDeps, input: Input) => Promise<Output>`,
   `present?: (result: Output) => unknown`) plus the erased `Route` the
   dispatcher iterates, and one exported function
   `defineRoute<Input, Output>(def: RouteDefinition<Input, Output>): Route`
   performs the single erasing cast. Each `ROUTES` entry is
   `defineRoute({...})`. Consequences, all intended:
   - the per-row `as SomeInput` casts disappear — 22 new rows is exactly the
     wrong number of casts to add;
   - `decode` and `run` are checked against each other, so a decode/run
     mismatch is a typecheck error instead of a runtime `undefined`;
   - `app.ts` stops writing `route.present!`: the dispatcher branches on
     `successStatus === 204` first, then reads `route.present` behind an
     explicit `if (route.present === undefined) throw new HttpFailure(internal)`
     guard. No non-null assertion anywhere in dispatch.
   - each view module exports its DTO type (`export type ProjectDto = …`), so
     the Preact UI imports response types from the same module the server
     presents with. Rejected alternative: a third `Dto` type parameter — the
     view module's exported return type already carries it.
4. **Collection and item shape.** A REQUIRED parent scope is a path segment; an
   OPTIONAL filter is a query parameter. So `list initiative --project X` is
   `GET /api/project/X/initiative` (project id required by the use case), while
   `list task --status` is `GET /api/initiative/X/task?status=…`. Every 020 row
   is `GET`, `kind: "json"`, `successStatus: 200`. No writes, no `PATCH`.
5. **`find <kind> --name` retires as `?name=<exact>` on the collection**
   (inherited from 019; this decision says how). The filter is implemented by an
   optional `name` field added to the READ list use cases —
   `ListProjects.execute({ name? })`, `ListInitiatives`, `ListObjectives`,
   `ListResources` — filtering on exact name equality. The route's `run` stays
   one line and the response keeps ONE shape: the same DTO array, with zero or
   one element. The `Find*` use cases are NOT called over HTTP and are NOT
   deleted (the CLI keeps them), so `AmbiguousNameError` is unreachable from an
   020 route and, per 019 decision 11, is deliberately NOT added to the error
   registry. Rejected alternative: a `?name=` row that calls `Find*` and returns
   a bare id — it gives the collection two response shapes, which every UI list
   view then has to branch on.
6. **Resource sub-collections are typed PATHS; the resource item is
   type-agnostic.** `ListResources` requires `type`, so the four leaves get four
   rows — `/api/project/:id/repository`, `/credential`, `/notification`,
   `/filesystem` — each binding its `type` literally in `decode`, mirroring how
   `buildListResourceCommand` (`src/apps/cli/commands/list/resource.ts:13`)
   binds it per leaf. `ListResources.type` is **not** weakened to optional. The
   item route is `GET /api/resource/:id` (one row, `cliCommands: ["get
resource", "get repository"]`) because `GetResource` takes only an id and
   returns the discriminated `ResourceView`. `find resource` is claimed by the
   four typed collections via `?name=`; the CLI's type-less find has no HTTP
   twin, and that is accepted — every UI resource screen is per-type.
7. **`ListTasks` must stop reporting an empty initiative as a missing one.**
   `src/app/task/list-tasks.ts:29-31` throws `UnknownReferenceError` when the
   initiative has zero tasks, so `GET /api/initiative/:id/task` would answer
   `404 unknown_reference` for a real, empty initiative — while
   `GET /api/initiative/:id/graph` on that same id answers `200`. 020 fixes the
   use case: it takes the `InitiativeRepository` (already available in
   `composition.ts`), throws `UnknownReferenceError` only when
   `initiatives.get(initiativeId)` is undefined, and returns `[]` for an
   existing initiative with no tasks. The CLI inherits the fix; no
   backward-compatibility duty exists (AGENTS.md, local development only). This
   is the one app-layer behaviour change in 020 and it is deliberate.
8. **`conflict` is a singleton sub-resource read, and its errors join the
   registry.** `GET /api/task/:id/conflict` → `GetConflict`;
   `GET /api/objective/:id/conflict` → `GetObjectiveConflict`. The CLI's
   `--id` XOR `--objective` flag pair (`src/apps/cli/task.ts:292-306`) becomes
   two paths, so the XOR rule disappears instead of being ported. Per 019
   decision 11 the registry gains exactly the errors these rows can raise:
   `NoConflictCandidateError` → `409 no_conflict_candidate`,
   `ObjectiveNotInConflictError` → `409 objective_not_in_conflict`.
   `UnknownReferenceError` → `404 unknown_reference` is already registered and
   covers every other 020 row.
9. **`HttpDeps` grows one field per use case a row calls**, still an interface
   owned by `src/apps/http/deps.ts`, still not `CliDeps` and not a god bag.
   `list model` has no `app/` use case — it is a closure built in
   `composition.ts:237` typed by `src/apps/cli/models.ts`. `apps/http` must not
   import from `apps/cli`, so `HttpDeps` declares
   `readonly listModels: (provider?: string) => ModelInfoLike[]` against a
   structural type declared in `src/apps/http/views/model.ts` — the same
   local-mirror trick `src/apps/cli/deps.ts:130-183` already uses, with the same
   kind of comment stating why.
10. **One view module per resource under `src/apps/http/views/`**, each
    exporting a `*View(result)` function with a LITERAL field list and its DTO
    type. Mandatory, not stylistic (019 decision 9): `GetProject`,
    `ListProjects`, `ListInitiatives` and `ListObjectives` return `domain/`
    entities and eslint `boundaries` forbids `apps/` → `domain/`. Where a DTO
    field's TYPE originates in `domain/` (`TaskStatus`, `Action`, `Event`,
    `UnsatisfiedEdge`), the view either uses an existing `app/` re-export (e.g.
    `TaskStatus` from `src/app/errors.ts`, as `src/apps/cli/list-tasks.ts:2`
    does) or declares its own local literal union. No `import` from `domain/`,
    and no object spread — a spread is how an internal field reaches the wire.
11. **No pagination in 020.** No read use case supports a cursor today, and
    inventing one here would touch every list. `queue` keeps its existing
    `?limit=` (the only limit-shaped input that exists,
    `src/app/project/get-decision-queue.ts:225`); `GET /api/model` takes
    `?provider=`. The event feed's cursor is 021's problem.
12. **Auth, envelope, CORS, Host and CSRF gates are untouched.** Auth already
    covers every route (019 decision 4); 020 adds no per-route auth, no new
    middleware, and no new middleware order. The unsafe-method gates are not
    exercised by 020 because every 020 row is a `GET`.

## Route table (22 rows, all `GET`, all `200`, all `kind: "json"`)

| id                          | path                            | use case                                 | `cliCommands`                        |
| --------------------------- | ------------------------------- | ---------------------------------------- | ------------------------------------ |
| `project.list`              | `/api/project`                  | `ListProjects` (`?name=`)                | `list project`, `find project`       |
| `project.get`               | `/api/project/:id`              | `GetProject`                             | `get project`                        |
| `project.overview.get`      | `/api/project/:id/overview`     | `GetProjectOverview`                     | `get overview`                       |
| `project.initiative.list`   | `/api/project/:id/initiative`   | `ListInitiatives` (`?name=`)             | `list initiative`, `find initiative` |
| `project.repository.list`   | `/api/project/:id/repository`   | `ListResources` (`type` bound, `?name=`) | `list repository`, `find resource`   |
| `project.credential.list`   | `/api/project/:id/credential`   | `ListResources`                          | `list credential`, `find resource`   |
| `project.notification.list` | `/api/project/:id/notification` | `ListResources`                          | `list notification`, `find resource` |
| `project.filesystem.list`   | `/api/project/:id/filesystem`   | `ListResources`                          | `list filesystem`, `find resource`   |
| `project.ai-provider.list`  | `/api/project/:id/ai-provider`  | `ResolveProjectChain`                    | `list ai-provider`                   |
| `initiative.get`            | `/api/initiative/:id`           | `GetInitiative`                          | `get initiative`                     |
| `initiative.graph.get`      | `/api/initiative/:id/graph`     | `GetInitiativeGraph`                     | `get graph`                          |
| `initiative.objective.list` | `/api/initiative/:id/objective` | `ListObjectives` (`?name=`)              | `list objective`, `find objective`   |
| `initiative.task.list`      | `/api/initiative/:id/task`      | `ListTasks` (`?status=`, `?objective=`)  | `list task`                          |
| `objective.get`             | `/api/objective/:id`            | `GetObjective`                           | `get objective`                      |
| `objective.conflict.get`    | `/api/objective/:id/conflict`   | `GetObjectiveConflict`                   | `get conflict`                       |
| `task.get`                  | `/api/task/:id`                 | `GetTask`                                | `get task`                           |
| `task.conflict.get`         | `/api/task/:id/conflict`        | `GetConflict`                            | `get conflict`                       |
| `resource.get`              | `/api/resource/:id`             | `GetResource`                            | `get resource`, `get repository`     |
| `ai-provider.list`          | `/api/ai-provider`              | `ListAiProviders`                        | `list ai-provider`                   |
| `ai-provider.get`           | `/api/ai-provider/:id`          | `GetAiProvider`                          | `get ai-provider`                    |
| `model.list`                | `/api/model`                    | `listModels` closure (`?provider=`)      | `list model`                         |
| `queue.get`                 | `/api/queue`                    | `GetDecisionQueue` (`?limit=`)           | `queue`                              |

Note the CLI-flag → use-case-field mismatches decode must get right:
`GetInitiativeGraph` takes `{ id }` (not `initiativeId`),
`GetProjectOverview` takes `{ projectId }`, `GetResource`, `GetAiProvider` and
`ResolveProjectChain` take a POSITIONAL string, `GetConflict` takes
`{ taskId }` and `GetObjectiveConflict` takes `{ objectiveId }`.

## Verification Gate

Gates: `npm run verify` (typecheck + test + verify:handoff + lint + db status).

Hermetic coverage required beyond the Proof:

- **The three decision-2 assertions in `src/apps/http/routes.test.ts`**
  (allowlist, no-`s` over `PATH_SEGMENTS` with the empty `NOT_PLURAL` escape
  list, negative control on `/api/projects`), iterating `ROUTES` so a later
  epic's plural row fails the build. The existing route-policy and verb-ban
  tests keep passing unchanged over all 22 new rows.
- **A generics test that must not compile away:** `defineRoute` typechecks a
  matching `decode`/`run` pair, and a `// @ts-expect-error` case proves a
  mismatched pair is rejected. Plus a dispatch test: a non-204 row with no
  `present` yields `500 internal` from the explicit guard, never a `TypeError`.
- **Per row, three unit tests with fakes** (no SQLite, no server): `decode`
  maps params/query to the exact use-case input (including the mismatched field
  names above, and `requirePathParam` rejecting a blank id → `400
invalid_input`); `run` calls the injected fake once with that input;
  `present` returns an object whose `Object.keys()` equal the declared literal
  list — asserted key-by-key, so a later spread that leaks an internal field
  fails.
- **No secret ever presented:** the credential view test asserts `value` is
  absent from the presented DTO even when the fake returns one.
- **`ListTasks` (decision 7):** unknown initiative → `UnknownReferenceError`;
  existing initiative with zero tasks → `[]`; existing initiative with tasks →
  unchanged rows. The CLI's `list task` test suite is updated for the new
  empty-initiative behaviour in the same story.
- **`?name=` filter (decision 5):** exact match returns one element, a
  different case or a substring returns zero, absent `name` returns all, for
  each of the four list use cases.
- **Error registry hygiene** (019's existing test) still passes with the two new
  409 codes; a test asserts each new code maps from exactly one class.
- **CLI-retirement inventory** (`src/apps/http/cli-coverage.test.ts`) still
  passes: every `cliCommands` entry names a real Commander leaf, and the
  uncovered set shrinks by the 25 leaves this epic claims.
- **Boundary lint:** no file under `src/apps/http/` imports from `src/domain/`
  or from `src/apps/cli/` (eslint `boundaries` is the check; the view modules
  exist to satisfy it).

Proof: `scripts/e2e/http-reads-proof.sh` — deterministic, no model, no outbound
network (loopback only), no server left running. Run from the repo root:

```bash
scripts/e2e/http-reads-proof.sh
```

It must print `020 ok: …`. Phases:

- **A** — a temp `KANTHORD_DB` is migrated and the fixture is built through the
  real CLI: projects `alpha` + `beta`, a repository against a local bare git
  remote, a credential whose file content is `sekret`, a notification, a
  filesystem, initiatives `init-one` + `init-empty`, objective `obj-one`, tasks
  `task one` + `task two`. `serve --port 0` starts in an isolated working
  directory carrying its own `.env`, and the bound port is read from the
  `listening` JSON log line. `GET /healthz` still answers `200`.
- **B** — the project collection and item: two projects, ids ascending,
  `?name=alpha` returns exactly one and `?name=nope` returns zero (the
  statement that retires `find project`), the item returns `id` + `name`. Then
  the two decision checks: `GET /api/projects` is `404 unknown_route` (plural is
  not served) and `GET /api/project/find` is `404 unknown_reference` (`find` is
  a query parameter, never a path segment).
- **C** — nesting: initiatives of a project (with `?name=` and cross-project
  scoping), the initiative item, objectives of an initiative, the objective
  item, tasks of an initiative with `?objective=` and `?status=`, the task item
  (`id`, `title`, `objectiveId`), and **`GET /api/initiative/<empty>/task` is
  `200` with `[]`** — decision 7 proved over the wire.
- **D** — the four typed resource collections, each project-scoped; the
  credential response contains neither `sekret` nor a `value` field; the
  type-agnostic item `GET /api/resource/<repoId>` reports `type: "repository"`.
- **E** — the computed reads: `overview` (`projectId`, the fixture initiative
  present, `lanes`/`decisions`/`digest` present), `graph` (`initiative.id`, 2
  nodes, 1 group, `counts.pending === 2`), `queue?limit=5`
  (`items`/`counts`/`warnings`), `model` (non-empty, every row has `id` +
  `provider`, `?provider=anthropic` narrows), `ai-provider` and the project
  provider chain (both `[]` on a fresh database — a real `200`, not an error).
- **F** — error mapping over the wire: unknown project and unknown task ids →
  `404 unknown_reference`; `GET /api/project/%20` → `400 invalid_input` (a
  single space never reaches a use case); `task/:id/conflict` on a
  non-conflicted task → `409 no_conflict_candidate`; `objective/:id/conflict` on
  a healthy objective → `409 objective_not_in_conflict`.
- **G** — CLI/HTTP parity: `list project`, `get task --id`, `list task
--initiative` and `get overview --project` in `--json` form are compared
  field-by-field against the same HTTP reads. **Stated limit:** parity is
  asserted on chosen scalar fields and list lengths, not by deep-equality of
  every DTO — the CLI's JSON printers are their own presenters and are allowed
  to differ in shape; what must not differ is the DATA.
- **H** — `GET /api/project` with no `Authorization` is `401 unauthenticated`
  (019's gate covers the new routes with no per-route work), the `API_KEY` bytes
  appear in no log line, `SIGTERM` shuts the server down and the port stops
  accepting.

Ran against the CURRENT tree (2026-07-30, commit `98b2558`): the script exits
`1` in phase B at the first `/api` request —

```
--- A: fixture through the CLI, then serve on an ephemeral port
    bound port: 50788 — fixture: project 01KYR5PZ8CS93FBF4HMDYVS2H9, initiative 01KYR5Q3TPT93BNZ1MS9EP6ZAN, task 01KYR5Q63F5TX0ZQFBCY02HWMC
--- B: project collection + item, ?name= replaces find, plural is not served
FAILED: project collection status — expected '200', got '404'
```

Phase A passes in full — the CLI fixture is created, `serve` binds, and an
authenticated `/healthz` answers `200` — so the first failure is the missing
capability (`GET /api/project` is not a route yet), not a broken fixture.

## Stories

- **S1 — generic `Route` + `defineRoute` (decision 3).** `routes.ts` gains
  `RouteDefinition<Input, Output>` and `defineRoute`; the two existing rows
  (`health.get`, `ui.get`) are converted; `app.ts` drops both `route.present!`
  with the explicit `internal` guard. No new route yet, so `npm run verify`
  proves the refactor is behaviour-preserving.
- **S2 — the decision-2 path check.** `PATH_SEGMENTS`, `NOT_PLURAL`, the three
  assertions in `routes.test.ts`.
- **S3 — app-layer read changes.** The optional `name` filter on `ListProjects`
  / `ListInitiatives` / `ListObjectives` / `ListResources` (decision 5) and the
  `ListTasks` empty-initiative fix (decision 7), with their unit tests and the
  affected CLI tests.
- **S4 — project rows.** `views/project.ts`, the `HttpDeps` fields, and rows
  `project.list`, `project.get`, `project.overview.get`.
- **S5 — initiative + objective rows.** `views/initiative.ts`,
  `views/objective.ts`, rows `project.initiative.list`, `initiative.get`,
  `initiative.graph.get`, `initiative.objective.list`, `objective.get`.
- **S6 — task rows.** `views/task.ts`, rows `initiative.task.list`, `task.get`.
- **S7 — resource rows.** `views/resource.ts`, the four typed collections and
  `resource.get` (decision 6).
- **S8 — ai-provider + model + queue rows.** `views/ai-provider.ts`,
  `views/model.ts` (with the structural `listModels` mirror, decision 9),
  `views/queue.ts`, rows `ai-provider.list`, `ai-provider.get`,
  `project.ai-provider.list`, `model.list`, `queue.get`.
- **S9 — conflict rows + registry.** `views/conflict.ts`, rows
  `task.conflict.get` and `objective.conflict.get`, and the two new 409 entries
  in `error-registry.ts` (decision 8).
- **S10 — composition wiring + the Proof.** `composition.ts` injects every new
  `HttpDeps` field; `scripts/e2e/http-reads-proof.sh` (already written, already
  failing for the right reason) must print `020 ok: …`; the retirement roadmap
  is updated to mark Target 020 covered (its path spelling was already corrected
  to singular on 2026-07-30).

## Non-goals

- Every write. No `POST`, `PATCH` or `DELETE` row lands in 020; planning writes
  are 022, state transitions 023, high-impact operations 024.
- The event feed and `ack project` (`GET /api/event?after=…`) — that is 021,
  and it owns the cursor convention.
- Pagination, sorting and cursors on the 020 collections (decision 11).
- Actually retiring any CLI leaf. 020 makes 25 leaves retirable and updates the
  inventory; removal happens when the UI uses the routes.
- Any UI work beyond what 019 shipped. The Preact screens that consume these
  reads, and the shared response-type import (which decision 3 enables), are a
  later epic. 020's only UI-facing deliverable is the typed DTO surface.
- `If-Match`/`ETag`, `PUT`, content negotiation, OpenAPI generation, client
  codegen, a `/v1` prefix — all still deferred exactly as 019 recorded them.
- Any change to auth, CORS, the Host check, the CSRF gates, the middleware
  order, the logger or the envelope (decision 12).
