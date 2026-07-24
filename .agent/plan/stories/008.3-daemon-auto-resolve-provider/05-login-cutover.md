# Story E — Cut `login` over to the global registry

Epic: `.agent/plan/epics/008.3-daemon-auto-resolve-provider.md`
Depends on: EPIC 008.1 (`RegisterAiProvider`; the shared registry insert helper).

## Change

- **Shared helper (no use-case-calls-use-case)** — extract the insert +
  first-wins-default + reactivation logic from `RegisterAiProvider`
  (`src/app/ai-provider/register-ai-provider.ts`, 008.1) into a plain function
  `registerGlobalProvider(deps, { name, provider, model, baseUrl?, effort?, value })`
  (in `src/app/ai-provider/register-global-provider.ts`, or a static method) that
  both `RegisterAiProvider.execute` and the login path call. Neither use case
  calls the other.
- **Rewire `LoginProvider`** — `src/app/auth/login-provider.ts`: drop `projectId`
  from `LoginProviderInput` (:26-32) and the project-ref validation; keep
  `providerId`, add `name`, optional `model`, optional `baseUrl`/`effort`, and a
  transport callback `selectModel?: (models: string[]) => Promise<string>` (same
  seam pattern as the OAuth `presenter`). Constructor deps become `{ oauth,
registry, unitOfWork, modelCatalog, listModels, newId }` (drop `projects`,
  `resolver`; `listModels: (provider: string) => string[]` enumerates the
  provider's pinned-catalog model ids). Flow in `execute`: 0. **OAuth-only guard**: `if (!this.#oauth.has(input.providerId)) throw` a typed
  `NonOAuthProviderError(providerId)` (message: use `register ai-provider
   --value-file` for API-key providers). `oauth.has()` already exists
  (`src/oauth/port.ts:31`; pi registers OAuth for `anthropic` /
  `github-copilot` / `openai-codex` only — `deepseek`/`opencode`/`openrouter`
  are API-key-only and go through `register`, 008.1).
  1. `value = await this.#oauth.login(...)` (OAuth first — success gates the rest).
  2. `let model = input.model;` — if `undefined`, `const choices =
this.#listModels(input.providerId); model = await input.selectModel!(choices);`
     (interactive selection happens **only after** OAuth success).
  3. `registerGlobalProvider({ registry, unitOfWork, modelCatalog, newId },
{ name, provider: providerId, model, baseUrl, effort, value })` and return id.
- **CLI** — `src/apps/cli/login.ts` (`runLogin`) + `src/apps/cli/commands/login/provider.ts`:
  drop `--project`; add `--name` (required), `--model` (**optional**),
  `--base-url`/`--effort` (optional); keep `--provider` + `--method`. When
  `--model` is absent, pass a `selectModel` callback that prints the numbered
  model list via the login `io.print` and reads the choice via `io.prompt`
  (reuse `LoginIO`); validate the pick is in the list. When `--model` is present,
  pass it and no `selectModel` is invoked. Success stderr becomes
  `"ai-provider registered: <id>"`. Update `composition.ts:643-648` login wiring to
  the new deps (registry + unitOfWork + modelCatalog + `listModels` from the
  builtin catalog at `composition.ts:184` + newId).
- **Error** — new `NonOAuthProviderError` in `src/app/ai-provider/errors.ts` (or
  `src/oauth/port.ts`); add it to the `instanceof` chain in
  `src/apps/cli/error-map.ts:42-67`.
- **architecture.test.ts**: the `login provider` MATRIX row + `login <provider>
positional` OLD_SPELLINGS row stay (still valid). No leaf count change (the
  `login provider` leaf is repurposed, not added/removed).

## Constraints

- Model validation (`modelCatalog.isValid`) applies to login too — an OAuth login
  with an unknown `--model` is rejected before persistence.
- Same first-wins default + name-reactivation semantics as `register` (shared
  helper guarantees identical behavior).

## Verify

- Update `src/apps/cli/login.test.ts` + `src/app/auth/login-provider.test.ts`:
  login now returns a global provider id (`stderr: ["ai-provider registered: …"]`),
  persists via the registry (not `projects.addResource`), applies first-wins
  default, and reactivates a `logged_out` name. **OAuth-only guard**: `login
--provider opencode` (an API-key-only provider) → exit 1 with
  `NonOAuthProviderError` pointing at `register` (fake `oauth.has()` returns false
  for it); `login --provider openai-codex` proceeds. Cover **both** model paths:
  - `--model <id>` given → `selectModel` is **not** called; an unknown `--model`
    → rejected via `modelCatalog.isValid` (`UnknownModelError`).
  - `--model` absent → after a successful fake OAuth, `selectModel(choices)` is
    invoked with the provider's `listModels` output and the returned pick is what
    gets registered; a pick outside the list → rejected.
- `npm run verify` exits 0.
- Proof (008.3 Proof block): no dedicated `PASS` line (the Proof uses `register`,
  not interactive `login`); this story keeps the login→run path unbroken through
  the cutover and shares the registry insert path with `register`.
