# `GET /api/auth/verify`

Verify a human bearer JWT and return its business properties using their original claim names. Operation ID: `gateway.verify`. Access: **human**. Timeout: **10 seconds**. Input: empty path parameters and query, with no request body.

```sh
curl -i http://127.0.0.1:31415/api/auth/verify \
  -H 'Authorization: Bearer <jwt>'
```

For a JWT issued to `ulrich`, success is HTTP `200`:

```json
{ "kind": "human", "sub": "ulrich", "name": "ulrich" }
```

`kind`, `sub`, and `name` retain their exact values from the verified JWT. `sub` carries the signed username and `name` the display name; neither is trimmed or renamed. Authentication checks the signature, expiry, claim types, username and display-name validity, and session bans. Human tokens cannot carry `binding` or `reg`. Missing, malformed, tampered, expired, banned, or wrong-key tokens receive HTTP `401 gateway.authentication.unauthorized`; a valid machine identity also fails the human access policy.

The response contains only `kind`, `sub`, and `name`: no aliases such as `accountId`, raw token, signing key, or token metadata (`iat`, `exp`, `jti`). This is a read operation and creates no idempotency record.

Related: [verify CLI](../../cli/gateway/verify.md), [JWT generation](../../cli/jwt.md). [Reference index](../../README.md).
