# `POST /api/worker/register`

Register a worker instance using its existing client identity and secret and receive a machine JWT. This creates no human account, client identity or worker definition. Operation ID: `worker.register`. Access policy: **public**, with worker credential verification. Timeout: **10 seconds**. Mutation: **yes**. Secret response: **yes**.

```sh
curl -i http://127.0.0.1:31415/api/worker/register \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  --data '{"clientId":"<client-id>","clientSecret":"<client-secret>"}'
```

Use a fresh canonical ULID for a new registration request; retain it for retries of that request. Both body fields are required strings of 1–256 characters. The route accepts no query parameters. Duplicate JSON keys and extra schema fields are rejected. Its request-body limit is 40 KiB.

With configured collaborators, HTTP `200` returns `{"token":"<machine-jwt>","expiresAt":<unix-milliseconds>}`. The JWT uses `kind: "client"`, the verified client ID as `sub`, and the live registration ID as `reg`. The standalone Server currently supplies no Project/Worker integrations, so it returns **HTTP `503 gateway.authentication.registration.unavailable`** for a valid registration-shaped request.

Invalid credentials return `401`. After credential verification, a missing or malformed idempotency key returns `400 gateway.idempotency.invalid_key`; conflicting reuse returns `409`. Repeating the same accepted request verifies the credentials again and issues a fresh token for the same live registration. Cancelling after registration commits does not deregister it.

Related: [worker register CLI](../../cli/worker/register.md). [Reference index](../../README.md).
