---
title: LLM Implementation
---

# LLM Implementation

This file holds the mechanisms that realize [llm.md](llm.md).
This file is not a design document, and `llm.md` stays the single source of truth.
A mechanism here never overrides a rule there.

The module lives in `src/llm/`.
The platform validators and the model connector use the contracts of `@earendil-works/pi-ai` at 1.1.0.

## Platform validators

The component owns a dedicated platform validator for every [LLM platform](llm.vocabulary.md#llm-platform).
Each platform validator declares its secret shape, metadata schema and validation. A platform holds exactly one secret shape, and a second shape for the same remote is another platform, for example `anthropic-subscription` or `openai-codex`.

| Platform                 | Secret shape | Metadata                   | Check                                                                                      |
| ------------------------ | ------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `github-copilot`         | `oauth`      | None                       | `GET https://api.github.com/copilot_internal/v2/token` with the stored GitHub token        |
| `openai-codex`           | `oauth`      | None                       | One model call to `gpt-5.6-luna` at reasoning `low` with the prompt "What time is it?"     |
| `anthropic-subscription` | `oauth`      | None                       | One model call to `claude-haiku-5-5` with 1 output token and the prompt "What time is it?" |
| `anthropic`              | `api_key`    | None                       | `GET https://api.anthropic.com/v1/models`                                                  |
| `openai-compatible`      | `api_key`    | `base_url`, `models`       | `GET <base_url>/models`                                                                    |
| `openrouter`             | `api_key`    | None                       | `GET https://openrouter.ai/api/v1/key`                                                     |
| `openai`                 | `api_key`    | None                       | `GET https://api.openai.com/v1/models`                                                     |
| `amazon-bedrock`         | `api_key`    | `region`                   | None                                                                                       |
| `google-vertex`          | `api_key`    | `project`, `location`      | None                                                                                       |
| `azure`                  | `api_key`    | `resource_name`            | None                                                                                       |
| `cloudflare-workers-ai`  | `api_key`    | `account_id`               | None                                                                                       |
| `cloudflare-ai-gateway`  | `api_key`    | `account_id`, `gateway_id` | None                                                                                       |
| `opencode-go`            | `api_key`    | None                       | One model call to `deepseek-v4-flash` with the prompt "What time is it?"                   |

- Every other `KnownProvider` of pi-ai 1.1.0 is a platform with `api_key`, no metadata and no check: `ant-ling`, `google`, `radius`, `nvidia`, `deepseek`, `xai`, `groq`, `cerebras`, `vercel-ai-gateway`, `zai`, `zai-coding-cn`, `mistral`, `minimax`, `minimax-cn`, `moonshotai`, `moonshotai-cn`, `huggingface`, `fireworks`, `together`, `baseten`, `opencode`, `kimi-coding`, `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, `xiaomi`, `xiaomi-token-plan-cn`, `xiaomi-token-plan-ams`, `xiaomi-token-plan-sgp`, `meta` and `typesafe`.
- A pi-ai provider that accepts an API key is a platform with the secret shape `api_key`. An OAuth login of that provider is a separate platform.
- `anthropic-subscription` is the OAuth login of the pi provider `anthropic`. The dashboard shows the platform id `anthropic-subscription`, the same as every other platform.
- `piProviderId` maps a platform to its pi adapter id. `anthropic-subscription` maps to `anthropic`, and every other platform maps to itself.
- The custody handover item, the model connector, the model check, the agent model list and the OAuth login use the pi adapter id. Every other field keeps the platform.
- The `api_key` of `amazon-bedrock` is a Bedrock bearer token, and the `api_key` of `google-vertex` is a Google Cloud API key.
- A platform that authenticates through the host, for example an AWS profile or Google ADC, takes no credential record.
- Each metadata field of `amazon-bedrock`, `google-vertex`, `azure`, `cloudflare-workers-ai` and `cloudflare-ai-gateway` is a required nonblank string.
- An official OpenAI record is an `openai` record.
- An OpenRouter record is an `openrouter` record, never an `openai-compatible` record, because OpenRouter serves `GET /models` without authentication.
- `openai-compatible.base_url` uses `https` or `http`, with no query, no fragment and no trailing slash.
- The base URL is fixed for the life of a revision. A metadata edit that changes it answers 409 `llm.metadata.base_url_fixed`, and a rotation can set a new one.
- The first revision of an `openai-compatible` copy of the holder `server` starts with `models: []`.
- The first revision of an `openai-compatible` [instance copy](#instance-copies) takes the `models` that the human types, because no provider check runs for it.
- Each approved model holds a required `id` and optional `context_window`, `max_tokens` and `reasoning_levels`. An `id` is unique inside `models`.
- An omitted value takes the default of pi 1.1.0: `context_window` `128000`, `max_tokens` `16384` and `reasoning_levels` `["off"]`.
- `context_window` and `max_tokens` are positive integers, and `max_tokens` does not exceed `context_window` after the defaults apply.
- A metadata edit adds approved models to the next revision after the [provider check](#the-provider-check). A metadata edit of an instance copy takes the model ids that the human types.
- A metadata edit or a rotation that drops a model answers 409 `llm.metadata.model_in_use` while a default configuration or an entry names it. A fallback configuration is a dependent too.
- The dependency check and the metadata update commit in one transaction; a refusal lists the dependents in `details` as `{ models: [{ model, agents }] }`.

## The LLM provider

- `LlmProvider` is a TypeScript interface with one method, `check(secret, metadata, context, observe)`. `observe` is optional and receives the failure reason without material.
- `check` answers `{ connection, models }`. `connection` is `ok`, `unauthorized`, `unreachable` or `invalid_response`. `models` is a list of `{ id, owned_by, created }`, or null when the call reads no model list. `owned_by` and `created` are null when the remote leaves them out.
- The check of `openai-compatible` and of `openai` answers `models` from the OpenAI list shape of `GET /models`. Every other check answers `models: null`.
- Each LLM provider declares its capability: `copilot token read` for `github-copilot`, `model call` for `openai-codex`, `anthropic-subscription` and `opencode-go`, `model-list read` for `anthropic`, `openai-compatible` and `openai`, and `key read` for `openrouter`. A platform without an LLM provider has the capability `none`.
- The LLM component answers the capability of the LLM provider of a credential to the agent provider healthcheck.
- `LLM_PROVIDERS` maps a platform to its `LlmProvider`. The map holds exactly the platforms with a check in the [platform table](#platform-validators), and a platform outside the map has no implementation.
- `verifiable` of the [platform list](architecture.impl.md#the-platform-list) is true exactly for a platform in `LLM_PROVIDERS`.
- `check` maps a reply to `ok`, 401 or 403 to `unauthorized`, a network failure or the deadline to `unreachable`, and every other answer to `invalid_response`.
- The `connection` value is not a failure reason. For a 403, `connection` is `unauthorized` and the health entry carries `failure_reason: forbidden`.
- A model call through pi-ai calls no `onResponse` on a refused request. The check of a model call reads the HTTP status from the `<status>:` or `<status> ` prefix of the `errorMessage` of the pi-ai reply. A failed model call without a status maps to `unreachable`.
- The `opencode-go` check passes a session id, so that pi-ai sends the header `x-opencode-session`. OpenCode Go refuses a call without it with 400 `MissingSessionID`.
- Each model that a check calls is a named constant in `src/llm/`, for example the constants of `gpt-5.6-luna` for `openai-codex`, `claude-haiku-5-5` for `anthropic-subscription` and `deepseek-v4-flash` for `opencode-go`. No code compares or sends a model name as a raw string.
- The credential healthcheck, the agent provider healthcheck and the provider check call `check`. A healthcheck maps `ok` to `healthy`, `unauthorized` to `unhealthy`, and `unreachable` and `invalid_response` to `unknown`.
- Ulrich accepts the token cost of the `openai-codex` check, of the `anthropic-subscription` check and of the `opencode-go` check.

## The provider check

- `llm.provider.check` is a server-wide read operation under `human` access, with no project or binding.
- Its route is `POST /api/llm/provider/check`, and its input is only `{ credential }`.
- It accepts a credential of every platform in `LLM_PROVIDERS`. A credential of another LLM platform answers 400 `llm.provider.check_unsupported`.
- The component calls `check` with the material that custody releases, caches nothing and drops the material after the call.
- The check refreshes an OAuth token by [the OAuth refresh of a check](#the-oauth-refresh-of-a-check).
- Each call of `check` has a 10 s deadline.
- HTTP 200 holds the answer of `check`, `{ connection, models }`.
- The route declares an open body, and the handler validates `{ credential }`, so that invalid input answers `llm.provider.invalid_input` and not a Gateway code.
- HTTP 400 `llm.provider.invalid_input` reports invalid input. HTTP 404 `llm.provider.credential_not_found` reports an unknown credential or a credential of another component.
- The check reads the copy of the holder `server`. A name with no such copy answers 409 `credential.credential.held_by_instance`, because custody releases no instance copy.
- The answer holds no key and pre-fills model ids, not limits or reasoning levels.
- No raw key reaches `llm.provider.check`. The [pre-save check](architecture.impl.md#the-pre-save-check) is the only credential operation that takes a typed secret, and the LLM component runs it through `LlmProvider.check`.
- A human approves models through a [credential metadata revision](#platform-validators).

## The model check

- `llm.model.check` is a server-wide read operation under `human` access, with no project or binding.
- Its route is `POST /api/llm/model/check`, and its input is `{ credential, model_identifier, reasoning_effort }`.
- The route declares the body schema, so invalid input answers the Gateway code `gateway.request.validation_failed`.
- It accepts a credential of every LLM platform, `openai-compatible` included.
- The component builds the model runtime with the [model connector](#the-model-connector) from the material that custody releases. The check and an execution use one runtime path for every platform.
- The check pins no credential revision and caches nothing. It stores only a refreshed OAuth value, by [the OAuth refresh of a check](#the-oauth-refresh-of-a-check). The enablement write does not call it.
- HTTP 404 `llm.model.credential_not_found` reports an unknown credential or a credential of another component.
- The check reads the copy of the holder `server`. A name with no such copy answers 409 `credential.credential.held_by_instance`.
- HTTP 400 `llm.model.model_unknown` reports a model outside the model list of the credential. HTTP 400 `llm.model.reasoning_unsupported` reports a reasoning effort outside the supported levels of the model.
- The check runs one tool round trip: a user message, one declared tool `check_tool`, a tool call of the model, a tool result `ready` and a final reply.
- The reasoning effort `off` sends no `reasoning` option. Every other effort goes to the model call as `reasoning`.
- HTTP 200 holds `{ result, message }`. `result` is `ok` or one provider failure code: `rate_limited`, `quota_exhausted`, `unauthorized`, `bad_request` or `unavailable`.
- `message` is `null` for `ok`. Otherwise `message` is the error text of the model call, redacted with the secrets of the credential and cut to 300 characters.
- The LLM component owns the classifier of the error text. The Worker Service uses the same classifier for the stop code of `provider_failed`.
- The classifier maps quota text to `quota_exhausted`, status 429 to `rate_limited`, 401 and 403 to `unauthorized`, every other 4xx to `bad_request`, and every other text to `unavailable`.
- A first reply without a call of `check_tool` answers `bad_request` with the message `The model did not call the tool.`
- `checkModel` gives the model runtime the custody refresh store in place of the store of one call.
- Without a refresh store, an OAuth access token that expires within 5 minutes answers `unauthorized` with the message `The access token is expired or expires within 5 minutes, and the check cannot refresh it.` without a model call.
- A failed refresh answers `unauthorized` with the message `The access token refresh failed.`
- A check that the 50 s deadline or the cancellation of the caller ends answers `unavailable`.
- The check is a warning for the dashboard and the CLI before an enablement write.

## The approved models

- The LLM component answers the approved models of a credential to the [Agent configuration validation](agent.impl.md#agent-configuration-validation): the `models` metadata of an `openai-compatible` credential, with the defaults applied.
- It answers the approved models of each copy. A model is approved for the name when every copy approves it.
- The Worker Service reads no metadata key of a credential.

## Operations

- The component declares the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) under the prefix `llm`.
- `llm.credential.create` accepts a record of every LLM platform whose secret shape is not `oauth`.
- `llm.credential.login` obtains a record of an LLM platform whose secret shape is `oauth`.
- `llm.credential.get` answers the record with `agent_providers`, the list of `{ agent, name }` of every agent provider that names the credential. The Agent component answers that read.

## Instance copies

- `llm.credential.create` and `llm.credential.rotate` declare the access policy `human_or_worker` of [the Gateway](gateway-service.impl.md#access-policy). Every other credential operation keeps `human`, except where this section names another policy.
- Under a human identity, `create` takes `{ name, platform, metadata, secret, holders }`. `holders` is a list of `server` and live instance names, and it defaults to `["server"]`. [Custody seals](custody.impl.md#the-seal-of-a-human-entry) each instance copy and writes one row for each holder in one transaction.
- Under a human identity, `rotate` takes `{ expected_revision, secret }` and the query `holder`, which defaults to `server`.
- Under a [worker token](gateway-service.vocabulary.md#worker-token), `create` takes `{ name, platform, metadata, holder, sealed, sealed_to }`, and `rotate` takes `{ expected_revision, holder, sealed, sealed_to }`. `holder` equals the instance of the token.
- A body holds exactly one of `secret` and `sealed` with `sealed_to`. A human body with `sealed`, a worker body with `secret`, or a body with both answers 400 `credential.input.invalid`.
- A `holder` that names no live instance answers 400 `llm.credential.instance_unknown`.
- A worker caller acts only on the copies of its own instance. Another holder answers 403 `llm.credential.instance_forbidden`.
- A metadata edit, a revoke, an archive and a login declare `human`. The Gateway answers a worker token on them with 401 `gateway.authentication.unauthorized`.
- A human create or rotate that seals for an instance reads the keys in one transaction, seals outside it, and commits in a second transaction. The commit checks `sealed_to` against the current fingerprint again, and a key rotation in between answers 400 `credential.sealed.invalid`.
- A human create with several holders answers the copy of the first holder.
- `list` and `get` declare `human_or_worker`. A worker caller reads only the copies of its own instance. A human `list` takes the optional query `holder`.
- `get`, `metadata`, `revoke`, `archive` and `login` take the query or body field `holder`, which defaults to `server`.
- `login_code` and `login_status` take no `holder`. The session identity names the holder of the session.
- Each record answer adds `holder`, `sealed_to` and `sealed_current`.
- An instance copy skips the [pre-save check](architecture.impl.md#the-pre-save-check) and the [provider check](#the-provider-check).
- The CLI on the host of an instance seals locally. With `--holder <name>` and an instance file `$XDG_CONFIG_HOME/kanthord/workers/<name>.yaml`, it derives the public key from the private key of that file. It authenticates with a worker token, and it trusts no key that the server supplies. The token call creates no connection.
- Without that file, the CLI sends the plaintext and the holder under the human token, and the server seals.
- The credential sheet of an instance page sends the plaintext and the holders. Its `Also seal to` field lists every live instance, grouped by worker.
- The `Rotate` sheet offers `Also rotate on` with every other holder of the name. It sends one request for each holder, each with its own `expected_revision`.
- `/llm` lists the copies of the holder `server` only and states "Instance credentials live on the worker pages."

### The health of an instance copy

- `credential_version` is an in-memory counter of the component for each instance. A server start sets every counter to the start time in Unix milliseconds, so the instance sees a new value after each restart.
- Each committed write of a copy of that instance raises the counter by one. These writes are a create, a rotation, a metadata edit, a revoke, an archive, the completion of a login, and a refresh report.
- Custody calls `instanceCopyRefreshed(holder)` after it writes the refresh report of an instance copy.
- The heartbeat answer of the instance carries the counter, under [the instance exchange](worker-service.impl.md#the-instance-exchange).
- A worker instance checks each of its own copies after its first heartbeat answer and when the `credential_version` of a heartbeat answer changes. The process sends its first heartbeat at its start. A change during a check run starts one more run after it.
- The instance lists its copies with `llm.credential.list`. It reads each live copy whose `sealed_current` is true through `llm.credential.sealed`.
- `llm.credential.sealed` is `GET /api/llm/credential/:credential_name/sealed`, policy `worker`, read, secret. The answer is `{ name, platform, revision, metadata, sealed }` of the newest live revision of the copy of the instance of the token. A copy that is absent or sealed to an ended key answers 404 `credential.credential.not_found`. Custody reads the sealed object with `storedSealed` and never opens it.
- The instance opens the copy with its own key and runs the `check` of [the LLM provider](#the-llm-provider) of the platform with a deadline of 10 s. The check has no refresh store, so it never refreshes the copy. An OAuth access token that expires within 5 minutes reports `unhealthy` with `failure_reason: unauthorized` without a remote call. It maps the result as [the resource healthcheck](#the-resource-healthcheck) does. A platform without a check or an open failure reports `unknown` with `failure_reason: unclassified`. A check that exceeds the deadline reports `unknown` with `failure_reason: deadline_exceeded`.
- A run that ends on an indeterminate answer or a server failure runs again at the next heartbeat. A refusal waits for the next change of the counter.
- It reports each result through `llm.credential.report`: `POST /api/llm/credential/:credential_name/report`, policy `worker`, mutation, body `{ revision, status, capability, failure_reason, models }`, answer 204. The body limit is 1 MiB.
- `revision` must be the newest live revision of a copy of the instance of the token that is sealed to the current key. An absent or ended-key copy answers 404 `credential.credential.not_found`. Another revision answers 409 `credential.revision.conflict` with `details.revision`. These bodies answer 400 `credential.input.invalid`:
  - a `failure_reason` that is null for a status other than `healthy`, or not null for `healthy`;
  - the `failure_reason` `held_by_instance`, because only the server answers it;
  - a `capability` other than the capability of the platform.
- `models` holds the model list of a check that reads one, else null. It holds at most 512 items, and each `id` and `owned_by` holds at most 256 characters. The instance drops a longer item. The dashboard offers it as the model ids of the next metadata edit of an `openai-compatible` instance copy.
- The component keeps the last report of each copy in memory, with the instance name and the time. A server restart shows `unknown` until the next report.
- `worker.instance.get` answers the report of each copy in `credentials[].health`: `{ status, capability, failure_reason, models, reported_at }`. A copy with no report, a report of another revision, or a copy sealed to an ended key answers `unknown`, `failure_reason: held_by_instance`, `models: null` and `reported_at: null`.
- `CopyHealthBook` of `src/llm/copy-health.ts` holds the counters and the reports. `CopyChecks` of `src/apps/worker/copy-checks.ts` runs the checks on the instance.

## The OAuth login

- The component calls `models.login(providerId, "oauth", interaction)` of pi-ai over the credential store of custody.
- The component registers the OAuth flows of pi-ai statically with `registerBunOAuthFlows` of `@earendil-works/pi-ai/bun-oauth`, imported as `registerOAuthFlows`. The single binary carries no flow file next to its bundle, so the variable import of pi-ai finds none.
- The [platform table](#platform-validators) determines whether OAuth is accepted.
- A login session is a runtime record of the component with identity `login_session_<ulid>`.
- It holds platform, mode, initial human identity, credential name, state, address, code, failure reason and expiry.
- Expiry falls 15 minutes after start.
- The interaction adapter answers `select` with `browser`, `device_code` or `copy_code`; an unsupported option fails the session.
- It records `auth_url` as the address and `device_code` as the code and address.
- It records `info` and `progress` as the last message.
- The GitHub Copilot login of pi-ai first asks for a GitHub Enterprise domain with the placeholder `company.ghe.com`. While the session holds no address, the adapter answers that one prompt with the empty value, which selects github.com.
- Every other `manual_code`, `text` or `secret` prompt waits for a supplied value until expiry.
- `llm.credential.login` is a unary mutation and answers session identity, address, code and expiry.
- `llm.credential.login_code` is a unary mutation with session identity and value; it answers 409 when no value is awaited.
- `llm.credential.login_status` is a unary read with session identity; it answers state, last message and failure reason.
- The routes are `POST /api/llm/credential/login`, `POST /api/llm/credential/login/:session_id/code` and `GET /api/llm/credential/login/:session_id`. The static segment `login` takes precedence over `/:credential_name`, so the component refuses the name `login`.
- A platform with one mode ignores the requested mode.
- A browser callback listener belongs to pi-ai, not the Gateway, and lasts for the session.
- The server sets no `PI_OAUTH_CALLBACK_HOST` override. The container image sets it to `::` in the image environment.
- Browser mode works only for a browser on the server host. The provider fixes the redirect to `localhost` and its port, so a browser on another machine, for example with the server on a VPS, never reaches the callback listener.
- `llm.credential.login` reads the `Host` header of the request. A host that is not `localhost`, `127.*` or `[::1]` forces device mode: a request with no mode selects device mode, and a request for browser mode answers `400 credential.login.browser_unavailable`.
- A call with no HTTP request, through the direct client, keeps browser mode.
- The dashboard applies the same rule to the address of its instance. It disables the browser mode there and states why.
- A remote browser can return its redirect URL or code through `llm.credential.login_code` when its loopback callback fails.
- In the container image, the OpenAI Codex callback listener binds `[::]:1455`, which accepts IPv4 and IPv6, and the run publishes port 1455. A browser on the container host reaches the listener, and the login completes with no extra step.
- Device mode needs no listener; pi-ai polls until success, failure or expiry.
- `anthropic-subscription` offers only `copy_code` mode. The address is the authorization URL and the code is `null`. The human submits the `code#state` value that `platform.claude.com` shows through `llm.credential.login_code`. Copy-code mode needs no listener.
- The component permits at most one pending session per platform and human identity over every holder; another start answers 409.
- The component takes an optional `oauthProviders` that defaults to the built-in pi-ai GitHub Copilot, OpenAI Codex and Anthropic providers.
- The component keeps `refresh`, `access` and `expires` of a pi OAuth credential and drops every other field before validation. The OpenAI Codex login adds `accountId`, and the runtime derives it from the access token.
- Completion writes the first revision through custody inside the pi-ai `CredentialStore.modify` call. The transaction checks the session state again, so an expired or failed session stores nothing. The session ends only after the commit.
- The session record holds no token, and a failed or expired session stores nothing.
- The login flow proves the OAuth record; no extra validation call follows it.
- Output exposes the address and code that the human needs, never a token.

### The login of an instance

- `llm.credential.login` takes the optional `holder`. A login of an instance holder runs on that instance, and the server holds only the session record.
- An instance with no current connection answers 409 `credential.login.instance_unavailable`. A connection whose last heartbeat is older than `INSTANCE_CONNECTED_WINDOW` (60 s) counts as no current connection.
- A holder that names no live instance answers 400 `llm.credential.instance_unknown`.
- A login of an instance holder refuses with 409 `credential.name.conflict` only when the `(name, holder)` group holds a live revision sealed to the current fingerprint. `details.id` holds the identity of that revision.
- A login of an archived copy answers 409 `credential.credential.archived`. The archive stays final.
- A copy whose newest live revision is sealed to an ended key takes a new login. A key rotation or a Reset key of the instance makes a copy stale in this way.
- `llm.credential.login` waits for the first report of the instance with an address, inside the operation timeout of 30 s. The instance receives the session in its next heartbeat answer.
- An instance session never uses browser mode. `anthropic-subscription` uses `copy_code` mode. `openai-codex` and `github-copilot` use device mode. A request for browser mode answers 400 `credential.login.browser_unavailable`.
- The heartbeat answer of the instance lists its pending sessions in `login_sessions`, under [the instance exchange](worker-service.impl.md#the-instance-exchange). The instance sends its heartbeat every 2 s while a session of it is pending.
- `login_sessions` is `[{ session_id, name, platform, mode, code }]`. `name` is the credential name, because the instance seals with it in the AAD. `mode` is `copy_code` or `device`. `code` is the copy code that the human submitted, or null.
- The instance runs the pi-ai login with the interaction adapter of the component and registers the OAuth flows of pi-ai as the component does. It reports `{ state, address, code, message, failure_reason }` through `llm.credential.login_report`: `POST /api/llm/credential/login/:session_id/report`, policy `worker`, mutation, answer 204.
- `state` is `pending`, `completed` or `failed`. A `pending` report sets the address, the code and the last message. A `failed` report fails the session with `failure_reason`.
- In device mode, the instance reports only the user code and the verification address. The PKCE verifier and the polling secret stay in the instance process.
- The value that the human submits through `llm.credential.login_code` reaches the instance in the next heartbeat answer.
- An instance session accepts one value, in `copy_code` mode only, after the instance reported the address. Another value answers 409 `credential.login.value_not_awaited`.
- The instance runs each listed session once. A session that leaves `login_sessions` ends on the instance.
- The instance expires its own run 15 minutes after it receives the session. The expiry of the server decides.
- At completion, the instance seals the credential to its own key and sends `sealed` and `sealed_to` in the final report. The component writes the revision through custody, under the rules of this section. A group with no revision gets revision 1. A group with a stale live revision n gets revision n+1, sealed to the current key, with the metadata of revision n. The older live revisions then drain as after a rotation.
- The write checks in one transaction that the session is pending and not expired, and that `sealed_to` is the current fingerprint of the holder. It checks the name rules of the start again. An expired session stores nothing.
- A refused write fails the session with the error code and stores nothing. A `completed` report without `sealed`, or another report with `sealed`, answers 400 `credential.input.invalid`.
- A report to an unknown, ended or expired session, or to a session of another instance, answers 404 `credential.login.not_found`.
- `address` is an `https:` URL of at most 2048 characters. `code`, `message` and `failure_reason` hold at most 1024 characters. The first address of a session stays; a report with another address answers 400 `credential.input.invalid`.
- The component applies a `pending` or `failed` report to the session after the commit of the operation.
- The instance sends a lost `pending` report again with the next heartbeat answer. It sends a lost `completed` report again every 2 s with one idempotency key, until the session ends or expires. A stopped instance starts no session.
- `InstanceLogin` of `src/llm/instance-login.ts` holds the session of an instance holder on the server. `InstanceLogins` of `src/apps/worker/instance-login.ts` runs the sessions on the instance.
- The instance refreshes its OAuth copy and reports the refreshed copy sealed, under [the credential handover](custody.impl.md#the-credential-handover). One instance runs one execution at a time, so one copy has one refresh holder.

## The model connector

- The model connector takes the execution credential store of [custody](custody.impl.md#the-credential-store-of-an-execution), the pi adapter id, the model identifier, the reasoning effort and the metadata of the pinned revision.
- It answers the pi `ModelRuntime` and the pi `Model`, or it fails closed with `worker.runtime.setup_refused`, whose `details.reason` is `model_unknown`, `reasoning_effort_unsupported`, `credential_absent` or `credential_revision_mismatch`.
- It puts the metadata into the `env` of the API key credential that the store answers. It maps each metadata field to the pi-ai variable name:
  - `amazon-bedrock`: `region` to `AWS_REGION`.
  - `google-vertex`: `project` to `GOOGLE_CLOUD_PROJECT` and `location` to `GOOGLE_CLOUD_LOCATION`.
  - `azure`: `resource_name` to `AZURE_OPENAI_RESOURCE_NAME`.
  - `cloudflare-workers-ai`: `account_id` to `CLOUDFLARE_ACCOUNT_ID`.
  - `cloudflare-ai-gateway`: `account_id` to `CLOUDFLARE_ACCOUNT_ID` and `gateway_id` to `CLOUDFLARE_GATEWAY_ID`.
- The `env` stays inside the model connector. The custody execution store and a refresh report never carry it.
- Every runtime setup call carries an abort signal with a deadline.

### The OpenAI-compatible provider

- The model connector builds the pi provider from the credential metadata of the resolved revision.
- It calls `createProvider` with id `openai-compatible`, the agent provider name and metadata `base_url`.
- It supplies `auth: { apiKey: envApiKeyAuth("<agent provider name> API key", []) }` and `api: openAIResponsesApi()`.
- The environment-variable list is empty; the execution store supplies the credential.
- Each metadata model becomes a pi model with provider `openai-compatible` and the metadata base URL.
- The model carries `api: "openai-responses"`, `context_window`, `max_tokens` and the established reasoning levels.
- The model builder applies the defaults of pi 1.1.0 to each value that the metadata omits: `context_window` `128000`, `max_tokens` `16384` and reasoning levels `["off"]`, because pi-ai `createProvider` applies none.
- Input defaults to `["text"]`, and all cost rates are zero.
- The model list enters `createProvider`, and `setProvider` registers the provider.
- The model connector builds each model rather than reuses `OPENAI_MODELS`, whose base URLs address OpenAI.
- Provider construction performs no write-time remote call.

## The resource healthcheck

- The [credential healthcheck](architecture.impl.md#the-credential-healthcheck) rules apply.
- The healthcheck reads `holder` first. An instance copy reports `unknown` with `failure_reason: held_by_instance` and releases nothing. [The health of an instance copy](#the-health-of-an-instance-copy) states the report of the instance.
- The [LLM providers](#the-llm-provider) supply the checks.
- The healthcheck refreshes an OAuth record by [the OAuth refresh of a check](#the-oauth-refresh-of-a-check). An access token that the check cannot refresh and that expires within 5 minutes answers `unauthorized` without a remote call. The healthcheck reports `unhealthy` with `failure_reason: unauthorized`.
- The `github-copilot` check sends the stored GitHub token and ignores the stored expiry. The remote decides the result of an expired record.
- Each failure carries a value of [the failure reason of an HTTP check](gateway-service.impl.md#the-failure-reason-of-an-http-check). A check that exceeds its deadline reports `unknown` with `failure_reason: deadline_exceeded`.
- Credential and agent provider healthchecks share an implementation where appropriate, not ownership.
- The `openai-codex` check, the `anthropic-subscription` check and the `opencode-go` check make a model call.
- The `anthropic-subscription` check builds its call as the `openai-codex` check does, under the pi provider `anthropic`.
- The `openai-codex` check builds its call through pi-ai as an execution does: it puts the stored OAuth credential into a pi credential store for that one call and lets the pi `openai-codex` provider resolve the authentication. Without a custody refresh store, the store lives for the call, and nothing writes back to custody.
- A pi call with an OAuth credential carries no `apiKey` option. pi takes the API key path whenever the options hold the `apiKey` key, even with a `null` value.
- The `opencode-go` check builds its call through the pi `opencode-go` provider with the stored API key and the smallest token limit.
- The Copilot check writes no minted token back to the record.

### The OAuth refresh of a check

- The healthcheck, the record verify, the provider check and the model check run on the copy of the holder `server`. They follow one rule for an `openai-codex` or `anthropic-subscription` record.
- Custody gives the check a pi credential store, the refresh store, in `ResourceCheck` and in `CheckMaterial.refreshStore`. The check passes that store to the pi call in place of the store of one call.
- pi-ai resolves the authentication of the call. It refreshes an access token that expires within 5 minutes with the stored refresh token, under `CredentialStore.modify`, and the model call uses the new access token.
- The refresh store writes the refreshed value inside `modify` through `replaceServerCopy`, in place at the same revision. `replaceServerCopy` uses `applyReport`, the digest rule of a [refresh report](custody.impl.md#the-credential-handover). A refresh adds no revision.
- The workbench credential store and the refresh store share `replaceServerCopy`. It refuses a revision that a live execution pins at the write. It logs `credential refresh stale` when the stored value changed, and then it writes nothing.
- Custody holds one in-process lock for each credential revision. Both stores run `CredentialStore.modify` under it, so pi-ai refreshes a revision once. A second check reads the new value under the lock and refreshes nothing.
- The lock is also the registry of refreshes in flight. A server placement handover of a revision with a refresh in flight refuses inside its transaction with `CredentialRefreshInFlight`. The Worker Service handler waits until the refresh ends and runs the handover again. A wait past the 30 s handover timeout answers 504 `gateway.invocation.timeout`.
- A write that custody refuses after a refresh fails the pi call. The healthcheck and the verify answer `unknown` with `unreachable`, the provider check answers `unreachable`, and the model check answers `unavailable`.
- Custody gives no refresh store when a live execution pins the revision, because the execution holds the refresh token. An access token that expires within 5 minutes then answers `unauthorized` without a remote call.
- A check without a refresh store gives pi-ai a frozen store. Its `modify` answers the stored value and never calls the refresh, so the check never refreshes, also when the token enters the window between two model calls.
- The redaction list of a check holds every credential that the refresh returns, also when the write fails.
- A failed refresh, for example a revoked refresh token, answers `unauthorized`. The stored value does not change. The log of the healthcheck, the verify and the provider check names the reason `access token refresh failed`. The log of the model check names the reason `The access token refresh failed.`
- The check of an instance copy runs on the instance with no refresh store, by [the health of an instance copy](#the-health-of-an-instance-copy). The instance refreshes its own copy only in an execution.
- The `github-copilot` check sends the stored GitHub token and refreshes nothing.
- The rule adds no error code.

## Tests

- Tests assert the platform list against the platform table, and the refusal of a platform of another component.
- Tests assert the secret shape of each platform, the entry method of each shape, metadata schemas, model defaults, fixed base URL and a `base_url` change at rotation alone.
- Tests cover a model removal with dependents and concurrent changes.
- Tests cover the check of every LLM provider, its `connection` mapping, the healthcheck status mapping, expired OAuth and forbidden calls.
- Tests cover the OAuth refresh of a check for the healthcheck, the verify, the provider check and the model check: a refresh through pi-ai written in place, a failed refresh, and a revision that a live execution pins. Tests cover the instance copy check inside the refresh window. The tests fake the network and make no remote call.
- Tests assert that a refused model call maps 401 and 403 to `unauthorized` through the status in `errorMessage`.
- Tests assert that `LLM_PROVIDERS` and `verifiable` agree, and that `llm.provider.check` refuses a platform without a check.
- Tests cover the model check: the tool round trip, a reply without a tool call, each provider failure code, redaction of the secrets, an unknown model, an unsupported reasoning effort, an OAuth access token inside the refresh window and the `openai-compatible` runtime path.
- Tests cover login completion, manual code, conflicting sessions and expiry without stored material.
- A test runs the built-in pi-ai GitHub Copilot provider offline to its first prompt and asserts the enterprise-domain placeholder.
- Tests cover the metadata map of the model connector for each platform with metadata, and each refusal reason of `worker.runtime.setup_refused`.
- Tests cover a human create for several holders, a sealed create of an instance and each refusal of an instance caller. They also cover `llm.credential.instance_unknown` and an `openai-compatible` instance copy with typed model ids.
- Tests cover an instance login in each allowed mode with a fake pi-ai flow, a refused browser mode, `credential.login.instance_unavailable` and an expiry that stores nothing.
- Tests cover a login after a key rotation (revision 2 live), a login after a revoked revision (the next revision), a live current copy (409 `credential.name.conflict`), an archived copy (409 `credential.credential.archived`) and a copy that turns current during the session.
- Tests cover `llm.credential.report` and each refusal, `llm.credential.sealed`, the counter of each write, the healthcheck of an instance copy with no release, and `unknown` after a server restart.
- A test runs a live instance against the server with a fake provider check: a bad key shows `unhealthy` with the report time on `worker.instance.get`, and a rotation shows `healthy` after the next check.
