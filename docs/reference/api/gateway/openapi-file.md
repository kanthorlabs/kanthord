# `GET /api/openapi/:service/:file`

Serve one allowlisted OpenAPI fragment. Operation ID: `gateway.openapiFile`. Access: **public**. Timeout: **30 seconds**. Input: `service` and `file` path parameters, empty query, and no request body.

```sh
curl -i http://127.0.0.1:31415/api/openapi/gateway/verify.yaml
curl -i http://127.0.0.1:31415/api/openapi/shared/components.yaml
```

`service` must match `^[a-z][a-z0-9-]*$`; `file` must match `^[A-Za-z][A-Za-z0-9._-]*\.yaml$`. The assembled relative path must also occur in the allowlist derived from all registered operations. This includes shared components and the per-service path-item files referenced by the [root contract](openapi.md).

Success returns HTTP `200` with `Content-Type: application/yaml`. Invalid parameters fail validation with `400`; a well-formed but unlisted file returns `404 gateway.openapi.not_found`; a listed file that cannot be read returns `503 gateway.openapi.unavailable`. These failures use the shared [JSON error envelope](../../errors.md).

[Reference index](../../README.md).
