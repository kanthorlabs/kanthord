# Agent enablements

[Reference index](../README.md)

## Function description

Manage the global enablement of a catalog agent. An enablement belongs to no project, and the agent name is its key. It names the agent providers, which pair a provider kind with an LLM credential. It also holds the default configuration of the agent. A worker binding can run the agent only while its enablement is live and `enabled`.

| Command   | Effect                                                                          |
| --------- | ------------------------------------------------------------------------------- |
| `list`    | Read the live enablements in ascending agent-name order, one page at a time.    |
| `get`     | Read the live enablement of one agent.                                          |
| `put`     | Create an enablement, or replace its agent providers and default configuration. |
| `enable`  | Validate a live enablement and set its state to `enabled`.                      |
| `disable` | Set the state of a live enablement to `disabled`, without a validation.         |
| `remove`  | Remove an enablement that no worker binding uses.                               |

Every write adds a revision, and the revision increases by `1`. Every write except a first `put` requires the latest revision that the caller read. `enable` and `disable` add a revision also when the state does not change.

`put` with no prior record creates the enablement in the `enabled` state. A replacement keeps the current state. A retained agent provider cannot change its provider kind. An omitted agent provider is a removal. To change only the provider list, use [the provider commands](enablement-provider.md).

A configuration write validates the default configuration. The default `agent_provider` must name an agent provider of the request. Its credential must exist with the platform of the provider kind. The model must be a model of that provider kind or credential, and the reasoning effort must be a level of that model. [List the models of a credential](model.md) shows the valid pairs. `put` also checks the credential of every other agent provider in the request the same way. `put` and `enable` also validate the effective configuration of each dependent worker binding.

`disable` is the stop switch of an agent. It keeps the worker bindings. A later binding write for the agent fails with `agent.enablement.unavailable`, and configuration resolution reports that code.

`remove` writes a removal revision. The record then disappears from `list` and `get`, and `agent get` answers `enablement: null`. A later `put` creates a new `enabled` record. That `put` requires the revision of the removal, which is the removed revision plus `1`.

## Expected response

`get`, `put`, `enable` and `disable` return HTTP `200` with the enablement record. The CLI writes one JSON line to stdout and exits `0`. Mutations add the retry key on the CLI only.

```json
{
  "agent_name": "swe@1",
  "state": "enabled",
  "agent_providers": [
    {
      "name": "main",
      "provider": "anthropic",
      "credential": "<credential-name>"
    }
  ],
  "default_configuration": {
    "agent_provider": "main",
    "model_identifier": "claude-sonnet-4-5",
    "reasoning_effort": "high"
  },
  "revision": 1,
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property                                 | Type                  | Surface                  | Purpose                                                                                |
| ---------------------------------------- | --------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `agent_name`                             | string                | API and CLI              | Catalog key of the agent.                                                              |
| `state`                                  | string                | API and CLI              | `enabled` or `disabled`.                                                               |
| `agent_providers`                        | array                 | API and CLI              | Agent providers. Each name and each credential is unique inside the enablement.        |
| `agent_providers[].name`                 | string                | API and CLI              | Name of the agent provider; binding entries and the default configuration refer to it. |
| `agent_providers[].provider`             | string                | API and CLI              | Provider kind: `openai-compatible` or a built-in provider of pi-ai 0.86.0.             |
| `agent_providers[].credential`           | string                | API and CLI              | Credential name in custody. The record holds no secret.                                |
| `default_configuration.agent_provider`   | string                | API and CLI              | Name of the default agent provider.                                                    |
| `default_configuration.model_identifier` | string                | API and CLI              | Default model.                                                                         |
| `default_configuration.reasoning_effort` | string                | API and CLI              | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`.                           |
| `revision`                               | integer               | API and CLI              | Revision of this record.                                                               |
| `idempotency_key`                        | canonical ULID string | CLI only, mutations only | Key used for this request; reuse it to retry the same request.                         |

`list` returns `{ "items": [<record>, ...], "next_cursor": "<cursor>" }`. `next_cursor` is `null` on the last page.

`remove` returns `{ "agent_name": "swe@1", "removed": true }` on the API. The CLI adds the retry key and prints `{ "agent_name": "swe@1", "removed": true, "idempotency_key": "<ulid>" }`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). The server checks the catalog, then the record, then the revision, then the configuration.

| HTTP status / code                                     | Commands                     | Meaning                                                                                                        |
| ------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`              | All                          | Missing, invalid, expired or banned token, or a machine token.                                                 |
| `400 gateway.request.validation_failed`                | All                          | The input breaks the schema, for example an empty `agent_providers` array or an unknown field.                 |
| `400 system.pagination.cursor_invalid`                 | list                         | The cursor is malformed.                                                                                       |
| `400 gateway.idempotency.invalid_key`                  | Mutations                    | Missing or malformed idempotency key, checked after schema validation.                                         |
| `409 gateway.idempotency.conflict`                     | Mutations                    | The key belongs to a different request of the same caller.                                                     |
| `404 agent.catalog.not_found`                          | put, enable, disable, remove | The agent name is not in the catalog.                                                                          |
| `404 agent.enablement.not_found`                       | get, enable, disable, remove | The agent has no live enablement. `get` answers this code also for a name outside the catalog.                 |
| `409 agent.enablement.revision_conflict`               | Mutations                    | `expected_revision` differs from the latest revision. `details.revision` holds that revision, or `null`.       |
| `409 agent.enablement.provider.name_conflict`          | put                          | Two agent providers use the same name.                                                                         |
| `409 agent.enablement.provider.credential_conflict`    | put                          | Two agent providers use the same credential.                                                                   |
| `404 agent.enablement.provider.not_found`              | put, enable                  | The default `agent_provider` names no agent provider.                                                          |
| `400 agent.configuration.credential_unsuitable`        | put, enable                  | A credential does not exist, or its platform differs from the provider kind. `put` checks each provider.       |
| `400 agent.configuration.model_unknown`                | put, enable                  | The default model is not a model of the provider kind or credential.                                           |
| `400 agent.configuration.reasoning_effort_unsupported` | put, enable                  | The default model does not support the reasoning effort.                                                       |
| `409 agent.enablement.provider.fixed`                  | put                          | The request changes the provider kind of a retained agent provider.                                            |
| `409 agent.enablement.provider.in_use`                 | put                          | A binding entry names an omitted agent provider. `details.bindings` lists the bindings.                        |
| `409 agent.enablement.invalidates_bindings`            | put, enable                  | The change makes a dependent binding invalid. `details.bindings` lists `binding_id`, `worker_name` and `code`. |
| `409 agent.enablement.in_use`                          | remove                       | A worker binding of a worker that runs the agent exists. `details.bindings` lists the bindings.                |
| `413 gateway.request.body_too_large`                   | Mutations                    | The body exceeds 64 KiB.                                                                                       |

The CLI checks some input before it sends the request. `<command>` is the command name.

| CLI code                                          | Commands                | Meaning                                                                         |
| ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `cli.pagination.limit_invalid`                    | list                    | `--limit` is not a positive safe integer.                                       |
| `cli.pagination.limit_out_of_range`               | list                    | `--limit` is above 1000.                                                        |
| `cli.agent.enablement.<command>.invalid_revision` | enable, disable, remove | `--expected-revision` is not a positive safe integer.                           |
| `cli.agent.enablement.<command>.token_required`   | All                     | No option, environment variable or client file supplies a token.                |
| `cli.idempotency_key.invalid`                     | Mutations               | `--idempotency-key` is not a canonical ULID.                                    |
| `cli.file.invalid_path`                           | put                     | `--file` is `-`; the command does not read stdin.                               |
| `cli.file.not_found`, `cli.file.not_regular`      | put                     | The `--file` path does not exist, or is not a regular file.                     |
| `cli.file.encoding_invalid`, `cli.file.not_json`  | put                     | The file is not UTF-8, or is not one JSON document.                             |
| `cli.file.duplicate_key`, `cli.file.not_object`   | put                     | The JSON repeats an object key, or is not an object.                            |
| `cli.file.schema_invalid`                         | put                     | The object breaks the body schema; the message lists the issue paths and codes. |
| `cli.agent.enablement.<command>.indeterminate`    | All                     | A transport failure, timeout or malformed response.                             |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A mutation prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. An indeterminate mutation prints the retry key. Retry with the same key and the same input. The server replays the recorded answer, a failure included, for the same caller and key within `gateway.idempotency_ttl` (default 86400 seconds).

## API shape

All operations use `human` access, a 30-second timeout, and the header `Authorization: Bearer <human-jwt>`. Mutations also require `Content-Type: application/json` and an `Idempotency-Key` header with a fresh canonical ULID. The mutation body limit is 64 KiB. The HTTP client of the CLI has a 31-second deadline.

| Command   | Method and path                                  | Operation ID               | Mutation |
| --------- | ------------------------------------------------ | -------------------------- | -------- |
| `list`    | `GET /api/agent/enablement`                      | `agent.enablement.list`    | No       |
| `get`     | `GET /api/agent/enablement/:agent_name`          | `agent.enablement.get`     | No       |
| `put`     | `PUT /api/agent/enablement/:agent_name`          | `agent.enablement.put`     | Yes      |
| `enable`  | `POST /api/agent/enablement/:agent_name/enable`  | `agent.enablement.enable`  | Yes      |
| `disable` | `POST /api/agent/enablement/:agent_name/disable` | `agent.enablement.disable` | Yes      |
| `remove`  | `DELETE /api/agent/enablement/:agent_name`       | `agent.enablement.remove`  | Yes      |

The path parameter `agent_name` is the catalog key, for example `swe@1`. The static path `/api/agent/enablement` does not match `GET /api/agent/:agent_name`.

### List enablements

| Parameter | In    | Required | Purpose                                             |
| --------- | ----- | -------- | --------------------------------------------------- |
| `limit`   | query | No       | Page size from `1` to `1000`; the default is `100`. |
| `cursor`  | query | No       | `next_cursor` of the previous page.                 |

The request has no body.

```sh
curl -s 'http://127.0.0.1:31415/api/agent/enablement?limit=100' \
  -H 'Authorization: Bearer <human-jwt>'
```

### Get an enablement

The request has no query parameters and no body.

```sh
curl -s http://127.0.0.1:31415/api/agent/enablement/swe@1 \
  -H 'Authorization: Bearer <human-jwt>'
```

### Create or replace an enablement

| Body field              | Type    | Required                   | Purpose                                                                              |
| ----------------------- | ------- | -------------------------- | ------------------------------------------------------------------------------------ |
| `expected_revision`     | integer | Yes when a revision exists | Positive latest revision that the caller read, the removal revision included.        |
| `agent_providers`       | array   | Yes, at least one item     | Complete list of `{ name, provider, credential }`; every field is a nonempty string. |
| `default_configuration` | object  | Yes                        | `{ agent_provider, model_identifier, reasoning_effort }`.                            |

The body and its objects are closed; an unknown field fails validation.

```sh
curl -s -X PUT http://127.0.0.1:31415/api/agent/enablement/swe@1 \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"agent_providers":[{"name":"main","provider":"anthropic","credential":"<credential-name>"}],"default_configuration":{"agent_provider":"main","model_identifier":"claude-sonnet-4-5","reasoning_effort":"high"}}'
```

### Enable, disable or remove an enablement

| Body field          | Type    | Required | Purpose                                        |
| ------------------- | ------- | -------- | ---------------------------------------------- |
| `expected_revision` | integer | Yes      | Positive latest revision that the caller read. |

```sh
curl -s -X POST http://127.0.0.1:31415/api/agent/enablement/swe@1/disable \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":1}'
```

## CLI shape

```text
kanthord agent enablement list [--limit <count>] [--cursor <cursor>]
kanthord agent enablement get <agent-name>
kanthord agent enablement put <agent-name> --file <path> [--idempotency-key <ulid>]
kanthord agent enablement enable <agent-name> --expected-revision <revision> [--idempotency-key <ulid>]
kanthord agent enablement disable <agent-name> --expected-revision <revision> [--idempotency-key <ulid>]
kanthord agent enablement remove <agent-name> --expected-revision <revision> [--idempotency-key <ulid>]
```

Each command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord agent enablement list --limit 50
kanthord agent enablement put swe@1 --file swe-enablement.json
kanthord agent enablement disable swe@1 --expected-revision 1
kanthord agent enablement enable swe@1 --expected-revision 2
kanthord agent enablement remove swe@1 --expected-revision 3
```

The `--file` of `put` holds the request body as one JSON object:

```json
{
  "expected_revision": 1,
  "agent_providers": [
    {
      "name": "main",
      "provider": "anthropic",
      "credential": "<credential-name>"
    }
  ],
  "default_configuration": {
    "agent_provider": "main",
    "model_identifier": "claude-sonnet-4-5",
    "reasoning_effort": "high"
  }
}
```

| Argument       | Commands                          | Required | Purpose                            |
| -------------- | --------------------------------- | -------- | ---------------------------------- |
| `<agent-name>` | get, put, enable, disable, remove | Yes      | Catalog key; maps to `agent_name`. |

| Option                           | Commands                | Default / resolution                                                        | Purpose                                                            |
| -------------------------------- | ----------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--limit <count>`                | list                    | `100`; at most `1000`                                                       | Sets `limit`.                                                      |
| `--cursor <cursor>`              | list                    | None                                                                        | Sets `cursor`.                                                     |
| `--file <path>`                  | put                     | Required                                                                    | UTF-8 JSON file with the request body.                             |
| `--expected-revision <revision>` | enable, disable, remove | Required                                                                    | Sets `expected_revision`.                                          |
| `--idempotency-key <ulid>`       | Mutations               | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key on a retry. |
| `--token <jwt>`                  | All                     | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                           |
| `--endpoint <url>`               | All                     | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                   |

The `agent` group declares `--token` and `--endpoint`. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration).
