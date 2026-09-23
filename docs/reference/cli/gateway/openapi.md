# `kanthord gateway openapi`

Generate the package's scoped OpenAPI YAML contract.

```sh
kanthord gateway openapi
```

The output is `static/openapi.yaml`, per-service files under `static/openapi/<service>/`, and shared components under `static/openapi/shared/`. The root is a `$ref` index. Methods sharing a path belong to one service and share one path-item file.

The writer updates generated files and removes obsolete files only when they carry its generated-file header. Success prints the absolute root YAML path and exits `0`. Scope, schema, or filesystem failures exit `1`.

Related: [root contract API](../../api/gateway/openapi.md), [fragment API](../../api/gateway/openapi-file.md). [Reference index](../../README.md).
