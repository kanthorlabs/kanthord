# Story 05 — D1: typed `update` use cases + CLI

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

Each resource type gains a dedicated `update` use case (`UpdateRepository`,
`UpdateCredential`, `UpdateAiProvider`, `UpdateNotification`, `UpdateFilesystem`)
and a matching CLI command. Immutable fields are never touched. Optional fields
are cleared only via explicit `--clear-*` flags (omission ≠ clear). Credential
value reads through `--value-file` (Story 02). Model changes re-validate through
the `ModelCatalog` (Story 04). A repository update that would silently rewrite a
cached clone's `origin` is rejected unless the cache is absent or an explicit
`--reclone` flag is passed.

The D1 stories that needed a raw DB edit during the E2E (`gpt-5.5 → gpt-5.6-terra`)
will now work via: `update ai-provider --id <id> --model gpt-5.6-terra`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/app/resource/update-resource.ts  (new — shared input types + errors)

export interface UpdateRepositoryInput {
  id: string;
  name?: string;
  branch?: string;
  path?: string;
  remoteUrl?: string;
  auth?: import("../../domain/resource.ts").RepositoryAuth;
  reclone?: boolean; // required when remoteUrl changes and home cache exists
}

export interface UpdateCredentialInput {
  id: string;
  name?: string;
  value?: string; // populated by the CLI via readCredentialValue(), never from --value
}

export interface UpdateAiProviderInput {
  id: string;
  name?: string;
  model?: string;
  effort?: import("../../domain/resource.ts").ReasoningEffort | null; // null = clear
  baseUrl?: string | null; // null = clear (explicit --clear-base-url)
}

export interface UpdateNotificationInput {
  id: string;
  name?: string;
  destination?: string;
}

export interface UpdateFilesystemInput {
  id: string;
  name?: string;
  path?: string;
}

// Thrown when the caller tries to change an immutable field:
export class ImmutableFieldError extends Error {
  readonly field: string;
  constructor(field: string); // name = "ImmutableFieldError"
}

// Thrown when a remoteUrl update is attempted but the home clone exists and
// --reclone was not passed:
export class CacheConflictError extends Error {
  readonly resourceId: string;
  constructor(resourceId: string); // name = "CacheConflictError"
}
```

```ts
// src/app/resource/update-repository.ts
export class UpdateRepository {
  constructor(
    projectRepository: ProjectRepository,
    workspaceManager: WorkspaceManager, // to check whether home path exists
  );
  execute(input: UpdateRepositoryInput): Promise<void>;
  // - looks up the resource, throws UnknownReferenceError if not found
  // - throws ImmutableFieldError for any of: id, projectId, type
  // - when input.remoteUrl is set and differs: checks whether home path exists;
  //   if it does and reclone !== true, throws CacheConflictError
  // - validates remoteUrl has no embedded userinfo (EmbeddedCredentialError)
  // - saves the merged resource
}

// src/app/resource/update-credential.ts
export class UpdateCredential {
  constructor(projectRepository: ProjectRepository);
  execute(input: UpdateCredentialInput): Promise<void>;
  // - throws ImmutableFieldError for id, projectId, type, provider
}

// src/app/resource/update-ai-provider.ts
export class UpdateAiProvider {
  constructor(
    projectRepository: ProjectRepository,
    modelCatalog: ModelCatalog,
  );
  execute(input: UpdateAiProviderInput): Promise<void>;
  // - throws ImmutableFieldError for id, projectId, type, provider
  // - when model is set: validates via modelCatalog.isValid(provider, model);
  //   throws UnknownModelError on failure
  // - effort: null → clear (set to undefined); string → replace
  // - baseUrl: null → clear; string → replace
}

// src/app/resource/update-notification.ts
export class UpdateNotification {
  constructor(projectRepository: ProjectRepository);
  execute(input: UpdateNotificationInput): Promise<void>;
  // - throws ImmutableFieldError for id, projectId, type, provider

// src/app/resource/update-filesystem.ts
export class UpdateFilesystem {
  constructor(projectRepository: ProjectRepository);
  execute(input: UpdateFilesystemInput): Promise<void>;
  // - throws ImmutableFieldError for id, projectId, type
}
```

```ts
// CLI surface (src/apps/cli/router.ts COMMANDS additions):
// "update repository"  --id --name --branch --path --remote-url --auth --credential --reclone
// "update credential"  --id --name [--value-file <path>] [--value-timeout <dur>]
// "update ai-provider" --id --name --model --effort --clear-effort --base-url --clear-base-url
// "update notification"--id --name --destination
// "update filesystem"  --id --name --path
```

## Constraints

- `UpdateRepository`, `UpdateCredential`, etc. each live in their own
  `src/app/resource/update-<type>.ts` file (verb-first naming, AGENTS.md rule).
- The `update-resource.ts` file is a shared input-types and error module, not a
  base class. No generic `UpdateResource<T>` base.
- `app/` imports only `domain/` and `*/port.ts`. `UpdateAiProvider` imports
  `ModelCatalog` from `src/model-catalog/port.ts`; `UpdateRepository` imports
  `WorkspaceManager` from `src/workspace/port.ts`. No concrete adapters.
- **Late-binding rule (locked):** when a resource update completes, tasks that
  are already `running` keep the values they loaded at claim time. Tasks that are
  `pending` or `failed` (retryable) will read the new values when they next run.
  Tasks that are `completed` keep their historical values. This rule is enforced
  structurally — no in-flight task state is touched by the update use cases.
- **Immutable check:** `id`, `projectId`, `type` are immutable for all resource
  types. `provider` is additionally immutable for `Credential` and `AIProvider`.
  Attempting to update one of these (i.e. passing a value that differs from the
  stored value) throws `ImmutableFieldError`.
- **`--clear-*` flags:** omission of an optional field means "leave unchanged".
  Setting `effort: null` (via `--clear-effort`) clears the field. Setting
  `baseUrl: null` (via `--clear-base-url`) clears it. There is no `--clear-name`
  — name is always required when `--name` is passed.
- Credential value via `readCredentialValue()` from Story 02, never from a
  `--value` flag.
- `RemoteUrl` embedded-credential check in `UpdateRepository` reuses the same
  `EmbeddedCredentialError` as Story 01 (domain-level validation).
- `composition.ts` wires all five new use cases.

## Verification Gate

`node --test src/app/resource/update-*.test.ts` (all five) green;
`node --test src/apps/cli/update-resource.test.ts` green;
`npm run typecheck` exit 0; `npm run lint` clean.

---

### Task T1 — shared errors + `UpdateCredential` + `UpdateNotification` + `UpdateFilesystem`

**Requires:** Story 01 T1 (domain shape), Story 02 T1 (credential-input module
— not strictly needed here, but Story 01 foundation is required for the
`Repository` shape context).

**Input:** `src/app/resource/update-resource.ts` (new, shared types + errors),
`src/app/resource/update-credential.ts` (new),
`src/app/resource/update-notification.ts` (new),
`src/app/resource/update-filesystem.ts` (new),
corresponding test files.

**Action — RED:** tests for each: (a) `UpdateCredential.execute` with a valid
`{ id, name: "new-name" }` updates the name; (b) calling with `{ id, provider: "other" }`
throws `ImmutableFieldError("provider")`; (c) calling with `{ id, value: "new-val" }`
updates the stored value; (d) `UpdateNotification.execute` with `{ id, destination: "new" }`
updates it; (e) calling with `{ id, provider: "telegram" }` (provider is immutable)
throws `ImmutableFieldError("provider")`; (f) `UpdateFilesystem.execute` with
`{ id, path: "/new" }` updates the path. All three throw `UnknownReferenceError`
for an unknown id. Fails today: use cases do not exist.

**Action — GREEN:** create `update-resource.ts` with the locked input interfaces
and errors. Implement each use case: look up resource by id; apply the non-nil
fields from the input to a copy; throw `ImmutableFieldError` for any immutable
field that differs; persist the updated copy.

**Action — REFACTOR:** extract a shared `applyNameUpdate(resource, name)` helper
if the three implementations share the pattern.

**Output:** `UpdateCredential`, `UpdateNotification`, `UpdateFilesystem` use
cases implemented and tested.

**Verify:** `node --test src/app/resource/update-credential.test.ts` etc. green;
`npm run typecheck` 0.

---

### Task T2 — `UpdateAiProvider` with `ModelCatalog` validation

**Requires:** T1, Story 04 T1 (`ModelCatalog` port + `FakeModelCatalog`).

**Input:** `src/app/resource/update-ai-provider.ts` (new),
`src/app/resource/update-ai-provider.test.ts` (new).

**Action — RED:** tests using `FakeModelCatalog`: (a) `execute({ id, model: "gpt-5.6-sol" })`
where the fake accepts `(provider, "gpt-5.6-sol")` → updates model; (b) same call
with a fake that rejects → throws `UnknownModelError`; (c) `execute({ id, effort: null })`
clears effort (result has `effort === undefined`); (d) `execute({ id, baseUrl: null })`
clears baseUrl; (e) `execute({ id, provider: "other" })` throws `ImmutableFieldError("provider")`.
Fails today: use case does not exist.

**Action — GREEN:** implement `UpdateAiProvider` with the locked contract. Use
`FakeModelCatalog` in tests. Handle `null` for `effort` and `baseUrl` as explicit
clear; `undefined` means unchanged.

**Action — REFACTOR:** none.

**Output:** `UpdateAiProvider` validates model changes via `ModelCatalog`.

**Verify:** `node --test src/app/resource/update-ai-provider.test.ts` green;
`npm run typecheck` 0.

---

### Task T3 — `UpdateRepository` with reclone guard

**Requires:** T1, Story 01 T1 (Repository domain shape), Story 01 T4
(`LocalWorkspaceManager` reads `remoteUrl`).

**Input:** `src/app/resource/update-repository.ts` (new),
`src/app/resource/update-repository.test.ts` (new).

**Action — RED:** tests using a fake `WorkspaceManager` (or a real temp-dir
setup): (a) updating `branch` on a known repo succeeds; (b) updating `remoteUrl`
when no home path exists → succeeds; (c) updating `remoteUrl` when home path
exists and `reclone !== true` → throws `CacheConflictError`; (d) updating
`remoteUrl` with `reclone: true` when home path exists → succeeds (update stored
value; the actual reclone is deferred to the next `prepare` — the use case does
NOT trigger a filesystem operation, just clears the `path` so the next prepare
treats it as absent); (e) `remoteUrl` with embedded userinfo → throws
`EmbeddedCredentialError`; (f) updating `type` → throws `ImmutableFieldError("type")`.
Fails today: use case does not exist.

**Action — GREEN:** implement `UpdateRepository`. For the reclone guard: inject a
`WorkspaceManager` (or a simpler `{ homePathExists(path: string): Promise<boolean> }`
port if that is a lighter seam — check what WorkspaceManager exposes before
deciding). When `input.remoteUrl` is set and differs from stored: call
`homePathExists`; if true and `!input.reclone`, throw `CacheConflictError`. If
`reclone: true`, set `resource.path = ""` (empty path signals "not yet cloned"
to the next prepare). Validate `remoteUrl` for embedded credentials via the same
check as `buildResource` in domain.

**Action — REFACTOR:** none.

**Output:** `UpdateRepository` prevents silent origin rewrites.

**Verify:** `node --test src/app/resource/update-repository.test.ts` green;
`npm run typecheck` 0.

---

### Task T4 — CLI: `update <type>` commands + credential value via `--value-file`

**Requires:** T1, T2, T3, Story 02 T3 (`runCreateCredential` uses `--value-file`).

**Input:** `src/apps/cli/resource.ts`, `src/apps/cli/router.ts`,
`src/apps/cli/update-resource.test.ts` (new).

**Action — RED:** tests: (a) `dispatch(["update", "ai-provider", "--id", id, "--model", "gpt-5.6-sol"], deps)`
returns exitCode 0; (b) same with `--model no-such-model` returns exitCode 1 with
`"get models"` in stderr; (c) `dispatch(["update", "credential", "--id", id, "--value-file", tmpFile], deps)`
returns exitCode 0; (d) `dispatch(["update", "credential", "--id", id, "--value", "x"], deps)`
returns exitCode 1 (unknown option); (e) `dispatch(["update", "ai-provider", "--id", id, "--clear-effort"], deps)`
returns exitCode 0; (f) `dispatch(["update", "repository", "--id", id, "--remote-url", "https://github.com/o/r.git"], deps)`
when home path exists returns exitCode 1 (`CacheConflictError`); with
`--reclone` returns exitCode 0. Fails today: `"update *"` commands do not exist
in `COMMANDS`.

**Action — GREEN:** add five handler functions to `src/apps/cli/resource.ts`:
`runUpdateRepository`, `runUpdateCredential`, `runUpdateAiProvider`,
`runUpdateNotification`, `runUpdateFilesystem`. For `runUpdateCredential`: call
`readCredentialValue` (Story 02) only when `--value-file` is present. Add five
entries to `COMMANDS` in `router.ts`. Add all five use cases to `RouterDeps`.
Update `src/apps/cli/error-map.ts` to map `CacheConflictError` and
`ImmutableFieldError` to exit code 1 with a clear message.

**Action — REFACTOR:** none.

**Output:** all five `update <type>` commands work end-to-end; `--value` is absent
from `update credential`.

**Verify:** CLI tests green; `npm run typecheck` 0; `npm run lint` clean.

---

### Task T5 — `composition.ts`: wire all five update use cases

**Requires:** T1, T2, T3, T4, Story 03 T3 (GetResource already wired), Story 04 T3 (PiModelCatalog wired).

**Input:** `src/composition.ts`.

**Action — RED:** an integration smoke: `dispatch(["update", "ai-provider", "--id", aipId, "--model", "gpt-5.6-sol"], buildDeps(dbPath))` does not throw; returns exitCode 0. Fails today: deps bundle does not include the five update use cases.

**Action — GREEN:** import all five update use cases in `src/composition.ts`. For
`UpdateAiProvider`, reuse the `modelCatalog` already constructed for `AddResource`
(Task 04 T3). For `UpdateRepository`, pass a thin home-path-exists adapter using
`access` from `node:fs/promises`. Include all five in the returned `RouterDeps`.

**Action — REFACTOR:** none.

**Output:** `buildDeps` wires all five update use cases; `npm run verify` green.

**Verify:** `npm run verify` green.
