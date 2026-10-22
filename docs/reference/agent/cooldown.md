# Agent cooldowns

[Reference index](../README.md)

## Function description

A cooldown excludes every model of one copy of a credential from the claim selection until its end time `available_at`. A release with the stop reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` writes it. The claim then selects the next entry of the fallback chain of each agent whose credential copy is not cooling. The codes `bad_request` and `unauthorized` write no cooldown.

The key of a cooldown is the credential name and its holder. The holder is `server` or a worker instance; see [instance copies](../llm/credential.md#instance-copies). A claim writes and reads the copy of its claimant: the instance of the registration at the `worker` placement, else `server`. `swe@1`, `re@1` and every project share a key. An advance is such a release: it moves the agent to the next chain entry. A repeated advance on the same copy adds one strike. The duration is the base of the code, doubled for each strike after the first, up to the maximum. An expired cooldown keeps its strikes until a release with no `provider_failed` stop releases the copy. Any release without a `provider_failed` stop on any model of the copy releases every model of the copy, a `budget_end` stop or another failure stop included. A `provider_failed` stop with `unauthorized` or `bad_request` neither adds a strike nor releases the copy. A human can also clear a copy. The server log records three events at level `info`, each after its write commits. `agent.fallback.cooldown_started` carries `execution_id`, `credential_name`, `holder`, `code`, `strikes` and `available_at`. `agent.fallback.cooldown_cleared` appears only when a release or a human clear resets strikes above 0, also for an expired cooldown, and it carries `credential_name` and `holder`, with `execution_id` for a release. The log names the credential `credential_name`, because the log redacts a field named `credential`. After a new claim commits, `agent.fallback.selected` logs each selection.

| Server configuration key            | Default    | Purpose                                       |
| ----------------------------------- | ---------- | --------------------------------------------- |
| `agent.cooldown.rate_limited_ms`    | `60000`    | Base duration for the code `rate_limited`.    |
| `agent.cooldown.unavailable_ms`     | `60000`    | Base duration for the code `unavailable`.     |
| `agent.cooldown.quota_exhausted_ms` | `3600000`  | Base duration for the code `quota_exhausted`. |
| `agent.cooldown.max_ms`             | `86400000` | Maximum duration after the doubling.          |

When the claimant copy of the credential of every entry of the chain of an agent has a live cooldown, a work pull answers `no-work`. That answer creates no block, no pause and no failed execution. The agent views report `cooling` with the code `agent.configuration.chain_cooling`; see [the agent view](agent.md#expected-response) and [the worker binding agent view](../project/agent.md#expected-response). That code is a view code and has no HTTP status. At the `worker` placement, each instance holds its own copy. The worker binding agent view shows the cooldown with the latest `available_at` over the instances of the binding.

The **Cooldown** section of the LLM credential page reads `cooldown list`. It shows the strike and the end time of a live cooldown, and the strikes of an expired cooldown. The **Details** tab of an `Available` node and the **Overview** status line read `cooling` of the [worker binding agent view](../project/agent.md#expected-response).

| Command | Effect                                                                                    |
| ------- | ----------------------------------------------------------------------------------------- |
| `list`  | Read every credential copy that holds a cooldown, live and expired.                       |
| `clear` | Release one credential copy, so that its entries return at the next claim of that holder. |

## Expected response

### `cooldown list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "items": [
    {
      "credential": "<credential-name>",
      "holder": "server",
      "strikes": 2,
      "available_at": 1791447720000
    }
  ]
}
```

| Property               | Type             | Purpose                                                                                                               |
| ---------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `items`                | array            | Every credential copy with `strikes` above 0, ordered by credential name, then by holder. The list has no pagination. |
| `items[].credential`   | string           | Credential name.                                                                                                      |
| `items[].holder`       | string           | Holder of the copy: `server` or a worker instance name.                                                               |
| `items[].strikes`      | positive integer | Count of advances since the last release of the copy.                                                                 |
| `items[].available_at` | timestamp        | Unix epoch milliseconds when the cooldown ends. A past `available_at` marks an expired cooldown.                      |

### `cooldown clear`

The API returns HTTP `204` with no body. The CLI writes one JSON line with the retry key and exits `0`:

```json
{ "idempotency_key": "idempotency_key_01M4C5G6DGWEVZYSPETSQR65JH" }
```

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                               |
| ----------------------------------------- | -------- | --------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | All      | Missing, invalid, expired or banned token, or a machine token.        |
| `400 gateway.request.validation_failed`   | All      | A path parameter or the query fails the schema.                       |
| `400 gateway.request.unexpected_body`     | All      | The request has a body.                                               |
| `400 gateway.idempotency.invalid_key`     | clear    | Missing or malformed idempotency key.                                 |
| `409 gateway.idempotency.conflict`        | clear    | The key belongs to a different request of the same caller.            |
| `404 agent.cooldown.not_found`            | clear    | The copy holds no cooldown. `details` holds `{ credential, holder }`. |
| `504 gateway.invocation.timeout`          | All      | The operation exceeded 30 seconds.                                    |

The CLI checks some input before it sends the request.

| CLI code                                      | Commands | Meaning                                                          |
| --------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `cli.agent.cooldown.<command>.token_required` | All      | No option, environment variable or client file supplies a token. |
| `cli.idempotency_key.invalid`                 | clear    | `--idempotency-key` is not an `idempotency_key_<ulid>` value.    |
| `cli.agent.cooldown.<command>.indeterminate`  | All      | A transport failure, timeout or malformed response.              |

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr. A `clear` prints `<code>: request failed` and the rows `status: <status>` and `idempotency_key: <key>` instead. Retry an indeterminate `clear` with the same key.

## API shape

All operations use `human` access, a 30-second timeout, and the header `Authorization: Bearer <human-jwt>`. The `clear` operation also requires an `Idempotency-Key` header with a fresh `idempotency_key_<ulid>`. The HTTP client of the CLI has a 31-second deadline.

| Command | Method and path                          | Operation ID           | Mutation |
| ------- | ---------------------------------------- | ---------------------- | -------- |
| `list`  | `GET /api/agent/cooldown`                | `agent.cooldown.list`  | No       |
| `clear` | `DELETE /api/agent/cooldown/:credential` | `agent.cooldown.clear` | Yes      |

The static path `/api/agent/cooldown` does not match `GET /api/agent/:agent_name`. Neither request has a body. `clear` takes the optional query `holder`, and its default is `server`.

```sh
curl -s http://127.0.0.1:31415/api/agent/cooldown \
  -H 'Authorization: Bearer <human-jwt>'

curl -s -X DELETE 'http://127.0.0.1:31415/api/agent/cooldown/<credential-name>?holder=builder-1' \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST'
```

## CLI shape

```text
kanthord agent cooldown list
kanthord agent cooldown clear <credential> [--holder <name>] [--idempotency-key <key>]
```

Each command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord agent cooldown list
kanthord agent cooldown clear <credential-name>
kanthord agent cooldown clear <credential-name> --holder builder-1
```

| Argument       | Commands | Required | Purpose                                |
| -------------- | -------- | -------- | -------------------------------------- |
| `<credential>` | clear    | Yes      | Credential name; maps to `credential`. |

| Option                    | Commands | Default / resolution                                                        | Purpose                                                                   |
| ------------------------- | -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `--holder <name>`         | clear    | `server`                                                                    | Holder of the copy: `server` or a worker instance name; maps to `holder`. |
| `--idempotency-key <key>` | clear    | A generated `idempotency_key_<ulid>`                                        | Sets the `Idempotency-Key` header; supply the same key on a retry.        |
| `--token <jwt>`           | All      | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                                  |
| `--endpoint <url>`        | All      | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                          |

The `agent` group declares `--token` and `--endpoint`. Each option except `--endpoint` accepts one occurrence only; a repeat fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration).
