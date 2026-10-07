# Enablement providers

[Reference index](../README.md)

## Function description

Change or inspect one agent provider of a live [agent enablement](enablement.md). An agent provider pairs a name with a provider kind and an LLM credential.

| Command               | Effect                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `provider add`        | Append one named agent provider to the enablement.                             |
| `provider remove`     | Remove one named agent provider that nothing uses.                             |
| `provider model list` | List the models and reasoning efforts of one agent provider of the enablement. |

`provider add` and `provider remove` require the latest revision that the caller read. Each adds a revision to the enablement and keeps its state. `provider add` refuses a name or a credential that an agent provider of the enablement already uses. It checks that the credential exists with the platform of the provider kind.

`provider remove` keeps at least one agent provider. It refuses a provider that the default configuration or a binding entry names. To change the credential of an agent provider or the default configuration, use `enablement put`.

`provider model list` reads the enablement in either state. A built-in provider kind lists the models of pi-ai 0.86.0 with the supported thinking levels of each model. The `openai-compatible` kind lists the approved models in the metadata of the credential. [List the models of a credential](model.md) answers the same shape before an enablement names the credential.

## Expected response

`provider add` and `provider remove` return HTTP `200` with the revised [enablement record](enablement.md#expected-response). The CLI writes it as one JSON line with the retry key and exits `0`.

```json
{
  "agent_name": "swe@1",
  "state": "enabled",
  "agent_providers": [
    {
      "name": "main",
      "provider": "anthropic",
      "credential": "<credential-name>"
    },
    {
      "name": "spare",
      "provider": "anthropic",
      "credential": "<other-credential-name>"
    }
  ],
  "default_configuration": {
    "agent_provider": "main",
    "model_identifier": "claude-sonnet-4-5",
    "reasoning_effort": "high"
  },
  "revision": 2,
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

`provider model list` returns HTTP `200`. The CLI writes the same object as one JSON line and exits `0`.

```json
{
  "items": [
    {
      "model_identifier": "claude-sonnet-4-5",
      "reasoning_efforts": ["off", "minimal", "low", "medium", "high"]
    }
  ]
}
```

| Property                    | Type         | Purpose                                                                       |
| --------------------------- | ------------ | ----------------------------------------------------------------------------- |
| `items`                     | array        | Every model of the agent provider. The list has no pagination.                |
| `items[].model_identifier`  | string       | Value for `model_identifier` in the default configuration or a binding entry. |
| `items[].reasoning_efforts` | string array | Reasoning efforts that the model supports.                                    |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). The server checks the catalog, then the record, then the revision, then the provider.

| HTTP status / code                                  | Commands           | Meaning                                                                                                        |
| --------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`           | All                | Missing, invalid, expired or banned token, or a machine token.                                                 |
| `400 gateway.request.validation_failed`             | All                | The input breaks the schema, for example an unknown provider kind or an unknown field.                         |
| `400 gateway.idempotency.invalid_key`               | add, remove        | Missing or malformed idempotency key, checked after schema validation.                                         |
| `409 gateway.idempotency.conflict`                  | add, remove        | The key belongs to a different request of the same caller.                                                     |
| `404 agent.catalog.not_found`                       | All                | The agent name is not in the catalog.                                                                          |
| `404 agent.enablement.not_found`                    | All                | The agent has no live enablement.                                                                              |
| `409 agent.enablement.revision_conflict`            | add, remove        | `expected_revision` differs from the latest revision. `details.revision` holds that revision.                  |
| `409 agent.enablement.provider.name_conflict`       | add                | An agent provider already uses the name.                                                                       |
| `409 agent.enablement.provider.credential_conflict` | add                | An agent provider already uses the credential. `details` holds `credential` and `agent_provider`.              |
| `400 agent.configuration.credential_unsuitable`     | add                | The credential does not exist, or its platform differs from the provider kind.                                 |
| `404 agent.enablement.provider.not_found`           | remove, model list | The provider name names no agent provider of the enablement.                                                   |
| `400 agent.enablement.provider.required`            | remove             | The provider is the last agent provider.                                                                       |
| `409 agent.enablement.provider.in_use`              | remove             | The default configuration or a binding entry names the provider. `details.dependents` lists them.              |
| `409 agent.enablement.invalidates_bindings`         | add, remove        | The change makes a dependent binding invalid. `details.bindings` lists `binding_id`, `worker_name` and `code`. |
| `413 gateway.request.body_too_large`                | add, remove        | The body exceeds 64 KiB.                                                                                       |

An item of `details.dependents` is `{ "kind": "default_configuration" }` or `{ "binding_id": "<binding-id>", "worker_name": "<worker-name>" }`.

The CLI checks some input before it sends the request. `<command>` is `add`, `remove` or `model.list`.

| CLI code                                                 | Commands    | Meaning                                                                         |
| -------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `cli.agent.enablement.provider.remove.invalid_revision`  | remove      | `--expected-revision` is not a positive safe integer.                           |
| `cli.agent.enablement.provider.<command>.token_required` | All         | No option, environment variable or client file supplies a token.                |
| `cli.idempotency_key.invalid`                            | add, remove | `--idempotency-key` is not a canonical ULID.                                    |
| `cli.file.invalid_path`                                  | add         | `--file` is `-`; the command does not read stdin.                               |
| `cli.file.not_found`, `cli.file.not_regular`             | add         | The `--file` path does not exist, or is not a regular file.                     |
| `cli.file.encoding_invalid`, `cli.file.not_json`         | add         | The file is not UTF-8, or is not one JSON document.                             |
| `cli.file.duplicate_key`, `cli.file.not_object`          | add         | The JSON repeats an object key, or is not an object.                            |
| `cli.file.schema_invalid`                                | add         | The object breaks the body schema; the message lists the issue paths and codes. |
| `cli.agent.enablement.provider.<command>.indeterminate`  | All         | A transport failure, timeout or malformed response.                             |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. For `add` and `remove`, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. An indeterminate `add` or `remove` prints the retry key. Retry with the same key and the same input. The server replays the recorded answer, a failure included, for the same caller and key within `gateway.idempotency_ttl` (default 86400 seconds).

## API shape

All operations use `human` access, a 30-second timeout, and the header `Authorization: Bearer <human-jwt>`. Mutations also require `Content-Type: application/json` and an `Idempotency-Key` header with a fresh canonical ULID. The mutation body limit is 64 KiB. The HTTP client of the CLI has a 31-second deadline.

| Command               | Method and path                                                       | Operation ID                           | Mutation |
| --------------------- | --------------------------------------------------------------------- | -------------------------------------- | -------- |
| `provider add`        | `POST /api/agent/enablement/:agent_name/provider`                     | `agent.enablement.provider.add`        | Yes      |
| `provider remove`     | `DELETE /api/agent/enablement/:agent_name/provider/:provider_name`    | `agent.enablement.provider.remove`     | Yes      |
| `provider model list` | `GET /api/agent/enablement/:agent_name/provider/:provider_name/model` | `agent.enablement.provider.model.list` | No       |

| Path parameter  | Commands           | Purpose                                      |
| --------------- | ------------------ | -------------------------------------------- |
| `agent_name`    | All                | Catalog key, for example `swe@1`.            |
| `provider_name` | remove, model list | Name of an agent provider of the enablement. |

No operation takes query parameters.

### Add a provider

| Body field          | Type    | Required | Purpose                                                                    |
| ------------------- | ------- | -------- | -------------------------------------------------------------------------- |
| `expected_revision` | integer | Yes      | Positive latest revision that the caller read.                             |
| `name`              | string  | Yes      | Nonempty name of the new agent provider.                                   |
| `provider`          | string  | Yes      | Provider kind: `openai-compatible` or a built-in provider of pi-ai 0.86.0. |
| `credential`        | string  | Yes      | Nonempty credential name in custody.                                       |

The body is closed; an unknown field fails validation.

```sh
curl -s -X POST http://127.0.0.1:31415/api/agent/enablement/swe@1/provider \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":1,"name":"spare","provider":"anthropic","credential":"<credential-name>"}'
```

### Remove a provider

| Body field          | Type    | Required | Purpose                                        |
| ------------------- | ------- | -------- | ---------------------------------------------- |
| `expected_revision` | integer | Yes      | Positive latest revision that the caller read. |

```sh
curl -s -X DELETE http://127.0.0.1:31415/api/agent/enablement/swe@1/provider/spare \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":2}'
```

### List the models of a provider

The request has no body.

```sh
curl -s http://127.0.0.1:31415/api/agent/enablement/swe@1/provider/main/model \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord agent enablement provider add <agent-name> --file <path> [--idempotency-key <ulid>]
kanthord agent enablement provider remove <agent-name> <provider-name> --expected-revision <revision> [--idempotency-key <ulid>]
kanthord agent enablement provider model list <agent-name> <provider-name>
```

Each command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord agent enablement provider add swe@1 --file spare-provider.json
kanthord agent enablement provider remove swe@1 spare --expected-revision 2
kanthord agent enablement provider model list swe@1 main
```

The `--file` of `provider add` holds the request body as one JSON object:

```json
{
  "expected_revision": 1,
  "name": "spare",
  "provider": "anthropic",
  "credential": "<credential-name>"
}
```

| Argument          | Commands           | Required | Purpose                                       |
| ----------------- | ------------------ | -------- | --------------------------------------------- |
| `<agent-name>`    | All                | Yes      | Catalog key; maps to `agent_name`.            |
| `<provider-name>` | remove, model list | Yes      | Agent provider name; maps to `provider_name`. |

| Option                           | Commands    | Default / resolution                                                        | Purpose                                                            |
| -------------------------------- | ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--file <path>`                  | add         | Required                                                                    | UTF-8 JSON file with the request body.                             |
| `--expected-revision <revision>` | remove      | Required                                                                    | Sets `expected_revision`.                                          |
| `--idempotency-key <ulid>`       | add, remove | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key on a retry. |
| `--token <jwt>`                  | All         | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                           |
| `--endpoint <url>`               | All         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                   |

The `agent` group declares `--token` and `--endpoint`. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration).
