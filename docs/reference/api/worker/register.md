# `POST /api/worker/register`

Register a worker instance using an existing machine bearer JWT and receive its runtime identity, not another JWT. This creates no human account, client identity or worker definition. Operation ID: `worker.register`. Access policy: **client**, without requiring an existing registration. Timeout: **10 seconds**. Mutation: **yes**.

```sh
curl -i -X POST http://127.0.0.1:31415/api/worker/register \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

Generate the credential locally with [`kanthord jwt --binding <binding>`](../../cli/jwt.md). Its business claims are `kind: "client"`, `sub`, `name`, and `binding`. Gateway verifies the token and resolves the binding and its project. Registration adds no claim to the JWT and issues no token.

Use a fresh canonical ULID for a new registration request; retain it for retries of that request. The route accepts no path parameters, query parameters, or body. Even JSON `{}` is rejected. The 40 KiB body limit does not permit a registration payload.

HTTP `200` returns only:

```json
{ "runtimeIdentity": "<runtime-identity>" }
```

A client identity holds at most one live registration. Within the process-local replay TTL, repeating the same key under the same client identity replays the runtime identity while that registration remains live. If the recorded registration has ended, replay returns `409 gateway.registration.stale`; it does not recreate the instance. Cancelling after registration commits does not deregister it.

Missing, invalid, expired, banned, or human tokens return `401 gateway.authentication.unauthorized`. A machine token whose binding is absent or unavailable also returns `401`. After authentication, a missing or malformed idempotency key returns `400 gateway.idempotency.invalid_key`; conflicting reuse returns `409`.

The default Project service currently resolves no worker bindings, so the standalone Server rejects machine tokens with `401` until a binding resolver is supplied. Local JWT issuance does not provision a binding or registration.

Related: [worker register CLI](../../cli/worker/register.md), [JWT generation](../../cli/jwt.md). [Reference index](../../README.md).
