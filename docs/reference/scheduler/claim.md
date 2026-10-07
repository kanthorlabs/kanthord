# Read an own claim

[Reference index](../README.md)

## Function description

A registered worker instance reads one execution that it claimed. The result is the same `ExecutionRecord` that [`execution get`](execution.md) returns, but the caller is a machine identity, not a human.

The execution must belong to the caller. Its runtime identity, project and resource identity must equal those of the live registration of the caller. The read also returns an ended or lost execution while that registration stays live. It grants no authority: every later execution operation checks liveness again.

Use this read after a lost answer of [`execution release`](execution.md#execution-release). A committed release shows `claim_state` `finished`. After the registration ends, a human reads the execution with `execution get`.

## Expected response

The API returns HTTP `200` with one [`ExecutionRecord`](execution.md#executionrecord). The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "project_id": "project_01JZ8PZ0A1B2C3D4E5F6G7H8J9",
  "node_id": "node_01JZ8Q0K4M6N8P0R2S4T6V8W0X",
  "claimant": {
    "worker_binding_id": "binding_01JZ8PZ5N6P7Q8R9S0T1V2W3X4",
    "resource_identity": "<resource-identity>",
    "runtime_identity": "worker_instance_01JZ8R0Y1Z2A3B4C5D6E7F8G9H",
    "client_id": "client_identity_01JZ8QZW2X3Y4Z5A6B7C8D9E0F",
    "name": "Worker display name"
  },
  "attempt": 1,
  "pinned_revision": 3,
  "credentials": [],
  "claim_state": "running",
  "expired_at": 1791449400000,
  "created_at": 1791447600000,
  "ended_at": null,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "root_span_id": "00f067aa0ba902b7"
}
```

| Property    | Purpose                                                              |
| ----------- | -------------------------------------------------------------------- |
| Every field | Same as the [`ExecutionRecord` table](execution.md#executionrecord). |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Meaning                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Missing, invalid or expired token, a human token, or a machine token whose binding does not resolve. |
| `403 gateway.registration.required`       | The machine identity holds no live worker registration.                                              |
| `400 gateway.request.validation_failed`   | `execution_id` is not a canonical `execution_<ulid>` identity, or the request has a query field.     |
| `400 gateway.request.unexpected_body`     | The request carries a body.                                                                          |
| `404 scheduler.execution.not_found`       | No execution has this identity.                                                                      |
| `403 scheduler.execution.not_owner`       | The execution belongs to another runtime identity, project or resource identity.                     |
| `504 gateway.invocation.timeout`          | The operation did not complete in 30 seconds.                                                        |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                       | Meaning                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `cli.scheduler.claim.get.invalid_execution_id` | `<execution-id>` is not a canonical `execution_<ulid>` identity. |
| `cli.scheduler.claim.get.token_required`       | No nonblank token resolves.                                      |
| `cli.option.duplicate`                         | An option occurs more than once.                                 |

A declared API failure makes the CLI exit `1`. The diagnostic starts with the error code of the API. A transport failure, timeout or malformed response exits `1` with `cli.scheduler.claim.get.indeterminate`. This read changes nothing, so run the command again.

## API shape

| Item                  | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Method and path       | `GET /api/scheduler/claim/:execution_id`                      |
| Operation ID          | `scheduler.claim.get`                                         |
| Access                | `client` (machine bearer JWT) with a live worker registration |
| Timeout               | 30 seconds                                                    |
| Mutation              | No                                                            |
| Path/query parameters | `execution_id` (path, required); no query fields              |
| Request body          | None                                                          |

| Header          | Required | Purpose                                                   |
| --------------- | -------- | --------------------------------------------------------- |
| `Authorization` | Yes      | `Bearer <machine-jwt>` of the registered worker instance. |

```sh
curl -i http://127.0.0.1:31415/api/scheduler/claim/execution_01JZ8R2B3C4D5E6F7G8H9J0K1M \
  -H 'Authorization: Bearer <machine-jwt>'
```

## CLI shape

```text
kanthord scheduler claim get <execution-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler claim get execution_01JZ8R2B3C4D5E6F7G8H9J0K1M --token '<machine-jwt>'
```

| Positional argument | Purpose                              |
| ------------------- | ------------------------------------ |
| `<execution-id>`    | Required `execution_<ulid>` to read. |

| Option             | Default / resolution                                                        | Purpose                                    |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------ |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                           |

`--token` and `--endpoint` belong to the `scheduler` group, and each leaf command accepts them. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The command reads no server configuration. The HTTP client has a 31-second deadline for this 30-second operation.
