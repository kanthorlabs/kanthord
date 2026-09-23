# `kanthord worker register`

Register a worker instance through [`POST /api/worker/register`](../../api/worker/register.md) and receive its JWT. This is not human signup and creates no worker definition or client identity.

```sh
kanthord worker register \
  --client-id '<existing-worker-client-id>' \
  --client-secret '<client-secret>' \
  --endpoint http://127.0.0.1:31415 \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
```

Prefer `KANTHORD_CLIENT_ID` and `KANTHORD_CLIENT_SECRET` over literal secrets in shell history. Command options override those variables. Both resolved credentials are required strings of 1–256 characters. The command sends the credentials in the JSON body, never as Basic authentication, and sends no human bearer token. Endpoint precedence is `--endpoint` → `KANTHORD_ENDPOINT` → the operator-supplied client file → `http://127.0.0.1:31415`.

The optional `--idempotency-key` must be a canonical ULID. If omitted, the client generates one. Reuse the same key and credentials after an indeterminate result; a replay reissues a JWT for the same live registration rather than consuming another instance slot. There is no automatic retry.

Success prints one JSON line to **terminal stdout** and exits `0`:

```json
{
  "token": "<worker-jwt>",
  "expiresAt": 1790000000000,
  "idempotencyKey": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

`expiresAt` uses Unix milliseconds. The terminal check runs **before** the request, so a redirected invocation consumes no instance slot. The command saves no credential or endpoint. Worker runtimes can call the API directly to obtain their token without displaying it.

A declared failure exits `1` and reports the originating error code, HTTP status and retry key, without credentials. A transport failure, timeout or malformed response exits `1` with an indeterminate-result diagnostic and the retry key. A cancellation does not undo an accepted registration.

The standalone Server currently has no Project/Worker integrations. Registration therefore returns `503 gateway.authentication.registration.unavailable` until those collaborators are supplied; this command does not provision them.

Related: [human JWT generation](../jwt.md). [Reference index](../../README.md).
