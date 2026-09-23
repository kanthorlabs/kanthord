# `GET /api/openapi.yaml`

Serve the packaged OpenAPI root reference index. Operation ID: `gateway.openapi`. Access: **public**. Timeout: **30 seconds**. Input: empty path parameters and query, with no request body.

```sh
curl -i http://127.0.0.1:31415/api/openapi.yaml
```

Success returns HTTP `200` with `Content-Type: application/yaml`. Its relative references resolve to [service-scoped and shared fragment routes](openapi-file.md). A missing or unreadable package asset returns `503 gateway.openapi.unavailable` using the [JSON error envelope](../../errors.md).

Publication uses [gateway openapi](../../cli/gateway/openapi.md); serving reads the generated asset.

[Reference index](../../README.md).
