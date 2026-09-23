# CLI and API reference

[Documentation home](../README.md)

This reference answers “What exactly does this interface do?” Each command and operation has a page describing its invocation, inputs, outputs, errors, and limitations. These pages describe implemented behavior. The [explanation pages](../explanation/README.md) explain its guarantees and limitations.

For help interpreting component reports, see [how healthchecks work](../explanation/healthchecks.md).

The [error-code reference](errors.md) defines the shared naming rule, failure envelope and CLI diagnostics. The [identity reference](identities.md) defines prefixed ULIDs and request-ID handling.

## CLI

Run `kanthord` from an installed package, or `node bin/kanthord.mjs` from `engine/` after `pnpm run build`. The launcher requires Node.js `>=24.15.0 <25`. Commands declare their arguments and options and read no interactive input.

| Group         | Function                                  | Purpose                                             |
| ------------- | ----------------------------------------- | --------------------------------------------------- |
| Configuration | [config init](cli/config/init.md)         | Create private server configuration                 |
| Configuration | [config validate](cli/config/validate.md) | Validate stored server configuration                |
| Configuration | [config show](cli/config/show.md)         | Display effective configuration with secrets masked |
| Application   | [serve](cli/serve.md)                     | Start, run, and gracefully stop the server          |
| Human tokens  | [jwt](cli/jwt.md)                         | Generate a human JWT locally                        |
| Gateway       | [gateway verify](cli/gateway/verify.md)   | Verify a human JWT through the API                  |
| Worker        | [worker register](cli/worker/register.md) | Register a worker instance and obtain its JWT       |
| Gateway       | [gateway openapi](cli/gateway/openapi.md) | Generate the scoped OpenAPI files                   |

`--help` describes each command. Invoking a group displays its help. The `project`, `mission`, `scheduler`, and `tracking` groups currently expose help only. Human tokens come from `kanthord jwt`; startup issues none, and there are no login or logout commands.

## API

The default endpoint is `http://127.0.0.1:31415`. The operation registry owns the following unversioned routes.

| Service | Operation                                  | Method and path                   | Access                                           |
| ------- | ------------------------------------------ | --------------------------------- | ------------------------------------------------ |
| Gateway | [healthcheck](api/gateway/healthcheck.md)  | `GET /api/healthcheck`            | Public                                           |
| Gateway | [verify](api/gateway/verify.md)            | `GET /api/auth/verify`            | Human bearer JWT                                 |
| Worker  | [register](api/worker/register.md)         | `POST /api/worker/register`       | Public route with worker credential verification |
| Gateway | [openapi](api/gateway/openapi.md)          | `GET /api/openapi.yaml`           | Public                                           |
| Gateway | [openapiFile](api/gateway/openapi-file.md) | `GET /api/openapi/:service/:file` | Public                                           |

All routes pass through request-ID assignment, request logging, the host allowlist, readiness checks, and CORS middleware. Request IDs follow the [prefixed identity contract](identities.md#request-ids). Each operation adds a timeout, body limit, and the shared invocation chain for schema validation and its access policy. Failures use the shared JSON error envelope with a `requestId`. Public access still requires an allowed host and a ready server.
