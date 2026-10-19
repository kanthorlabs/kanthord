# Agent cooldowns

[Reference index](../README.md)

## Function description

A cooldown excludes every model of one credential from the claim selection until its end time `available_at`. A release with the stop reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` writes it. The claim then selects the next entry of the fallback chain of each agent whose credential is not cooling. The codes `bad_request` and `unauthorized` write no cooldown.

The key of a cooldown is the credential name. `swe@1`, `re@1` and every project share it. A repeated advance on the same credential adds one strike. The duration is the base of the code, doubled for each strike after the first, up to the maximum. An expired cooldown keeps its strikes until a release with no `provider_failed` stop releases the credential. A success on any model of the credential releases every model. A human can also clear a credential. The server log records three events at level `info`. `agent.fallback.cooldown_started` carries `execution_id`, `credential_name`, `code`, `strikes` and `available_at`. `agent.fallback.cooldown_cleared` appears only when a release or a human clear resets strikes above 0, also for an expired cooldown, and it carries `credential_name`, with `execution_id` for a release. The log names the credential `credential_name`, because the log redacts a field named `credential`. After a new claim commits, `agent.fallback.selected` logs each selection.

| Server configuration key            | Default    | Purpose                                       |
| ----------------------------------- | ---------- | --------------------------------------------- |
| `agent.cooldown.rate_limited_ms`    | `60000`    | Base duration for the code `rate_limited`.    |
| `agent.cooldown.unavailable_ms`     | `60000`    | Base duration for the code `unavailable`.     |
| `agent.cooldown.quota_exhausted_ms` | `3600000`  | Base duration for the code `quota_exhausted`. |
| `agent.cooldown.max_ms`             | `86400000` | Maximum duration after the doubling.          |

When the credential of every entry of the chain of an agent has a live cooldown, a work pull answers `no-work`. That answer creates no block, no pause and no failed execution. The agent views report `cooling` with the code `agent.configuration.chain_cooling`; see [the agent view](agent.md#expected-response) and [the worker binding agent view](../project/agent.md#expected-response). That code is a view code and has no HTTP status.

| Command | Effect                                                                |
| ------- | --------------------------------------------------------------------- |
| `list`  | Read every credential that holds a cooldown, live and expired.        |
| `clear` | Release one credential, so that its entries return at the next claim. |

## Expected response

### `cooldown list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "items": [
    {
      "credential": "<credential-name>",
      "strikes": 2,
      "available_at": 1791447720000
    }
  ]
}
```

| Property               | Type             | Purpose                                                                                          |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `items`                | array            | Every credential with `strikes` above 0, ordered by credential name. The list has no pagination. |
| `items[].credential`   | string           | Credential name.                                                                                 |
| `items[].strikes`      | positive integer | Count of advances since the last release of the credential.                                      |
| `items[].available_at` | timestamp        | Unix epoch milliseconds when the cooldown ends. A past `available_at` marks an expired cooldown. |

### `cooldown clear`

The API returns HTTP `204` with no body. The CLI writes one JSON line with the retry key and exits `0`:

```json
{ "idempotency_key": "01M4C5G6DGWEVZYSPETSQR65JH" }
```

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                                |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | All      | Missing, invalid, expired or banned token, or a machine token.         |
| `400 gateway.request.validation_failed`   | All      | A path parameter fails the schema.                                     |
| `400 gateway.request.unexpected_body`     | All      | The request has a body.                                                |
| `400 gateway.idempotency.invalid_key`     | clear    | Missing or malformed idempotency key.                                  |
| `409 gateway.idempotency.conflict`        | clear    | The key belongs to a different request of the same caller.             |
| `404 agent.cooldown.not_found`            | clear    | The credential holds no cooldown. `details.credential` holds its name. |
| `504 gateway.invocation.timeout`          | All      | The operation exceeded 30 seconds.                                     |

The CLI checks some input before it sends the request.

| CLI code                                      | Commands | Meaning                                                          |
| --------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `cli.agent.cooldown.<command>.token_required` | All      | No option, environment variable or client file supplies a token. |
| `cli.idempotency_key.invalid`                 | clear    | `--idempotency-key` is not a canonical ULID.                     |
| `cli.agent.cooldown.<command>.indeterminate`  | All      | A transport failure, timeout or malformed response.              |

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr. A `clear` prints `<code>: request failed` and the rows `status: <status>` and `idempotency_key: <key>` instead. Retry an indeterminate `clear` with the same key.

## API shape

All operations use `human` access, a 30-second timeout, and the header `Authorization: Bearer <human-jwt>`. The `clear` operation also requires an `Idempotency-Key` header with a fresh canonical ULID. The HTTP client of the CLI has a 31-second deadline.

| Command | Method and path                          | Operation ID           | Mutation |
| ------- | ---------------------------------------- | ---------------------- | -------- |
| `list`  | `GET /api/agent/cooldown`                | `agent.cooldown.list`  | No       |
| `clear` | `DELETE /api/agent/cooldown/:credential` | `agent.cooldown.clear` | Yes      |

The static path `/api/agent/cooldown` does not match `GET /api/agent/:agent_name`. Neither request has a body.

```sh
curl -s http://127.0.0.1:31415/api/agent/cooldown \
  -H 'Authorization: Bearer <human-jwt>'

curl -s -X DELETE http://127.0.0.1:31415/api/agent/cooldown/<credential-name> \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

## CLI shape

```text
kanthord agent cooldown list
kanthord agent cooldown clear <credential> [--idempotency-key <ulid>]
```

Each command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord agent cooldown list
kanthord agent cooldown clear <credential-name>
```

| Argument       | Commands | Required | Purpose                                |
| -------------- | -------- | -------- | -------------------------------------- |
| `<credential>` | clear    | Yes      | Credential name; maps to `credential`. |

| Option                     | Commands | Default / resolution                                                        | Purpose                                                            |
| -------------------------- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `--idempotency-key <ulid>` | clear    | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key on a retry. |
| `--token <jwt>`            | All      | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                           |
| `--endpoint <url>`         | All      | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                   |

The `agent` group declares `--token` and `--endpoint`. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration).
