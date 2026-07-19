# Story 10 — C1: `import graph` context binding (alias→id)

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

Imported tasks have no resource context today (`task_context` is never written
by the import path — only by `create task --context`), so every imported graph
is a non-runnable shell. This story adds a binding-alias system to the graph
format, extends the codec to round-trip it, wires resolver + validation into
`CreateGraph`, and adds `--bind alias=<id>` to `import graph`. After the story,
`get task --json` shows resolved `context` (repository/ai_provider/credential)
and the task is immediately runnable.

Graph format version bumps from 1 → 2. Absent context in a format-2 package
preserves any live `task_context` rows already in the DB (never silently
replaces them). Format-1 packages are still parseable and land without context
(no regression).

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/app/graph/graph-package.ts — augmented interfaces

// UPDATED: PkgInitiative gains bindings
export interface PkgInitiative {
  id?: string;
  ref: string;
  name: string;
  sourcePath: string;
  bindings?: Record<string, string>; // alias → resource type
  //   e.g. { source: "repository", model: "ai_provider", "model-auth": "credential" }
}

// UPDATED: PkgObjective gains context (package-local lexical default)
export interface PkgObjective {
  id?: string;
  ref: string;
  initiativeRef: string;
  name: string;
  sourcePath: string;
  context?: Record<string, string>; // context slot → alias ref
  //   e.g. { source: "source", model: "model", "model-auth": "model-auth" }
}

// UPDATED: PkgTask gains context (per-key override; absent key = inherit objective default)
export interface PkgTask {
  id?: string;
  ref: string;
  objectiveRef: string;
  title: string;
  instructions: string;
  ac: string[];
  agent: string;
  verification: string[] | null | undefined;
  dependsOn: string[];
  sourcePath: string;
  context?: Record<string, string>; // per-key override; absent = inherit from objective
}
```

```ts
// src/app/graph/format.ts — new constant
export const GRAPH_FORMAT_VERSION = 2; // bumped from 1 (C1: bindings + context)
export const GRAPH_FORMAT_VERSION_LEGACY = 1; // still parseable; no bindings/context
```

```ts
// src/app/graph/import-errors.ts — new error classes

// CLI-resolved --bind value names a resource that does not exist in the project:
export class UnknownBindingNameError extends Error {
  readonly alias: string;
  readonly name: string;
  constructor(alias: string, name: string);
  // name = "UnknownBindingNameError"
}

// CLI-resolved --bind value matches more than one resource by name:
export class AmbiguousBindingNameError extends Error {
  readonly alias: string;
  readonly name: string;
  readonly count: number;
  constructor(alias: string, name: string, count: number);
  // name = "AmbiguousBindingNameError"
}

// A declared alias has no --bind mapping (and no fallback):
export class UnboundAliasError extends Error {
  readonly alias: string;
  constructor(alias: string);
  // name = "UnboundAliasError"
}

// The resource id supplied for an alias has the wrong type:
export class IncompatibleBindingTypeError extends Error {
  readonly alias: string;
  readonly expectedType: string;
  readonly actualType: string;
  constructor(alias: string, expectedType: string, actualType: string);
  // name = "IncompatibleBindingTypeError"
}

// The provider and credential supplied are incompatible (provider mismatch):
export class IncompatibleProviderCredentialError extends Error {
  readonly aiProviderId: string;
  readonly credentialId: string;
  constructor(aiProviderId: string, credentialId: string);
  // name = "IncompatibleProviderCredentialError"
}

// One or more tasks have an executor whose required binding set is not fully
// satisfied by the resolved context:
export class ExecutorBindingSetError extends Error {
  readonly errors: Array<{ taskRef: string; agent: string; missing: string[] }>;
  constructor(
    errors: Array<{ taskRef: string; agent: string; missing: string[] }>,
  );
  // name = "ExecutorBindingSetError"
  // message lists ALL failing tasks in one report (fail-fast non-interactive)
}
```

```ts
// src/app/graph/create-graph.ts — extended input
export interface CreateGraphInput {
  pkg: GraphPackage;
  projectId: string;
  packageId: string;
  bindings?: Record<string, string>; // alias → concrete resource id (pre-resolved by CLI)
}
// CreateGraphResult is unchanged.
```

```ts
// src/app/graph/binding-resolver.ts — new pure helper (zero I/O)
// Resolves the effective context map for each task and validates it.

// Per-executor required/forbidden binding specs (app-layer, not domain).
export interface ExecutorBindingSpec {
  required: string[]; // resource type names that must be present
  forbidden: string[]; // resource type names that must be absent
}

// Executor specs known to the codec layer.
export const EXECUTOR_BINDING_SPECS: Record<string, ExecutorBindingSpec> = {
  "generic@1": {
    required: ["repository", "ai_provider", "credential"],
    forbidden: [],
  },
  "tdd@1": {
    required: ["repository", "ai_provider", "credential"],
    forbidden: [],
  },
};
// Unknown executor → no binding validation (pass through).

// Resolves alias → resource_id for one task, given:
//   bindings:        initiative bindings (alias → resource type)
//   objectiveContext: objective context (slot → alias)
//   taskContext:     task context override (slot → alias), may be undefined
//   bindMap:         CLI --bind map (alias → concrete resource id)
// Returns the effective context map (resource_type → resource_id) for task_context.
// Throws UnboundAliasError when a required alias has no binding.
export function resolveTaskContext(
  bindings: Record<string, string>,
  objectiveContext: Record<string, string> | undefined,
  taskContext: Record<string, string> | undefined,
  bindMap: Record<string, string>,
): Record<string, string>;

// Validates the resolved context map against the executor's binding spec.
// Throws ExecutorBindingSetError if ANY task violates the spec.
// Collects ALL violations before throwing (one complete error report).
export function validateExecutorBindings(
  tasks: Array<{ ref: string; agent: string; context: Record<string, string> }>,
): void;
```

```ts
// src/apps/cli/import-graph.ts — extended args
export type ImportGraphArgs = {
  dir: string;
  create: boolean;
  apply: boolean;
  dryRun?: boolean;
  deleteMissing?: boolean;
  confirmDelete?: boolean;
  project?: string;
  initiative?: string;
  bind?: Record<string, string>; // alias → id-or-name from --bind alias=value
};

export type ImportGraphDeps = {
  createGraph: CreateGraphUC;
  applyGraph?: ApplyGraphUC;
  newId: () => string;
  // NEW: needed to resolve name → id for --bind shorthand
  findResourcesByName: (
    projectId: string,
    name: string,
    type: string,
  ) => Promise<Array<{ id: string }>>;
  getResource: (
    id: string,
  ) => Promise<{ type: string; provider?: string } | undefined>;
};
```

## Constraints

- `src/app/graph/binding-resolver.ts` is pure — no I/O, no storage imports.
  It imports only domain types and `graph-package.ts`.
- `CreateGraph` imports `binding-resolver.ts` for validation BEFORE opening the
  UnitOfWork transaction. Name→id resolution and type lookup stay in the CLI
  adapter; `CreateGraph` only validates pre-resolved ids.
- `src/app/graph/import-errors.ts` grows the new error classes; no new file.
- Format-1 packages (`formatVersion: 1`) are parsed without bindings/context and
  imported without touching `task_context`. Absent context on a format-2 package
  also leaves `task_context` rows untouched (no-op, not clear).
- Credential lookup for compatibility check: the CLI adapter fetches the
  `AIProvider.provider` and `Credential.provider` and rejects mismatches. This
  check is in the CLI adapter (has resource fetch), not in `CreateGraph`.
- `--bind` may supply a ULID directly or a resource name. ULID = used verbatim.
  Name = looked up via `findResourcesByName`; 0 matches → `UnknownBindingNameError`;
  2+ matches → `AmbiguousBindingNameError`. Credentials by id/alias — never by
  value (the `value` field is structurally omitted from lookup results per D6).
- `GRAPH_FORMAT_VERSION` constant is in `format.ts` (imported by codec) so
  parse and serialize cannot drift. The manifest written by `--create` uses 2.
  The manifest written by `--apply` preserves the package's declared version.

## Verification Gate

`node --test src/app/graph/graph-codec.test.ts` green (round-trip with bindings +
context); `node --test src/app/graph/create-graph.test.ts` green (binding
resolution + validation with fakes); `node --test src/apps/cli/import-graph.test.ts`
green (`--bind` CLI flag, name→id shorthand, fail-fast error report);
`npm run typecheck` exit 0; `npm run lint` clean.

---

### Task T1 — extend `GraphPackage` DTO + format version constant

**Requires:** nothing.

**Input:** `src/app/graph/graph-package.ts`, `src/app/graph/format.ts`.

**Action — RED:** tests in `src/app/graph/graph-codec.test.ts`: (a) a
`PkgInitiative` with `bindings` set is accepted by the TypeScript type; (b) a
`PkgObjective` with `context` set is accepted; (c) a `PkgTask` with `context`
set is accepted; (d) `GRAPH_FORMAT_VERSION === 2` and
`GRAPH_FORMAT_VERSION_LEGACY === 1` are exported from `format.ts`. Fails today:
`bindings`/`context` fields absent; no version constants.

**Action — GREEN:** add `bindings?: Record<string, string>` to `PkgInitiative`;
add `context?: Record<string, string>` to `PkgObjective` and `PkgTask`. Add
`GRAPH_FORMAT_VERSION = 2` and `GRAPH_FORMAT_VERSION_LEGACY = 1` to `format.ts`.

**Action — REFACTOR:** none.

**Output:** DTO interfaces carry the new optional fields; version constants
exported.

**Verify:** `npm run typecheck` 0; `npm run lint` clean.

---

### Task T2 — codec: parse and serialize `bindings`/`context` fields (round-trip)

**Requires:** T1.

**Input:** `src/app/graph/graph-codec.ts`, `src/app/graph/graph-codec.test.ts`.

**Action — RED:** tests: (a) `parseGraphPackage` on a format-2 package with
initiative frontmatter `bindings: { source: repository }` produces
`pkg.initiative.bindings === { source: "repository" }`; (b) an objective with
`context: { source: source }` in frontmatter produces
`obj.context === { source: "source" }`; (c) a task with `context: { model: model }`
produces `task.context === { model: "model" }`; (d) `serializeNode` for an
initiative with `bindings` round-trips back through `parseGraphPackage` without
data loss; (e) a format-1 package without bindings parses to
`initiative.bindings === undefined`, `obj.context === undefined` (no regression);
(f) the manifest written by `runCreate` (step 7 in `import-graph.ts`) uses
`formatVersion: 2` when the package has bindings (existing fixture uses 1 —
update the snapshot). Fails today: codec ignores `bindings`/`context` frontmatter
keys; hardcoded `formatVersion: 1` in the manifest write.

**Action — GREEN:** in `buildInitiative`, read `fm["bindings"]` and store as
`bindings` when it is a non-empty plain object. In `buildObjective` and
`buildTask`, read `fm["context"]` and store as `context`. In
`serializeInitiative`/`serializeObjective`/`serializeTask`, emit `bindings:` /
`context:` YAML blocks when present. In `runCreate` (`import-graph.ts`), write
`formatVersion: GRAPH_FORMAT_VERSION` (import from `format.ts`) in the manifest
when the package has bindings; keep `1` for packages without bindings.

**Action — REFACTOR:** use the `GRAPH_FORMAT_VERSION` constant consistently in
`serializeNode` / manifest writes (no hardcoded `1`).

**Output:** codec round-trips bindings + context; manifest version reflects
format.

**Verify:** `node --test src/app/graph/graph-codec.test.ts` green; typecheck 0.

---

### Task T3 — `BindingResolver`: resolve and validate context maps

**Requires:** T1.

**Input:** `src/app/graph/binding-resolver.ts` (new file),
`src/app/graph/binding-resolver.test.ts` (new file),
`src/app/graph/import-errors.ts`.

**Action — RED:** tests in `binding-resolver.test.ts`: (a) `resolveTaskContext`
with `bindings={source:"repository"}`, objective `context={source:"source"}`, no
task override, `bindMap={source:"ID1"}` returns `{repository:"ID1"}`; (b) alias
missing from `bindMap` throws `UnboundAliasError("source")`; (c) task override
`context={source:"other"}` uses the override alias; (d) `validateExecutorBindings`
with `generic@1` and full context passes; (e) `generic@1` with `ai_provider`
missing throws `ExecutorBindingSetError` with `missing: ["ai_provider"]`; (f)
two failing tasks → single `ExecutorBindingSetError` listing both; (g) unknown
executor (e.g. `"custom@1"`) passes without error (no spec → no validation).
Fails today: file does not exist.

**Action — GREEN:** create `binding-resolver.ts` implementing
`resolveTaskContext` and `validateExecutorBindings` as described in Locked
contracts. Add new error classes to `import-errors.ts`:
`UnboundAliasError`, `AmbiguousBindingNameError`, `UnknownBindingNameError`,
`IncompatibleBindingTypeError`, `IncompatibleProviderCredentialError`,
`ExecutorBindingSetError`.

**Action — REFACTOR:** none.

**Output:** pure binding resolution and executor validation helpers; error
classes exported from `import-errors.ts`.

**Verify:** `node --test src/app/graph/binding-resolver.test.ts` green;
typecheck 0; lint clean.

---

### Task T4 — wire binding validation into `CreateGraph` + `--bind` CLI flag

**Requires:** T2, T3.

**Input:** `src/app/graph/create-graph.ts`, `src/apps/cli/import-graph.ts`,
`src/apps/cli/router.ts`, `src/apps/cli/import-graph.test.ts`.

**Action — RED:** tests in `import-graph.test.ts`: (a) calling `runImportGraph`
with a package that declares `bindings: {source:repository, model:ai_provider,
"model-auth":credential}` but only `--bind source=<id> --bind model=<id>` (no
`model-auth`) returns `exitCode: 1` and stderr mentioning `model-auth` (unbound
alias); (b) with all three `--bind` flags: `exitCode: 0`, the `createGraph.execute`
spy receives `bindings: {source:repoId, model:aipId, "model-auth":credId}`; (c)
`--bind source=<name>` where the fake `findResourcesByName` returns one match:
resolves to its `id`; (d) `findResourcesByName` returns 0 → `exitCode: 1`,
mentions the alias and name; (e) returns 2+ → `exitCode: 1`, mentions ambiguous;
(f) resource type mismatch (alias `source` bound to a credential id) → `exitCode: 1`.
In `create-graph.test.ts`: (g) `CreateGraph.execute` with `bindings` calls
`saveTaskContext` for each resolved task; (h) package with no bindings and
`bindings: undefined` skips `saveTaskContext` (no-op). Fails today:
`ImportGraphArgs` has no `bind`; `CreateGraph` does not call `saveTaskContext`.

**Action — GREEN:** extend `ImportGraphArgs` and `ImportGraphDeps` as in Locked
contracts. In `runCreate`, before calling `createGraph.execute`: iterate declared
aliases, resolve each `--bind` value (ULID → direct; name → `findResourcesByName`
lookup; check type via `getResource`; check provider↔credential compatibility for
the `ai_provider`+`credential` pair via `getResource`; call
`validateExecutorBindings`); if any error, collect all failures and return
`exitCode: 1` with a complete error report to stderr. Pass the resolved
`bindings` map to `createGraph.execute`. In `CreateGraph.execute`: when
`input.bindings` is present, compute the effective `context` map for each task
(call `resolveTaskContext`), then call `this.#taskRepo.saveTaskContext` for each
task after the task row is persisted. In `router.ts`, parse `--bind alias=value`
args (repeatable) into `Record<string,string>` and forward to `runImportGraph`.

**Action — REFACTOR:** extract the name→id resolution loop into a private
`resolveBindMap` function inside `import-graph.ts`.

**Output:** `import graph --create --project <id> --bind alias=<id> …` resolves
bindings, validates, and writes `task_context` rows; missing/ambiguous/wrong-type
bindings fail before the transaction.

**Verify:** `node --test src/apps/cli/import-graph.test.ts` green;
`node --test src/app/graph/create-graph.test.ts` green; typecheck 0; lint clean.
