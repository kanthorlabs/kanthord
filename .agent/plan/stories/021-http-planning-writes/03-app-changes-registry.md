# Story S3 — the app-layer changes and the 21 error mappings

Epic: `.agent/plan/epics/021-http-planning-writes.md` (decision 7 + the error
registry section)
Depends on: Story S1 (`428` in `ALLOWED_STATUSES`).

No row lands in this story. `ROUTES.length` stays `24`.

## Change

### 1. `src/app/graph/export-initiative.ts:46-48` — a classifiable error

Add `import { UnknownReferenceError } from "../errors.ts";` and replace the bare
throw:

```ts
const initiative = this.#initiatives.get(initiativeId);
if (initiative === undefined) {
  throw new UnknownReferenceError("initiative", initiativeId);
}
```

Without this, `GET /api/initiative/<unknown>/package` answers `500 internal`
while every other unknown-id read answers `404 unknown_reference`. The CLI
inherits the better message; there is no backward-compatibility duty
(AGENTS.md).

### 2. `src/app/observability/diagnostics-export.ts:115-325` — split building from writing

Extract `build` and leave `execute` as `build` + `writeFile` + preview. The HTTP
row calls `build`, so no request can name a server filesystem path.

- `build(input: { initiativeId: string; taskId?: string; debug?: boolean }): Promise<SafeFactsExport>`
  is the CURRENT body of `execute` from line 123 (`const runKey = newId();`)
  through line 318 (`};`, closing `exportObj`), ending with
  `return exportObj;`. Annotate its return type `Promise<SafeFactsExport>`,
  adding `SafeFactsExport` to the EXISTING `../../domain/safe-facts.ts` import
  (an `app/` module may import `domain/`). Delete the
  `const { initiativeId, outPath } = input;` destructure from `build` and use
  `const { initiativeId } = input;`.
  The `preview`/`kindCounts` block (current lines 299-307) moves OUT of `build`
  — see the next bullet — but the `records` array and every `switch` case stay
  byte-for-byte as they are.
- add a module-level pure function directly above the class:

  ```ts
  /** Preview counts grouped by kind, in first-seen order (unchanged behaviour). */
  function previewOf(
    records: readonly SafeFactsRecord[],
  ): Array<{ kind: SafeFactsKind; count: number }> {
    const kindCounts = new Map<SafeFactsKind, number>();
    for (const r of records) {
      kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);
    }
    return Array.from(kindCounts.entries()).map(([kind, count]) => ({
      kind,
      count,
    }));
  }
  ```

- `execute` keeps its exact current signature
  (`{ initiativeId, taskId?, outPath, debug? }` → `Promise<DiagnosticsExportResult>`)
  and becomes:

  ```ts
    async execute(input: {
      initiativeId: string;
      taskId?: string;
      outPath: string;
      debug?: boolean;
    }): Promise<DiagnosticsExportResult> {
      const document = await this.build(input);
      await this.#writeFile(
        input.outPath,
        JSON.stringify(document, null, 2),
        { mode: 0o600 },
      );
      return {
        recordCount: document.records.length,
        outPath: input.outPath,
        preview: previewOf(document.records),
      };
    }
  ```

Behaviour is unchanged: `records` order is the order `build` produced, so
`previewOf` yields the same first-seen kind order the inline block did, and
`recordCount === records.length` held before too.

### 3. `src/app/graph/graph-codec.ts` — validate an untrusted JSON graph package

**Scope note: this is an addition beyond the EPIC's text, and it exists to close
a trust-boundary hole the EPIC created.** Decision 6 hands `CreateGraph` and
`ApplyGraph` a `GraphPackage` parsed from the request body and says
`parseGraphPackage` (the MARKDOWN parser) stays CLI-only. No validator exists for
an already-parsed JSON package, and neither use case is defensive: `CreateGraph`
dereferences `input.pkg.initiative.sourcePath` at `create-graph.ts:99` before any
check. So a body like `{"pkg":{}}` would be a `500 internal`, and "the client
already parsed it" is not a server trust boundary — any caller can post arbitrary
JSON. The transport layer cannot fix this without an unchecked cast, so the
validator belongs here, in `app/`, shared by any future adapter.

Add, beside `parseGraphPackage` (`:297`):

```ts
/** Thrown when an untrusted JSON graph-package document is malformed. */
export class GraphPackageDocumentError extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`invalid graph package: ${field} ${detail}`);
    this.name = "GraphPackageDocumentError";
    this.field = field;
  }
}

/**
 * Structurally validate an already-parsed graph package (a JSON document, NOT
 * markdown) and return it typed. Validates exactly the fields `CreateGraph` and
 * `ApplyGraph` dereference — nothing more, so it cannot drift into a second
 * schema. Never touches the filesystem and never parses markdown.
 */
export function parseGraphPackageDocument(value: unknown): GraphPackage;
```

Validation rules, exactly:

- the document is a non-null, non-array object; else
  `GraphPackageDocumentError("pkg", "must be an object")`.
- `packageId`: required non-empty string. `formatVersion`: required number.
- `initiative`: required object with required non-empty string `ref`, `name`,
  `sourcePath`; optional string `id`; optional `after` (array of strings);
  optional `bindings` (object of strings).
- `objectives`: required array (may be empty); each element an object with
  required non-empty string `ref`, `initiativeRef`, `name`, `sourcePath`;
  optional string `id`; optional `after` (array of strings); optional `context`
  (object of strings).
- `tasks`: required array (may be empty); each element an object with required
  non-empty string `ref`, `objectiveRef`, `title`, `instructions`, `agent`,
  `sourcePath`; required `ac` and `dependencies` (arrays of strings); optional
  string `id`; `verification` may be absent, `null`, or an array of strings;
  optional `context` (object of strings).
- `manifest`: optional; when present, an object with required non-empty string
  `initiativeId`, `packageId`; required number `formatVersion`; required
  `digestAlgorithm === "sha256"`; required `nodes` and `refToId.objectives` /
  `refToId.tasks` (objects of strings); required `files` (array of strings);
  optional `objectiveIds` (array of strings).
- The error `field` names the failing path (`"tasks[1].title"`,
  `"manifest.refToId"`) so the HTTP `400` message points at the offending field.
- The function RETURNS THE INPUT VALUE typed — it does not rebuild the object, so
  it cannot silently drop a field a future `GraphPackage` version adds.

Then register it in `src/apps/http/error-registry.ts` (see section 5) as
`{ type: GraphPackageDocumentError, code: "invalid_package", status: 400 }` and
add `invalid_package` to the epic's error registry.

### 4. `src/app/errors.ts` — three missing re-exports

`InvalidTaskFieldError`, `DuplicateTaskError` and `UnknownDependencyError` are
declared in `domain/`, which `apps/http` may not import. Append beside the
existing `CycleError` re-export (`:4-5`):

```ts
export { DuplicateTaskError, UnknownDependencyError } from "../domain/graph.ts";
export { InvalidTaskFieldError } from "../domain/task.ts";
```

The other 17 classes are declared under `src/app/**` and are imported from their
own modules — `error-registry.ts` already imports `app/task/get-conflict.ts`
directly, so no further re-export is needed.

### 5. `src/apps/http/error-registry.ts:1-8, 22-37` — 21 domain mappings

Imports:

```ts
import {
  UnknownReferenceError,
  DuplicateNameError,
  ObjectiveNotInConflictError,
  WrongTypeReferenceError,
  CycleError,
  DuplicateTaskError,
  UnknownDependencyError,
  DependenciesLockedError,
  SequencingScopeError,
  SequencingLockedError,
  UnknownAgentError,
  InvalidTaskFieldError,
  EmbeddedCredentialError,
} from "../../app/errors.ts";
import { NoConflictCandidateError } from "../../app/task/get-conflict.ts";
import {
  ImmutableFieldError,
  CacheConflictError,
} from "../../app/resource/update-resource.ts";
import { ImportValidationError } from "../../app/resource/import-resources.ts";
import { GraphPackageDocumentError } from "../../app/graph/graph-codec.ts";
import {
  CreateModeIdError,
  UnboundAliasError,
  ExecutorBindingSetError,
  UnknownNodeError,
  CrossInitiativeError,
  StaleManifestError,
  UncreatableObjectiveError,
} from "../../app/graph/import-errors.ts";
import { HttpFailure } from "./errors.ts";
```

Append to `DOMAIN_ERROR_MAPPINGS`, after the four existing entries, in exactly
this order (each keeps the thrown error's own message — no `message` override):

```ts
  { type: WrongTypeReferenceError, code: "wrong_type_reference", status: 400 },
  { type: CycleError, code: "cycle_detected", status: 409 },
  { type: DuplicateTaskError, code: "duplicate_task", status: 409 },
  { type: UnknownDependencyError, code: "unknown_dependency", status: 400 },
  { type: DependenciesLockedError, code: "dependencies_locked", status: 409 },
  { type: SequencingScopeError, code: "sequencing_scope", status: 400 },
  { type: SequencingLockedError, code: "sequencing_locked", status: 409 },
  { type: UnknownAgentError, code: "unknown_agent", status: 400 },
  { type: InvalidTaskFieldError, code: "invalid_task_field", status: 400 },
  { type: EmbeddedCredentialError, code: "embedded_credential", status: 400 },
  { type: ImmutableFieldError, code: "immutable_field", status: 409 },
  { type: CacheConflictError, code: "cache_conflict", status: 409 },
  { type: ImportValidationError, code: "import_validation", status: 400 },
  { type: CreateModeIdError, code: "create_mode_id", status: 400 },
  { type: UnboundAliasError, code: "unbound_alias", status: 400 },
  { type: ExecutorBindingSetError, code: "executor_binding_set", status: 400 },
  { type: UnknownNodeError, code: "unknown_node", status: 404 },
  { type: CrossInitiativeError, code: "cross_initiative", status: 409 },
  { type: StaleManifestError, code: "stale_manifest", status: 409 },
  { type: UncreatableObjectiveError, code: "uncreatable_objective", status: 409 },
  { type: GraphPackageDocumentError, code: "invalid_package", status: 400 },
```

## Constraints

- These classes are NOT registered, and the reason is the EPIC's: `AmbiguousNameError`
  (no route calls `Find*`); `AmbiguousBindingNameError`, `UnknownBindingNameError`,
  `IncompatibleBindingTypeError`, `IncompatibleProviderCredentialError`,
  `DriftConflictError` (no production module throws them); `DuplicateRefError`
  (thrown by `parseGraphPackage`, which runs in the client);
  `InvalidObjectiveIdError` (unreachable — `CreateTask` resolves the objective's
  kind first and 404s, `create-task.ts:57-60`).
- Every class in `DOMAIN_ERROR_MAPPINGS` extends `Error` directly — none is a
  subclass of another — so `mapError`'s linear `instanceof` scan is order-
  independent. Do not reorder the four existing entries.
- `build` must not write, must not take `outPath`, and must not change any
  `switch` case, the `seq` accounting, the `process.stderr.write` warnings or the
  validation `try/catch`. `execute`'s public signature and its
  `DiagnosticsExportResult` are unchanged.
- `ExportInitiative`'s change is the throw only. Its return value, the manifest
  it builds and its positional `execute(initiativeId: string)` signature are
  unchanged.
- `src/apps/cli/export.ts` is NOT changed; it still lets the error escape to
  commander, which now sees a better message.

## Verify

- `src/app/graph/export-initiative.test.ts` (add):
  - `execute("nope")` on a repo that has no such initiative rejects with
    `UnknownReferenceError`; `err.kind === "initiative"` and `err.id === "nope"`
    (assert whichever field names the class carries — see
    `src/domain/errors.ts:19-29`).
  - `mapError(err)` gives `{ code: "unknown_reference", status: 404 }`.
  - every existing test in the file still passes unedited.
- `src/app/observability/diagnostics-export.test.ts` (add):
  - `build` returns a document whose keys are exactly
    `["exportedAt","initiativeRef","records","schemaVersion"]` (sorted) and
    which has **no** `outPath` key.
  - `execute` writes the same document: with fake `refs` returning constant refs
    (`getOrCreateSessionRef` → `"S"`, `getOrCreateInitiativeRef` → `"I"`,
    `getOrCreateTaskRef` → `"T"`) and one shared event fixture, call `execute`
    with a `writeFile` spy and call `build` separately; set both documents'
    `exportedAt` to a fixed sentinel, then
    `assert.deepEqual(JSON.parse(spy.data), built)`.
  - `execute` still writes with mode `0o600`: `assert.deepEqual(spy.opts, { mode: 0o600 })`,
    and `spy.path` equals the `outPath` it was given.
  - `execute`'s result is `{ recordCount, outPath, preview }` with
    `recordCount === document.records.length` and the same `preview` array the
    pre-change code produced for that fixture (assert the exact array).
  - every existing test in the file still passes unedited.
- New `src/app/graph/graph-codec.document.test.ts`:
  - a full valid package (initiative + one objective + one task + manifest,
    every optional present) round-trips: `parseGraphPackageDocument(pkg)`
    returns the SAME object reference (`assert.equal(out, pkg)`).
  - a minimal valid package (empty `objectives`, empty `tasks`, no `manifest`)
    passes.
  - each rejection, asserting `err instanceof GraphPackageDocumentError` and the
    exact `err.field`: `{}` → `"pkg"`; a missing `packageId`; a string
    `formatVersion`; a missing `initiative`; `initiative.ref === ""`;
    `objectives` a string; `objectives[0]` a number → `"objectives[0]"`;
    `tasks[1].title` missing → `"tasks[1].title"`; `tasks[0].ac` a string;
    `tasks[0].dependencies` missing; `tasks[0].after` is NOT a field and is
    ignored; `manifest.digestAlgorithm === "md5"` → `"manifest.digestAlgorithm"`;
    `manifest.refToId` missing a `tasks` key.
  - `tasks[0].verification` absent, `null` and `["cmd"]` all pass; `"cmd"` (a
    scalar) is rejected.
  - `mapError(new GraphPackageDocumentError("pkg","must be an object"))` gives
    `{ code: "invalid_package", status: 400 }`.
  - a package containing an UNKNOWN extra top-level field passes (the validator
    checks required fields, it is not a whitelist) and the extra field survives
    on the returned object.
- `src/apps/http/error-registry.test.ts` (add):
  - `DOMAIN_ERROR_MAPPINGS.length === 25`.
  - one class per code:
    `assert.equal(new Set(DOMAIN_ERROR_MAPPINGS.map((m) => m.type)).size, DOMAIN_ERROR_MAPPINGS.length)`.
  - one code per class: the existing uniqueness assertion already covers codes.
  - a table-driven test that constructs one instance of each of the 20 new
    classes and asserts `mapError(instance)` returns the exact
    `{ code, status }` pair from the table above — 21 assertions, no loop over
    the registry itself (a loop over the registry would assert nothing).
  - each of the 21 mapped messages is the thrown error's own message
    (`mapped.message === err.message`), so no mapping silently hides a domain
    message.
  - the registry-hygiene test passes with the 23 new codes (21 domain + S1's 2
    transport).
- `node --test src/app/graph/export-initiative.test.ts src/app/observability/diagnostics-export.test.ts src/app/graph/graph-codec.document.test.ts src/app/graph/graph-codec.test.ts src/apps/http/error-registry.test.ts` passes.
- `npm run verify` exits 0.
- Proof: none directly, but `scripts/e2e/http-reads-proof.sh` (`020 ok: …`) must
  still pass — run it.
