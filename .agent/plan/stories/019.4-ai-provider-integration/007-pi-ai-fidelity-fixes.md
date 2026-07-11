# Story 007 - pi-ai fidelity fixes

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

Close the three deviations the pi-ai fidelity review found (see
`.agent/plan/feedback/019.4-ai-provider-integration/pi-ai-fidelity-review.md`) so
the provider engine uses **only** what pi-ai exposes and invents nothing pi-ai
already provides: (B1) stop re-deriving the Copilot enterprise base URL by hand;
(B2) build the openai-compatible provider through `createProvider` with the
correct API and an account-scoped api-key auth; (B3) let an operator supply the
GitHub Enterprise domain during Copilot login.

## Acceptance Criteria

- **Copilot enterprise base URL comes from pi-ai (B1).** For a `github-copilot`
  account whose stored OAuth token carries a `proxy-ep`, the request the resolved
  `streamFn` issues targets the enterprise base URL, and that URL is derived by
  pi-ai's auth resolution — kanthord no longer parses the token to compute it.
  Individual (non-enterprise) Copilot accounts still resolve to the individual
  base URL. No behavior change is observable at the request boundary versus today.
- **openai-compatible honors its configured api (B2).** An `openai-compatible`
  account configured with `api: "openai-completions"` resolves to a session that
  streams over the completions API; one configured with `api: "openai-responses"`
  streams over the responses API. (Today both route through the responses API.)
- **openai-compatible never falls back to an ambient OpenAI key (B2).** An
  `openai-compatible` account with **no** stored api-key is a typed "unconfigured
  account" error **even when `OPENAI_API_KEY` is set in the environment** — the
  ambient OpenAI key must not silently authenticate a custom endpoint.
- **Enterprise Copilot login works (B3).** `kanthord login github-copilot
  --account <label> --enterprise <domain>` drives the login seam with the operator
  domain, and the resulting account resolves to that enterprise host. Omitting
  `--enterprise` keeps the `github.com` default. Cancel/timeout still writes
  nothing.

## Constraints

- **B1 — delete the hand-rolled derivation.** Remove `parseCopilotBaseUrl` and the
  `model.baseUrl` override in `src/agent/provider-session.ts`; rely on the pi-ai
  Copilot OAuth `toAuth()` + `Models.applyAuth()` seam
  (`utils/oauth/github-copilot.js:329-332`) to supply the enterprise base URL.
  Update any test asserting an **eager** `session.model.baseUrl` to assert at the
  resolved-auth / `streamSimple` seam instead (review caveat).
- **B2 — use `createProvider`, not a Provider literal.** Replace
  `buildOpenAICompatibleSession`'s hand-written `Provider` object with
  `createProvider({ id, baseUrl, auth, models, api })`, selecting the
  `ProviderStreams` implementation from `config.api` (completions vs responses,
  e.g. via `lazyApi` or an api-map keyed by `model.api`). `auth` is a plain
  `ApiKeyAuth` bound to the account credential with **no ambient env fallback**.
  This satisfies Story 004's original Constraint ("`openai` factory /
  `createProvider`").
- **B3 — thread the enterprise domain.** Add an optional enterprise-domain input to
  `startLoginOperation` / `LoginCommandDeps` and a `--enterprise <domain>` flag to
  the login CLI; feed it to the login seam's `onPrompt` (empty preserves
  `github.com`). Do not hard-code `onPrompt` to `""`.
- **No new provider mechanism.** All three fixes move logic onto pi-ai seams; they
  add no kanthord-owned provider behavior. Hermetic gate only — no network.

## Verification Gate

- `npm run typecheck` exits 0; `npm test` green — updated resolver, openai-
  compatible, and login-operation/CLI suites plus all pre-existing 019.4 suites,
  no regression; zero-network guard green.
- The B1, B2, and B3 acceptance behaviors are each asserted against fakes / a
  pi-ai `Models` double and a temp registry/store, no network.

### Task T1 - Copilot enterprise base URL derived by pi-ai, not kanthord (B1)

**Input:** `src/agent/provider-session.ts`, `src/agent/provider-session.test.ts`

**Action - RED:** for a `github-copilot` account whose stored OAuth token carries a
`proxy-ep`, assert the resolved request targets the enterprise base URL via the
auth-resolution seam (e.g. `Models.getAuth` / an `onResponse`/`onPayload` capture
on the `streamFn`), and that an individual-token account resolves to the
individual base URL — without kanthord parsing the token. Update the existing
eager-`model.baseUrl` assertion to the resolved-auth seam.

**Action - GREEN:** delete `parseCopilotBaseUrl` and the `model.baseUrl` override;
let the Copilot OAuth `toAuth()` + `Models.applyAuth()` supply the base URL.

**Action - REFACTOR:** remove any now-orphaned helper/import the deletion leaves.

**Verify:** `node --test src/agent/provider-session.test.ts` — T1 cases green.

### Task T2 - openai-compatible via createProvider: correct api + no ambient key (B2)

**Input:** `src/agent/provider-session.ts`, `src/agent/openai-compatible.ts`,
`src/agent/openai-compatible.test.ts`, `src/agent/provider-session.test.ts`

**Action - RED:** assert (a) an `openai-compatible` account with
`api: "openai-completions"` resolves to a session streaming over the completions
API and one with `api: "openai-responses"` over the responses API (assert on the
API the resolved model/provider uses, not internals); (b) with `OPENAI_API_KEY`
present in the environment but no stored account key, resolution is a typed
"unconfigured account" error — the ambient key does not authenticate the endpoint.

**Action - GREEN:** rebuild `buildOpenAICompatibleSession` on
`createProvider({ id, baseUrl, auth, models, api })` — api selected from
`config.api`, `auth` a plain `ApiKeyAuth` bound to the stored account credential
with no ambient fallback.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/openai-compatible.test.ts src/agent/provider-session.test.ts`
— T2 cases green.

### Task T3 - enterprise-domain Copilot login (B3)

**Input:** `src/agent/login-operation.ts`, `src/agent/login-operation.test.ts`,
`src/cli/login.ts`, `src/cli/login.test.ts`

**Action - RED:** assert that starting a `github-copilot` login with an
enterprise domain feeds that domain to the login seam's `onPrompt` (fake `loginFn`
captures the prompted value) and that `kanthord login github-copilot --account X
--enterprise company.ghe.com` passes it through; omitting `--enterprise` yields the
`github.com` default (empty prompt response).

**Action - GREEN:** add the optional enterprise-domain option to
`startLoginOperation`/`LoginCommandDeps`, parse `--enterprise` in the CLI, and
route the value into `onPrompt` instead of the hard-coded `""`.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/login-operation.test.ts src/cli/login.test.ts`
— T3 cases green.
