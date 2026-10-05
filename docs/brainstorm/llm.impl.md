---
title: LLM Implementation
---

# LLM Implementation

This file holds the mechanisms that realize [llm.md](llm.md).
This file is not a design document, and `llm.md` stays the single source of truth.
A mechanism here never overrides a rule there.

The module lives in `src/llm/`.
The platform validators and the model connector use the contracts of `@earendil-works/pi-ai` at 0.86.0.

## Platform validators

The component owns a dedicated platform validator for every [LLM platform](llm.vocabulary.md#llm-platform).
Each platform validator declares its secret shape, metadata schema and validation. A platform holds exactly one secret shape, and a second shape for the same remote is another platform, for example `anthropic-subscription` or `openai-codex`.

| Platform | Secret shape | Metadata | Check |
| --- | --- | --- | --- |
| `github-copilot` | `oauth` | None | `GET https://api.github.com/copilot_internal/v2/token` with the stored GitHub token |
| `openai-codex` | `oauth` | None | One model call to `gpt-5.6-luna` at reasoning `low` with the prompt "What time is it?" |
| `anthropic` | `api_key` | None | `GET https://api.anthropic.com/v1/models` |
| `openai-compatible` | `api_key` | `baseUrl`, `models` | `GET <baseUrl>/models` |
| `openrouter` | `api_key` | None | `GET https://openrouter.ai/api/v1/key` |
| `openai` | `api_key` | None | `GET https://api.openai.com/v1/models` |
| `amazon-bedrock` | `api_key` | `region` | None |
| `google-vertex` | `api_key` | `project`, `location` | None |
| `azure-openai-responses` | `api_key` | `resource_name` | None |
| `cloudflare-workers-ai` | `api_key` | `account_id` | None |
| `cloudflare-ai-gateway` | `api_key` | `account_id`, `gateway_id` | None |
| `opencode-go` | `api_key` | None | One model call to `deepseek-v4-flash` with the prompt "What time is it?" |

- Every other `KnownProvider` of pi-ai 0.86.0 is a platform with `api_key`, no metadata and no check: `ant-ling`, `google`, `radius`, `nvidia`, `deepseek`, `xai`, `groq`, `cerebras`, `vercel-ai-gateway`, `zai`, `zai-coding-cn`, `mistral`, `minimax`, `minimax-cn`, `moonshotai`, `moonshotai-cn`, `huggingface`, `fireworks`, `together`, `baseten`, `opencode`, `kimi-coding`, `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, `xiaomi`, `xiaomi-token-plan-cn`, `xiaomi-token-plan-ams` and `xiaomi-token-plan-sgp`.
- A pi-ai provider that accepts an API key is a platform with the secret shape `api_key`. An OAuth login of that provider is a separate platform that no page names yet.
- The `api_key` of `amazon-bedrock` is a Bedrock bearer token, and the `api_key` of `google-vertex` is a Google Cloud API key.
- A platform that authenticates through the host, for example an AWS profile or Google ADC, takes no credential record.
- Each metadata field of `amazon-bedrock`, `google-vertex`, `azure-openai-responses`, `cloudflare-workers-ai` and `cloudflare-ai-gateway` is a required nonblank string.
- An official OpenAI record is an `openai` record.
- An OpenRouter record is an `openrouter` record, never an `openai-compatible` record, because OpenRouter serves `GET /models` without authentication.
- `openai-compatible.baseUrl` uses `https` or `http`, with no query, no fragment and no trailing slash.
- The base URL is fixed for the life of a revision. A metadata edit that changes it answers 409 `llm.metadata.base_url_fixed`, and a rotation can set a new one.
- The first revision of an `openai-compatible` credential starts with `models: []`.
- Each approved model holds a required `id` and optional `contextWindow`, `maxTokens` and `reasoningLevels`. An `id` is unique inside `models`.
- An omitted value takes the default of pi 0.86.0: `contextWindow` `128000`, `maxTokens` `16384` and `reasoningLevels` `["off"]`.
- `contextWindow` and `maxTokens` are positive integers, and `maxTokens` does not exceed `contextWindow` after the defaults apply.
- A metadata edit adds approved models to the next revision after the [provider check](#the-provider-check).
- A metadata edit or a rotation that drops a model answers 409 `llm.metadata.model_in_use` while a default configuration or an entry names it.
- The dependency check and the metadata update commit in one transaction; a refusal lists the dependents in `details` as `{ models: [{ model, agents }] }`.

## The LLM provider

- `LlmProvider` is a TypeScript interface with one method, `check(secret, metadata, context)`.
- `check` answers `{ connection, models }`. `connection` is `ok`, `unauthorized`, `unreachable` or `invalid_response`. `models` is a list of `{ id, ownedBy, created }`, or null when the call reads no model list.
- The check of `openai-compatible` and of `openai` answers `models` from the OpenAI list shape of `GET /models`. Every other check answers `models: null`.
- `LLM_PROVIDERS` maps a platform to its `LlmProvider`. The map holds exactly the platforms with a check in the [platform table](#platform-validators), and a platform outside the map has no implementation.
- `verifiable` of the [platform list](architecture.impl.md#the-platform-list) is true exactly for a platform in `LLM_PROVIDERS`.
- `check` maps a reply to `ok`, 401 or 403 to `unauthorized`, a network failure or the deadline to `unreachable`, and every other answer to `invalid_response`.
- A model call through pi-ai calls no `onResponse` on a refused request. The check of a model call reads the HTTP status from the `<status>:` prefix of the `errorMessage` of the pi-ai reply.
- The `opencode-go` check passes a session id, so that pi-ai sends the header `x-opencode-session`. OpenCode Go refuses a call without it with 400 `MissingSessionID`.
- Each model that a check calls is a named constant in `src/llm/`, for example the constants of `gpt-5.6-luna` for `openai-codex` and `deepseek-v4-flash` for `opencode-go`. No code compares or sends a model name as a raw string.
- The credential healthcheck, the agent provider healthcheck and the provider check call `check`. A healthcheck maps `ok` to `healthy`, `unauthorized` to `unhealthy`, and `unreachable` and `invalid_response` to `unknown`.
- Ulrich accepts the token cost of the `openai-codex` check and of the `opencode-go` check.

## The provider check

- `llm.provider.check` is a server-wide read operation under `human` access, with no project or binding.
- Its route is `POST /api/llm/provider/check`, and its input is only `{ credential }`.
- It accepts a credential of every platform in `LLM_PROVIDERS`. A credential of another LLM platform answers 400 `llm.provider.check_unsupported`.
- The component calls `check` with the material that custody releases, caches nothing and drops the material after the call.
- Each call of `check` has a 10 s deadline.
- HTTP 200 holds the answer of `check`, `{ connection, models }`.
- HTTP 400 `llm.provider.invalid_input` reports invalid input. HTTP 404 `llm.provider.credential_not_found` reports an unknown credential or a credential of another component.
- The answer holds no key and pre-fills model ids, not limits or reasoning levels.
- A human approves models through a [credential metadata revision](#platform-validators).

## The approved models

- The LLM component answers the approved models of a credential to the [Worker configuration validation](worker-service.impl.md#agent-configuration-validation): the `models` metadata of an `openai-compatible` credential, with the defaults applied.
- The Worker Service reads no metadata key of a credential.

## Operations

- The component declares the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) under the prefix `llm`.
- `llm.credential.create` accepts a record of every LLM platform whose secret shape is not `oauth`.
- `llm.credential.login` obtains a record of an LLM platform whose secret shape is `oauth`.
- `llm.credential.get` answers the record with `agentProviders`, the list of `{ agent, name }` of every agent provider that names the credential. The Worker Service answers that read.

## The OAuth login

- The component calls `models.login(providerId, "oauth", interaction)` of pi-ai over the credential store of custody.
- The [platform table](#platform-validators) determines whether OAuth is accepted.
- A login session is a runtime record of the component with identity `login_session_<ulid>`.
- It holds platform, mode, initial human identity, credential name, state, address, code, failure reason and expiry.
- Expiry falls 15 minutes after start.
- The interaction adapter answers `select` with `browser` or `device_code`; an unsupported option fails the session.
- It records `auth_url` as the address and `device_code` as the code and address.
- It records `info` and `progress` as the last message.
- The GitHub Copilot login of pi-ai first asks for a GitHub Enterprise domain with the placeholder `company.ghe.com`. While the session holds no address, the adapter answers that one prompt with the empty value, which selects github.com.
- Every other `manual_code`, `text` or `secret` prompt waits for a supplied value until expiry.
- `llm.credential.login` is a unary mutation and answers session identity, address, code and expiry.
- `llm.credential.login_code` is a unary mutation with session identity and value; it answers 409 when no value is awaited.
- `llm.credential.login_status` is a unary read with session identity; it answers state, last message and failure reason.
- The routes are `POST /api/llm/credential/login`, `POST /api/llm/credential/login/:sessionId/code` and `GET /api/llm/credential/login/:sessionId`. The static segment `login` takes precedence over `/:credentialName`, so the component refuses the name `login`.
- A platform with one mode ignores the requested mode.
- A browser callback listener belongs to pi-ai, not the Gateway, and lasts for the session.
- The server sets no `PI_OAUTH_CALLBACK_HOST` override.
- A remote browser can return its redirect URL or code through `llm.credential.login_code` when its loopback callback fails.
- Device mode needs no listener; pi-ai polls until success, failure or expiry.
- The component permits at most one pending session per platform and human identity; another start answers 409.
- The component takes an optional `oauthProviders` that defaults to the built-in pi-ai GitHub Copilot and OpenAI Codex providers.
- The component keeps `refresh`, `access` and `expires` of a pi OAuth credential and drops every other field before validation. The OpenAI Codex login adds `accountId`, and the runtime derives it from the access token.
- Completion writes the first revision through custody inside the pi-ai `CredentialStore.modify` call. The transaction checks the session state again, so an expired or failed session stores nothing. The session ends only after the commit.
- The session record holds no token, and a failed or expired session stores nothing.
- The login flow proves the OAuth record; no extra validation call follows it.
- Output exposes the address and code that the human needs, never a token.

## The model connector

- The model connector takes the execution credential store of [custody](custody.impl.md#the-credential-store-of-an-execution), the pi adapter id, the model identifier, the reasoning effort and the metadata of the pinned revision.
- It answers the pi `ModelRuntime` and the pi `Model`, or it fails closed with `worker.runtime.setup_refused`, whose `details.reason` is `model_unknown`, `reasoning_effort_unsupported`, `credential_absent` or `credential_revision_mismatch`.
- It puts the metadata into the `env` of the API key credential that the store answers. It maps each metadata field to the pi-ai variable name:
  - `amazon-bedrock`: `region` to `AWS_REGION`.
  - `google-vertex`: `project` to `GOOGLE_CLOUD_PROJECT` and `location` to `GOOGLE_CLOUD_LOCATION`.
  - `azure-openai-responses`: `resource_name` to `AZURE_OPENAI_RESOURCE_NAME`.
  - `cloudflare-workers-ai`: `account_id` to `CLOUDFLARE_ACCOUNT_ID`.
  - `cloudflare-ai-gateway`: `account_id` to `CLOUDFLARE_ACCOUNT_ID` and `gateway_id` to `CLOUDFLARE_GATEWAY_ID`.
- The `env` stays inside the model connector. The custody execution store and a refresh report never carry it.
- Every runtime setup call carries an abort signal with a deadline.

### The OpenAI-compatible provider

- The model connector builds the pi provider from the credential metadata of the resolved revision.
- It calls `createProvider` with id `openai-compatible`, the agent provider name and metadata `baseUrl`.
- It supplies `auth: { apiKey: envApiKeyAuth("<agent provider name> API key", []) }` and `api: openAIResponsesApi()`.
- The environment-variable list is empty; the execution store supplies the credential.
- Each metadata model becomes a pi model with provider `openai-compatible` and the metadata base URL.
- The model carries `api: "openai-responses"`, `contextWindow`, `maxTokens` and the established reasoning levels.
- The model builder applies the defaults of pi 0.86.0 to each value that the metadata omits: `contextWindow` `128000`, `maxTokens` `16384` and reasoning levels `["off"]`, because pi-ai `createProvider` applies none.
- Input defaults to `["text"]`, and all cost rates are zero.
- The model list enters `createProvider`, and `setProvider` registers the provider.
- The model connector builds each model rather than reuses `OPENAI_MODELS`, whose base URLs address OpenAI.
- Provider construction performs no write-time remote call.

## The resource healthcheck

- The [credential healthcheck](architecture.impl.md#the-credential-healthcheck) rules apply.
- The [LLM providers](#the-llm-provider) supply the checks.
- No check refreshes an OAuth record; an expired access token answers `unreachable` without a remote call, and the healthcheck reports `unknown`.
- Credential and agent provider healthchecks share an implementation where appropriate, not ownership.
- The `openai-codex` check and the `opencode-go` check make a model call.
- The `openai-codex` check builds its call through pi-ai as an execution does: it puts the stored OAuth credential into a pi credential store for that one call and lets the pi `openai-codex` provider resolve the authentication. The store lives for the call, and nothing writes back to custody.
- A pi call with an OAuth credential carries no `apiKey` option. pi takes the API key path whenever the options hold the `apiKey` key, even with a `null` value.
- The `opencode-go` check builds its call through the pi `opencode-go` provider with the stored API key and the smallest token limit.
- The Copilot check writes no minted token back to the record.

## Tests

- Tests assert the platform list against the platform table, and the refusal of a platform of another component.
- Tests assert the secret shape of each platform, the entry method of each shape, metadata schemas, model defaults, fixed base URL and a `baseUrl` change at rotation alone.
- Tests cover a model removal with dependents and concurrent changes.
- Tests cover the check of every LLM provider, its `connection` mapping, the healthcheck status mapping, expired OAuth and forbidden calls.
- Tests assert that a refused model call maps 401 and 403 to `unauthorized` through the status in `errorMessage`.
- Tests assert that `LLM_PROVIDERS` and `verifiable` agree, and that `llm.provider.check` refuses a platform without a check.
- Tests cover login completion, manual code, conflicting sessions and expiry without stored material.
- A test runs the built-in pi-ai GitHub Copilot provider offline to its first prompt and asserts the enterprise-domain placeholder.
- Tests cover the metadata map of the model connector for each platform with metadata, and each refusal reason of `worker.runtime.setup_refused`.
