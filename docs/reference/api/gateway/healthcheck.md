# `GET /api/healthcheck`

Report the components of every registered service. Operation ID: `gateway.healthcheck`. Access: **public**. Route timeout: **30 seconds**; each service probe has a **5-second** deadline. Input: empty path parameters and query, with no request body.

```sh
curl -i http://127.0.0.1:31415/api/healthcheck
```

A healthy response from `kanthord serve` is HTTP `200`:

```json
{
  "status": "ok",
  "services": {
    "server": {
      "gateway": 200,
      "store": 200,
      "log": 200
    },
    "gateway": {
      "listener": 200,
      "authentication": 200,
      "idempotency": 200,
      "registry": 200,
      "invocation": 200
    }
  }
}
```

`services` maps service names to component maps. Component codes are integers: `200` means healthy and `503` means unavailable. Every registered service must return a nonempty map whose components are all healthy for the API to return `200`.

The current server reports only `server` and `gateway`. It invents no healthy provider or worker-instance entries for services that do not exist. Component names are public identifiers, not credentials or private endpoint URLs.

## Failures and cancellation

An unavailable component produces HTTP `503`, code `gateway.healthcheck.unhealthy`, through the shared [error envelope](../../errors.md). `error.details` contains the complete service map, including healthy siblings, at the same nesting level as `services` on success. For example:

```json
{
  "error": {
    "code": "gateway.healthcheck.unhealthy",
    "message": "One or more services are unavailable.",
    "details": {
      "server": { "gateway": 200, "store": 200, "log": 503 },
      "gateway": {
        "listener": 200,
        "authentication": 200,
        "idempotency": 200,
        "registry": 200,
        "invocation": 200
      }
    }
  },
  "requestId": "request_01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

A failed, empty, malformed or timed-out probe is represented by `{ "healthcheck": 503 }` under its service name. Other service reports remain visible; exception messages are not exposed.

A client disconnect or process shutdown cancels collection rather than producing a successful health response. Before Gateway readiness, the server returns `503 gateway.lifecycle.not_ready` without collecting component reports.

Related: [how healthchecks work](../../../explanation/healthchecks.md), [serve](../../cli/serve.md). [Reference index](../../README.md).
