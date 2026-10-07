# List the models of a credential

[Reference index](../README.md)

## Function description

List the models and reasoning efforts that one LLM credential offers for one agent provider kind. The read needs no [enablement](enablement.md). Use it to choose a `model_identifier` and a `reasoning_effort` before you write an enablement.

The credential must exist in custody, and its platform must equal the provider kind. A built-in provider kind lists the models of pi-ai 0.86.0 with the supported thinking levels of each model. The `openai-compatible` kind lists the approved models in the metadata of the credential. The read makes no remote call and changes no state.

[List the models of an enablement provider](enablement-provider.md#list-the-models-of-a-provider) answers the same shape for a provider that an enablement already names.

## Expected response

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`. The example below is shortened.

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

| Property                    | Type         | Purpose                                                                                                       |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `items`                     | array        | Every model of the credential for the provider kind. The list has no pagination.                              |
| `items[].model_identifier`  | string       | Value for `default_configuration.model_identifier`.                                                           |
| `items[].reasoning_efforts` | string array | Reasoning efforts that the model supports, from `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. |

An `openai-compatible` credential without approved models answers an empty `items` array.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Meaning                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | Missing, invalid, expired or banned token, or a machine token.                                                       |
| `400 gateway.request.validation_failed`         | `provider` is not an agent provider kind, or `credential` is absent or empty.                                        |
| `400 agent.configuration.credential_unsuitable` | The credential does not exist, or its platform differs from `provider`. `details` holds `provider` and `credential`. |

| CLI code                                | Meaning                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `cli.agent.model.list.invalid_provider` | The `--provider` value is not an agent provider kind.                  |
| `cli.agent.model.list.token_required`   | No option, environment variable or client file supplies a token.       |
| `cli.agent.model.list.indeterminate`    | A transport failure, timeout or malformed response. Retry the command. |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr.

## API shape

| Item            | Value                      |
| --------------- | -------------------------- |
| Method and path | `GET /api/agent/model`     |
| Operation ID    | `agent.model.list`         |
| Access          | `human` (human bearer JWT) |
| Timeout         | 30 seconds                 |
| Mutation        | No                         |
| Request body    | None                       |

| Parameter    | In    | Required | Purpose                                                                                                   |
| ------------ | ----- | -------- | --------------------------------------------------------------------------------------------------------- |
| `provider`   | query | Yes      | Agent provider kind: `openai-compatible` or a built-in provider of pi-ai 0.86.0, for example `anthropic`. |
| `credential` | query | Yes      | Credential name in custody.                                                                               |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -s 'http://127.0.0.1:31415/api/agent/model?provider=anthropic&credential=<credential-name>' \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord agent model list --provider <provider> --credential <credential> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord agent model list --provider anthropic --credential <credential-name>
```

There are no positional arguments.

| Option                      | Default / resolution                                                        | Purpose                                  |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--provider <provider>`     | Required                                                                    | Sets `provider`.                         |
| `--credential <credential>` | Required                                                                    | Sets `credential`.                       |
| `--token <jwt>`             | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>`          | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

The `agent` group declares `--token` and `--endpoint`. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline for this 30-second operation.
