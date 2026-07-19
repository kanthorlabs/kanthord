# Story 04 — D3: `ModelCatalog` port + create/update validation

Epic: `.agent/plan/epics/007.1-e2e-hardening.md`

## Goal

An app-owned `ModelCatalog` port validates `(provider, model)` pairs at **create
time** (`AddResource` for `ai_provider`) and at **update time** (Story 05's
`UpdateAiProvider`). Unknown pairs are rejected with a clear error that points
the user to `get models`. The `--allow-unknown-model` and `--base-url` CLI escape
hatches are dropped. The authoritative check (which model is actually available
to the session) stays at session open in `PiProviderSessionFactory` (one source,
no pi-ai imports in app/ or domain/).

`ModelCatalog` is a clean port — a plain interface owned by the app layer.
`composition.ts` wires a pi-ai adapter. Tests use a `FakeModelCatalog`.

## Locked contracts (exact names — tests assert verbatim)

```ts
// src/model-catalog/port.ts  (new capability directory)

export interface ModelCatalog {
  /** Returns true if the (provider, model) pair is known and usable. */
  isValid(provider: string, model: string): boolean;
}

// Error thrown by AddResource and (Story 05) UpdateAiProvider when the pair
// is unknown:
export class UnknownModelError extends Error {
  readonly provider: string;
  readonly model: string;
  constructor(provider: string, model: string);
  // name = "UnknownModelError"
  // message must contain "get models" so the CLI error-map can forward it verbatim
}
```

```ts
// src/model-catalog/pi.ts  (pi-ai adapter, composition-root only)

import type { ModelCatalog } from "./port.ts";

export class PiModelCatalog implements ModelCatalog {
  constructor(listModels: import("../apps/cli/models.ts").ListModels);
  isValid(provider: string, model: string): boolean;
}
// Uses the existing ListModels function (already wired in composition.ts via
// builtinModels from @earendil-works/pi-ai/providers/all) to resolve the catalog.
// Only composition.ts imports PiModelCatalog.
```

```ts
// src/app/resource/add-resource.ts — updated constructor

export class AddResource {
  constructor(
    projectRepository: ProjectRepository,
    referenceResolver: ReferenceResolver,
    modelCatalog: ModelCatalog, // NEW — injected, not optional
  );
  // execute() throws UnknownModelError when input.type === "ai_provider" and
  // modelCatalog.isValid(input.provider, input.model) === false.
}
```

```ts
// FakeModelCatalog for tests:
// src/model-catalog/fake.ts
export class FakeModelCatalog implements ModelCatalog {
  constructor(validPairs?: Array<{ provider: string; model: string }>);
  isValid(provider: string, model: string): boolean;
}
```

## Constraints

- `ModelCatalog` port lives in `src/model-catalog/port.ts`. The error
  `UnknownModelError` lives in the same file (it is owned by the port contract,
  not by the domain).
- `src/app/resource/add-resource.ts` imports `src/model-catalog/port.ts` only —
  never the pi adapter. The pi adapter is imported exclusively by `composition.ts`.
- The `--allow-unknown-model` and `--base-url` flags are removed from
  `runCreateAiProvider` and from the `"create ai-provider"` COMMANDS entry.
  Passing them now causes an "unknown option" parse error (strict mode).
- `baseUrl` as a stored field on `AIProvider` is **unchanged** (it may be set
  explicitly for self-hosted deployments with a known valid model). The escape
  hatch removed is the CLI-only flag that let you bypass validation; the stored
  `baseUrl` field remains. To set `baseUrl` via CLI, it will be added as a
  validated option in Story 05's update command.
- `UnknownModelError.message` must contain the text `"get models"` (verbatim,
  lowercase) so the `toResult` error-map in `src/apps/cli/error-map.ts` can
  forward the message to stderr and the Proof's `grep -qiE 'get models'` check passes.
- The `FakeModelCatalog` constructor accepts an optional list of valid pairs. When
  constructed with no args it rejects everything. Tests supply the pairs they need.

## Verification Gate

`node --test src/app/resource/add-resource.test.ts` green (updated tests use
`FakeModelCatalog`); `node --test src/model-catalog/pi.test.ts` green;
`npm run typecheck` exit 0; `npm run lint` clean.

---

### Task T1 — `ModelCatalog` port + `UnknownModelError` + `FakeModelCatalog`

**Requires:** nothing (new module).

**Input:** `src/model-catalog/port.ts` (new), `src/model-catalog/fake.ts` (new),
`src/model-catalog/port.test.ts` (new).

**Action — RED:** tests: (a) `new FakeModelCatalog([{ provider: "openai-codex", model: "gpt-5.6-terra" }]).isValid("openai-codex", "gpt-5.6-terra")` returns `true`; (b) `.isValid("openai-codex", "no-such")` returns `false`; (c) `new FakeModelCatalog()` (no args) `.isValid(…)` always returns `false`; (d) `UnknownModelError` has `name === "UnknownModelError"`, `provider`, `model` fields, and message contains `"get models"`. Fails today: module does not exist.

**Action — GREEN:** create `src/model-catalog/port.ts` with `ModelCatalog` interface
and `UnknownModelError`. Create `src/model-catalog/fake.ts` with `FakeModelCatalog`.

**Action — REFACTOR:** none.

**Output:** port contract + fake ready for use in app tests.

**Verify:** `node --test src/model-catalog/port.test.ts` green;
`npm run typecheck` 0.

---

### Task T2 — `AddResource` injects `ModelCatalog`, validates `ai_provider` at create

**Requires:** T1.

**Input:** `src/app/resource/add-resource.ts`,
`src/app/resource/add-resource.test.ts`.

**Action — RED:** tests using `FakeModelCatalog`: (a) `execute` with
`{ type: "ai_provider", provider: "openai-codex", model: "gpt-5.6-terra", … }`
and a fake that accepts this pair → returns an id (exitCode 0 path); (b) same
call with a fake that rejects the pair → throws `UnknownModelError` with the
right `provider`/`model` fields and message containing `"get models"`; (c) a
`{ type: "credential" }` input still works (no validation for non-ai_provider
types). Fails today: `AddResource` constructor does not accept a `ModelCatalog`;
no validation.

**Action — GREEN:** add `modelCatalog: ModelCatalog` as the third constructor
arg. In `execute`, when `input.type === "ai_provider"`: call
`this.#modelCatalog.isValid(input.provider, input.model)`; if false throw
`new UnknownModelError(input.provider, input.model)`. Update existing tests to
pass a `FakeModelCatalog` (permissive fake: accept all pairs for non-D3 tests).

**Action — REFACTOR:** none.

**Output:** `AddResource` validates `(provider, model)` at create using the
injected catalog.

**Verify:** `node --test src/app/resource/add-resource.test.ts` green;
`npm run typecheck` 0.

---

### Task T3 — `PiModelCatalog` adapter + `composition.ts` wiring

**Requires:** T1, T2.

**Input:** `src/model-catalog/pi.ts` (new), `src/model-catalog/pi.test.ts` (new),
`src/composition.ts`.

**Action — RED:** test: `PiModelCatalog` constructed with the real `builtinModels`-based
`listModels` returns `true` for `("openai-codex", "gpt-5.6-terra")` and `false`
for `("openai-codex", "no-such-model-xyz")`. Fails today: `PiModelCatalog` does
not exist.

**Action — GREEN:** create `src/model-catalog/pi.ts`:
`PiModelCatalog` stores a reference to the `ListModels` function; `isValid` calls
`listModels(provider)` and checks whether any returned `ModelInfo.id === model`.
In `src/composition.ts`: import `PiModelCatalog`, construct
`const modelCatalog = new PiModelCatalog(listModels)` (where `listModels` is
already built from `builtinModels`), pass it as the third argument to
`new AddResource(projectRepository, referenceResolver, modelCatalog)`.

**Action — REFACTOR:** none.

**Output:** `PiModelCatalog` adapts the existing pi-ai model list; `buildDeps`
wires it into `AddResource`.

**Verify:** `node --test src/model-catalog/pi.test.ts` green;
`npm run verify` green (end-to-end: unknown model → exit 1 from CLI).

---

### Task T4 — CLI: remove `--allow-unknown-model` and `--base-url`; validate error surface

**Requires:** T2, T3.

**Input:** `src/apps/cli/resource.ts`, `src/apps/cli/router.ts`.

**Action — RED:** tests: (a) `dispatch(["create", "ai-provider", "--project", id,
"--name", "bad", "--provider", "openai-codex", "--model", "no-such", …], deps)` with
the real `PiModelCatalog` returns exitCode 1 and stderr contains `"get models"`;
(b) passing `--allow-unknown-model` produces a parse error (unknown option); (c)
`create ai-provider` with a valid pair returns exitCode 0. Fails today: `--allow-unknown-model`
and `--base-url` are accepted; unknown model is stored.

**Action — GREEN:** remove `"allow-unknown-model"` from the `"create ai-provider"`
parse config in `router.ts`. Remove `"base-url"` from the same parse config (it
was the escape-hatch path; `baseUrl` storage is preserved for Story 05). In
`src/apps/cli/resource.ts`, remove the `baseUrl` and `effort` flag reads that
referenced `base-url`. Update the `toResult` mapping in
`src/apps/cli/error-map.ts` to forward `UnknownModelError.message` as stderr.

**Action — REFACTOR:** none.

**Output:** `--allow-unknown-model` and `--base-url` flags are gone; unknown-model
errors surface to the user with a pointer to `get models`.

**Verify:** CLI tests green; `npm run typecheck` 0; `npm run lint` clean.
