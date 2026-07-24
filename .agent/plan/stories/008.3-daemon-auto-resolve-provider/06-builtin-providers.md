# Story F — Runtime support for pi's builtin API-key providers

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: Story A (runner takes a resolved provider), EPIC 008.1
(`register ai-provider` validates against the pinned catalog via `ModelCatalog`).

## Change

- No new production code path is required IF Story A's provider→`sessions.for`
  build already passes `provider.provider` / `provider.model` unchanged — the
  builtin providers `deepseek` / `openrouter` / `opencode` already exist in the
  pinned pi-ai catalog and take the API-key path
  (`src/agent-runner/pi-session.ts:180-184`, non-JSON `value` ⇒ api key). This
  story is primarily **test coverage** that the real `PiProviderSessionFactory`
  constructs a session for each, plus a documented contract.
- **`src/agent-runner/pi-session.ts`**: confirm `.for()` resolves each builtin via
  `builtinModels().getModel(provider, model)` (:188-193); ensure `opencode`'s
  **mixed per-model API flavor** does not throw at construction (the model's
  `api` selects the stream implementation) — add a clear error if a model's `api`
  has no entry (do not fail silently).

## Constraints

- API-key only. No OAuth for these providers (deferred). No custom baseUrl/models
  (custom provider deferred out of 008.x).
- Support is "the pi-ai catalog pinned by this release" — validation is against
  the installed catalog version; a model absent from it is rejected at
  `register` time (008.1 `ModelCatalog.isValid`).

## Verify

- New `src/agent-runner/pi-session.builtin.test.ts` (real
  `PiProviderSessionFactory`, no network): for each of `deepseek`, `openrouter`,
  `opencode`, pick one exact model id from `builtinModels().getModels(provider)`,
  build a `GlobalAiProvider`-shaped input with a dummy api-key `value`, call
  `factory.for(aiProvider, credential)` and assert it returns a `ProviderSession`
  (model resolved, `getApiKey()` returns the key) without throwing. Include an
  `opencode` model whose api flavor differs, asserting session construction still
  succeeds.
- Assert a bogus `(provider, model)` fails `ModelCatalog.isValid` (reuse the 008.1
  register test path).
- `npm run verify` exits 0.
- Proof (008.3 Proof block): delivers **PASS F** (`deepseek`/`openrouter`/
  `opencode` accepted against the pinned catalog) and **PASS F-neg** (bogus model
  rejected). The Proof registers each with a model fetched from `list model
--provider <p> --json`.
