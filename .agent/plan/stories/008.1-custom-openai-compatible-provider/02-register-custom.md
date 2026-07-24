# Story B — `register ai-provider` custom path

Epic: `.agent/plan/epics/008.1-custom-openai-compatible-provider.md`
Depends on: Story A (schema), `008.1-global-ai-provider-registry` Story 03
(`register ai-provider` + `RegisterAiProvider` + `src/apps/cli/ai-provider.ts`).

## Change

- **CLI flags** — `src/apps/cli/commands/register/ai-provider.ts` (from the global
  008.1): add `.option("--api <flavor>")`, `.option("--custom-provider-id <id>")`,
  `.option("--base-url <url>")` (may already exist), `.option("--context-window <n>")`,
  `.option("--max-tokens <n>")`, `.option("--allow-insecure")` (consumed by Story E).
- **Runner** — `src/apps/cli/ai-provider.ts` `runRegisterAiProvider`: when
  `--api` is present, take the **custom** branch — require `--custom-provider-id`,
  `--base-url`, `--model`; `--api` must be `openai-completions` or
  `openai-responses` (else typed error); pass a custom input to the use case.
  When `--api` is absent, the existing builtin branch (catalog-validated).
- **Use case** — `src/app/ai-provider/register-ai-provider.ts` (global 008.1):
  `RegisterAiProviderInput` gains optional `api`, `customProviderId`,
  `contextWindow`, `maxTokens`, `baseUrl`. In `execute`, if `api` is set (custom):
  - **skip** `modelCatalog.isValid` (custom models are not in the pinned catalog);
  - build the record with `provider = customProviderId`, `model`, `baseUrl`,
    `api`, `contextWindow = input.contextWindow ?? 32768`, `maxTokens =
input.maxTokens ?? 4096`, `value`, and the shared first-wins-default +
    name-reactivation logic (unchanged).
  - Trust validation of `baseUrl` (embedded-cred + insecure) is Story E.
- **Conservative model defaults** are documented in the story/help text: `cost`
  = unknown/0, `reasoning` = false, `input` = ["text"], `contextWindow`/`maxTokens`
  from flags or the 32768/4096 defaults. These defaults are consumed at session
  build (Story C), not stored beyond `contextWindow`/`maxTokens`.

## Constraints

- Custom registration never touches the pinned catalog; a custom
  `(provider, model)` is accepted as-is (validation is deferred to a real call via
  `test ai-provider`, Story D).
- `--api` outside the allowlist is rejected with a typed error.

## Verify

- Extend `src/app/ai-provider/register-ai-provider.test.ts`: `--api
openai-completions` + `--custom-provider-id` + `--base-url` + `--model` inserts a
  custom record (api set, model NOT catalog-validated), applies first-wins
  default; omitting `--custom-provider-id`/`--base-url` on the custom branch →
  typed error; `--api bogus` → typed error; the builtin branch (no `--api`) still
  catalog-validates.
- Extend `src/apps/cli/ai-provider.test.ts`: `register ai-provider --api
openai-completions …` returns an id; missing required custom flags → exit 1.
- `npm run verify` exits 0.
- Proof (008.1-custom Proof): delivers **PASS A/B** (custom openai-compatible
  provider registered) — paired with Story E's `--allow-insecure` on the mock's
  http endpoint.
