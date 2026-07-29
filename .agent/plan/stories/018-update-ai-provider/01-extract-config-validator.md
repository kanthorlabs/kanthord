# Story S1 — Extract the provider config validator

Epic: `.agent/plan/epics/018-update-ai-provider.md`

## Change

- New file `src/app/ai-provider/config-validation.ts`. Pure: no I/O, no registry,
  no catalog. It imports only `./errors.ts`, `../errors.ts` and
  `../../domain/resource.ts`. Exports exactly two functions:

```ts
export interface CustomProviderConfig {
  api?: string;
  effort?: string;
  customProviderId?: string;
  baseUrl?: string;
  contextWindow?: number;
  maxTokens?: number;
  allowInsecure?: boolean;
}

/**
 * Validates the custom OpenAI-compatible provider config.
 * `require.customProviderId` / `require.baseUrl` are true on the register path
 * (both fields are mandatory at creation) and false on the update path (a patch
 * omits what it does not change).
 */
export function validateCustomProviderConfig(
  cfg: CustomProviderConfig,
  require: { customProviderId: boolean; baseUrl: boolean },
): void;

/** Validates a baseUrl on the builtin path: absolute http(s) only. */
export function validateBuiltinBaseUrl(baseUrl: string): void;
```

- `validateCustomProviderConfig` performs the checks **in exactly this order**,
  each one skipped when its field is `undefined` (except the two `require`
  presence checks), throwing the same typed errors the register path throws
  today:
  1. `cfg.api` not `"openai-completions"` / `"openai-responses"` →
     `InvalidApiFlavorError(cfg.api)` — mirrors
     `src/app/ai-provider/register-ai-provider.ts:88-93`.
  2. `cfg.effort` not in `REASONING_EFFORTS` → `InvalidEffortError(cfg.effort)`
     — mirrors `:96-101`.
  3. `require.customProviderId` and `cfg.customProviderId` is `undefined` or
     `""` → `MissingCustomProviderIdError()` — mirrors `:104-109`.
  4. `require.baseUrl` and `cfg.baseUrl` is `undefined` or `""` →
     `MissingBaseUrlError()` — mirrors `:110-112`.
  5. `cfg.baseUrl` defined: `new URL()` throws, or protocol is neither `http:`
     nor `https:` → `InvalidBaseUrlError(cfg.baseUrl)` — mirrors `:115-122`.
  6. `cfg.contextWindow` defined and not a positive integer →
     `InvalidNumericFlagError("context-window", cfg.contextWindow)` — `:125-133`.
  7. `cfg.maxTokens` defined and not a positive integer →
     `InvalidNumericFlagError("max-tokens", cfg.maxTokens)` — `:134-139`.
  8. `cfg.baseUrl` defined and `hasEmbeddedUserinfo(cfg.baseUrl)` →
     `EmbeddedCredentialError(cfg.baseUrl)` — `:142-144`.
  9. `cfg.baseUrl` defined, `!cfg.allowInsecure`, and
     `isInsecureEndpoint(cfg.baseUrl)` → `InsecureEndpointError(cfg.baseUrl)` —
     `:145-147`.
- `validateBuiltinBaseUrl` is check 5 alone — mirrors
  `register-ai-provider.ts:190-199`.
- Rewrite `src/app/ai-provider/register-ai-provider.ts` to call these:
  - Replace the inline blocks at `:88-147` with one call
    `validateCustomProviderConfig({api: input.api, effort: input.effort, customProviderId: input.customProviderId, baseUrl: input.baseUrl, contextWindow: input.contextWindow, maxTokens: input.maxTokens, allowInsecure: input.allowInsecure}, {customProviderId: true, baseUrl: true})`.
  - Replace the inline block at `:190-199` with
    `if (input.baseUrl !== undefined) validateBuiltinBaseUrl(input.baseUrl);`.
  - Delete the now-unused imports from `register-ai-provider.ts` that only those
    blocks used. Keep every other line of `execute` byte-identical, including the
    catalog checks at `:172-186`, the `registry.register` calls, the drift warning
    at `:225-232` and the first-wins default at `:163-165` / `:235-237`.

## Constraints

- Pure refactor: **no behaviour change**. Error types, error messages and the
  order in which two simultaneously-invalid fields are reported all stay as they
  are today, which is why the order above is numbered and binding.
- The catalog-driven checks (`isValid`, `hasProvider`, `getEfforts` at
  `register-ai-provider.ts:172-186`) stay in the use case — the validator is
  catalog-free so it stays pure.
- `EmbeddedCredentialError` is imported from `../errors.ts`, the other errors
  from `./errors.ts`, matching `register-ai-provider.ts:6-17`.
- Do not move the module into `src/domain/` — `domain/` may not import the app
  error classes these rules throw.

## Verify

- New test file `src/app/ai-provider/config-validation.test.ts`, `node:test` +
  `node:assert/strict`, flat `test(...)`, no fakes needed (the module is pure).
  Table-driven over all nine rules: one case per rule asserting
  `assert.throws(fn, ErrorClass)` on the invalid value, plus one all-valid case
  asserting it does not throw. Add:
  - `require:{customProviderId:false, baseUrl:false}` with both fields absent
    does **not** throw (the update path's shape).
  - `allowInsecure: true` suppresses `InsecureEndpointError` but still throws
    `EmbeddedCredentialError` for a userinfo URL.
- `node --test src/app/ai-provider/config-validation.test.ts` passes.
- `node --test src/app/ai-provider/register-ai-provider.test.ts` passes
  **unchanged** — do not edit that file. This is the proof the refactor changed
  no behaviour.
- `npm run verify` exits 0.
- Proof: no phase directly; S1 is the precondition for S3's validation, which
  phase E of `scripts/e2e/update-ai-provider-proof.sh` exercises.
