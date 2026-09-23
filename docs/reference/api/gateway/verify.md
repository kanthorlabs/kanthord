# `GET /api/auth/verify`

Verify a human bearer JWT and return its authenticated identity. Operation ID: `gateway.verify`. Access: **human**. Timeout: **10 seconds**. Input: empty path parameters and query, with no request body.

```sh
curl -i http://127.0.0.1:31415/api/auth/verify \
  -H 'Authorization: Bearer <jwt>'
```

For a JWT issued to `ulrich`, success is HTTP `200`:

```json
{ "kind": "human", "accountId": "ulrich" }
```

`accountId` carries the exact signed username. Authentication checks the signature, expiry, claim types, username validity, and session bans. Human tokens carry neither `ver` nor `reg`. Missing, malformed, tampered, expired, banned, or wrong-key tokens receive HTTP `401 gateway.authentication.unauthorized`; a valid machine identity also fails the human access policy.

The response returns the identity only. This is a read operation and creates no idempotency record.

Related: [verify CLI](../../cli/gateway/verify.md), [JWT generation](../../cli/jwt.md). [Reference index](../../README.md).
