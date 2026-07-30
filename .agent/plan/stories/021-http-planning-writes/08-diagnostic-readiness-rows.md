# Story S8 — diagnostic and readiness rows

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decision 6)
Depends on: Story S1, S2, S3 (`DiagnosticsExport.build`, the error mappings), S7
(`ROUTES.length` continuity).

Three rows. `ROUTES.length` becomes `52` — the epic's final count.

## Change

### 1. `src/app/graph/check-graph.ts` — nothing changes

`CheckGraph.execute` is **synchronous** (`check-graph.ts:17`). `run` is `async`,
so `run: async (deps, input) => deps.checkGraph.execute(input)` is legal as is.
No signature change. Recorded so nobody "fixes" it.

### 2. `src/apps/cli/deps.ts` + `src/composition.ts` — expose `CheckGraph`

`checkGraph` is the one 021 write use case `CliDeps` does not carry, because the
CLI adapter constructs `new CheckGraph()` itself
(`src/apps/cli/commands/check/graph.ts:8`, `_deps` unused). Constructing a use
case belongs in the composition root, so:

- `src/apps/cli/deps.ts` — add `checkGraph: CheckGraph;` beside `checkProject`
  (`:251`), with `import type { CheckGraph } from "../../app/graph/check-graph.ts";`.
- `src/composition.ts` — construct it beside the other graph use cases
  (`:387-414`): `const checkGraph = new CheckGraph();` and add `checkGraph,` to
  the returned `CliDeps` bundle beside `checkProject`.
- `src/apps/cli/commands/check/graph.ts` and `src/apps/cli/graph-check.ts` are
  NOT changed — the CLI keeps its own instance. This story adds a field; it does
  not refactor the CLI.

### 3. `src/apps/http/views/readiness.ts` (new)

```ts
import type { ReadinessEntry } from "../../../app/graph/check-graph.ts";
import type {
  ReadinessReport,
  CheckRecord,
  NextAction,
  ProbeRecord,
} from "../../../app/project/project-readiness.ts";
```

`ReadinessEntry` is declared in `domain/graph.ts` but RE-EXPORTED from
`app/graph/check-graph.ts:13`, which is the legal import for `apps/http`.

- `readinessEntryView(r: ReadinessEntry)` → `{ id: r.id, state: r.state, waiting: [...r.waiting] }`.
- `probeRecordView(r: ProbeRecord)` → `resourceId`, `status`, `detail`.
- `checkRecordView(r: CheckRecord)` → `name`, `status`, `blocking`, `detail`,
  plus conditionally spread `probes?` (`.map(probeRecordView)`) and
  `ageSeconds?`. `ageSeconds` is `number | null`, so the conditional spread tests
  `!== undefined` and a `null` survives.
- `nextActionView(r: NextAction)` → `check`, `action`,
  `requiresInput: [...r.requiresInput]`, plus conditionally spread `command?`.
- `projectReadinessView(r: ReadinessReport)` → `projectId`, `configured`,
  `verified`, `operational`, `ready`, `checks: r.checks.map(checkRecordView)`,
  `next: r.next === null ? null : nextActionView(r.next)`.

`readonly [key: string]: unknown;` goes on `ReadinessEntryView` and
`ProjectReadinessView` (both are top-level `present` outputs) and on no nested
interface.

### 4. `src/apps/http/views/diagnostic.ts` (new)

`SafeFactsExport` is declared in `src/domain/safe-facts.ts:632` and `apps/http`
may not name it, so declare a local structural mirror. The value
`DiagnosticsExport.build` returns is assignable to it, so
`present: (result) => diagnosticView(result)` typechecks without the import.

```ts
/** Structural mirror of SafeFactsRecord (src/domain/safe-facts.ts:615-630). */
export interface DiagnosticRecordResult {
  readonly schemaVersion: string;
  readonly sessionRef: string;
  readonly taskRef: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly kind: string;
  readonly outcomeCode?: string;
  readonly reasonCode?: string;
  readonly toolCategory?: string;
  readonly exitClass?: string;
  readonly durationMs?: number;
  readonly turns?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
}

/** Structural mirror of SafeFactsExport (src/domain/safe-facts.ts:632-637). */
export interface DiagnosticResult {
  readonly schemaVersion: string;
  readonly exportedAt: string;
  readonly initiativeRef: string;
  readonly records: readonly DiagnosticRecordResult[];
}
```

`diagnosticRecordView` emits the six required fields literally and conditionally
spreads the eight optionals. `diagnosticView(r: DiagnosticResult)` emits exactly
`schemaVersion`, `exportedAt`, `initiativeRef`,
`records: r.records.map(diagnosticRecordView)` — and **no `outPath`**: a client
never learns a server filesystem path.

### 5. `src/apps/http/deps.ts` — three fields

```ts
import type { DiagnosticsExport } from "../../app/observability/diagnostics-export.ts";
import type { CheckGraph } from "../../app/graph/check-graph.ts";
import type { CheckProject } from "../../app/project/check-project.ts";
...
  readonly diagnosticsExport: DiagnosticsExport;
  readonly checkGraph: CheckGraph;
  readonly checkProject: CheckProject;
```

### 6. `src/apps/cli/commands/serve.ts` — populate them

```ts
      diagnosticsExport: deps.diagnosticsExport,
      checkGraph: deps.checkGraph,
      checkProject: deps.checkProject,
```

### 7. `src/apps/http/routes.ts` — three rows appended to `ROUTES`

New imports:

```ts
import { readinessEntryView, projectReadinessView } from "./views/readiness.ts";
import { diagnosticView } from "./views/diagnostic.ts";
```

| id                             | method | path                             | status | use case                  | cliCommands             |
| ------------------------------ | ------ | -------------------------------- | ------ | ------------------------- | ----------------------- |
| `initiative.diagnostic.export` | POST   | `/api/initiative/:id/diagnostic` | 200    | `DiagnosticsExport.build` | `["export diagnostic"]` |
| `graph.readiness.check`        | POST   | `/api/graph/readiness`           | 200    | `CheckGraph`              | `["check graph"]`       |
| `project.readiness.get`        | GET    | `/api/project/:id/readiness`     | 200    | `CheckProject`            | `["check project"]`     |

```ts
  defineRoute({
    id: "initiative.diagnostic.export",
    method: "POST",
    path: "/api/initiative/:id/diagnostic",
    successStatus: 200,
    kind: "json",
    cliCommands: ["export diagnostic"],
    decode: ({ params, body }) => {
      // The CLI's `--out` is deliberately NOT accepted: a client-supplied server
      // filesystem path is an arbitrary-file-write primitive. The document is
      // returned, never written.
      const taskId = optionalBodyString(body, "task");
      const debug = optionalBodyBool(body, "debug");
      return {
        initiativeId: requirePathParam(params, "id"),
        ...(taskId !== undefined ? { taskId } : {}),
        ...(debug !== undefined ? { debug } : {}),
      };
    },
    run: async (deps, input) => deps.diagnosticsExport.build(input),
    present: (result) => diagnosticView(result),
  }),
  defineRoute({
    id: "graph.readiness.check",
    method: "POST",
    path: "/api/graph/readiness",
    successStatus: 200,
    kind: "json",
    cliCommands: ["check graph"],
    decode: ({ body }) => ({
      tasks: requireBodyObjectArray(body, "tasks").map((entry) => {
        const dependencies = optionalBodyStringArray(entry, "dependencies");
        return {
          id: requireBodyString(entry, "id"),
          ...(dependencies !== undefined ? { dependencies } : {}),
        };
      }),
    }),
    // CheckGraph.execute is synchronous; `run` is async, which is legal as is.
    run: async (deps, input) => deps.checkGraph.execute(input),
    present: (result) => result.map(readinessEntryView),
  }),
  defineRoute({
    id: "project.readiness.get",
    method: "GET",
    path: "/api/project/:id/readiness",
    successStatus: 200,
    kind: "json",
    cliCommands: ["check project"],
    decode: ({ params }) => ({
      id: requirePathParam(params, "id"),
      // The two probe flags are deliberately NOT exposed: --probe-provider makes
      // a real billable model call and --probe-repositories runs git ls-remote.
      // Probing belongs with EPIC 024's POST /api/ai-provider/:id/probe.
      probeRepositories: false,
      probeProvider: false,
    }),
    run: async (deps, input) => deps.checkProject.execute(input),
    present: (result) => projectReadinessView(result),
  }),
```

### 8. `src/apps/http/routes.test.ts` — the final row count and the full id list

```ts
test("ROUTES holds exactly 52 rows: 24 from 019+020, plus the 28 rows of EPIC 021", () => {
  assert.equal(ROUTES.length, 52);
});
```

### 9. `src/apps/http/cli-coverage.test.ts` — three more claimed leaves

Add `"export diagnostic"`, `"check graph"`, `"check project"`.

## Constraints

- `export diagnostic` is a **POST**, not a read: every call mints a fresh session
  ref through `getOrCreateSessionRef`, which `INSERT`s a row
  (`src/storage/sqlite/sqlite-observability-refs.ts:25-46`).
- `check graph` is a **POST** because the computation is over the CALLER's graph
  and stores nothing (`check-graph.ts:16-27`); a document that does not fit a URL
  is a POST body. It creates nothing, so it declares no `location`.
- `check project` is a **GET**: a pure read over stored state, with both probe
  flags bound literally `false` in `decode`. They are required booleans on
  `CheckProjectInput` — do not make them optional.
- The response document carries no `outPath` and its `initiativeRef` is the
  opaque ref `getOrCreateInitiativeRef` returns, never the real initiative id.
- `schemaVersion` is the STRING `"007.1"` (`src/domain/safe-facts.ts:602`). Do
  not coerce it to a number; Story S9 corrects the Proof line that asserts
  otherwise.
- The body field is `task`, the use-case field is `taskId` — the row's `decode`
  bridges the name.
- `readiness` and `diagnostic` are already in `PATH_SEGMENTS` and `readiness` is
  already the single `NOT_PLURAL` entry (Story S2).
- No `as` cast in any row.

## Verify

- New `src/apps/http/views/readiness.test.ts`:
  - `readinessEntryView` leak test: exactly `["id","state","waiting"]`, and
    `waiting` is a copy, not the input reference.
  - `projectReadinessView` with a full `ReadinessReport` fixture (two checks, one
    carrying `probes` and `ageSeconds: null`, one carrying neither; a non-null
    `next` with and without `command`) plus an injected extra field at every
    level: the top-level key set is exactly
    `["checks","configured","next","operational","projectId","ready","verified"]`,
    the check key sets are exactly as declared, `probes` entries are exactly
    `["detail","resourceId","status"]`, and `next` is exactly
    `["action","check","requiresInput"]` when `command` is absent.
  - `next: null` survives as `null`; `verified: null` survives as `null`;
    `ageSeconds: null` survives as `null` (a conditional spread on
    `!== undefined`, not on truthiness).
- New `src/apps/http/views/diagnostic.test.ts`:
  - `diagnosticView` leak test: the top-level key set is exactly
    `["exportedAt","initiativeRef","records","schemaVersion"]` even when the
    fixture is cast through `as unknown as DiagnosticResult` carrying `outPath`,
    `secret` and a stray nested field — assert `"outPath" in view === false`.
  - a record with only the six required fields gives exactly
    `["kind","schemaVersion","seq","sessionRef","taskRef","timestamp"]`; a record
    with all eight optionals gives the full 14-key set.
- New `src/apps/http/routes.readiness.test.ts` (supertest + fakes):
  - `POST /api/initiative/i1/diagnostic` with `{}` → `200`, the fake `build`
    received exactly `{ initiativeId: "i1" }` (no `taskId`/`debug` keys), and the
    body's `data` has no `outPath`.
  - the same with `{"task":"t1","debug":true}` → the fake received
    `{ initiativeId: "i1", taskId: "t1", debug: true }`.
  - the fake `build` throwing `new UnknownReferenceError("initiative","i1")` →
    `404 unknown_reference`.
  - the response carries an `ETag` (it is a `200` json row).
  - `POST /api/graph/readiness` with
    `{"tasks":[{"id":"a"},{"id":"b","dependencies":["a"]}]}` → `200`, the fake
    received `{ tasks: [{ id: "a" }, { id: "b", dependencies: ["a"] }] }`
    exactly (the first element has NO `dependencies` key), and the body is
    `{ data: [ {id,state,waiting}, … ] }`.
  - `POST /api/graph/readiness` with `{}` → `400 invalid_input` naming `tasks`;
    with `{"tasks":[{}]}` → `400 invalid_input` naming `id`; with
    `{"tasks":"x"}` → `400 invalid_input`; the fake was never called in any of
    the three.
  - the fake throwing `new CycleError([...])` → `409 cycle_detected`; throwing
    `new UnknownDependencyError(...)` → `400 unknown_dependency`; throwing
    `new DuplicateTaskError(...)` → `409 duplicate_task`.
  - the fake `checkGraph` is a SYNCHRONOUS `execute` returning an array (not a
    promise) and the row still answers `200` — proving the `async` wrapper.
  - `GET /api/project/p1/readiness` → `200`, the fake received exactly
    `{ id: "p1", probeRepositories: false, probeProvider: false }`, and the body's
    `data.projectId` is `"p1"`.
  - `GET /api/project/p1/readiness?probe-repositories=true` → the fake STILL
    received `probeRepositories: false` (the query parameter is ignored, not
    honoured).
  - `GET /api/project/%20/readiness` → `400 invalid_input` with the fake never
    called; the fake throwing `new UnknownReferenceError("project","p1")` →
    `404 unknown_reference`.
  - row shapes: all three have `location === undefined` and `readRow ===
undefined`; all three have a `present`.
- `node --test src/apps/http/views/readiness.test.ts src/apps/http/views/diagnostic.test.ts src/apps/http/routes.readiness.test.ts src/apps/http/routes.test.ts src/apps/http/cli-coverage.test.ts src/apps/cli/architecture.test.ts` passes.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-writes-proof.sh` phases A through H — H's
  `schemaVersion` assertion still fails until Story S9 corrects that line;
  everything else in H must pass.
