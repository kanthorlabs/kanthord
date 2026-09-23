# `kanthord jwt [username]`

Generate a human JWT locally from the validated server configuration. This is the only human-token issuance command; server startup issues no token and there is no human login flow.

```sh
kanthord jwt
kanthord jwt ulrich --config /absolute/path/kanthord.yaml
```

The optional positional username defaults to `KANTHORD_AUTH_USERNAME` (`kanthorlabs`). An explicit value must be nonblank and at most 64 JavaScript string code units; its exact value is preserved. `--config` uses the server configuration precedence described in [config init](config/init.md).

The payload contains `sub`, `kind: "human"`, `iat`, `exp`, and a fresh ULID `jti`. JWT timestamps are Unix seconds; expiry uses `gateway.tokenLifetime`. Success prints only the token and a newline to **terminal stdout**, then exits `0`. Invalid inputs or redirected stdout fail with exit `1`.

The command saves no client file and calls no server. Supply the token through `--token` or `KANTHORD_TOKEN` when verifying it. Worker instances instead obtain their JWT through [worker registration](worker/register.md).

Next: [verify](gateway/verify.md). [Reference index](../README.md).
