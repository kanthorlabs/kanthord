# Manage LLM credentials

[Reference index](../README.md)

## Function description

An LLM credential is a named, revisioned secret for one LLM platform. The LLM component owns these routes. Custody encrypts the secret and keeps every revision row. A credential belongs to no project.

No answer contains a secret, a ciphertext or an authentication header. Every command accepts a human bearer JWT. `create`, `rotate`, `list` and `get` also accept the worker token of a worker instance; see [Instance copies](#instance-copies). To start an OAuth credential, use the [subscription login flow](login.md). To check a stored credential against its provider and read its models, use [the provider check](provider.md).

### Credential names

A credential name has 1 to 63 characters. The first character is a lower-case letter. The other characters are lower-case letters, digits or hyphens. The names `login`, `platform`, `check` and `ssh` are reserved. A name stays taken after an archive.

A name whose platform belongs to another component, for example a repository credential, answers as an unknown name.

### Platforms

Each platform has one secret shape, an optional metadata schema, and an optional LLM provider. A platform with a provider is `verifiable`.

| Platform                 | Secret shape | Metadata                     | Capability           | Verifiable |
| ------------------------ | ------------ | ---------------------------- | -------------------- | ---------- |
| `github-copilot`         | `oauth`      | `null`                       | `copilot token read` | Yes        |
| `openai-codex`           | `oauth`      | `null`                       | `model call`         | Yes        |
| `anthropic-subscription` | `oauth`      | `null`                       | `model call`         | Yes        |
| `anthropic`              | `api_key`    | `null`                       | `model-list read`    | Yes        |
| `openai-compatible`      | `api_key`    | `{ base_url, models }`       | `model-list read`    | Yes        |
| `openrouter`             | `api_key`    | `null`                       | `key read`           | Yes        |
| `openai`                 | `api_key`    | `null`                       | `model-list read`    | Yes        |
| `opencode-go`            | `api_key`    | `null`                       | `model call`         | Yes        |
| `amazon-bedrock`         | `api_key`    | `{ region }`                 | `none`               | No         |
| `google-vertex`          | `api_key`    | `{ project, location }`      | `none`               | No         |
| `azure`                  | `api_key`    | `{ resource_name }`          | `none`               | No         |
| `cloudflare-workers-ai`  | `api_key`    | `{ account_id }`             | `none`               | No         |
| `cloudflare-ai-gateway`  | `api_key`    | `{ account_id, gateway_id }` | `none`               | No         |

The other platforms have the secret shape `api_key`, metadata `null`, capability `none`, and no provider: `ant-ling`, `google`, `radius`, `nvidia`, `deepseek`, `xai`, `groq`, `cerebras`, `vercel-ai-gateway`, `zai`, `zai-coding-cn`, `mistral`, `minimax`, `minimax-cn`, `moonshotai`, `moonshotai-cn`, `huggingface`, `fireworks`, `together`, `baseten`, `opencode`, `kimi-coding`, `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, `xiaomi`, `xiaomi-token-plan-cn`, `xiaomi-token-plan-ams`, `xiaomi-token-plan-sgp`, `meta` and `typesafe`.

Every metadata field is a nonblank string, except `openai-compatible.models`. Metadata objects are closed. A platform without metadata requires the explicit value `null`.

The `api_key` secret is `{ "key": "<api-key>" }`. The `oauth` secret is `{ "refresh": "<refresh-token>", "access": "<access-token>", "expires": <unix-ms> }`. The `key` is nonblank. Both secrets must contain well-formed Unicode. The normalized secret must fit in 48,914 UTF-8 bytes.

For `openai-compatible`:

- `base_url` uses `http` or `https`, and has no query, no fragment and no trailing slash.
- `models` is an array of approved models with unique `id` values. It must be `[]` at the creation of the `server` copy.
- For a name with several copies, an agent provider offers only the models that every copy approves.
- Each model has a nonblank `id`. The optional `context_window` and `max_tokens` are positive integers, with defaults `128000` and `16384`.
- `max_tokens` must not exceed `context_window`. The optional `reasoning_levels` holds values from `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. The default is `["off"]`.
- A metadata update cannot change `base_url`. A rotation can set a new `base_url`.
- An update or a rotation cannot remove a model that an agent enablement names.

### Revisions

Each create, rotate and metadata update inserts the next revision number of one copy. The newest live revision of a copy is its current revision. A revision with `ended_at` set is ended.

A rotation and a revoke end every older live revision of the copy that no live execution pins. A `get` and a `list` do the same drain before they answer. A metadata update keeps older revisions live until a drain or a revoke ends them.

### Instance copies

A credential name holds one copy for each holder. A holder is `server` or the name of a worker instance. Each copy has its own revisions, its own [cooldown](../agent/cooldown.md) and its own archive. Every copy of a name holds the same platform. `create` and `rotate` take an instance copy only for a platform with the secret shape `api_key`. An instance copy of an `oauth` platform comes from a [login on the instance](login.md#login-on-a-worker-instance).

The server never opens an instance copy. It stores the copy as an object sealed to the X25519 key of the instance. Only the worker of that instance opens it. A worker binding at the `worker` placement receives only the copy of its own instance; see [the handover](../worker/handover.md).

A human adds an instance copy with `holders` in the `create` body, or with the query `holder` of `rotate`. The server seals the secret to the current key of each instance. A worker token sends `holder`, `sealed` and `sealed_to` in place of `secret`, so the server never receives the plaintext. A worker token reads and writes only the copies of its own instance.

`sealed_current` is `false` for a copy that is sealed to an older key of its instance. Rotate the copy to seal it to the current key. The archive of a worker instance archives every copy that the instance holds.

`verify`, the [provider check](provider.md) and the [model check](model.md) read only the `server` copy. A name that has live instance copies and no live `server` copy answers `409 credential.credential.held_by_instance`. The [resource healthcheck](../gateway/healthcheck.md) reports an agent provider of such a name as `unknown` with the `failure_reason` `held_by_instance`.

### Health of an instance copy

The server never calls the provider with the key of an instance copy. The worker instance checks each of its own copies and reports the result:

1. The instance checks its copies after its first heartbeat, and again when the `credential_version` of a [heartbeat answer](../worker/instance.md#workerinstanceheartbeat) changes.
2. It lists its copies with `list` under its worker token. For each live copy that is sealed to its current key, it reads the sealed object with `llm.credential.sealed` and opens it with its own key.
3. It runs the check of the platform with a 10-second deadline, with the status rules of [the check answer](#check-and-verify-answer).
4. It sends the result with `llm.credential.report`.

The server keeps the last report of each copy in memory. [`worker instance get`](../worker/instance.md#worker-instance-get) shows it in `credentials[].health`, and the instance page of the dashboard shows it as the health line of the copy. A server restart clears every report, so each copy shows `unknown` until the next report of its instance.

`credential_version` starts at the server start time in Unix milliseconds, so each server start gives a new value. These writes of a copy of the instance each add `1`:

- a create, a rotation, a metadata edit, a revoke or an archive;
- the completion of a login on the instance;
- a refresh of an OAuth copy by the instance during an execution.

### Cooldowns

A provider failure with the code `rate_limited`, `unavailable` or `quota_exhausted` puts one copy of the credential into a cooldown. The credential answer carries no cooldown. Read it with [`agent cooldown list`](../agent/cooldown.md). The **Cooldown** section of the LLM credential page in the dashboard shows the same hold. Clear it with [`agent cooldown clear`](../agent/cooldown.md#cooldown-clear).

### Commands

- `list` returns one page of credential copies in ascending name order, then in ascending holder order. By default it leaves out archived copies. Without the query `holder`, a human lists every copy, and a worker token lists the copies of its instance.
- `get` returns one copy, all its revisions, and the agent providers that name the credential. The holder defaults to `server` for a human and to its own instance for a worker token.
- `platforms` returns the platform table above. It reads no credential.
- `create` stores a credential with an `api_key` secret as revision 1 of each copy. It makes no remote call. An `oauth` platform requires the [login flow](login.md). A create of a name that another holder holds adds a copy with the same platform.
- `rotate` stores a new secret as the next revision of one copy. An absent `metadata` copies the metadata of the current revision.
- `update-metadata` stores a complete metadata replacement as the next revision of one copy. It copies the secret or the sealed object of the current revision.
- `revoke` ends one older live revision of one copy at once. A live execution that pins that revision fails at its next use of the credential.
- `archive` ends every live revision of one copy. An archive is final. An agent provider, a worker binding or an inbound that names the credential blocks the archive of the `server` copy. A worker binding that lists the instance blocks the archive of an instance copy when an agent of its worker has an agent provider that names the credential.
- `check` tests a typed secret against its platform before a `create`. It stores nothing. It accepts only `verifiable` platforms with the secret shape `api_key`.
- `verify` tests the current revision of a stored credential. It stores no result, only a refreshed OAuth value. It accepts every `verifiable` platform.

`check` and `verify` run the provider check of the platform with a 10-second deadline. The connection result maps to a status: `ok` to `healthy`, `unauthorized` to `unhealthy`, and `unreachable` or `invalid_response` to `unknown`. A check that exceeds its deadline answers `unknown` with the failure reason `deadline_exceeded`. `verify` refreshes an OAuth access token by the [OAuth refresh](#oauth-refresh). The `github-copilot` check sends the stored GitHub token and ignores the stored expiry, so the remote decides.

### OAuth refresh

The health report, `verify`, [`llm provider check`](provider.md) and [`llm model check`](model.md) run on the `server` copy of a credential. For `openai-codex` and `anthropic-subscription`, they follow one rule:

- pi-ai refreshes the access token with the stored refresh token when the token expires within 5 minutes. The model call then uses the new access token.
- The server writes the refreshed value in place at the same revision. The refresh adds no revision.
- The server runs one refresh of a revision at a time. A second check waits and uses the new access token.
- When a live execution pins the revision before the refresh starts, the check does not refresh. This also applies to a pin that commits after the check reads the credential. An access token that expires within 5 minutes then answers `unauthorized`, without a remote call.
- A failed refresh, for example a revoked refresh token, answers `unauthorized`. The stored value does not change.
- The server tests the pin again at the write. A handover waits for a refresh in flight, so this test is a guard. When the guard refuses the write, `verify` answers `unknown` with `unreachable`, and the stored value does not change.
- In server and container placements, a handover to an execution waits until a refresh of its revision ends, and then hands over the new value. When the refresh does not end in the wait, the handover answers 503 [`worker.handover.refresh_in_flight`](../worker/handover.md), and the worker retries it.
- The check of an instance copy never refreshes. An access token that expires within 5 minutes answers `unauthorized`, without a remote call.

## Expected response

Every API call returns HTTP `200` with JSON. The CLI writes one JSON line to stdout and exits `0`. Mutation commands add `idempotency_key` to the object. The examples below are formatted.

### Credential answer

`create`, `rotate`, `update-metadata`, `revoke` and `archive` return a credential answer of one copy. `get` adds `agent_providers`. A `create` with several `holders` answers the copy of the first holder.

```json
{
  "name": "team-openai",
  "platform": "openai",
  "holder": "server",
  "sealed_to": null,
  "sealed_current": true,
  "revisions": [
    {
      "id": "credential_01K6ZB3Q8X2M4N5P6R7S8T9V0W",
      "revision": 2,
      "metadata": null,
      "created_at": 1791417600000,
      "ended_at": null
    },
    {
      "id": "credential_01K6Z9V4D1E2F3G4H5J6K7M8N9",
      "revision": 1,
      "metadata": null,
      "created_at": 1791331200000,
      "ended_at": 1791417600000
    }
  ],
  "agent_providers": [{ "agent": "swe@1", "name": "default" }],
  "idempotency_key": "idempotency_key_01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property                 | Type                            | Surface               | Purpose                                                                                                                  |
| ------------------------ | ------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `name`                   | string                          | API and CLI           | Credential name.                                                                                                         |
| `platform`               | string                          | API and CLI           | Platform of the credential; it never changes.                                                                            |
| `holder`                 | string                          | API and CLI           | `server`, or the name of the worker instance of the copy.                                                                |
| `sealed_to`              | string or `null`                | API and CLI           | Key fingerprint that the copy is sealed to; `null` for `server`.                                                         |
| `sealed_current`         | boolean                         | API and CLI           | `true` when the copy is live and `sealed_to` is the current key fingerprint of the instance; always `true` for `server`. |
| `revisions`              | array                           | API and CLI           | Every revision of the copy, newest first.                                                                                |
| `revisions[].id`         | `credential_<ulid>`             | API and CLI           | [Identity](../identities.md) of the revision row.                                                                        |
| `revisions[].revision`   | positive integer                | API and CLI           | Revision number.                                                                                                         |
| `revisions[].metadata`   | object or `null`                | API and CLI           | Metadata of the revision.                                                                                                |
| `revisions[].created_at` | integer                         | API and CLI           | Creation time in Unix milliseconds.                                                                                      |
| `revisions[].ended_at`   | integer or `null`               | API and CLI           | End time in Unix milliseconds; `null` for a live revision.                                                               |
| `agent_providers`        | array of `{agent, name}`        | `get` only            | Agent providers that name the credential.                                                                                |
| `idempotency_key`        | `idempotency_key_<ulid>` string | CLI mutation commands | Key of the request; keep it for a retry.                                                                                 |

### List answer

```json
{
  "items": [
    {
      "name": "team-openai",
      "platform": "openai",
      "holder": "builder-1",
      "sealed_to": "SHA256:<43-base64-characters>",
      "sealed_current": true,
      "revisions": [
        {
          "id": "credential_01K6ZB3Q8X2M4N5P6R7S8T9V0W",
          "revision": 2,
          "metadata": null,
          "created_at": 1791417600000,
          "ended_at": null
        }
      ]
    }
  ],
  "next_cursor": "dGVhbS1vcGVuYWk"
}
```

| Property      | Type             | Purpose                                                                                                     |
| ------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `items`       | array            | Credential answers of the copies, in ascending name order, then in holder order, without `agent_providers`. |
| `next_cursor` | string or `null` | Cursor of the next page; `null` on the last page.                                                           |

The CLI fetches no further page.

### Platform list answer

```json
{
  "items": [
    {
      "platform": "openai-compatible",
      "secret_shape": "api_key",
      "login_modes": [],
      "metadata_fields": ["base_url"],
      "verifiable": true
    }
  ]
}
```

| Property                  | Type             | Purpose                                                                        |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `items[].platform`        | string           | Platform name.                                                                 |
| `items[].secret_shape`    | string           | `api_key` or `oauth`.                                                          |
| `items[].login_modes`     | array of strings | Login modes: `browser`, `device`, `copy_code`; `[]` for an `api_key` platform. |
| `items[].metadata_fields` | array of strings | Names of the string fields of the metadata schema.                             |
| `items[].verifiable`      | boolean          | `true` when the platform has an LLM provider.                                  |

### Check and verify answer

```json
{ "status": "healthy", "capability": "model-list read", "failure_reason": null }
```

```json
{
  "status": "unhealthy",
  "capability": "model-list read",
  "failure_reason": "unauthorized"
}
```

| Property         | Type             | Purpose                                                                                    |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `status`         | string           | `healthy`, `unhealthy` or `unknown`.                                                       |
| `capability`     | string           | Capability of the platform check, as in the health report.                                 |
| `failure_reason` | string or `null` | `null` for a `healthy` answer only. Every other answer carries a value of the table below. |

| `failure_reason`    | Cause                                                                                                                                                                                          | Status      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `unauthorized`      | The provider answered `401`, the [OAuth refresh](#oauth-refresh) failed, or an `openai-codex` or `anthropic-subscription` access token that the check cannot refresh expires within 5 minutes. | `unhealthy` |
| `forbidden`         | The provider answered `403`.                                                                                                                                                                   | `unhealthy` |
| `rate_limited`      | The provider answered `429`.                                                                                                                                                                   | `unknown`   |
| `invalid_response`  | The provider answered another status or a redirect, or a model list that the check cannot read.                                                                                                | `unknown`   |
| `unreachable`       | The request failed before an HTTP answer, or a failed model call carries no HTTP status.                                                                                                       | `unknown`   |
| `deadline_exceeded` | The check exceeded its 10-second deadline.                                                                                                                                                     | `unknown`   |
| `unclassified`      | Any other failure.                                                                                                                                                                             | `unknown`   |

The answer holds no remote text. The server log record `credential verify failed` or `credential check failed` keeps the redacted remote text under `reason`.

The dashboard shows a hint under a check result that carries a `failure_reason`. The hint texts of this component:

| `failure_reason`    | Hint                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`      | The provider refused the API key or the access token. Correct the key, or sign in again for a new token. Then verify again.                                                                                 |
| `forbidden`         | The provider accepted the key or the token but refused the access. Check the permissions and the plan of the account.                                                                                       |
| `rate_limited`      | The provider limited the requests. Wait some minutes, or check the quota of the plan. Then verify again.                                                                                                    |
| `unreachable`       | The server cannot reach the provider. Check the network of the server and the base URL of an openai-compatible credential. For an OAuth platform, sign in again.                                            |
| `invalid_response`  | The provider sent an answer that the check does not expect, for example a server error. Verify again later. For an openai-compatible credential, check that the base URL points to the API of the provider. |
| `deadline_exceeded` | The remote host or service did not answer before the deadline. Verify again. If the failure stays, check the network of the server.                                                                         |
| `unclassified`      | The check failed for an unknown cause. Verify again. If the failure stays, read the server log.                                                                                                             |

A value with no hint shows "The check failed with the reason <value>. Verify again. If the failure stays, read the server log."

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). Every command can answer these shared failures:

| HTTP status / code                           | Meaning                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Absent, invalid, expired or banned token, or a machine token. A worker token also fails, except on `create`, `rotate`, `list` and `get`. |
| `400 gateway.request.validation_failed`      | Params, query or body do not match the operation schema.                                                                                 |
| `400 gateway.request.invalid_json`           | The request body is not valid JSON.                                                                                                      |
| `400 gateway.request.unexpected_body`        | A route without a body received one.                                                                                                     |
| `413 gateway.request.body_too_large`         | The body exceeds the route limit.                                                                                                        |
| `415 gateway.request.unsupported_media_type` | A route with a body received no `application/json` content type.                                                                         |
| `504 gateway.invocation.timeout`             | The 30-second operation timeout expired; a mutation can still complete.                                                                  |
| `400 gateway.idempotency.invalid_key`        | Mutations only: absent or malformed `Idempotency-Key`.                                                                                   |
| `409 gateway.idempotency.conflict`           | Mutations only: the key is in progress or names a different request.                                                                     |

Command failures:

| HTTP status / code                           | Commands                                                | Meaning                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 system.pagination.cursor_invalid`       | `list`                                                  | The cursor is malformed.                                                                                                                                                                           |
| `400 credential.input.invalid`               | `create`, `rotate`, `update-metadata`, `check`          | Invalid or reserved name, invalid secret, invalid metadata, or nonempty `models` at the creation of the `server` copy. Also a repeated holder, or a body with the fields of the other caller kind. |
| `400 credential.platform.unsupported`        | `create`, `check`                                       | The platform is not an LLM platform.                                                                                                                                                               |
| `400 credential.entry.unsupported`           | `create`                                                | The platform has the secret shape `oauth`.                                                                                                                                                         |
| `400 credential.check.unsupported`           | `check`, `verify`                                       | The platform is not `verifiable`; for `check`, also an `oauth` platform.                                                                                                                           |
| `400 credential.sealed.invalid`              | `create`, `rotate`                                      | The sealed object fails its form or its size limit, or `sealed_to` is not the current key fingerprint of the instance.                                                                             |
| `400 llm.credential.instance_unknown`        | `create`, `rotate`                                      | A holder of a human request names no live worker instance. `details.holder` holds the name.                                                                                                        |
| `403 llm.credential.instance_forbidden`      | `create`, `rotate`, `list`, `get`                       | A worker token names a copy of another holder, or its instance is not live.                                                                                                                        |
| `404 credential.credential.not_found`        | `get`, `rotate`, `update-metadata`, `archive`, `verify` | Unknown name, a name of another component, or no live revision of the copy.                                                                                                                        |
| `404 credential.revision.not_found`          | `revoke`                                                | The copy has no such revision, or the name is unknown.                                                                                                                                             |
| `409 credential.name.conflict`               | `create`                                                | The holder already holds a copy of the name. `details.id` holds the identity of its newest revision.                                                                                               |
| `409 credential.name.platform_conflict`      | `create`                                                | Another copy of the name holds another platform. `details.platform` holds that platform.                                                                                                           |
| `409 credential.credential.held_by_instance` | `verify`                                                | The name has live instance copies and no live `server` copy.                                                                                                                                       |
| `409 credential.revision.conflict`           | `rotate`, `update-metadata`                             | `expected_revision` is not the current revision. `details.revision` holds the current one.                                                                                                         |
| `409 credential.credential.archived`         | `rotate`, `update-metadata`, `archive`, `verify`        | The credential is archived.                                                                                                                                                                        |
| `409 credential.revision.ended`              | `revoke`                                                | The revision is already ended.                                                                                                                                                                     |
| `409 credential.revision.newest_live`        | `revoke`                                                | No later live revision exists.                                                                                                                                                                     |
| `409 credential.credential.in_use`           | `archive`                                               | A dependent names the credential. See the details below.                                                                                                                                           |
| `409 llm.metadata.base_url_fixed`            | `update-metadata`                                       | The update changes `openai-compatible.base_url`.                                                                                                                                                   |
| `409 llm.metadata.model_in_use`              | `rotate`, `update-metadata`                             | A removed model has agent enablements. `details.models` holds `[{ model, agents }]`.                                                                                                               |

The `credential.credential.in_use` details are `{ agent_providers: [{ agent_name, provider_name }], bindings: [{ binding_id, project_id }], inbounds: [{ inbound_id }] }`. For an instance copy, `agent_providers` and `inbounds` are `[]`, and `bindings` lists the worker bindings that block the archive.

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr. A mutation command prints `<code>: request failed` and the rows `status: <status>` and `idempotency_key: <key>` instead. A transport failure, timeout or malformed response exits `1` with `cli.llm.credential.<command>.indeterminate`. For a mutation, the diagnostic names the key for a retry. There is no automatic retry.

Local CLI failures exit `1` before a request:

| Code                                                                 | Commands                                       | Meaning                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `cli.llm.credential.<command>.token_required`                        | All                                            | No nonblank token resolves.                                                                               |
| `cli.pagination.limit_invalid`                                       | `list`                                         | `--limit` is not a positive integer.                                                                      |
| `cli.pagination.limit_out_of_range`                                  | `list`                                         | `--limit` is greater than `1000`.                                                                         |
| `cli.llm.credential.revoke.invalid_revision`                         | `revoke`                                       | `<revision>` is not a positive safe integer.                                                              |
| `cli.idempotency_key.invalid`                                        | Mutation commands                              | `--idempotency-key` is not an `idempotency_key_<ulid>` value.                                             |
| `cli.option.duplicate`                                               | All                                            | A single-use option appears twice.                                                                        |
| `cli.file.invalid_path`                                              | `create`, `rotate`, `update-metadata`, `check` | The path is `-`; stdin is not accepted.                                                                   |
| `cli.file.not_found`, `cli.file.not_regular`                         | `create`, `rotate`, `update-metadata`, `check` | The file is absent or is not a regular file.                                                              |
| `system.files.invalid_permissions`                                   | `create`, `rotate`, `check`                    | The secret file is not owned by the user or its mode is not `0600`.                                       |
| `system.files.open_failed`                                           | `create`, `rotate`, `check`                    | The secret file cannot be opened, for example a symbolic link.                                            |
| `cli.file.encoding_invalid`                                          | `update-metadata`                              | The file is not valid UTF-8.                                                                              |
| `cli.file.not_json`, `cli.file.duplicate_key`, `cli.file.not_object` | `create`, `rotate`, `update-metadata`, `check` | The file is not one JSON object with unique keys.                                                         |
| `cli.file.schema_invalid`                                            | `create`, `rotate`, `update-metadata`, `check` | The object does not match the request body schema. The `details` row lists each issue path and code only. |

A local seal of `create` or `rotate` with `--holder` exits `1` with `cli.llm.credential.secret_invalid` when the secret is not an `api_key` object within 32,768 bytes. The CLI checks it after the token exchange and before the write.

## API shape

`create`, `rotate`, `list` and `get` use the access `human_or_worker`: `Authorization: Bearer <human-jwt>`, or the worker token of a worker instance. The other operations use human access with `Authorization: Bearer <human-jwt>`. Every operation has a 30-second timeout. Mutations require an `Idempotency-Key` header with a fresh `idempotency_key_<ulid>`. A retry with the same key, caller and request replays the recorded answer within the process-local [idempotency TTL](../config/show.md). A recorded failure replays too.

| Command           | Method and path                                                       | Operation ID                     | Mutation | Body limit |
| ----------------- | --------------------------------------------------------------------- | -------------------------------- | -------- | ---------- |
| `list`            | `GET /api/llm/credential`                                             | `llm.credential.list`            | No       | No body    |
| `get`             | `GET /api/llm/credential/:credential_name`                            | `llm.credential.get`             | No       | No body    |
| `platforms`       | `GET /api/llm/credential/platform`                                    | `llm.credential.platform_list`   | No       | No body    |
| `create`          | `POST /api/llm/credential`                                            | `llm.credential.create`          | Yes      | 64 KiB     |
| `rotate`          | `POST /api/llm/credential/:credential_name/revision`                  | `llm.credential.rotate`          | Yes      | 64 KiB     |
| `update-metadata` | `PUT /api/llm/credential/:credential_name/metadata`                   | `llm.credential.update_metadata` | Yes      | 16 KiB     |
| `revoke`          | `POST /api/llm/credential/:credential_name/revision/:revision/revoke` | `llm.credential.revoke`          | Yes      | No body    |
| `archive`         | `POST /api/llm/credential/:credential_name/archive`                   | `llm.credential.archive`         | Yes      | No body    |
| `check`           | `POST /api/llm/credential/check`                                      | `llm.credential.check`           | No       | 64 KiB     |
| `verify`          | `POST /api/llm/credential/:credential_name/verify`                    | `llm.credential.verify`          | No       | No body    |
| none              | `GET /api/llm/credential/:credential_name/sealed`                     | `llm.credential.sealed`          | No       | No body    |
| none              | `POST /api/llm/credential/:credential_name/report`                    | `llm.credential.report`          | Yes      | 1 MiB      |

| Header            | Required           | Purpose                                                                       |
| ----------------- | ------------------ | ----------------------------------------------------------------------------- |
| `Authorization`   | Yes                | `Bearer <human-jwt>`, or `Bearer <worker-token>` where the access permits it. |
| `Content-Type`    | Routes with a body | `application/json`.                                                           |
| `Idempotency-Key` | Mutations          | Fresh `idempotency_key_<ulid>` for a new request; reuse it only for a retry.  |

Request objects are closed: an unknown field fails validation.

`llm.credential.sealed` and `llm.credential.report` use `worker` access. Only a worker instance calls them, for its own copy of the name. No CLI command calls them.

`llm.credential.sealed` answers `{ name, platform, revision, metadata, sealed }` for the newest live revision of the copy, with the header `Cache-Control: no-store`. `sealed` is the sealed object that only the key of the instance opens. A copy that is absent or sealed to an ended key answers `404 credential.credential.not_found`.

`llm.credential.report` takes this body and answers `204`:

| Field            | Type           | Value                                                                                            |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `revision`       | integer        | The newest live revision of the copy.                                                            |
| `status`         | string         | `healthy`, `unhealthy` or `unknown`.                                                             |
| `capability`     | string         | The capability of the platform, as in [the check answer](#check-and-verify-answer).              |
| `failure_reason` | string or null | `null` for `healthy` only. Otherwise a value of [the failure reasons](#check-and-verify-answer). |
| `models`         | array or null  | At most 512 `{ id, owned_by, created }` items of a check that reads a model list, else `null`.   |

| HTTP status / code                    | Meaning                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `404 credential.credential.not_found` | The instance holds no live copy of the name, or the copy is sealed to an ended key.                                                      |
| `409 credential.revision.conflict`    | `revision` is not the newest live revision. `details.revision` holds it.                                                                 |
| `400 credential.input.invalid`        | `failure_reason` does not match `status`, `failure_reason` is `held_by_instance`, or `capability` is not the capability of the platform. |

### list

| Parameter          | In    | Required | Value                                        |
| ------------------ | ----- | -------- | -------------------------------------------- |
| `platform`         | query | No       | Platform filter.                             |
| `include_archived` | query | No       | `true` or `false`; default `false`.          |
| `limit`            | query | No       | Integer from `1` to `1000`; default `100`.   |
| `cursor`           | query | No       | `next_cursor` of the previous page.          |
| `holder`           | query | No       | Holder filter: `server` or an instance name. |

```sh
curl -i 'http://127.0.0.1:31415/api/llm/credential?platform=openai&limit=50' \
  -H 'Authorization: Bearer <human-jwt>'
```

### get

The path parameter `credential_name` is required. The optional query `holder` selects the copy.

```sh
curl -i http://127.0.0.1:31415/api/llm/credential/team-openai \
  -H 'Authorization: Bearer <human-jwt>'
```

### platforms

There are no parameters.

```sh
curl -i http://127.0.0.1:31415/api/llm/credential/platform \
  -H 'Authorization: Bearer <human-jwt>'
```

### create

A human sends `{ name, platform, metadata, secret, holders? }`. `holders` is a nonempty list of unique holders, and its default is `["server"]`. The server seals the secret to the current key of each instance in `holders`.

A worker token sends `{ name, platform, metadata, holder, sealed, sealed_to }`. `holder` is the name of its own instance. `sealed` is the secret sealed to the key of the instance, and `sealed_to` is the fingerprint of that key.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"name":"team-openai","platform":"openai","metadata":null,"secret":{"key":"<api-key>"},"holders":["server","builder-1"]}'
```

### rotate

The path parameter `credential_name` is required. A human sends `{ expected_revision, secret, metadata? }`. `expected_revision` is the current revision number of the copy. The secret matches the secret shape of the platform. The optional query `holder` selects the copy, and its default is `server`. For an instance holder, the server seals the secret to the current key of the instance.

A worker token sends `{ expected_revision, holder, sealed, sealed_to, metadata? }` for the copy of its own instance. A query `holder` must name the same instance.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/revision \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"expected_revision":1,"secret":{"key":"<new-api-key>"}}'
```

### update-metadata

The path parameter `credential_name` is required. The body is `{ expected_revision, metadata }`, and `metadata` is a complete replacement. The optional query `holder` selects the copy, and its default is `server`.

```sh
curl -i -X PUT http://127.0.0.1:31415/api/llm/credential/local-vllm/metadata \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"expected_revision":1,"metadata":{"base_url":"http://10.0.0.5:8000/v1","models":[{"id":"qwen3-coder","max_tokens":8192}]}}'
```

### revoke

The path parameters `credential_name` and `revision` are required. `revision` is a positive integer. The optional query `holder` selects the copy, and its default is `server`.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/revision/1/revoke \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST'
```

### archive

The path parameter `credential_name` is required. The optional query `holder` selects the copy, and its default is `server`.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/archive \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST'
```

### check

The body is `{ platform, metadata, secret }`, the `create` body without `name`. The operation is not a mutation and takes no `Idempotency-Key`.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"platform":"anthropic","metadata":null,"secret":{"key":"<api-key>"}}'
```

### verify

The path parameter `credential_name` is required. The operation is not a mutation and takes no `Idempotency-Key`.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/verify \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord llm credential list [--platform <platform>] [--holder <name>] [--include-archived] [--limit <count>] [--cursor <cursor>]
kanthord llm credential get <credential-name> [--holder <name>]
kanthord llm credential platforms
kanthord llm credential create --file <path> [--holder <name>] [--idempotency-key <key>]
kanthord llm credential rotate <credential-name> --file <path> [--holder <name>] [--idempotency-key <key>]
kanthord llm credential update-metadata <credential-name> --file <path> [--holder <name>] [--idempotency-key <key>]
kanthord llm credential revoke <credential-name> <revision> [--holder <name>] [--idempotency-key <key>]
kanthord llm credential archive <credential-name> [--holder <name>] [--idempotency-key <key>]
kanthord llm credential check --file <path>
kanthord llm credential verify <credential-name>
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord llm credential platforms
kanthord llm credential create --file ./team-openai.json
kanthord llm credential list --platform openai --limit 50
kanthord llm credential rotate team-openai --file ./team-openai-rotate.json \
  --idempotency-key idempotency_key_01M34JC4BJ66JHP41M4MYY6PST
kanthord llm credential revoke team-openai 1
kanthord llm credential verify team-openai --endpoint http://127.0.0.1:31415
kanthord llm credential create --file ./team-openai.json --holder builder-1
kanthord llm credential get team-openai --holder builder-1
```

An example `create` file, at mode `0600`:

```json
{
  "name": "team-openai",
  "platform": "openai",
  "metadata": null,
  "secret": { "key": "<api-key>" }
}
```

An example `rotate` file, at mode `0600`: `{ "expected_revision": 1, "secret": { "key": "<new-api-key>" } }`. An example `update-metadata` file: `{ "expected_revision": 1, "metadata": { "base_url": "http://10.0.0.5:8000/v1", "models": [] } }`.

| Positional argument | Commands                                                          | Purpose                                      |
| ------------------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `<credential-name>` | `get`, `rotate`, `update-metadata`, `revoke`, `archive`, `verify` | Credential name; sent as the path parameter. |
| `<revision>`        | `revoke`                                                          | Revision number; a positive safe integer.    |

`list`, `platforms`, `create` and `check` take no positional arguments.

| Option                    | Commands                                                                  | Default / resolution                                                        | Purpose                                                                           |
| ------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--token <jwt>`           | All                                                                       | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                                          |
| `--endpoint <url>`        | All                                                                       | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                                  |
| `--platform <platform>`   | `list`                                                                    | No filter                                                                   | Sets the `platform` query.                                                        |
| `--include-archived`      | `list`                                                                    | `false`                                                                     | Sets `include_archived=true`. Without it, the CLI sends `include_archived=false`. |
| `--limit <count>`         | `list`                                                                    | `100`                                                                       | Page size from `1` to `1000`.                                                     |
| `--cursor <cursor>`       | `list`                                                                    | First page                                                                  | Sets the `cursor` query.                                                          |
| `--holder <name>`         | `list`, `get`, `create`, `rotate`, `update-metadata`, `revoke`, `archive` | `server`; `list` lists every copy                                           | Selects the copy: `server` or an instance name. See the local seal below.         |
| `--file <path>`           | `create`, `rotate`, `update-metadata`, `check`                            | Required                                                                    | JSON file that holds the request body.                                            |
| `--idempotency-key <key>` | `create`, `rotate`, `update-metadata`, `revoke`, `archive`                | A generated `idempotency_key_<ulid>`                                        | Sets the `Idempotency-Key` header; supply the same key for a retry.               |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. Each option is single-use. The read commands reject `--idempotency-key` as an unknown option.

The `--file` value must name a regular file; `-` for stdin is rejected. The file holds one JSON object with no duplicate key. The CLI validates it against the body schema before the request. For `create`, `rotate` and `check`, the file is a secret file: it must be owned by the user, have mode `0600`, and not be a symbolic link. The CLI repairs no permission and never prints the secret. The `update-metadata` file uses the ordinary rules and holds no secret.

`--holder` maps to the query `holder` on `list`, `get`, `update-metadata`, `revoke` and `archive`. On `create` and `rotate`, the CLI first looks for the instance file `$XDG_CONFIG_HOME/kanthord/workers/<name>.yaml`. Without `XDG_CONFIG_HOME`, the path is `~/.config/kanthord/workers/<name>.yaml`.

- With the file, the CLI seals the secret locally. It exchanges the instance key for a worker token at the endpoint of the file. It seals to the public key that it derives from the private key of the file, and it trusts no key from the server. It sends `holder`, `sealed` and `sealed_to` in place of `secret` under the worker token, and it ignores `--token` and `--endpoint`. `rotate` first reads the platform of the copy under the worker token.
- Without the file, the CLI sends the plaintext secret under the human token. `create` adds `holders: [<name>]` to the body, and `rotate` adds the query `holder`. The server seals the copy.

The HTTP client has a 31-second deadline for these 30-second operations.
