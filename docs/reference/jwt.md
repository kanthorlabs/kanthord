# Generate or inspect a JWT

[Reference index](README.md)

## Function description

`kanthord jwt generate` generates a human or machine JWT locally from the validated server configuration. `kanthord jwt inspect` decodes a JWT locally and prints its claims. `jwt generate` is the only token-issuance command; server startup and worker registration issue no token, and there is no human login flow.

Human mode preserves the supplied username as `sub`; reissuing for the same username generates a fresh `jti` without creating an account or password record. Machine mode generates a fresh client identity and `jti` on every issuance. Local issuance cannot check whether a worker binding exists or is available; Gateway checks it when the token is used.

A machine presents its JWT to [worker registration](worker/register.md), which returns a runtime identity without issuing or modifying a JWT. Registration state is not a `reg` claim in the token.

## Expected response

In human mode, `jwt generate` prints only the JWT and a newline to **terminal stdout**, then exits `0`. In machine mode, it prints a `cli.yaml` fragment with the JWT and its client secret, one line each. With `--verbose` it prints the claim list after that output. The output is a token string, not a JSON response. Its decoded claims have these properties:

| Property            | Type                    | Purpose                                                                            |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `kind`              | `"human"` or `"client"` | Distinguishes human and machine identities.                                        |
| `sub`               | string                  | Exact human username, or a fresh `client_identity_<ulid>` for a machine.           |
| `name`              | string                  | Display name, preserved exactly; defaults to `sub` and grants no authority.        |
| `project_id`        | string, machine only    | Project identity supplied with `--project`; absent for human tokens.               |
| `resource_identity` | string, machine only    | `worker:kanthord:<binding name>`, built from `--binding`; absent for human tokens. |
| `iat`               | integer                 | Issued-at time in Unix seconds.                                                    |
| `exp`               | integer                 | Expiry in Unix seconds, using `gateway.token_lifetime`.                            |
| `jti`               | canonical ULID string   | Fresh bare ULID identifying this token issuance.                                   |

Invalid inputs, configuration failures, or redirected stdout fail with exit `1` and a [diagnostic](errors.md#cli-diagnostics). The command saves no client file and calls no server.

The claim list holds one `<claim>: <value>` line per claim, in signed order, between two `---` lines. `iat` and `exp` carry their UTC time as a YAML comment:

```text
---
sub: ulrich
name: ulrich
kind: human
iat: 1790586463 # 2026-09-28T09:07:43Z
exp: 1822122463 # 2027-09-28T09:07:43Z
jti: 01M3KMA9EGF0NY6W2TNP4BTTQ5
---
```

`jwt inspect` prints the claim list alone, to any stdout, and exits `0`. It verifies no signature, checks no expiry, reads no server configuration and calls no server. A missing token fails with `cli.jwt.inspect.token_required`. A malformed token fails with `cli.jwt.inspect.malformed_token`, and the diagnostic never prints the token.

## API shape

Not available. JWT issuance is a local operation using the server configuration, with no token-issuance endpoint or cURL equivalent. To verify an existing human token, use [verification](gateway/verify.md#api-shape).

## CLI shape

```text
kanthord jwt generate [username] [--name <display>] [--output [path]] [--endpoint <url>] [--config <path>]
kanthord jwt generate --project <project id> --binding <binding name> [--name <display>] [--config <path>]
kanthord jwt inspect [token]
```

Add the root option `--verbose` to `jwt generate` to print the claim list. `kanthord jwt` alone prints the help of the group.

### Human token

```sh
kanthord jwt generate
kanthord jwt generate ulrich --name 'Ulrich' --config /absolute/path/kanthord.yaml
kanthord jwt generate ulrich --verbose
```

### Write a client file

```sh
kanthord jwt generate --output
kanthord jwt generate ulrich --output ./ulrich.cli.yaml --endpoint https://tunnel.example
```

`--output` writes the human JWT into a new private `cli.yaml` instead of stdout. Without a value it writes the default path; with a value it writes that path. The file holds `token`, and `endpoint` only when `--endpoint` is given. The command prints only `Created <absolute path>`, so stdout need not be a terminal.

The command creates an absent file only. An existing file fails with `system.files.publish_failed` and stays unchanged; delete it first to replace it. A file at another path is an export: commands read the default path only, so copy it there as a regular file with mode `0600` that the running user owns.

`--output` with `--binding` fails with `cli.jwt.output_with_binding`, and `--endpoint` without `--output` fails with `cli.jwt.endpoint_without_output`. A machine token and its client secret never go into a file; paste the printed fragment instead.

### Machine token

```sh
kanthord jwt generate --project '<project-id>' --binding '<binding-name>' \
  --name 'Worker display name' --config /absolute/path/kanthord.yaml
```

`--binding` without `--project` fails with `cli.jwt.binding_without_project`. `--project` without `--binding` fails with `cli.jwt.project_without_binding`.

The output pastes into `cli.yaml` of the worker host, below `endpoint`:

```yaml
token: <machine-jwt>
client_secret: <client-secret>
```

The client secret is `HKDF-SHA256(master_key, "worker/client-secret/v1/" + sub)`. The server stores it nowhere and derives it again from the verified `sub`. Each machine JWT has its own secret, and a human JWT has none. The worker uses it to open its credential handover, so the worker host holds no `master_key`.

| Argument / option          | Default / constraints                                                                                   | Purpose                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `[username]`               | `kanthorlabs`; explicit values must be nonblank and at most 64 JavaScript string code units             | Human subject; cannot be combined with `--binding`.                              |
| `--name <display>`         | Subject (`sub`); nonblank and at most 64 JavaScript string code units                                   | Display name for either token kind.                                              |
| `--binding <binding name>` | Omitted in human mode; 1–63 characters: a lower-case letter, then lower-case letters, digits or hyphens | Selects machine mode and supplies the worker binding name; requires `--project`. |
| `--project <project id>`   | Omitted in human mode; canonical project identity: `project_` and a canonical 26-character ULID         | Supplies the project of the worker binding; requires `--binding`.                |
| `--config <path>`          | `KANTHORD_CONFIG` → XDG/default server configuration path                                               | Selects the server configuration used for signing and token lifetime.            |

Username and display-name values are preserved exactly, not trimmed. Binding and project values must match their formats exactly. The default username is the constant `kanthorlabs`, not an environment-variable override. See [initialize configuration](config/init.md#cli-shape) for server configuration path precedence.

### Inspect a token

```sh
kanthord jwt inspect "$KANTHORD_TOKEN"
kanthord jwt inspect | grep exp
```

| Argument  | Default / constraints                                  | Purpose            |
| --------- | ------------------------------------------------------ | ------------------ |
| `[token]` | `KANTHORD_TOKEN`, then the `token` field of `cli.yaml` | The JWT to decode. |

Supply the issued token through `--token`, `KANTHORD_TOKEN`, or an operator-managed private `cli.yaml` when using it; see [client configuration](README.md#client-configuration).

Next: [human verification](gateway/verify.md), [worker registration](worker/register.md).
