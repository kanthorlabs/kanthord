# 019.4 — pi-ai integration fidelity review (2026-07-11)

Deep review of how 019.4 integrated with `@earendil-works/pi-ai`, treating pi-ai
as the gold standard: use only what pi-ai exposes, invent nothing pi-ai already
provides. Verified against installed `@earendil-works/pi-ai@0.80.3` dist and
`@earendil-works/pi-agent-core`. Debate-hardened (opencode/plan). Routes to
remediation **Story 007**.

## Gold-standard seam (confirmed)

- Build a provider with `createProvider({ id, name, baseUrl, auth, models, api })`
  or a built-in factory (`openaiProvider`, `githubCopilotProvider`,
  `openaiCodexProvider`, `anthropicProvider`).
- Register in `createModels().setProvider()`; credentials via `CredentialStore`
  keyed by `provider.id` (one credential per provider).
- Runtime seam: `Models.streamSimple(model, ctx, opts) -> AssistantMessageEventStream`.
- pi-agent-core `StreamFn` is the SAME shape as pi-ai `streamSimple`; the Agent
  consumes a `streamFn`. 019.4's overall architecture matches this — the findings
  below are local deviations, not a wrong design.

## Blockers (route to Story 007)

- **B1 — copilot baseUrl reimplemented.** `src/agent/provider-session.ts:51-58`
  (`parseCopilotBaseUrl`) and the `model.baseUrl` override at `:206-231`
  re-implement pi-ai's own logic. The real logic lives in
  `node_modules/@earendil-works/pi-ai/dist/utils/oauth/github-copilot.js:35-48`
  (identical `proxy-ep` parse) and `toAuth()` at `:329-332` returns
  `{ apiKey, baseUrl: getGitHubCopilotBaseUrl(...) }`; `Models.applyAuth()` stamps
  that baseUrl onto the request model before streaming. Fix: delete the override,
  trust `toAuth`. Caveat: `session.model.baseUrl` no longer shows the enterprise
  URL *eagerly* — tests asserting eager baseUrl assert the wrong seam
  (`streamSimple`/`getAuth` is the seam) and must be updated.
  (`providers/github-copilot.js` has ZERO `proxy-ep` matches — the logic is only
  in `utils/oauth/github-copilot.js`.)

- **B2 — openai-compatible hand-rolls a Provider.**
  `provider-session.ts:135-157` (`buildOpenAICompatibleSession`) writes a
  `Provider` object literal delegating `stream`/`streamSimple` to
  `openaiProvider()` instead of using `createProvider`. Two defects:
  1. **Wrong API dispatch.** `openaiProvider()` is `Provider<"openai-responses">`,
     hard-wired to the responses API. A config with `api: "openai-completions"`
     silently streams through the wrong implementation.
  2. **Ambient key leakage.** Reusing `openaiProvider().auth` keeps OpenAI's
     ambient `OPENAI_API_KEY` fallback, so an un-credentialed custom endpoint can
     leak onto OpenAI's key (cross-provider). (The account credential IS read
     under `accountId`; the risk is the ambient fallback, not the stored-key path.)
  Fix: `createProvider({ id, baseUrl, auth: <plain ApiKeyAuth bound to the account
  credential, no ambient fallback>, models, api: <completions|responses
  ProviderStreams selected by config.api, e.g. via lazyApi or an api-map keyed by
  model.api> })`. Story 004's own Constraint already mandated
  "`openai` factory / `createProvider`" — the implementation deviated.

- **B3 — enterprise Copilot login is broken.** `src/agent/login-operation.ts:108`
  sets `onPrompt: async () => ""`. But `loginGitHubCopilot`
  (`utils/oauth/github-copilot.js:271-286`) prompts for the enterprise domain as
  its FIRST step (`"GitHub Enterprise URL/domain (blank for github.com)"`).
  Returning empty forces `github.com`, so enterprise Copilot login can never work
  through `kanthord login` — contradicting B1's enterprise-token handling. Fix:
  thread an operator-supplied enterprise domain (CLI flag / operation option) into
  `onPrompt`; default empty preserves `github.com`.

## Judged acceptable (no action)

- **Multi-account credential adapter** (`provider-session.ts:237-250`): a
  legitimate bridge over pi-ai's one-credential-per-`provider.id` design
  (copilot/codex hard-code auth on the provider id, so the id must stay canonical).
  Keep — with the explicit invariant: one `Models` instance per same-kind account
  session, account identity carried outside `model.provider`.
- **ChatGPT Subscription (`openai-codex`)**: already clean — built-in factory +
  `loginOpenAICodexDeviceCode`, no custom logic.
- **Device-code login layer**: using the lower-level device-code fns instead of
  `provider.auth.oauth.login` is fine for a headless daemon; the only defect is B3.
