# Generate a JWT

[Reference index](README.md)

## Function description

Generate a human or machine JWT locally from the validated server configuration. This is the only token-issuance command; server startup and worker registration issue no token, and there is no human login flow.

Human mode preserves the supplied username as `sub`; reissuing for the same username generates a fresh `jti` without creating an account or password record. Machine mode generates a fresh client identity and `jti` on every issuance. Local issuance cannot check whether a worker binding exists or is available; Gateway checks it when the token is used.

A machine presents its JWT to [worker registration](worker/register.md), which returns a runtime identity without issuing or modifying a JWT. Registration state is not a `reg` claim in the token.

## Expected response

Success prints only the JWT and a newline to **terminal stdout**, then exits `0`. The output is a token string, not a JSON response. Its decoded claims have these properties:

| Property  | Type                    | Purpose                                                                     |
| --------- | ----------------------- | --------------------------------------------------------------------------- |
| `kind`    | `"human"` or `"client"` | Distinguishes human and machine identities.                                 |
| `sub`     | string                  | Exact human username, or a fresh `client_identity_<ulid>` for a machine.    |
| `name`    | string                  | Display name, preserved exactly; defaults to `sub` and grants no authority. |
| `binding` | string, machine only    | Exact worker binding supplied in machine mode; absent for human tokens.     |
| `iat`     | integer                 | Issued-at time in Unix seconds.                                             |
| `exp`     | integer                 | Expiry in Unix seconds, using `gateway.tokenLifetime`.                      |
| `jti`     | canonical ULID string   | Fresh bare ULID identifying this token issuance.                            |

Invalid inputs, configuration failures, or redirected stdout fail with exit `1` and a [diagnostic](errors.md#cli-diagnostics). The command saves no client file and calls no server.

## API shape

Not available. JWT issuance is a local operation using the server configuration, with no token-issuance endpoint or cURL equivalent. To verify an existing human token, use [verification](gateway/verify.md#api-shape).

## CLI shape

```text
kanthord jwt [username] [--name <display>] [--config <path>]
kanthord jwt --binding <binding> [--name <display>] [--config <path>]
```

### Human token

```sh
kanthord jwt
kanthord jwt ulrich --name 'Ulrich' --config /absolute/path/kanthord.yaml
```

### Machine token

```sh
kanthord jwt --binding '<worker-binding>' --name 'Worker display name' \
  --config /absolute/path/kanthord.yaml
```

| Argument / option     | Default / constraints                                                                       | Purpose                                                               |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `[username]`          | `kanthorlabs`; explicit values must be nonblank and at most 64 JavaScript string code units | Human subject; cannot be combined with `--binding`.                   |
| `--name <display>`    | Subject (`sub`); nonblank and at most 64 JavaScript string code units                       | Display name for either token kind.                                   |
| `--binding <binding>` | Omitted in human mode; nonblank and at most 128 JavaScript string code units                | Selects machine mode and supplies the worker binding.                 |
| `--config <path>`     | `KANTHORD_CONFIG` → XDG/default server configuration path                                   | Selects the server configuration used for signing and token lifetime. |

Username, display-name, and binding values are preserved exactly, not trimmed. The default username is the constant `kanthorlabs`, not an environment-variable override. See [initialize configuration](config/init.md#cli-shape) for server configuration path precedence.

Supply the issued token through `--token`, `KANTHORD_TOKEN`, or an operator-managed private `cli.yaml` when using it; see [client configuration](README.md#client-configuration).

Next: [human verification](gateway/verify.md), [worker registration](worker/register.md).
