# `kanthord worker register`

Register a worker instance through [`POST /api/worker/register`](../../api/worker/register.md) using its machine JWT and receive its runtime identity. This is not token issuance or human signup and creates no worker definition or client identity.

```sh
kanthord worker register \
  --token '<machine-jwt>' \
  --endpoint http://127.0.0.1:31415 \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
```

Generate the machine JWT beforehand with [`kanthord jwt --binding <binding>`](../jwt.md). Prefer `KANTHORD_TOKEN` or a private `cli.yaml` over literal tokens in shell history. Token precedence is `--token` → `KANTHORD_TOKEN` → client-file token. A nonblank resolved token is required. The command sends it as a bearer credential with no request body; it accepts no client-ID or client-secret options.

Endpoint precedence is `--endpoint` → `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`. The command reads no server configuration and rejects `--config`.

The optional `--idempotency-key` must be a canonical ULID. If omitted, the client generates one. Reuse the same key and machine token after an indeterminate result; within the replay TTL, a replay returns the same live runtime identity rather than consuming another instance slot. No JWT is issued or changed. There is no automatic retry.

Success prints one JSON line and exits `0`:

```json
{
  "runtimeIdentity": "<runtime-identity>",
  "idempotencyKey": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

Redirected stdout is allowed; registration returns no token or expiry. The command saves no credential or endpoint. Worker runtimes can call the API directly with their existing machine JWT.

A declared failure exits `1` and reports the originating error code, HTTP status and retry key, without credentials. A transport failure, timeout or malformed response exits `1` with an indeterminate-result diagnostic and the retry key. A cancellation does not undo an accepted registration. Replaying an ended registration returns `409 gateway.registration.stale` rather than recreating it.

The default Project service currently resolves no worker bindings. The standalone Server therefore rejects machine tokens with `401` until a binding resolver is supplied; this command does not provision bindings.

Related: [JWT generation](../jwt.md). [Reference index](../../README.md).
