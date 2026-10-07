# Hand over execution credentials

[Reference index](../README.md)

## Function description

Receive the provider credential of a running execution as a sealed envelope. The caller is a registered worker instance that holds a live claim on the execution.

The server reads the worker binding of the execution and the effective agent configuration. It then releases the credential revision that the execution pins. If the execution pins no revision yet, the handover pins the newest live revision of that credential. The server seals the credential with AES-256-GCM before the response.

The seal key derives from the client secret of the caller's client identity. The additional authenticated data binds the envelope to the execution identity and the runtime identity. The worker opens the envelope with a key that it derives from the same client secret.

The response is secret. Gateway records no replayable answer for it. A repeated idempotency key returns a conflict without the envelope. Use a new key to receive the envelope again.

`worker handover` calls the same operation but discards the envelope. It prints only a receipt. Use it to check that a handover succeeds; worker runtimes call the API directly to use the credential.

## Expected response

The API returns HTTP `200` with the sealed envelope:

```json
{ "nonce": "<base64-nonce>", "ciphertext": "<base64-ciphertext>" }
```

| Property     | Type          | Surface  | Purpose                                                           |
| ------------ | ------------- | -------- | ----------------------------------------------------------------- |
| `nonce`      | base64 string | API only | 12-byte AES-256-GCM nonce.                                        |
| `ciphertext` | base64 string | API only | Encrypted credential, followed by the 16-byte authentication tag. |

The CLI writes one JSON line to stdout and exits `0` (shown formatted here):

```json
{
  "received": true,
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property          | Type                  | Surface  | Purpose                          |
| ----------------- | --------------------- | -------- | -------------------------------- |
| `received`        | boolean, always true  | CLI only | The server returned an envelope. |
| `idempotency_key` | canonical ULID string | CLI only | Key used for this request.       |

The CLI output contains no envelope, nonce or credential.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Meaning                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | Missing, invalid, expired or human token; also a machine token whose worker binding does not resolve.                                                |
| `403 gateway.registration.required`             | The client identity of the token has no live registration.                                                                                           |
| `415 gateway.request.unsupported_media_type`    | The `Content-Type` is not `application/json`.                                                                                                        |
| `400 gateway.request.validation_failed`         | The body is not exactly `{ "execution_id": "<execution-id>" }` with a canonical execution identity.                                                  |
| `413 gateway.request.body_too_large`            | The body is larger than 1 KiB.                                                                                                                       |
| `403 gateway.invocation.execution_proof_failed` | The execution is not a live, unexpired claim of the caller's registration.                                                                           |
| `400 gateway.idempotency.invalid_key`           | Missing or malformed idempotency key, checked after the execution proof.                                                                             |
| `409 gateway.idempotency.conflict`              | The caller used the key before; a repeat of a completed handover also conflicts.                                                                     |
| `403 worker.authorization.refused`              | The worker binding does not permit the handover. `details.reason` is `binding_mismatch`, `binding_removed`, `binding_disabled` or `no_native_agent`. |
| `400` agent configuration code                  | The effective agent configuration is not valid; the code is the first issue, for example `agent.enablement.unavailable`.                             |
| `409 credential.revision.revoked`               | The pinned credential revision is revoked.                                                                                                           |
| `404 credential.credential.not_found`           | The credential has no live revision to pin.                                                                                                          |
| `400 credential.platform.mismatch`              | The credential platform does not match the agent provider.                                                                                           |

A declared failure makes the CLI exit `1` and write `<code>: worker handover: request failed (HTTP <status>); idempotency key <key>.` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.worker.handover.indeterminate`. Retry an indeterminate result with a new `--idempotency-key`, because a repeated key always conflicts.

## API shape

| Item                  | Value                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| Method and path       | `POST /api/worker/handover`                                                   |
| Operation ID          | `worker.handover`                                                             |
| Access                | `client` (machine bearer JWT) with a live registration and an execution proof |
| Timeout               | 30 seconds                                                                    |
| Mutation              | Yes; secret, so no answer is replayed                                         |
| Path/query parameters | None                                                                          |
| Request body          | `{ "execution_id": "<execution-id>" }`; JSON, at most 1 KiB                   |

| Header            | Required | Purpose                                          |
| ----------------- | -------- | ------------------------------------------------ |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the registered client. |
| `Content-Type`    | Yes      | `application/json`.                              |
| `Idempotency-Key` | Yes      | Fresh canonical ULID for each handover request.  |

```sh
curl -i -X POST http://127.0.0.1:31415/api/worker/handover \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"execution_id":"<execution-id>"}'
```

The `execution_id` is a prefixed identity, for example `execution_<ulid>`; see the [identity contract](../identities.md).

## CLI shape

```text
kanthord worker handover <execution-id> [--token <jwt>] [--endpoint <url>] [--idempotency-key <ulid>]
```

```sh
kanthord worker handover '<execution-id>' \
  --token '<machine-jwt>' \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
```

| Argument         | Purpose                                                         |
| ---------------- | --------------------------------------------------------------- |
| `<execution-id>` | Canonical execution identity that the caller's instance claims. |

| Option                     | Default / resolution                                                        | Purpose                                    |
| -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| `--token <jwt>`            | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT sent as the bearer credential. |
| `--endpoint <url>`         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                           |
| `--idempotency-key <ulid>` | A generated canonical ULID                                                  | Sets the `Idempotency-Key` header.         |

The CLI checks its input before the request. An invalid execution identity fails with `cli.worker.handover.invalid_execution_id`. A missing token fails with `cli.worker.handover.token_required`. A malformed key fails with `cli.idempotency_key.invalid`. A repeated `--token` or `--idempotency-key` fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration) for the token and endpoint precedence. The HTTP client deadline is 31 seconds.
