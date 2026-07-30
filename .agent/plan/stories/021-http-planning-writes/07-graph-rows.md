# Story S7 — graph rows: create, apply, export package

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decision 6)
Depends on: Story S1, S2, S3 (`ExportInitiative` throws `UnknownReferenceError`
AND `parseGraphPackageDocument` exists), S6 (`ROUTES.length` continuity).

Three rows. `ROUTES.length` becomes `49`.

## Change

### 1. `src/apps/http/views/graph-package.ts` (new)

`GraphPackage` and its nested DTOs live under `src/app/graph/graph-package.ts`,
so they are imported `import type` — no domain mirror needed. Every field of the
package is presented; a client feeds the result straight back to
`POST /api/initiative/:id/graph`, so dropping a field would break the round trip
Proof phase G performs.

```ts
import type {
  GraphPackage,
  PkgInitiative,
  PkgObjective,
  PkgTask,
  ExportManifest,
} from "../../../app/graph/graph-package.ts";
```

Declare one `readonly` interface per nested shape, with
`readonly [key: string]: unknown;` on the TOP-LEVEL `GraphPackageView` only,
then one exported mapper plus four private ones. Field lists, literally:

- `pkgInitiativeView(r: PkgInitiative)` → `id?`, `ref`, `name`, `sourcePath`,
  `after?` (copied `[...]`), `bindings?` (copied `{ ... }`).
- `pkgObjectiveView(r: PkgObjective)` → `id?`, `ref`, `initiativeRef`, `name`,
  `sourcePath`, `after?` (copied), `context?` (copied).
- `pkgTaskView(r: PkgTask)` → `id?`, `ref`, `objectiveRef`, `title`,
  `instructions`, `ac` (copied), `agent`, `verification`, `dependencies`
  (copied), `sourcePath`, `context?` (copied).
- `exportManifestView(r: ExportManifest)` → `initiativeId`, `packageId`,
  `formatVersion`, `digestAlgorithm`, `nodes` (copied `{ ... }`), `files`
  (copied `[...]`), `objectiveIds?` (copied), `refToId:
{ objectives: { ...r.refToId.objectives }, tasks: { ...r.refToId.tasks } }`.
- `graphPackageView(r: GraphPackage)` → `packageId`, `formatVersion`,
  `initiative: pkgInitiativeView(r.initiative)`,
  `objectives: r.objectives.map(pkgObjectiveView)`,
  `tasks: r.tasks.map(pkgTaskView)`,
  `manifest?`: `...(r.manifest !== undefined ? { manifest: exportManifestView(r.manifest) } : {})`.

`PkgTask.verification` is `string[] | null | undefined`. It is a THREE-state
field (`undefined` = no `# Verification` section, `null`/`[]` = an empty one), so
it is NOT conditionally spread: emit `verification: r.verification === undefined
? undefined : r.verification === null ? null : [...r.verification]` and type it
`readonly string[] | null | undefined`. Its `undefined` disappears in
`JSON.stringify`, which is the same wire shape an absent key gives, and the
round trip through `JSON.parse` restores `undefined` for it.

### 2. `src/apps/http/views/graph-apply.ts` (new)

Holds both graph-WRITE result views (create and apply); the export view lives in
`graph-package.ts`.

```ts
import type { CreateGraphResult } from "../../../app/graph/create-graph.ts";
import type {
  ApplyGraphResult,
  ApplyClassification,
  EdgeChange,
} from "../../../app/graph/apply-graph.ts";
```

- `graphCreateView(r: CreateGraphResult)` → `initiativeId`,
  `refToId: { objectives: { ...r.refToId.objectives }, tasks: { ...r.refToId.tasks } }`,
  `nodes: { ...r.nodes }`.
- `applyClassificationView(r: ApplyClassification)` → `kind`, `ref`, `class`,
  plus conditionally spread `id?`, `sourcePath?`, `reason?`, `name?`,
  `liveStatus?`, `casReason?` (mapped literally:
  `r.casReason.kind === "sha" ? { kind: "sha" } : { kind: "status", currentStatus: r.casReason.currentStatus }`).
- `edgeChangeView(r: EdgeChange)` → `kind`, `id`, `dependency`, `change`.
- `graphApplyView(r: ApplyGraphResult)` → `applied`,
  `classifications: r.classifications.map(applyClassificationView)`,
  `summary: { created, updated, unchanged, missing, ...(r.summary.deleted !== undefined ? { deleted: r.summary.deleted } : {}) }`,
  `conflicts: r.conflicts.map(applyClassificationView)`, plus conditionally
  spread `freshNodeShas?` (copied `{ ... }`),
  `createdNodes?` (`r.createdNodes.map((n) => ({ ref: n.ref, id: n.id, ...(n.sourcePath !== undefined ? { sourcePath: n.sourcePath } : {}) }))`),
  `edgeChanges?` (`.map(edgeChangeView)`),
  `refusedEdgeRemovals?` (`.map(edgeChangeView)`).

### 3. `src/apps/http/deps.ts` — four fields

```ts
import type { CreateGraph } from "../../app/graph/create-graph.ts";
import type { ApplyGraph } from "../../app/graph/apply-graph.ts";
import type { ExportInitiative } from "../../app/graph/export-initiative.ts";
...
  readonly createGraph: CreateGraph;
  readonly applyGraph: ApplyGraph;
  readonly exportInitiative: ExportInitiative;
  /**
   * `import graph --create` needs a caller-minted packageId
   * (`create-graph.ts:44`); the CLI passes `deps.newId`, so the row mints it.
   */
  readonly newId: () => string;
```

### 4. `src/apps/cli/commands/serve.ts` — populate them

```ts
      createGraph: deps.createGraph,
      applyGraph: deps.applyGraph,
      exportInitiative: deps.exportInitiative,
      newId: deps.newId,
```

### 5. `src/apps/http/routes.ts` — three rows appended to `ROUTES`

New imports:

```ts
import { parseGraphPackageDocument } from "../../app/graph/graph-codec.ts";
import { graphPackageView } from "./views/graph-package.ts";
import { graphCreateView, graphApplyView } from "./views/graph-apply.ts";
```

`GraphPackage` is never named in `routes.ts`: `parseGraphPackageDocument` returns
it, so the row stays cast-free and annotation-free. Add `requireBodyObject` to the
`./body.ts` import.

| id                       | method | path                          | status | use case           | cliCommands             |
| ------------------------ | ------ | ----------------------------- | ------ | ------------------ | ----------------------- |
| `project.graph.create`   | POST   | `/api/project/:id/graph`      | 201    | `CreateGraph`      | `["import graph"]`      |
| `initiative.graph.apply` | POST   | `/api/initiative/:id/graph`   | 200    | `ApplyGraph`       | `["import graph"]`      |
| `initiative.package.get` | GET    | `/api/initiative/:id/package` | 200    | `ExportInitiative` | `["export initiative"]` |

```ts
  defineRoute({
    id: "project.graph.create",
    method: "POST",
    path: "/api/project/:id/graph",
    successStatus: 201,
    kind: "json",
    cliCommands: ["import graph"],
    decode: ({ params, body }) => {
      const bindings = optionalBodyRecord(body, "bindings");
      return {
        pkg: parseGraphPackageDocument(requireBodyObject(body, "pkg")),
        projectId: requirePathParam(params, "id"),
        paused: optionalBodyBool(body, "paused") ?? false,
        ...(bindings !== undefined ? { bindings } : {}),
      };
    },
    // packageId is minted here because only `run` sees deps (decision 6).
    run: async (deps, input) =>
      deps.createGraph.execute({
        pkg: input.pkg,
        projectId: input.projectId,
        packageId: deps.newId(),
        paused: input.paused,
        ...(input.bindings !== undefined ? { bindings: input.bindings } : {}),
      }),
    present: (result) => graphCreateView(result),
    location: (result) => `/api/initiative/${result.initiativeId}`,
  }),
  defineRoute({
    id: "initiative.graph.apply",
    method: "POST",
    path: "/api/initiative/:id/graph",
    successStatus: 200,
    kind: "json",
    cliCommands: ["import graph"],
    decode: ({ params, body }) => {
      const dryRun = optionalBodyBool(body, "dryRun");
      const deleteMissing = optionalBodyBool(body, "deleteMissing");
      const confirmDelete = optionalBodyBool(body, "confirmDelete");
      return {
        pkg: parseGraphPackageDocument(requireBodyObject(body, "pkg")),
        initiativeId: requirePathParam(params, "id"),
        ...(dryRun !== undefined ? { dryRun } : {}),
        ...(deleteMissing !== undefined ? { deleteMissing } : {}),
        ...(confirmDelete !== undefined ? { confirmDelete } : {}),
      };
    },
    run: async (deps, input) => deps.applyGraph.execute(input),
    present: (result) => graphApplyView(result),
  }),
  defineRoute({
    id: "initiative.package.get",
    method: "GET",
    path: "/api/initiative/:id/package",
    successStatus: 200,
    kind: "json",
    cliCommands: ["export initiative"],
    decode: ({ params }) => ({ id: requirePathParam(params, "id") }),
    // ExportInitiative takes a POSITIONAL string, not an input object.
    run: async (deps, input) => deps.exportInitiative.execute(input.id),
    present: (result) => graphPackageView(result),
  }),
```

### 6. `src/apps/http/routes.test.ts` — the row count

```ts
test("ROUTES holds exactly 49 rows: 46 after the dependency rows, plus the 3 graph rows", () => {
  assert.equal(ROUTES.length, 49);
});
```

### 7. `src/apps/http/cli-coverage.test.ts` — two more claimed leaves

Add `"import graph"` and `"export initiative"`. Two rows claim `"import graph"`
— the test only checks that each named leaf exists, so that is fine.

## Constraints

- `export initiative` is a **GET**: `ExportInitiative.execute` is read-only and
  returns the `GraphPackage`; every write in the CLI path is the adapter's file
  I/O (`src/apps/cli/export.ts:1-5`). An HTTP client receives the JSON and writes
  its own files. The row never touches the filesystem.
- `import graph` becomes **two** rows because there are two use cases: create on
  a project, apply on an initiative. `POST /api/initiative/:id/graph` shares its
  path with the existing `GET /api/initiative/:id/graph` (`initiative.graph.get`)
  — method+path stays unique, so nothing else changes.
- `packageId` is minted in `run` via `deps.newId()`, never in `decode` (which
  has no deps) and never by the client. `run` builds the use-case input
  field-by-field — do not spread `input`.
- `paused` defaults to `false` in `decode` and is always present:
  `CreateGraphInput.paused` is a required boolean.
- `--bind alias=name` resolution stays CLI-only: over HTTP `bindings` is an
  alias → resource **id** map, so `AmbiguousBindingNameError` and
  `UnknownBindingNameError` are unreachable and are NOT registered. The CLI's
  markdown parsing, manifest rewriting and source-file id rewriting also stay
  CLI-only — the HTTP body is an already-parsed package.
- The package is validated SERVER-SIDE by `parseGraphPackageDocument` (Story S3),
  which returns it typed — so there is no cast in either row and no
  `as unknown as GraphPackage` anywhere. A structurally invalid package is
  `400 invalid_package`, never a `500`. "The client already parsed it" is not a
  trust boundary. Semantic validation still belongs to the use cases
  (`CreateGraph` raises `CreateModeIdError` for a persisted id, `ApplyGraph`
  raises `StaleManifestError` for a wrong `formatVersion`).
- Views never spread an entity. `nodes`, `refToId.*`, `bindings`, `context` and
  `freshNodeShas` are value maps and ARE copied with a spread — the same
  exception 020 named for `byType`.
- `package` and `graph` are already in `PATH_SEGMENTS` (S2 added `package`).

## Verify

- New `src/apps/http/views/graph-package.test.ts`:
  - a full `GraphPackage` fixture (one objective, one task, a manifest, `after`,
    `bindings`, `context` on both objective and task) with an injected extra
    field on the package, the initiative, the objective, the task and the
    manifest, each cast through `as unknown as`; assert the key set of every
    level is exactly the declared list and no injected extra survives.
  - `manifest` absent → the top-level key set omits `manifest` entirely.
  - `verification: undefined` → the key is present with value `undefined` and
    `JSON.parse(JSON.stringify(view)).verification === undefined`;
    `verification: null` → `null` survives; `verification: []` → `[]` survives
    and is a different array reference from the input.
  - `after`, `ac`, `dependencies`, `files`, `objectiveIds` are all copies, not
    the input references.
- New `src/apps/http/views/graph-apply.test.ts`:
  - `graphCreateView` leak test: exactly
    `["initiativeId","nodes","refToId"]`, and `refToId` has exactly
    `["objectives","tasks"]`; both maps are copies.
  - `graphApplyView` with a minimal result (`applied`, `classifications`,
    `summary`, `conflicts`, everything else absent) → the key set is exactly
    those four, and `summary` is exactly
    `["created","missing","unchanged","updated"]`.
  - `graphApplyView` with every optional present (`freshNodeShas`,
    `createdNodes` with and without `sourcePath`, `edgeChanges`,
    `refusedEdgeRemovals`, `summary.deleted`) → the full key set, and each
    nested key set exactly as declared.
  - `applyClassificationView` with `casReason: { kind: "sha" }` gives exactly
    `["kind"]` inside `casReason`; with
    `{ kind: "status", currentStatus: "running" }` gives exactly
    `["currentStatus","kind"]`.
- New `src/apps/http/routes.graph.write.test.ts` (supertest + fakes):
  - `POST /api/project/p1/graph` with
    `{"pkg":{...},"bindings":{"source":"r1"}}` → `201`,
    `Location: /api/initiative/<initiativeId>`, body
    `{ data: { initiativeId, refToId, nodes } }`, and the fake `createGraph`
    received `{ pkg, projectId: "p1", packageId: "MINTED", paused: false, bindings: { source: "r1" } }`
    where the injected `newId` returns the constant `"MINTED"` — asserted with
    `assert.deepEqual`, so a stray `bindings: undefined` fails.
  - the same without `bindings` → the fake received an object with NO `bindings`
    key; with `"paused":true` → `paused: true`.
  - `POST /api/project/p1/graph` with `{}` → `400 invalid_input` naming `pkg`,
    and the fake was never called; with `{"pkg":"x"}` → `400 invalid_input`.
  - `POST /api/project/p1/graph` with `{"pkg":{}}` → `400 invalid_package` (NOT
    `500`), and the fake `createGraph.execute` was never called — the row rejects
    a structurally invalid package before the use case sees it. Same assertion for
    `POST /api/initiative/i1/graph` with `{"pkg":{"packageId":"p","formatVersion":3}}`.
  - the fake throwing `new CreateModeIdError("a.md","01X")` → `400
create_mode_id`; `new UnknownNodeError("a.md","ref")` → `404 unknown_node`;
    `new CrossInitiativeError(...)` → `409 cross_initiative`;
    `new UnboundAliasError(...)` → `400 unbound_alias`.
  - `POST /api/initiative/i1/graph` with `{"pkg":{...},"dryRun":true}` → `200`,
    the fake received `{ pkg, initiativeId: "i1", dryRun: true }` exactly, and
    the response body's `data.applied` is what the fake returned.
  - the same with only `pkg` → the fake received exactly
    `{ pkg, initiativeId: "i1" }` (no `dryRun`/`deleteMissing`/`confirmDelete`
    keys).
  - the fake throwing `new StaleManifestError(2, 3, "i1")` → `409
stale_manifest`; `new UncreatableObjectiveError("i1", [...])` → `409
uncreatable_objective`.
  - `GET /api/initiative/i1/package` → `200`, the fake `exportInitiative`
    received the POSITIONAL string `"i1"` (the spy records its first argument and
    the test asserts `assert.equal(received, "i1")`, not an object), the body is
    the presented package and the response carries an `ETag`.
  - `GET /api/initiative/%20/package` → `400 invalid_input` with the fake never
    called; the fake throwing `new UnknownReferenceError("initiative","x")` →
    `404 unknown_reference`.
  - `POST /api/initiative/i1/graph` and `GET /api/initiative/i1/graph` both
    resolve (a method+path pair test): the GET reaches
    `getInitiativeGraph` and the POST reaches `applyGraph`.
  - row shapes: `project.graph.create` has a `location` function and a `present`;
    `initiative.graph.apply` and `initiative.package.get` have
    `location === undefined` and a `present`.
- `node --test src/apps/http/views/graph-package.test.ts src/apps/http/views/graph-apply.test.ts src/apps/http/routes.graph.write.test.ts src/apps/http/routes.test.ts src/apps/http/routes.initiative.test.ts src/apps/http/cli-coverage.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-writes-proof.sh` phases A through G in full (phase H
  is the first failure after this story).
