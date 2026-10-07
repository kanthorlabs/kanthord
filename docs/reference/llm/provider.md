# Check an LLM provider connection

[Reference index](../README.md)

## Function description

Check a stored LLM credential through the LLM provider of its platform. The check reports the connection result. For `openai` and `openai-compatible`, it also returns the model list of the remote. The API and `kanthord llm provider check` perform the same read operation.

The check uses the current revision of the credential. It stores no result, caches nothing, and creates no idempotency record. It has no project or binding. Use the model IDs to select the approved models of an `openai-compatible` credential, then save them with [`llm credential update-metadata`](credential.md).

| Platform            | Remote call                                                | Model list |
| ------------------- | ---------------------------------------------------------- | ---------- |
| `github-copilot`    | `GET https://api.github.com/copilot_internal/v2/token`     | No         |
| `openai-codex`      | One model call to `gpt-5.6-luna` with reasoning `low`      | No         |
| `anthropic`         | `GET https://api.anthropic.com/v1/models`                  | No         |
| `openai-compatible` | `GET <base_url>/models`                                    | Yes        |
| `openrouter`        | `GET https://openrouter.ai/api/v1/key`                     | No         |
| `openai`            | `GET https://api.openai.com/v1/models`                     | Yes        |
| `opencode-go`       | One model call to `deepseek-v4-flash` with a 1-token limit | No         |

Other platforms have no LLM provider. These platforms are the `verifiable` platforms of [`llm credential platforms`](credential.md#platforms). The check has a 10-second deadline. An HTTP check does not follow a redirect; a redirect answers `invalid_response`. It does not refresh OAuth: an expired access token of `github-copilot` or `openai-codex` reports `unreachable` without a remote call.

## Expected response

The API returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`. The example below is formatted.

```json
{
  "connection": "ok",
  "models": [
    { "id": "qwen3-coder", "owned_by": "vllm", "created": 1791417600 },
    { "id": "llama-4-scout", "owned_by": null, "created": null }
  ]
}
```

| Property            | Type              | Purpose                                                                 |
| ------------------- | ----------------- | ----------------------------------------------------------------------- |
| `connection`        | string            | Connection result; see the table below.                                 |
| `models`            | array or `null`   | Models of the remote for `openai` and `openai-compatible`; else `null`. |
| `models[].id`       | string            | Model ID.                                                               |
| `models[].owned_by` | string or `null`  | Owner that the remote reports; `null` when absent.                      |
| `models[].created`  | integer or `null` | Creation time that the remote reports; `null` when absent.              |

| `connection`       | Meaning                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `ok`               | The remote answered with success.                                                                               |
| `unauthorized`     | The remote answered `401` or `403`.                                                                             |
| `unreachable`      | A network failure, the deadline, an expired OAuth access token, or a model call failure without an HTTP status. |
| `invalid_response` | Every other answer, for example another status or a malformed model list.                                       |

`models` is `null` for every result other than `ok`. The answer contains no key, base URL, or token limit.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Meaning                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `401 gateway.authentication.unauthorized`    | Absent, invalid, expired or banned token, or a machine token.      |
| `400 llm.provider.invalid_input`             | The body is not exactly `{ credential }` with a nonempty string.   |
| `404 llm.provider.credential_not_found`      | Unknown name, archived credential, or a name of another component. |
| `400 llm.provider.check_unsupported`         | The platform of the credential has no LLM provider.                |
| `400 gateway.request.invalid_json`           | The request body is not valid JSON.                                |
| `413 gateway.request.body_too_large`         | The body exceeds 16 KiB.                                           |
| `415 gateway.request.unsupported_media_type` | The request has no `application/json` content type.                |
| `504 gateway.invocation.timeout`             | The 30-second operation timeout expired.                           |

A remote failure is not an API failure; it appears in `connection`.

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.llm.provider.check.indeterminate`. Without a nonblank token, the CLI exits `1` with `cli.llm.provider.check.token_required` before a request. A repeated `--credential` exits `1` with `cli.option.duplicate`.

## API shape

| Item                  | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| Method and path       | `POST /api/llm/provider/check`                        |
| Operation ID          | `llm.provider.check`                                  |
| Access                | Human bearer JWT                                      |
| Timeout               | 30 seconds                                            |
| Mutation              | No                                                    |
| Path/query parameters | None                                                  |
| Request body          | `{ "credential": "<credential-name>" }`; 16 KiB limit |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |
| `Content-Type`  | Yes      | `application/json`.   |

```sh
curl -i -X POST http://127.0.0.1:31415/api/llm/provider/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"credential":"local-vllm"}'
```

## CLI shape

```text
kanthord llm provider check --credential <credential-name> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord llm provider check --credential local-vllm
kanthord llm provider check --credential team-openai \
  --token '<human-jwt>' \
  --endpoint http://127.0.0.1:31415
```

There are no positional arguments.

| Option                           | Default / resolution                                                        | Purpose                                  |
| -------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--credential <credential-name>` | Required                                                                    | Credential name; sent as `credential`.   |
| `--token <jwt>`                  | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>`               | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence. See [client configuration](../README.md#client-configuration) for the private `cli.yaml` file. The command rejects `--idempotency-key` as an unknown option. The HTTP client has a 31-second deadline for this 30-second operation.
