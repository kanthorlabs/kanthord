# Check a model of an LLM credential

[Reference index](../README.md)

## Function description

Check one model and one reasoning effort through a stored LLM credential. The check runs one tool round trip: the model receives a tool definition, calls the tool, receives the tool result and answers. The API and `kanthord llm model check` perform the same read operation.

The check uses the current revision of the credential. It builds the model runtime that an execution builds, so the check covers every LLM platform, `openai-compatible` included. It stores no result, pins no revision, caches nothing, and creates no idempotency record. It has no project or binding.

The check is a warning for the human. Run it before an agent enablement write. The enablement write does not call it.

| Step | Request                                                             |
| ---- | ------------------------------------------------------------------- |
| 1    | The user message asks the model to call the tool `check_tool` once. |
| 2    | The model must answer with a call of `check_tool`.                  |
| 3    | The tool result `ready` goes back to the model.                     |
| 4    | The model must answer without a provider failure.                   |

The reasoning effort `off` sends no reasoning option. Every other effort goes to the model call. The check has a 50-second deadline. It does not refresh OAuth: an expired access token answers `unauthorized` without a model call.

## Expected response

The API returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`, also when `result` is not `ok`. The example below is formatted.

```json
{
  "result": "rate_limited",
  "message": "429 Rate limit exceeded"
}
```

| Property  | Type             | Purpose                                                                            |
| --------- | ---------------- | ---------------------------------------------------------------------------------- |
| `result`  | string           | Check result; see the table below.                                                 |
| `message` | string or `null` | Failure text without secrets, cut to 300 characters; `null` when `result` is `ok`. |

| `result`          | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `ok`              | The model called the tool and answered after the tool result.                                |
| `rate_limited`    | The provider answered `429`.                                                                 |
| `quota_exhausted` | The error text names a quota, a usage limit, a billing state or a credit balance.            |
| `unauthorized`    | The provider answered `401` or `403`, or the OAuth access token is expired.                  |
| `bad_request`     | The provider answered another `4xx`, or the model answered without a call of the tool.       |
| `unavailable`     | Every other failure: a `5xx` answer, a network failure, the deadline or a cancelled request. |

The `message` of a model that does not call the tool is `The model did not call the tool.` The answer contains no key or token.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Meaning                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Absent, invalid, expired or banned token, or a machine token.                                 |
| `400 gateway.request.validation_failed`      | The body is not exactly the three properties below, each a nonempty string.                   |
| `404 llm.model.credential_not_found`         | Unknown name, archived credential, or a name of another component.                            |
| `409 credential.credential.held_by_instance` | The name has live [instance copies](credential.md#instance-copies) and no live `server` copy. |
| `400 llm.model.model_unknown`                | The model is not in the model list of the credential.                                         |
| `400 llm.model.reasoning_unsupported`        | The model does not support the reasoning effort.                                              |
| `400 gateway.request.invalid_json`           | The request body is not valid JSON.                                                           |
| `413 gateway.request.body_too_large`         | The body exceeds 16 KiB.                                                                      |
| `415 gateway.request.unsupported_media_type` | The request has no `application/json` content type.                                           |
| `504 gateway.invocation.timeout`             | The 60-second operation timeout expired.                                                      |

A provider failure is not an API failure; it appears in `result`.

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.llm.model.check.indeterminate`. Without a nonblank token, the CLI exits `1` with `cli.llm.model.check.token_required` before a request. A repeated option exits `1` with `cli.option.duplicate`.

## API shape

| Item                  | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| Method and path       | `POST /api/llm/model/check`                                              |
| Operation ID          | `llm.model.check`                                                        |
| Access                | Human bearer JWT                                                         |
| Timeout               | 60 seconds                                                               |
| Mutation              | No                                                                       |
| Path/query parameters | None                                                                     |
| Request body          | `{ "credential", "model_identifier", "reasoning_effort" }`; 16 KiB limit |

| Property           | Type   | Purpose                                                                           |
| ------------------ | ------ | --------------------------------------------------------------------------------- |
| `credential`       | string | Credential name.                                                                  |
| `model_identifier` | string | Model ID; the models of an `openai-compatible` credential come from its metadata. |
| `reasoning_effort` | string | One level that the model supports, for example `off`, `low` or `high`.            |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |
| `Content-Type`  | Yes      | `application/json`.   |

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/model/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"credential":"local-vllm","model_identifier":"qwen3-coder","reasoning_effort":"off"}'
```

## CLI shape

```text
kanthord llm model check --credential <credential-name> --model <model-identifier> --reasoning-effort <level> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord llm model check --credential local-vllm --model qwen3-coder --reasoning-effort off
kanthord llm model check --credential team-openai --model gpt-5.5 --reasoning-effort high \
  --token '<human-jwt>' \
  --endpoint http://127.0.0.1:31415
```

There are no positional arguments.

| Option                           | Default / resolution                                                        | Purpose                                      |
| -------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `--credential <credential-name>` | Required                                                                    | Credential name; sent as `credential`.       |
| `--model <model-identifier>`     | Required                                                                    | Model ID; sent as `model_identifier`.        |
| `--reasoning-effort <level>`     | Required                                                                    | Reasoning level; sent as `reasoning_effort`. |
| `--token <jwt>`                  | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.     |
| `--endpoint <url>`               | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                             |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. The command rejects `--idempotency-key` as an unknown option. The HTTP client has a 61-second deadline for this 60-second operation.
