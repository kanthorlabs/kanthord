# Renew a worker heartbeat

[Reference index](../README.md)

## Function description

Renew the heartbeat of the live registration that belongs to the machine JWT. The request carries no runtime identity and no body. Gateway finds the registration from the client identity of the token.

Every authenticated machine request with a live registration renews its heartbeat, not only this operation. This operation renews the heartbeat without other effects.

The server checks heartbeats every 30 seconds. It ends each registration whose last heartbeat is older than the `worker.heartbeat_window` server setting, in seconds. The default window is `300`. An ended registration frees its slot. Send a heartbeat more often than the window to keep the registration live.

Heartbeat readings are process-local. When the Server starts, it starts a new window for each live registration.

## Expected response

The API returns HTTP `204` with no body.

The CLI writes one JSON line to stdout and exits `0`:

```json
null
```

| Output     | Purpose                                                  |
| ---------- | -------------------------------------------------------- |
| HTTP `204` | The server renewed the heartbeat of the registration.    |
| CLI `null` | The CLI printed the empty answer; the renewal succeeded. |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Meaning                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Missing, invalid, expired or human token; also a machine token whose worker binding does not resolve. |
| `403 gateway.registration.required`       | The client identity of the token has no live registration. Register again with `worker register`.     |
| `400 gateway.request.unexpected_body`     | The request has a body.                                                                               |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.worker.heartbeat.indeterminate`. Run the command again after an indeterminate result.

## API shape

| Item                  | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| Method and path       | `POST /api/worker/heartbeat`                           |
| Operation ID          | `worker.heartbeat`                                     |
| Access                | `client` (machine bearer JWT) with a live registration |
| Timeout               | 30 seconds                                             |
| Mutation              | No; the operation takes no `Idempotency-Key`           |
| Path/query parameters | None                                                   |
| Request body          | None                                                   |

| Header          | Required | Purpose                                          |
| --------------- | -------- | ------------------------------------------------ |
| `Authorization` | Yes      | `Bearer <machine-jwt>` of the registered client. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/worker/heartbeat \
  -H 'Authorization: Bearer <machine-jwt>'
```

## CLI shape

```text
kanthord worker heartbeat [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker heartbeat --token '<machine-jwt>'
```

There are no positional arguments.

| Option             | Default / resolution                                                        | Purpose                                    |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------ |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                           |

A missing token fails with `cli.worker.heartbeat.token_required`. A repeated `--token` fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration) for the token and endpoint precedence. The HTTP client deadline is 31 seconds.
