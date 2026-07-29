# Story 02 — envelope + error registry

Epic: `.agent/plan/epics/019-http-api-skeleton.md`

## Change

### New file `src/apps/http/envelope.ts`

No imports.

```ts
export function okBody(data: unknown): string; // JSON.stringify({ data })
export function errorBody(
  code: string,
  message: string,
  requestId?: string,
): string;
// JSON.stringify({ error: { code, message, ...(requestId ? { requestId } : {}) } })
```

Binding: `okBody` emits no indentation (single line), matching
`src/apps/cli/get.ts:20`. `errorBody` omits `requestId` entirely when absent —
never `"requestId": undefined`.

### New file `src/apps/http/error-registry.ts`

Imports **only** the same module paths `src/apps/cli/error-map.ts:1-71` uses, all
under `../../app/`, plus `MissingFlagError` from `../cli/error-map.ts`
(intra-element, allowed) and the two local error classes below. **Do not import
from `src/domain/**` or any `*/port.ts`** — eslint forbids it from `apps/`.

```ts
export interface ErrorEntry {
  readonly error: Function; // an error constructor, used with `instanceof`
  readonly code: string;
  readonly status: number;
}

export const ERROR_REGISTRY: readonly ErrorEntry[];

/** First matching entry by `instanceof`, or undefined. */
export function lookupError(
  err: unknown,
): { code: string; status: number } | undefined;
```

**Code rule (mechanical, no judgement):** `code` is the class name minus the
trailing `Error`, converted to snake_case — `UnknownReferenceError` →
`unknown_reference`, `InvalidApiFlavorError` → `invalid_api_flavor`,
`CursorNotUlidError` → `cursor_not_ulid`. Write each literal out in the table;
do not compute it at runtime.

**Status table (binding, one row per class; grouped by import module):**

`../../app/errors.ts` — `UnknownReferenceError` 404 · `WrongTypeReferenceError`
400 · `DuplicateNameError` 409 · `AmbiguousNameError` 409 · `CycleError` 409 ·
`DependenciesLockedError` 409 · `UnknownAgentError` 400 ·
`TaskNotAwaitingConfirmationError` 409 ·
`ObjectiveNotAwaitingConfirmationError` 409 · `ObjectiveNotInConflictError` 409 ·
`ProposalWorkspaceMissingError` 409 · `EmbeddedCredentialError` 400 ·
`UnknownModelError` 400 · `SequencingLockedError` 409 ·
`SequencingScopeError` 400 · `StaleCandidateError` 409 · `ImpactChangedError` 409

`../../app/task/retry-task.ts` — `TaskNotRetryableError` 409
`../../app/objective/retry-objective.ts` — `ObjectiveNotRetryableError` 409
`../../app/task/approve-task.ts` — `ProposalMissingError` 409
`../../app/task/reject-task.ts` — `RejectionConflictError` 409
`../../app/resource/import-resources.ts` — `ImportValidationError` 400

`../../app/graph/import-errors.ts` — `CrossInitiativeError` 400 ·
`UnknownNodeError` 400 · `DuplicateRefError` 400 · `CreateModeIdError` 400 ·
`DriftConflictError` 409 · `StaleManifestError` 409 ·
`UncreatableObjectiveError` 409

`../../app/resource/update-resource.ts` — `ImmutableFieldError` 400 ·
`CacheConflictError` 412

`../../app/ai-provider/errors.ts` — `DuplicateAssignmentError` 409 ·
`LoggedOutProviderError` 409 · `DefaultNeedsReplacementError` 409 ·
`SelfReplacementError` 400 · `UnknownProviderError` 400 ·
`CorruptDefaultPointerError` 409 · `UnnecessaryReplacementError` 400 ·
`InvalidEffortError` 400 · `InvalidBaseUrlError` 400 ·
`ConflictingDefaultChoiceError` 400 · `NonOAuthProviderError` 400 ·
`EmptyValueError` 400 · `AssignedProviderError` 409 · `InvalidRankError` 400 ·
`AmbiguousFlagsError` 400 · `InvalidApiFlavorError` 400 ·
`InsecureEndpointError` 400 · `MissingCustomProviderIdError` 400 ·
`MissingBaseUrlError` 400 · `InvalidNumericFlagError` 400 ·
`NoUpdateFieldsError` 400 · `BuiltinProviderFieldError` 400 ·
`StaleCredentialError` 412

`../../app/task/abandon-task.ts` — `TaskNotAbandonableError` 409 ·
`NoRunningJobError` 409 · `AmbiguousRunningJobError` 409

`../../app/project/ack-project.ts` — `CursorNotUlidError` 400 ·
`CursorAheadOfFeedError` 409

`../cli/error-map.ts` — `MissingFlagError` 400, code `missing_flag`

**Transport-level entries, declared in this file** (so every code lives in one
table):

```ts
export class MalformedBodyError extends Error {} // code malformed_body,          status 400
export class UnsupportedMediaTypeError extends Error {} // unsupported_media_type, 415
export class BodyTooLargeError extends Error {} // body_too_large,               413
export class UnknownRouteError extends Error {} // unknown_route,                404
export class MethodNotAllowedError extends Error {} // method_not_allowed,          405
export class UnauthenticatedError extends Error {} // unauthenticated,              401
export class CsrfFailedError extends Error {} // csrf_failed,                  403
export class HostNotAllowedError extends Error {} // host_not_allowed,             403
export class OriginNotAllowedError extends Error {} // origin_not_allowed,          403
```

Each sets `this.name` to its class name. `MethodNotAllowedError` carries
`readonly allow: readonly string[]` (the methods the table declares for that
path) so the server can emit the `Allow` header.
`InvalidInputError` is **not** declared here — it lives in `decode.ts` (Story 03)
and is registered by importing it from `./decode.ts`, code `invalid_input`,
status 400.

Ordering: transport entries first, then the app entries in the module order
above. `lookupError` returns the first `instanceof` match.

## Constraints

- **Do not modify `src/apps/cli/error-map.ts`.** The CLI keeps its own map; this
  registry is a second consumer of the same class list.
- No error class carries its structured fields into the response. The body is
  `{ code, message }` only — `message` is `err.message` verbatim. Structured
  fields (`.flag`, `.ids`, `.path`) are deliberately dropped in 019.
- `ERROR_REGISTRY` is a flat `as const`-free readonly array; no nesting, no map
  keyed by name.

## Verify

New test file `src/apps/http/error-registry.test.ts`,
`describe("src/apps/http/error-registry.ts")`:

- **Completeness.** The test imports every class from the same 11 `../../app/**`
  modules listed above plus `MissingFlagError`, builds
  `const CLI_MAPPED: Function[] = [...]`, and asserts for each that
  `ERROR_REGISTRY.some((e) => e.error === cls)` is true, failing with the class
  name. **Build the list by importing the classes, never by hard-coding a
  count** — a count would drift.
- **No orphans.** Every app-layer entry in `ERROR_REGISTRY` (i.e. every entry
  whose class is not one of the nine transport classes or `InvalidInputError`)
  appears in `CLI_MAPPED`.
- **Unique codes.** `new Set(ERROR_REGISTRY.map((e) => e.code)).size === ERROR_REGISTRY.length`.
- **Status domain.** Every `status` is one of `400, 401, 403, 404, 405, 409, 412, 413, 415`.
- **Explicit per-class assertions** (not name-family derived), at minimum:
  `UnknownReferenceError` → `{ code: "unknown_reference", status: 404 }`;
  `DuplicateNameError`, `CycleError`, `StaleCandidateError`,
  `ImpactChangedError`, `DependenciesLockedError`, `DriftConflictError` → 409;
  `MissingFlagError`, `InvalidBaseUrlError`, `InvalidNumericFlagError`,
  `EmptyValueError` → 400; `CacheConflictError`, `StaleCredentialError` → 412.
- **`lookupError`** returns `undefined` for `new Error("boom")` and for a plain
  string, and resolves a real instance
  (`new UnknownReferenceError("project", "p1")`) to 404.
- **Subclass safety:** if two registered classes are in an `instanceof`
  relationship, the more specific one is earlier in the array. Assert this
  mechanically: for every pair `(i, j)` with `i < j`, it is not the case that
  `ERROR_REGISTRY[j].error.prototype instanceof ERROR_REGISTRY[i].error`.

New test file `src/apps/http/envelope.test.ts`:

- `okBody({ id: "p1" })` equals `'{"data":{"id":"p1"}}'` exactly.
- `errorBody("unknown_route", "no such route")` equals
  `'{"error":{"code":"unknown_route","message":"no such route"}}'` exactly — no
  `requestId` key.
- `errorBody("internal", "internal error", "01J…")` contains `"requestId"`.

Commands:

- `node --test src/apps/http/error-registry.test.ts src/apps/http/envelope.test.ts` exits 0.
- `npm run verify` exits 0.
- Proof: `scripts/e2e/http-api-proof.sh` phase E (`404 unknown_reference`,
  `404 unknown_route`, `405 method_not_allowed`), phase F (`403 csrf_failed`),
  phase G (`403 host_not_allowed`, `415`, `403 origin_not_allowed`).
