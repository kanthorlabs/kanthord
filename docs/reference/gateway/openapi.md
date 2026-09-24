# Publish and read the OpenAPI contract

[Reference index](../README.md)

## Function description

Generate and serve the package's scoped OpenAPI YAML contract. The root document is a `$ref` index pointing to service-scoped path-item files and shared components. Methods sharing a path belong to one service and share one path-item file.

The two API routes **read packaged assets**. The CLI **generates local assets**; it does not call either route or download the server's contract. The writer updates generated files and removes obsolete files only when they carry its generated-file header.

## Expected response

Both API routes return HTTP `200` with `Content-Type: application/yaml`, not a JSON envelope.

### Root document

The root contains fields such as these (path entries are omitted here):

```yaml
openapi: 3.1.0
info:
  title: kanthord
  version: <package-version>
paths:
  /api/auth/verify:
    $ref: ./openapi/gateway/verify.yaml#/pathItem
components:
  securitySchemes:
    bearerAuth:
      $ref: ./openapi/shared/components.yaml#/components/securitySchemes/bearerAuth
```

| Property                                     | Type   | Purpose                                                               |
| -------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `openapi`                                    | string | OpenAPI specification version (`3.1.0`).                              |
| `info.title`                                 | string | Package API name (`kanthord`).                                        |
| `info.version`                               | string | Package version, also used by the worker application's version check. |
| `paths.<path>.$ref`                          | string | Relative reference to a service-scoped path item.                     |
| `components.securitySchemes.bearerAuth.$ref` | string | Relative reference to the shared bearer authentication scheme.        |

### Fragment documents

| Property                     | Present in                          | Purpose                                                                            |
| ---------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `pathItem`                   | Service path-item files             | HTTP methods, operation metadata, parameters, and response definitions for a path. |
| `components.schemas`         | Service files and shared components | Input/output schemas for operations or shared error schemas.                       |
| `components.securitySchemes` | Shared components                   | Bearer JWT authentication definition.                                              |
| `components.parameters`      | Shared components                   | Reusable parameters, including `Idempotency-Key`.                                  |
| `components.responses`       | Shared components                   | Reusable error response definitions.                                               |

### CLI output

Success prints the absolute root YAML path and exits `0`:

```text
<package-directory>/static/openapi.yaml
```

| Output                                  | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| stdout path                             | Location of the generated root document, `static/openapi.yaml`. |
| `static/openapi/<service>/*.yaml`       | Generated service-scoped path-item files.                       |
| `static/openapi/shared/components.yaml` | Generated shared components.                                    |

### Failures

API failures use the shared [JSON error envelope](../errors.md#api-failures), even though successful responses are YAML.

| HTTP status / code                      | Meaning                                                   |
| --------------------------------------- | --------------------------------------------------------- |
| `400 gateway.request.validation_failed` | Invalid fragment path parameters.                         |
| `404 gateway.openapi.not_found`         | Well-formed but unlisted fragment path.                   |
| `503 gateway.openapi.unavailable`       | Missing or unreadable root asset or allowlisted fragment. |

CLI scope, schema, or filesystem failures exit `1` with a diagnostic.

## API shape

Both routes are public, have a 30-second timeout, and accept no query parameters or request body. Public access still requires an allowed host and a ready server.

| Method and path                   | Operation ID          | Purpose                                                     |
| --------------------------------- | --------------------- | ----------------------------------------------------------- |
| `GET /api/openapi.yaml`           | `gateway.openapi`     | Read the packaged root reference index; no path parameters. |
| `GET /api/openapi/:service/:file` | `gateway.openapiFile` | Read one allowlisted service-scoped or shared fragment.     |

| Path parameter | Required            | Constraints / purpose                                                 |
| -------------- | ------------------- | --------------------------------------------------------------------- |
| `service`      | Fragment route only | Matches `^[a-z][a-z0-9-]*$`; selects a service directory or `shared`. |
| `file`         | Fragment route only | Matches `^[A-Za-z][A-Za-z0-9._-]*\.yaml$`; selects the YAML fragment. |

The assembled fragment path must occur in the allowlist derived from all registered operations. This includes shared components and per-service path-item files referenced by the root contract.

```sh
curl -i http://127.0.0.1:31415/api/openapi.yaml
curl -i http://127.0.0.1:31415/api/openapi/gateway/verify.yaml
curl -i http://127.0.0.1:31415/api/openapi/shared/components.yaml
```

## CLI shape

```sh
kanthord gateway openapi
```

| Argument / option        | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| Positional arguments     | None.                                                             |
| Command-specific options | None; output locations are fixed within the package.              |
| `--endpoint <url>`       | Inherited from the Gateway group but unused; generation is local. |

No running server or server configuration is required. To read the published contract instead, use the cURL requests above.
