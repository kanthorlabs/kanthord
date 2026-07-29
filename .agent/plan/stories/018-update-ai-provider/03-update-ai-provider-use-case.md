# Story S3 — The `UpdateAiProvider` use case

Epic: `.agent/plan/epics/018-update-ai-provider.md`
Depends on: Story S1 (the validator) and Story S2 (`registry.update`)

## Change

- New file `src/app/ai-provider/update-ai-provider.ts` — one class, one
  `execute()`, following the shape of `register-ai-provider.ts`:

```ts
export interface UpdateAiProviderInput {
  id: string;
  model?: string;
  baseUrl?: string;
  effort?: string;
  api?: "openai-completions" | "openai-responses";
  contextWindow?: number;
  maxTokens?: number;
  /** New secret; when present the credential is rotated through the CAS. */
  value?: string;
  allowInsecure?: boolean;
}

/** The field names that changed, in the fixed order listed in `execute`. */
export type UpdateAiProviderOutput = { id: string; changed: string[] };

export class UpdateAiProvider {
  constructor(
    registry: AiProviderRegistry,
    uow: UnitOfWork,
    catalog?: ModelCatalog,
  );
  execute(input: UpdateAiProviderInput): UpdateAiProviderOutput;
}
```

- `execute` runs in this fixed order:
  1. Collect the present config keys in the fixed order `model`, `baseUrl`,
     `effort`, `api`, `contextWindow`, `maxTokens`, plus `value` last. If none is
     present → throw `NoUpdateFieldsError` (new, see below). This check is
     **before** the transaction and before any read, so a no-op writes nothing.
  2. `this.#uow.transaction(() => { … })` wraps everything below.
  3. `const current = registry.get(input.id)`; `undefined` →
     `UnknownReferenceError("ai_provider", input.id)` (same call and error as
     `get-ai-provider.ts:18`).
  4. `current.state === "logged_out"` → `LoggedOutProviderError(input.id, "update")`
     (imported from `./errors.ts:5`, which re-exports the domain class).
  5. Branch on `current.api`:
     - **custom** (`current.api !== null`): call
       `validateCustomProviderConfig({api, effort, baseUrl, contextWindow, maxTokens, allowInsecure}, {customProviderId: false, baseUrl: false})`
       from Story S1. Never consult the catalog.
     - **builtin** (`current.api === null`): if any of `api`, `baseUrl`,
       `contextWindow`, `maxTokens` is present → throw
       `BuiltinProviderFieldError(<first such field, in that fixed order>)`
       (new, see below). Then, when `model` is present and a catalog is wired,
       apply the catalog checks exactly as `register-ai-provider.ts:172-186`
       does, using `current.provider` as the provider: `!isValid` →
       `!hasProvider` ? `UnknownProviderError(current.provider)` :
       `UnknownModelError(current.provider, model)`; and when `effort` is present,
       `!catalog.getEfforts(current.provider, modelToCheck).includes(effort)` →
       `InvalidEffortError(effort)`, where `modelToCheck = input.model ?? current.model`.
  6. When at least one config key is present, call `registry.update(input.id, patch)`
     with only the present config keys — never `value`.
  7. When `input.value` is present: `input.value.length === 0` →
     `EmptyValueError()`; otherwise
     `registry.updateCredentialCAS(input.id, input.value, current.credentialVersion)`;
     an `{applied:false}` result → `StaleCredentialError(input.id)` (new, see
     below). The CAS is called **after** the config write, inside the same
     transaction, so either both land or neither does.
  8. Return `{ id: input.id, changed }` where `changed` lists the present keys in
     the order of step 1, with the secret reported as the literal `"value"`.

- New errors appended to `src/app/ai-provider/errors.ts`, matching the file's
  existing style (a doc comment, `readonly` fields, `this.name = …`):
  - `NoUpdateFieldsError` — `constructor()`, message
    `update ai-provider requires at least one field to change`.
  - `BuiltinProviderFieldError` — `constructor(field: string)`, message
    `--${field} is only valid for a custom provider (registered with --api)`,
    field `readonly field: string`.
  - `StaleCredentialError` — `constructor(id: string)`, message
    `credential for ai-provider ${id} changed concurrently — retry the update`,
    field `readonly id: string`.
- `src/apps/cli/error-map.ts` — import the three new classes beside the existing
  ai-provider error imports (`:38-59`) and add them to the `instanceof` chain
  (`:131-150`). Also add `ImmutableFieldError`-style handling is **not** needed
  here: the immutable fields are rejected by commander (Story S4) because no
  such option exists. **This step is mandatory**: `toResult` re-throws an
  unmapped error at `:159`, which crashes the CLI instead of exiting 1.

## Constraints

- No use case calls another use case. Shared logic comes from Story S1's module.
- The `value` never appears in the returned object, in an error message, or in
  a log line.
- Do not widen `AiProviderView` and do not touch `get-ai-provider.ts` /
  `list-ai-providers.ts` — they already omit `value`, `api`, `contextWindow`
  and `maxTokens`.
- No event is appended, matching `src/app/resource/update-credential.ts`.

## Verify

- New test file `src/app/ai-provider/update-ai-provider.test.ts`, `node:test` +
  `node:assert/strict`, using a hand-written `FakeRegistry` and the
  `FakeUnitOfWork` copied from `register-ai-provider.test.ts:142-146`, plus
  `FakeModelCatalog` from `src/model-catalog/fake.ts`. Assertions:
  - **no fields** → throws `NoUpdateFieldsError`, and the fake registry recorded
    **zero** calls to `update` and `updateCredentialCAS` and **zero** calls to
    `get` (the check precedes the read);
  - **unknown id** → `UnknownReferenceError`;
  - **logged_out row** → `LoggedOutProviderError`, with zero writes;
  - **custom row**: a valid `{model}` patch calls `registry.update` once with
    exactly `{model}`; an invalid `--context-window 0` throws
    `InvalidNumericFlagError` and calls `registry.update` **zero** times;
  - **custom row never consults the catalog**: a catalog whose `isValid` throws
    if called is passed, and a `{model}` update succeeds;
  - **builtin row**: each of `api`, `baseUrl`, `contextWindow`, `maxTokens`
    alone throws `BuiltinProviderFieldError` naming that field; a patch with
    several of them names `api` (the fixed order);
  - **builtin row model revalidation**: an unknown model throws
    `UnknownModelError`; an unknown provider kind throws `UnknownProviderError`;
    an effort outside `getEfforts` throws `InvalidEffortError`;
  - **secret rotation**: `{value:"k"}` calls `updateCredentialCAS(id,"k",current.credentialVersion)`
    once and `registry.update` zero times; `{model, value}` calls both, in that
    order (assert on a recorded call log array);
  - **empty secret** → `EmptyValueError`;
  - **stale CAS**: a fake returning `{applied:false}` → `StaleCredentialError`;
  - **atomicity**: a `FakeUnitOfWork` whose `transaction` catches and re-throws
    while recording that the body threw, driven with `{model:"ok", maxTokens:0}`,
    asserts the error is `InvalidNumericFlagError` and `registry.update` was
    called zero times — validation precedes every write;
  - **changed list order**: `{maxTokens, model, value}` returns
    `changed: ["model","maxTokens","value"]`.
- `node --test src/app/ai-provider/update-ai-provider.test.ts` passes.
- `node --test src/apps/cli/error-map.test.ts` passes with a new case per new
  error asserting `exitCode: 1` and an `error: ` prefixed message.
- `npm run verify` exits 0.
- Proof: phases B, D and E of `scripts/e2e/update-ai-provider-proof.sh`.
