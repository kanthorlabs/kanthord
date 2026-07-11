# Story 004 - OpenAI-compatible provider account

Epic: `.agent/plan/epics/019.4-ai-provider-integration.md`

## Goal

An operator can point kanthord at any OpenAI-compatible endpoint (local proxy, vLLM,
Azure-style, self-hosted) by registering an **`openai-compatible` provider account** —
a `baseUrl`, an `api` type, and a model list — with its api-key held in the Story 001
store. It is an ordinary `ProviderAccount` (multiple such accounts coexist) and resolves
through the Story 003 resolver like any other account.

## Acceptance Criteria

- Registering an `openai-compatible` account (`providerKind: "openai-compatible"`, a
  `baseUrl`, `api` = `openai-completions` | `openai-responses`, ≥1 model id) plus an
  api-key stored under that **account id** resolves through
  `buildProviderSession({accountId, modelId})` to a `model` whose base URL equals the
  configured `baseUrl`, `id === modelId`, and runtime provider maps to the account, with
  a working `streamFn`.
- Two `openai-compatible` accounts with different `baseUrl`s (e.g. two self-hosted
  endpoints) coexist and each resolves to its own base URL.
- Resolving an account id or model id **absent** from the config/registry is a typed
  error naming the failing entry; an account registered without a stored api-key (and no
  ambient key) is a typed "unconfigured account" error, not a silent empty key.

## Constraints

- **Config shape mirrors the gold standard's `models.json`** (pi coding-agent
  `ModelsConfigSchema`, `src/core/model-registry.ts`): endpoint metadata (`baseUrl` /
  `api` / `models[]`) only; the **api-key lives in the Story 001 store** keyed by account
  id (custody — Ulrich), never inline in config.
- **Reuse the Story 003 resolver** — the account's provider instance is registered into
  the same `createModels` via the pi-ai `openai` factory / `createProvider` with the
  configured base URL; no separate resolution path.
- **Registry vs policy boundary** — this is the runtime custom-endpoint path. The formal
  yaml registry + model-policy precedence stay in Epic 024 (Non-Goal); this is the
  minimal seam Story 005 references from 024.

## Verification Gate

- `npm test` green for the openai-compatible suite; typecheck 0; zero-network guard
  green.
- Resolve-to-custom-baseUrl (incl. two coexisting endpoints), the unknown account/model
  typed error, and the missing-key typed error are asserted against a temp config +
  registry/store, no network.

### Task T1 - openai-compatible account resolves with configured baseUrl + stored key

**Input:** `src/agent/openai-compatible.ts`, `src/agent/openai-compatible.test.ts`,
`src/agent/provider-session.ts`

**Action - RED:** register an `openai-compatible` account (baseUrl, api, one model) and
store its api-key, then assert `buildProviderSession({accountId, modelId})` returns a
`model` whose base URL equals the configured `baseUrl`; a second account with a different
`baseUrl` resolves to its own base URL.

**Action - GREEN:** load the account's endpoint metadata and register it into the
resolver's `createModels` (pi-ai `openai` factory / `createProvider` with the configured
base URL + api), pulling the api-key from the store by account id.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/openai-compatible.test.ts` — T1 cases green.

### Task T2 - typed errors for unknown account/model and missing key

**Input:** `src/agent/openai-compatible.ts`, `src/agent/openai-compatible.test.ts`

**Action - RED:** assert (a) resolving an id absent from the registry/config is a typed
error naming it, and (b) a configured account with no stored key (and no ambient key) is
a typed "unconfigured account" error, not an empty key.

**Action - GREEN:** add the lookup + key-presence checks producing the typed errors.

**Action - REFACTOR:** none.

**Verify:** `node --test src/agent/openai-compatible.test.ts` — T2 cases green.
