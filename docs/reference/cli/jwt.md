# `kanthord jwt`

Generate a human or machine JWT locally from the validated server configuration. This is the only token-issuance command; server startup and worker registration issue no token, and there is no human login flow.

## Human token

```sh
kanthord jwt
kanthord jwt ulrich --name 'Ulrich' --config /absolute/path/kanthord.yaml
```

The optional positional username defaults to `KANTHORD_AUTH_USERNAME` (`kanthorlabs`). An explicit value must be nonblank and at most 64 JavaScript string code units; its exact value is preserved. The optional `--name` display name has the same validation and defaults to the username. It grants no authority.

The business claims are `kind: "human"`, `sub: <username>`, and `name: <display name>`. Human tokens carry no `binding`. Reissuing for the same username preserves `sub` and generates a fresh `jti`; it creates no account or password record.

## Machine token

```sh
kanthord jwt --binding '<worker-binding>' --name 'Worker display name' \
  --config /absolute/path/kanthord.yaml
```

`--binding` selects machine mode and cannot be combined with a positional username. Its value must be nonblank and at most 128 JavaScript string code units; its exact value is preserved. The optional `--name` has the same validation as in human mode and defaults to the generated client identity.

The business claims are `kind: "client"`, `sub: "client_identity_<ulid>"`, `name: <display name>`, and `binding: <worker binding>`. Every issuance generates a fresh client identity and `jti`. Local issuance cannot check whether the binding exists or is available; Gateway checks it when the token is used.

A machine presents this JWT to [worker registration](worker/register.md), which returns a runtime identity without issuing or modifying a JWT. Registration state is not a `reg` claim in the token.

## Shared behavior

Both token kinds include `iat`, `exp`, and a fresh bare ULID `jti`. JWT timestamps are Unix seconds; expiry uses `gateway.tokenLifetime`. `--config` uses the server configuration precedence described in [config init](config/init.md).

Success prints only the token and a newline to **terminal stdout**, then exits `0`. Invalid inputs or redirected stdout fail with exit `1`. The command saves no client file and calls no server. Supply the token through `--token`, `KANTHORD_TOKEN`, or an operator-managed private `cli.yaml` when using it.

Next: [human verification](gateway/verify.md), [worker registration](worker/register.md). [Reference index](../README.md).
