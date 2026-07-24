# Story C — Session reconstruction for custom providers

Epic: `.agent/plan/epics/008.1-custom-openai-compatible-provider.md`
Depends on: Story A (custom record fields), `008.3` Story A/G (session factory
receives the resolved `GlobalAiProvider`, incl. `api`/`contextWindow`/`maxTokens`).

## Change

- **`src/agent-runner/pi-session.ts`** — at the catalog-build point (:200-218),
  branch on whether the resolved provider is custom (`api != null`):
  - **builtin** (`api == null`): unchanged — `builtinModels(...)` +
    `getModel(provider, model)` + baseUrl clone.
  - **custom** (`api != null`): build the model catalog **session-locally**:
    ```
    const runtimeId = "custom:" + provider.id;   // session-local, from the RECORD id
    const model: Model<Api> = {
      id: provider.model, name: provider.model, api: provider.api,
      provider: runtimeId, baseUrl: provider.baseUrl!,
      reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: provider.contextWindow ?? 32768,
      maxTokens: provider.maxTokens ?? 4096,
    };
    const models = createModels(credentialStore ? { credentials: credentialStore } : undefined);
    models.setProvider(createProvider({
      id: runtimeId, name: provider.name, baseUrl: provider.baseUrl!,
      auth: { apiKey: staticApiKeyAuth(credential.value) },   // folded value, NO env fallback
      models: [model],
      api: provider.api === "openai-completions" ? openAICompletionsApi() : openAIResponsesApi(),
    }));
    const found = models.getModel(runtimeId, provider.model);
    ```
    then `const streamFn = withReasoning(models.streamSimple.bind(models),
provider.effort)` and `getApiKey = () => credential.value`.
- **Imports** — add `createModels`, `createProvider` from `@earendil-works/pi-ai`
  (same entry as `Api`/`Model`, :9-17); `openAICompletionsApi` /
  `openAIResponsesApi` from their `.../api/*.lazy` subpaths.
- **Static api-key auth** — build a `ProviderAuth.apiKey` from the folded
  `credential.value` (a fixed key, **no** `envApiKeyAuth` — no ambient env
  fallback). If pi lacks a static-key helper, construct the `ApiKeyAuth` object
  inline per pi's `auth/types.ts`.
- **Runtime id from the record id** — `runtimeId = "custom:" + provider.id`
  (the registry record ULID), so two custom accounts of the same
  `--custom-provider-id` get distinct `setProvider` ids and never collide.

## Constraints

- `createModels` (mutable, per-session) — never mutate a shared/global
  `builtinModels` catalog.
- Only `openai-completions` / `openai-responses` flavors (allowlist); any other
  `api` value is impossible (Story B validates at register).
- No env-key fallback; the folded `value` is the only key.

## Verify

- New `src/agent-runner/pi-session.custom.test.ts` (real `PiProviderSessionFactory`,
  no network): given a custom `GlobalAiProvider` (`api='openai-completions'`,
  a `baseUrl`, a `model`, a dummy `value`), `factory.for(...)` returns a
  `ProviderSession` whose `model.provider` is the record-derived `runtimeId`,
  `model.baseUrl` is the custom url, `getApiKey()` returns the folded value, and
  no throw; two records with the same `--custom-provider-id` but different ids
  yield different `runtimeId`s.
- `npm run verify` exits 0.
- Proof (008.1-custom Proof): no standalone `PASS` line — enables the real model
  call that Story D's **PASS C/D** exercises.
