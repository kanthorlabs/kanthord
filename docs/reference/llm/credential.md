# Manage LLM credentials

[Reference index](../README.md)

## Function description

An LLM credential is a named, revisioned secret for one LLM platform. The LLM component owns these routes. Custody encrypts the secret and keeps every revision row. A credential belongs to no project.

No answer contains a secret, a ciphertext or an authentication header. Every command needs a human bearer JWT. To start an OAuth credential, use the [subscription login flow](login.md). To check a stored credential against its provider and read its models, use [the provider check](provider.md).

### Credential names

A credential name has 1 to 63 characters. The first character is a lower-case letter. The other characters are lower-case letters, digits or hyphens. The names `login`, `platform`, `check` and `ssh` are reserved. A name stays taken after an archive.

A name whose platform belongs to another component, for example a repository credential, answers as an unknown name.

### Platforms

Each platform has one secret shape, an optional metadata schema, and an optional LLM provider. A platform with a provider is `verifiable`.

| Platform                 | Secret shape | Metadata                     | Capability           | Verifiable |
| ------------------------ | ------------ | ---------------------------- | -------------------- | ---------- |
| `github-copilot`         | `oauth`      | `null`                       | `copilot token read` | Yes        |
| `openai-codex`           | `oauth`      | `null`                       | `model call`         | Yes        |
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

The other platforms have the secret shape `api_key`, metadata `null`, capability `none`, and no provider: `ant-ling`, `google`, `radius`, `nvidia`, `deepseek`, `xai`, `groq`, `cerebras`, `vercel-ai-gateway`, `zai`, `zai-coding-cn`, `mistral`, `minimax`, `minimax-cn`, `moonshotai`, `moonshotai-cn`, `huggingface`, `fireworks`, `together`, `baseten`, `opencode`, `kimi-coding`, `qwen-token-plan`, `qwen-token-plan-cn`, `qwen-token-plan-individual`, `xiaomi`, `xiaomi-token-plan-cn`, `xiaomi-token-plan-ams` and `xiaomi-token-plan-sgp`.

Every metadata field is a nonblank string, except `openai-compatible.models`. Metadata objects are closed. A platform without metadata requires the explicit value `null`.

The `api_key` secret is `{ "key": "<api-key>" }`. The `oauth` secret is `{ "refresh": "<refresh-token>", "access": "<access-token>", "expires": <unix-ms> }`. The `key` is nonblank. Both secrets must contain well-formed Unicode. The normalized secret must fit in 48,914 UTF-8 bytes.

For `openai-compatible`:

- `base_url` uses `http` or `https`, and has no query, no fragment and no trailing slash.
- `models` is an array of approved models with unique `id` values. It must be `[]` at creation.
- Each model has a nonblank `id`. The optional `context_window` and `max_tokens` are positive integers, with defaults `128000` and `16384`.
- `max_tokens` must not exceed `context_window`. The optional `reasoning_levels` holds values from `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. The default is `["off"]`.
- A metadata update cannot change `base_url`. A rotation can set a new `base_url`.
- An update or a rotation cannot remove a model that an agent enablement names.

### Revisions

Each create, rotate and metadata update inserts the next revision number. The newest live revision is the current revision. A revision with `ended_at` set is ended.

A rotation and a revoke end every older live revision that no live execution pins. A `get` and a `list` do the same drain before they answer. A metadata update keeps older revisions live until a drain or a revoke ends them.

### Commands

- `list` returns one page of credentials in ascending name order. By default it leaves out archived credentials.
- `get` returns one credential, all its revisions, and the agent providers that name it.
- `platforms` returns the platform table above. It reads no credential.
- `create` stores a credential with an `api_key` secret as revision 1. It makes no remote call. An `oauth` platform requires the [login flow](login.md).
- `rotate` stores a new secret as the next revision. An absent `metadata` copies the metadata of the current revision.
- `update-metadata` stores a complete metadata replacement as the next revision. It copies the secret of the current revision.
- `revoke` ends one older live revision at once. A live execution that pins that revision fails at its next use of the credential.
- `archive` ends every live revision. An archive is final. An agent provider, a worker binding or an inbound that names the credential blocks the archive.
- `check` tests a typed secret against its platform before a `create`. It stores nothing. It accepts only `verifiable` platforms with the secret shape `api_key`.
- `verify` tests the current revision of a stored credential. It stores no result. It accepts every `verifiable` platform.

`check` and `verify` run the provider check of the platform with a 10-second deadline. The connection result maps to a status: `ok` to `healthy`, `unauthorized` to `unhealthy`, and `unreachable` or `invalid_response` to `unknown`. A deadline overrun answers `unknown`. An expired OAuth access token answers `unknown`; no check refreshes OAuth.

## Expected response

Every API call returns HTTP `200` with JSON. The CLI writes one JSON line to stdout and exits `0`. Mutation commands add `idempotency_key` to the object. The examples below are formatted.

### Credential answer

`create`, `rotate`, `update-metadata`, `revoke` and `archive` return a credential answer. `get` adds `agent_providers`.

```json
{
  "name": "team-openai",
  "platform": "openai",
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
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property                 | Type                     | Surface               | Purpose                                                    |
| ------------------------ | ------------------------ | --------------------- | ---------------------------------------------------------- |
| `name`                   | string                   | API and CLI           | Credential name.                                           |
| `platform`               | string                   | API and CLI           | Platform of the credential; it never changes.              |
| `revisions`              | array                    | API and CLI           | Every revision, newest first.                              |
| `revisions[].id`         | `credential_<ulid>`      | API and CLI           | [Identity](../identities.md) of the revision row.          |
| `revisions[].revision`   | positive integer         | API and CLI           | Revision number.                                           |
| `revisions[].metadata`   | object or `null`         | API and CLI           | Metadata of the revision.                                  |
| `revisions[].created_at` | integer                  | API and CLI           | Creation time in Unix milliseconds.                        |
| `revisions[].ended_at`   | integer or `null`        | API and CLI           | End time in Unix milliseconds; `null` for a live revision. |
| `agent_providers`        | array of `{agent, name}` | `get` only            | Agent providers that name the credential.                  |
| `idempotency_key`        | canonical ULID string    | CLI mutation commands | Key of the request; keep it for a retry.                   |

### List answer

```json
{
  "items": [
    {
      "name": "team-openai",
      "platform": "openai",
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

| Property      | Type             | Purpose                                                                 |
| ------------- | ---------------- | ----------------------------------------------------------------------- |
| `items`       | array            | Credential answers, in ascending name order, without `agent_providers`. |
| `next_cursor` | string or `null` | Cursor of the next page; `null` on the last page.                       |

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

| Property                  | Type             | Purpose                                                           |
| ------------------------- | ---------------- | ----------------------------------------------------------------- |
| `items[].platform`        | string           | Platform name.                                                    |
| `items[].secret_shape`    | string           | `api_key` or `oauth`.                                             |
| `items[].login_modes`     | array of strings | Login modes: `browser`, `device`; `[]` for an `api_key` platform. |
| `items[].metadata_fields` | array of strings | Names of the string fields of the metadata schema.                |
| `items[].verifiable`      | boolean          | `true` when the platform has an LLM provider.                     |

### Check and verify answer

```json
{ "status": "healthy", "capability": "model-list read" }
```

| Property     | Type   | Purpose                                                    |
| ------------ | ------ | ---------------------------------------------------------- |
| `status`     | string | `healthy`, `unhealthy` or `unknown`.                       |
| `capability` | string | Capability of the platform check, as in the health report. |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). Every command can answer these shared failures:

| HTTP status / code                           | Meaning                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Absent, invalid, expired or banned token, or a machine token.           |
| `400 gateway.request.validation_failed`      | Params, query or body do not match the operation schema.                |
| `400 gateway.request.invalid_json`           | The request body is not valid JSON.                                     |
| `400 gateway.request.unexpected_body`        | A route without a body received one.                                    |
| `413 gateway.request.body_too_large`         | The body exceeds the route limit.                                       |
| `415 gateway.request.unsupported_media_type` | A route with a body received no `application/json` content type.        |
| `504 gateway.invocation.timeout`             | The 30-second operation timeout expired; a mutation can still complete. |
| `400 gateway.idempotency.invalid_key`        | Mutations only: absent or malformed `Idempotency-Key`.                  |
| `409 gateway.idempotency.conflict`           | Mutations only: the key is in progress or names a different request.    |

Command failures:

| HTTP status / code                     | Commands                                                | Meaning                                                                                       |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `400 system.pagination.cursor_invalid` | `list`                                                  | The cursor is malformed.                                                                      |
| `400 credential.input.invalid`         | `create`, `rotate`, `update-metadata`, `check`          | Invalid or reserved name, invalid secret, invalid metadata, or nonempty `models` at creation. |
| `400 credential.platform.unsupported`  | `create`, `check`                                       | The platform is not an LLM platform.                                                          |
| `400 credential.entry.unsupported`     | `create`                                                | The platform has the secret shape `oauth`.                                                    |
| `400 credential.check.unsupported`     | `check`, `verify`                                       | The platform is not `verifiable`; for `check`, also an `oauth` platform.                      |
| `404 credential.credential.not_found`  | `get`, `rotate`, `update-metadata`, `archive`, `verify` | Unknown name, a name of another component, or no live revision.                               |
| `404 credential.revision.not_found`    | `revoke`                                                | The name has no such revision, or the name is unknown.                                        |
| `409 credential.name.conflict`         | `create`                                                | The name is taken. `details.id` holds the identity of its newest revision.                    |
| `409 credential.revision.conflict`     | `rotate`, `update-metadata`                             | `expected_revision` is not the current revision. `details.revision` holds the current one.    |
| `409 credential.credential.archived`   | `rotate`, `update-metadata`, `archive`, `verify`        | The credential is archived.                                                                   |
| `409 credential.revision.ended`        | `revoke`                                                | The revision is already ended.                                                                |
| `409 credential.revision.newest_live`  | `revoke`                                                | No later live revision exists.                                                                |
| `409 credential.credential.in_use`     | `archive`                                               | A dependent names the credential. See the details below.                                      |
| `409 llm.metadata.base_url_fixed`      | `update-metadata`                                       | The update changes `openai-compatible.base_url`.                                              |
| `409 llm.metadata.model_in_use`        | `rotate`, `update-metadata`                             | A removed model has agent enablements. `details.models` holds `[{ model, agents }]`.          |

The `credential.credential.in_use` details are `{ agent_providers: [{ agent_name, provider_name }], bindings: [{ binding_id, project_id }], inbounds: [{ inbound_id }] }`.

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A mutation command prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. A transport failure, timeout or malformed response exits `1` with `cli.llm.credential.<command>.indeterminate`. For a mutation, the diagnostic names the key for a retry. There is no automatic retry.

Local CLI failures exit `1` before a request:

| Code                                                                 | Commands                                       | Meaning                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `cli.llm.credential.<command>.token_required`                        | All                                            | No nonblank token resolves.                                                                         |
| `cli.pagination.limit_invalid`                                       | `list`                                         | `--limit` is not a positive integer.                                                                |
| `cli.pagination.limit_out_of_range`                                  | `list`                                         | `--limit` is greater than `1000`.                                                                   |
| `cli.llm.credential.revoke.invalid_revision`                         | `revoke`                                       | `<revision>` is not a positive safe integer.                                                        |
| `cli.idempotency_key.invalid`                                        | Mutation commands                              | `--idempotency-key` is not a canonical ULID.                                                        |
| `cli.option.duplicate`                                               | All                                            | A single-use option appears twice.                                                                  |
| `cli.file.invalid_path`                                              | `create`, `rotate`, `update-metadata`, `check` | The path is `-`; stdin is not accepted.                                                             |
| `cli.file.not_found`, `cli.file.not_regular`                         | `create`, `rotate`, `update-metadata`, `check` | The file is absent or is not a regular file.                                                        |
| `system.files.invalid_permissions`                                   | `create`, `rotate`, `check`                    | The secret file is not owned by the user or its mode is not `0600`.                                 |
| `system.files.open_failed`                                           | `create`, `rotate`, `check`                    | The secret file cannot be opened, for example a symbolic link.                                      |
| `cli.file.encoding_invalid`                                          | `update-metadata`                              | The file is not valid UTF-8.                                                                        |
| `cli.file.not_json`, `cli.file.duplicate_key`, `cli.file.not_object` | `create`, `rotate`, `update-metadata`, `check` | The file is not one JSON object with unique keys.                                                   |
| `cli.file.schema_invalid`                                            | `create`, `rotate`, `update-metadata`, `check` | The object does not match the request body schema. The diagnostic lists issue paths and codes only. |

## API shape

Every operation uses human access with `Authorization: Bearer <human-jwt>`. Every operation has a 30-second timeout. Mutations require an `Idempotency-Key` header with a fresh canonical ULID. A retry with the same key, caller and request replays the recorded answer within the process-local [idempotency TTL](../config/show.md). A recorded failure replays too.

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

| Header            | Required           | Purpose                                                            |
| ----------------- | ------------------ | ------------------------------------------------------------------ |
| `Authorization`   | Yes                | `Bearer <human-jwt>`.                                              |
| `Content-Type`    | Routes with a body | `application/json`.                                                |
| `Idempotency-Key` | Mutations          | Fresh canonical ULID for a new request; reuse it only for a retry. |

Request objects are closed: an unknown field fails validation.

### list

| Parameter          | In    | Required | Value                                      |
| ------------------ | ----- | -------- | ------------------------------------------ |
| `platform`         | query | No       | Platform filter.                           |
| `include_archived` | query | No       | `true` or `false`; default `false`.        |
| `limit`            | query | No       | Integer from `1` to `1000`; default `100`. |
| `cursor`           | query | No       | `next_cursor` of the previous page.        |

```sh
curl -i 'http://127.0.0.1:31415/api/llm/credential?platform=openai&limit=50' \
  -H 'Authorization: Bearer <human-jwt>'
```

### get

The path parameter `credential_name` is required.

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

The body is `{ name, platform, metadata, secret }`. All four fields are required.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"name":"team-openai","platform":"openai","metadata":null,"secret":{"key":"<api-key>"}}'
```

### rotate

The path parameter `credential_name` is required. The body is `{ expected_revision, secret, metadata? }`. `expected_revision` is the current revision number. The secret matches the secret shape of the platform.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/revision \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"expected_revision":1,"secret":{"key":"<new-api-key>"}}'
```

### update-metadata

The path parameter `credential_name` is required. The body is `{ expected_revision, metadata }`, and `metadata` is a complete replacement.

```sh
curl -i -X PUT http://127.0.0.1:31415/api/llm/credential/local-vllm/metadata \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"expected_revision":1,"metadata":{"base_url":"http://10.0.0.5:8000/v1","models":[{"id":"qwen3-coder","max_tokens":8192}]}}'
```

### revoke

The path parameters `credential_name` and `revision` are required. `revision` is a positive integer.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/revision/1/revoke \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

### archive

The path parameter `credential_name` is required.

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/credential/team-openai/archive \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
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
kanthord llm credential list [--platform <platform>] [--include-archived] [--limit <count>] [--cursor <cursor>]
kanthord llm credential get <credential-name>
kanthord llm credential platforms
kanthord llm credential create --file <path> [--idempotency-key <ulid>]
kanthord llm credential rotate <credential-name> --file <path> [--idempotency-key <ulid>]
kanthord llm credential update-metadata <credential-name> --file <path> [--idempotency-key <ulid>]
kanthord llm credential revoke <credential-name> <revision> [--idempotency-key <ulid>]
kanthord llm credential archive <credential-name> [--idempotency-key <ulid>]
kanthord llm credential check --file <path>
kanthord llm credential verify <credential-name>
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord llm credential platforms
kanthord llm credential create --file ./team-openai.json
kanthord llm credential list --platform openai --limit 50
kanthord llm credential rotate team-openai --file ./team-openai-rotate.json \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
kanthord llm credential revoke team-openai 1
kanthord llm credential verify team-openai --endpoint http://127.0.0.1:31415
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

| Option                     | Commands                                                   | Default / resolution                                                        | Purpose                                                                           |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--token <jwt>`            | All                                                        | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                                          |
| `--endpoint <url>`         | All                                                        | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                                  |
| `--platform <platform>`    | `list`                                                     | No filter                                                                   | Sets the `platform` query.                                                        |
| `--include-archived`       | `list`                                                     | `false`                                                                     | Sets `include_archived=true`. Without it, the CLI sends `include_archived=false`. |
| `--limit <count>`          | `list`                                                     | `100`                                                                       | Page size from `1` to `1000`.                                                     |
| `--cursor <cursor>`        | `list`                                                     | First page                                                                  | Sets the `cursor` query.                                                          |
| `--file <path>`            | `create`, `rotate`, `update-metadata`, `check`             | Required                                                                    | JSON file that holds the request body.                                            |
| `--idempotency-key <ulid>` | `create`, `rotate`, `update-metadata`, `revoke`, `archive` | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key for a retry.               |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. Each option is single-use. The read commands reject `--idempotency-key` as an unknown option.

The `--file` value must name a regular file; `-` for stdin is rejected. The file holds one JSON object with no duplicate key. The CLI validates it against the body schema before the request. For `create`, `rotate` and `check`, the file is a secret file: it must be owned by the user, have mode `0600`, and not be a symbolic link. The CLI repairs no permission and never prints the secret. The `update-metadata` file uses the ordinary rules and holds no secret.

The HTTP client has a 31-second deadline for these 30-second operations.
