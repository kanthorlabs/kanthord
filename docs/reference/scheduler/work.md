# Pull work

[Reference index](../README.md)

## Function description

A registered worker instance asks for one job that it can execute. When the Scheduler admits a claim, it creates an execution and returns it. When it cannot admit a claim, it holds the request for at most 90 seconds and then answers `no-work`.

The caller is a machine identity with a live [worker registration](../worker/register.md). The request body names the runtime identity and the resource identity of that registration. The authenticated binding sets the project; the body cannot select a project, node, priority or attempt.

The Scheduler processes a pull in this order:

1. When the runtime identity holds a live execution, the pull returns that execution as `claimed`. It creates no second execution.
2. When the instance healthcheck fails, the pull answers `no-work` at once. The healthcheck fails for an ended registration, an absent or deleted binding, a binding with an instance count of `0`, or an invalid agent configuration of a server-hosted worker.
3. When the binding group already runs as many executions as its instance count, the pull admits no claim.
4. Otherwise, the Scheduler reads the project queue in queue order. It claims the first job whose node the Mission Service admits for the node states that the worker declares.

A claim creates one execution with a fixed deadline. `expired_at` is `created_at`, plus the wall time of the binding or the worker declaration, plus `scheduler.release_reserve` seconds (default `600`). After `expired_at`, the claim is lost.

When step 3 or step 4 admits no claim, the request waits. A wakeup for the project, for example after a release or a Mission or Project change, makes it try again. The 30-second loss sweep also wakes every pull that waits. It answers `no-work` when the 90-second window ends. It answers at once in these cases:

- Another pull of the same runtime identity already waits.
- The pull settles an expired execution of this instance or of a node in the queue.
- The server stops. During shutdown, a pull claims nothing and answers `no-work`.

`no-work` opens no attempt, creates no execution and holds no reservation. The worker decides when to pull again.

`work pull` is a mutation and requires an idempotency key. A retry with the same key and the same body returns the recorded answer while the gateway holds the record (`gateway.idempotency_ttl`, default 86400 seconds). A replay does not show later changes to the execution. A new key from an instance with a live execution also returns that execution.

## Expected response

The API returns HTTP `200` with one of two objects.

```json
{ "kind": "no-work" }
```

```json
{
  "kind": "claimed",
  "execution": {
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
}
```

The CLI adds the retry key, writes one JSON line to stdout, and exits `0`. Both `claimed` and `no-work` exit `0`.

```json
{ "kind": "no-work", "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST" }
```

| Property          | Type                   | Surface     | Purpose                                                                                      |
| ----------------- | ---------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `kind`            | `claimed` or `no-work` | API and CLI | Result of the pull.                                                                          |
| `execution`       | `ExecutionRecord`      | API and CLI | Only with `claimed`. The fields are in [the execution record](execution.md#executionrecord). |
| `idempotency_key` | canonical ULID string  | CLI only    | Key used for this request; retain it for a retry.                                            |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Meaning                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Missing, invalid or expired token, a human token, or a machine token whose binding does not resolve. |
| `403 gateway.registration.required`          | The machine identity holds no live worker registration.                                              |
| `415 gateway.request.unsupported_media_type` | The `Content-Type` is not `application/json`.                                                        |
| `400 gateway.request.invalid_json`           | The body is not valid JSON, or an object repeats a member name.                                      |
| `400 gateway.request.validation_failed`      | The body is not the closed object below, or a field is invalid.                                      |
| `400 gateway.idempotency.invalid_key`        | Missing or malformed `Idempotency-Key`.                                                              |
| `409 gateway.idempotency.conflict`           | The key is in use by a request that has not completed, or by a different request.                    |
| `403 scheduler.work.claimant_mismatch`       | `runtime_identity` or `resource_identity` differs from the live registration of the caller.          |
| `413 gateway.request.body_too_large`         | The body exceeds 10 MiB.                                                                             |
| `504 gateway.invocation.timeout`             | The operation did not complete in 120 seconds.                                                       |

The CLI checks the file and the key before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                 | Meaning                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `cli.file.invalid_path`                  | `--file -` is not accepted; the command does not read stdin. |
| `cli.file.not_found`                     | The file does not exist.                                     |
| `cli.file.not_regular`                   | The path is not a regular file.                              |
| `cli.file.encoding_invalid`              | The file is not valid UTF-8.                                 |
| `cli.file.not_json`                      | The file is not valid JSON.                                  |
| `cli.file.duplicate_key`                 | A JSON object repeats a member name.                         |
| `cli.file.not_object`                    | The JSON value is not an object.                             |
| `cli.file.schema_invalid`                | The object is not the closed request body below.             |
| `cli.idempotency_key.invalid`            | `--idempotency-key` is not a canonical ULID.                 |
| `cli.scheduler.work.pull.token_required` | No nonblank token resolves.                                  |
| `cli.option.duplicate`                   | An option occurs more than once.                             |

A declared API failure makes the CLI exit `1`. The diagnostic starts with the error code of the API and includes the retry key. A transport failure, timeout or malformed response exits `1` with `cli.scheduler.work.pull.indeterminate` and the retry key. After an indeterminate result, send the same file with the same key and machine token. There is no automatic retry.

## API shape

| Item                  | Value                                                         |
| --------------------- | ------------------------------------------------------------- |
| Method and path       | `POST /api/scheduler/work/pull`                               |
| Operation ID          | `scheduler.work.pull`                                         |
| Access                | `client` (machine bearer JWT) with a live worker registration |
| Timeout               | 120 seconds; the wait window is 90 seconds                    |
| Mutation              | Yes                                                           |
| Path/query parameters | None                                                          |
| Request body          | Closed JSON object; see the table below                       |

| Body field          | Type                     | Requirement                                                         |
| ------------------- | ------------------------ | ------------------------------------------------------------------- |
| `resource_identity` | nonempty string          | Required. Must equal the resource identity of the machine identity. |
| `runtime_identity`  | `worker_instance_<ulid>` | Required. Must equal the runtime identity of the live registration. |

| Header            | Required | Purpose                                                                  |
| ----------------- | -------- | ------------------------------------------------------------------------ |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the registered worker instance.                |
| `Content-Type`    | Yes      | `application/json`.                                                      |
| `Idempotency-Key` | Yes      | Fresh canonical ULID for a new pull; retain it for retries of that pull. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/scheduler/work/pull \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  --max-time 125 \
  -d '{"resource_identity":"<resource-identity>","runtime_identity":"<runtime-identity>"}'
```

A disconnect ends the wait for an answer. It does not undo a committed claim. The next pull of the same runtime identity returns that live execution.

## CLI shape

```text
kanthord scheduler work pull --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
cat > pull.json <<'EOF'
{ "resource_identity": "<resource-identity>", "runtime_identity": "<runtime-identity>" }
EOF
kanthord scheduler work pull --file pull.json --token '<machine-jwt>'
```

There are no positional arguments.

| Option                     | Default / resolution                                                        | Purpose                                                                       |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `--file <path>`            | Required; no default                                                        | JSON file that holds the request body. The file must be a regular UTF-8 file. |
| `--idempotency-key <ulid>` | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key when you retry.        |
| `--token <jwt>`            | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT sent as the bearer credential.                                    |
| `--endpoint <url>`         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                              |

`--token` and `--endpoint` belong to the `scheduler` group, and each leaf command accepts them. Explicit options take precedence; see [client configuration](../README.md#client-configuration). Generate the machine JWT with [`kanthord jwt generate`](../jwt.md). The command reads no server configuration. The HTTP client has a 121-second deadline for this 120-second operation.
