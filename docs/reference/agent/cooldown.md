# Agent cooldowns

[Reference index](../README.md)

## Function description

A cooldown excludes one model of one credential from the claim selection until its end time. A release with the stop reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` writes it. The claim then selects the next entry of the fallback chain of each agent. The codes `bad_request` and `unauthorized` write no cooldown.

The key of a cooldown is the credential name and the model identifier. `swe@1`, `re@1` and every project share it. A repeated advance on the same key adds one strike. The duration is the base of the code, doubled for each strike after the first, up to the maximum. An expired cooldown keeps its strikes until a release with no `provider_failed` stop deletes the row. A human can also clear a row.

| Server configuration key            | Default    | Purpose                                       |
| ----------------------------------- | ---------- | --------------------------------------------- |
| `agent.cooldown.rate_limited_ms`    | `60000`    | Base duration for the code `rate_limited`.    |
| `agent.cooldown.unavailable_ms`     | `60000`    | Base duration for the code `unavailable`.     |
| `agent.cooldown.quota_exhausted_ms` | `3600000`  | Base duration for the code `quota_exhausted`. |
| `agent.cooldown.max_ms`             | `86400000` | Maximum duration after the doubling.          |

When every entry of the chain of an agent has a live cooldown, a work pull answers `no-work`. That answer creates no block, no pause and no failed execution. The agent views report `cooling` with the code `agent.configuration.chain_cooling`; see [the agent view](agent.md#expected-response) and [the worker binding agent view](../project/agent.md#expected-response). That code is a view code and has no HTTP status.

| Command | Effect                                                                |
| ------- | --------------------------------------------------------------------- |
| `list`  | Read every cooldown row, live and expired.                            |
| `clear` | Delete one cooldown row, so that its entry returns at the next claim. |

## Expected response

### `cooldown list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "items": [
    {
      "cooldown_id": "agent_cooldown_01JZ8R2B3C4D5E6F7G8H9J0K1M",
      "credential": "<credential-name>",
      "model_identifier": "claude-sonnet-4-5",
      "code": "rate_limited",
      "strikes": 2,
      "started_at": 1791447600000,
      "until_at": 1791447720000,
      "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M"
    }
  ]
}
```

| Property                   | Type                    | Purpose                                                                                  |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `items`                    | array                   | Every cooldown row. The list has no pagination.                                          |
| `items[].cooldown_id`      | `agent_cooldown_<ulid>` | Identity of the row.                                                                     |
| `items[].credential`       | string                  | Credential name of the key.                                                              |
| `items[].model_identifier` | string                  | Model identifier of the key.                                                             |
| `items[].code`             | string                  | `rate_limited`, `quota_exhausted` or `unavailable`, from the latest advance.             |
| `items[].strikes`          | positive integer        | Count of advances since the last delete of the row.                                      |
| `items[].started_at`       | timestamp               | Unix epoch milliseconds of the latest advance.                                           |
| `items[].until_at`         | timestamp               | Unix epoch milliseconds when the cooldown ends. A row with a past `until_at` is expired. |
| `items[].execution_id`     | `execution_<ulid>`      | Execution whose release wrote the latest advance.                                        |

### `cooldown clear`

The API returns HTTP `204` with no body. The CLI writes one JSON line with the retry key and exits `0`:

```json
{ "idempotency_key": "01M4C5G6DGWEVZYSPETSQR65JH" }
```

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                        |
| ----------------------------------------- | -------- | -------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | All      | Missing, invalid, expired or banned token, or a machine token. |
| `400 gateway.request.validation_failed`   | All      | A path parameter fails the schema.                             |
| `400 gateway.request.unexpected_body`     | All      | The request has a body.                                        |
| `400 gateway.idempotency.invalid_key`     | clear    | Missing or malformed idempotency key.                          |
| `409 gateway.idempotency.conflict`        | clear    | The key belongs to a different request of the same caller.     |
| `404 agent.cooldown.not_found`            | clear    | No cooldown row has this identity.                             |
| `504 gateway.invocation.timeout`          | All      | The operation exceeded 30 seconds.                             |

The CLI checks some input before it sends the request.

| CLI code                                       | Commands | Meaning                                                              |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `cli.agent.cooldown.clear.invalid_cooldown_id` | clear    | `<cooldown-id>` is not a canonical `agent_cooldown_<ulid>` identity. |
| `cli.agent.cooldown.<command>.token_required`  | All      | No option, environment variable or client file supplies a token.     |
| `cli.idempotency_key.invalid`                  | clear    | `--idempotency-key` is not a canonical ULID.                         |
| `cli.agent.cooldown.<command>.indeterminate`   | All      | A transport failure, timeout or malformed response.                  |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A `clear` prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. Retry an indeterminate `clear` with the same key.

## API shape

All operations use `human` access, a 30-second timeout, and the header `Authorization: Bearer <human-jwt>`. The `clear` operation also requires an `Idempotency-Key` header with a fresh canonical ULID. The HTTP client of the CLI has a 31-second deadline.

| Command | Method and path                           | Operation ID           | Mutation |
| ------- | ----------------------------------------- | ---------------------- | -------- |
| `list`  | `GET /api/agent/cooldown`                 | `agent.cooldown.list`  | No       |
| `clear` | `DELETE /api/agent/cooldown/:cooldown_id` | `agent.cooldown.clear` | Yes      |

The static path `/api/agent/cooldown` does not match `GET /api/agent/:agent_name`. Neither request has a body.

```sh
curl -s http://127.0.0.1:31415/api/agent/cooldown \
  -H 'Authorization: Bearer <human-jwt>'

curl -s -X DELETE http://127.0.0.1:31415/api/agent/cooldown/agent_cooldown_01JZ8R2B3C4D5E6F7G8H9J0K1M \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

## CLI shape

```text
kanthord agent cooldown list
kanthord agent cooldown clear <cooldown-id> [--idempotency-key <ulid>]
```

Each command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord agent cooldown list
kanthord agent cooldown clear agent_cooldown_01JZ8R2B3C4D5E6F7G8H9J0K1M
```

| Argument        | Commands | Required | Purpose                                     |
| --------------- | -------- | -------- | ------------------------------------------- |
| `<cooldown-id>` | clear    | Yes      | Identity of the row; maps to `cooldown_id`. |

| Option                     | Commands | Default / resolution                                                        | Purpose                                                            |
| -------------------------- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--idempotency-key <ulid>` | clear    | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key on a retry. |
| `--token <jwt>`            | All      | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                           |
| `--endpoint <url>`         | All      | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                   |

The `agent` group declares `--token` and `--endpoint`. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration).
