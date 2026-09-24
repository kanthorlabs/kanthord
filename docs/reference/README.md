# Feature reference

[Documentation home](../README.md)

This reference answers “What exactly does this feature do?” Each feature has one page covering its API and CLI together, rather than separate pages for each interface. These pages describe implemented behavior. The [explanation pages](../explanation/README.md) explain its guarantees and limitations.

## Features

CLI entries below follow `kanthord`.

| Group         | Feature                                          | API                                                        | CLI                                                   |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| Configuration | [Initialize configuration](config/init.md)       | Not available (local only)                                 | `config init`                                         |
| Configuration | [Validate configuration](config/validate.md)     | Not available (local only)                                 | `config validate`                                     |
| Configuration | [Show masked configuration](config/show.md)      | Not available (local only)                                 | `config show`                                         |
| Application   | [Run an application](serve.md)                   | Not available (local process)                              | `serve [server]`, `serve worker`                      |
| Tokens        | [Generate a JWT](jwt.md)                         | Not available (local only)                                 | `jwt`                                                 |
| Gateway       | [Check service health](gateway/healthcheck.md)   | `GET /api/healthcheck`                                     | Not implemented; use cURL                             |
| Gateway       | [Verify a human JWT](gateway/verify.md)          | `GET /api/auth/verify`                                     | `gateway verify`                                      |
| Gateway       | [Publish and read OpenAPI](gateway/openapi.md)   | `GET /api/openapi.yaml`, `GET /api/openapi/:service/:file` | `gateway openapi` (local generation, not an API call) |
| Worker        | [Register a worker instance](worker/register.md) | `POST /api/worker/register`                                | `worker register`                                     |

### Page structure

Organize feature pages by service or command group (`config/`, `gateway/`, `worker/`), with standalone commands at the reference root. Every feature page uses these sections in order:

1. **Function description** — what the feature does, its effects, and current limitations.
2. **Expected response** — success output, a table of properties and their purposes, and failures. Identify API/CLI output differences explicitly; for local commands, describe text output, generated files, and exit codes instead of inventing a JSON response.
3. **API shape** — method, path, access, headers, parameters, request body, timeout, and a cURL request. State when no API exists.
4. **CLI shape** — command syntax, examples, positional arguments, options, defaults, and configuration precedence. State when no CLI command exists or when it performs a different local action.

Shared contracts, such as errors and identities, remain standalone references rather than feature pages.

## Shared contracts

The [error-code reference](errors.md) defines the shared naming rule, failure envelope, and CLI diagnostics. The [identity reference](identities.md) defines prefixed ULIDs and request-ID handling. For help interpreting component reports, see [how healthchecks work](../explanation/healthchecks.md).

## CLI conventions

Run `kanthord` from an installed package, or `node bin/kanthord.mjs` from `engine/` after `pnpm run build`. The launcher requires Node.js `>=24.15.0 <25`. Commands declare their arguments and options and read no interactive input.

`--help` describes each command. Invoking a group displays its help. The `project`, `mission`, `scheduler`, and `tracking` groups currently expose help only. Human and machine tokens come from `kanthord jwt`; startup and registration issue none, and there are no login or logout commands.

### Client configuration

Commands that call the server resolve their client settings as follows:

| Setting  | Precedence, highest first                                                              |
| -------- | -------------------------------------------------------------------------------------- |
| Token    | `--token` → `KANTHORD_TOKEN` → client-file `token`                                     |
| Endpoint | `--endpoint` → `KANTHORD_ENDPOINT` → client-file `endpoint` → `http://127.0.0.1:31415` |

The optional operator-supplied client file is `$XDG_CONFIG_HOME/kanthord/cli.yaml`, falling back to `~/.config/kanthord/cli.yaml`, and must have mode `0600`. Its optional fields are `token` and `endpoint`. Endpoints must be absolute HTTP(S) URLs without credentials, query, or fragment. No command saves these client settings. Prefer an environment variable or private client file over literal tokens in shell history.

Local server configuration uses a separate `kanthord.yaml`; see [initialize configuration](config/init.md#cli-shape).

## API conventions

The default endpoint is `http://127.0.0.1:31415`. The operation registry owns the unversioned routes listed above.

All routes pass through request-ID assignment, request logging, the host allowlist, readiness checks, and CORS middleware. Request IDs follow the [prefixed identity contract](identities.md#request-ids). Each operation adds a timeout, body limit, and the shared invocation chain for schema validation and its access policy. Failures use the shared JSON error envelope with a `requestId`. Public access still requires an allowed host and a ready server.
