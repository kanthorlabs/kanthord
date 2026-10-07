# Register a worker instance

[Reference index](../README.md)

## Function description

Register a worker instance using an existing machine bearer JWT and receive its runtime identity, not another JWT. The API and `kanthord worker register` create no human account, client identity, or worker definition.

Generate the credential locally with [`kanthord jwt generate --project <project id> --binding <binding name>`](../jwt.md). Its business claims are `kind: "client"`, `sub`, `name`, `project_id`, and `resource_identity`. Gateway verifies the token and resolves the worker binding in its project. Registration adds no claim to the JWT and issues no token.

A client identity holds at most one live registration. A client identity with a live registration receives that runtime identity with any idempotency key. Within the process-local replay TTL, a repeated key after that registration ends fails with `409 gateway.registration.stale`. Cancelling after registration commits does not deregister it.

The Project service resolves the worker binding from the `project_id` and `resource_identity` claims on each request. Local JWT issuance and this operation do not provision bindings.

## Expected response

The API returns HTTP `200` with only:

```json
{
  "runtime_identity": "<runtime-identity>",
  "resource_identity": "worker:kanthord:<binding-name>",
  "worker_name": "<worker-name>"
}
```

The CLI adds the retry key, writes one JSON line to stdout, and exits `0` (shown formatted here). Redirected stdout is allowed.

```json
{
  "runtime_identity": "<runtime-identity>",
  "resource_identity": "worker:kanthord:<binding-name>",
  "worker_name": "<worker-name>",
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property            | Type                  | Surface     | Purpose                                                                       |
| ------------------- | --------------------- | ----------- | ----------------------------------------------------------------------------- |
| `runtime_identity`  | string                | API and CLI | Runtime identity of the registered worker instance; not a JWT.                |
| `resource_identity` | string                | API and CLI | Worker binding of the instance, as `worker:kanthord:<binding name>`.          |
| `worker_name`       | string                | API and CLI | Name of the worker definition that the binding selects.                       |
| `idempotency_key`   | canonical ULID string | CLI only    | Key used for this request; retain it with the same machine token for retries. |

Neither response contains a token or expiry. The CLI saves no credential or endpoint.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Meaning                                                                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Missing, invalid, or expired token, a human token, or a token with a `binding` claim. Also a machine token whose binding is absent, removed, set to zero instances, or removed after token issuance. |
| `400 gateway.idempotency.invalid_key`     | Missing or malformed idempotency key, checked after authentication.                                                                                                                                  |
| `409 gateway.idempotency.conflict`        | Conflicting reuse of an idempotency key.                                                                                                                                                             |
| `409 gateway.registration.stale`          | The recorded registration has ended; replay does not recreate the instance.                                                                                                                          |
| `409 worker.instance.slot_unavailable`    | The binding is absent or removed, or every instance slot of the binding is in use.                                                                                                                   |

A declared failure makes the CLI exit `1` and report the originating error code, HTTP status, and retry key without credentials. A transport failure, timeout, or malformed response exits `1` with an indeterminate-result diagnostic and the retry key. Reuse the same key and machine token after an indeterminate result; there is no automatic retry.

## API shape

| Item                  | Value                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| Method and path       | `POST /api/worker/register`                                               |
| Operation ID          | `worker.register`                                                         |
| Access                | `client` (machine bearer JWT), without requiring an existing registration |
| Timeout               | 10 seconds                                                                |
| Mutation              | Yes                                                                       |
| Path/query parameters | None                                                                      |
| Request body          | None; even JSON `{}` is rejected                                          |

| Header            | Required | Purpose                                                                                     |
| ----------------- | -------- | ------------------------------------------------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` containing the existing machine credential.                          |
| `Idempotency-Key` | Yes      | Fresh canonical ULID for a new registration request; retain it for retries of that request. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/worker/register \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

The 40 KiB body limit does not permit a registration payload. Worker runtimes can call this API directly with their existing machine JWT.

## CLI shape

```text
kanthord worker register [--token <jwt>] [--endpoint <url>] [--idempotency-key <ulid>]
```

```sh
kanthord worker register \
  --token '<machine-jwt>' \
  --endpoint http://127.0.0.1:31415 \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
```

There are no positional arguments.

| Option                     | Default / resolution                                                        | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `--token <jwt>`            | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT sent as the bearer credential.                            |
| `--endpoint <url>`         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                      |
| `--idempotency-key <ulid>` | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header; supply the same key when retrying. |

Explicit options take precedence. Prefer `KANTHORD_TOKEN` or a private `cli.yaml` over literal tokens in shell history; see [client configuration](../README.md#client-configuration). The command sends no request body, reads no server configuration, rejects `--config`, and accepts no client-ID or client-secret options. The HTTP client has an 11-second deadline for this 10-second operation.
