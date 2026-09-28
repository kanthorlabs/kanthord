# Check service health

[Reference index](../README.md)

## Function description

Report the components of every registered service. Every registered service must return a nonempty map whose components are all healthy, and at least one service must report, for the API to return HTTP `200`.

The current composed server reports `server`, `gateway`, `project`, and `worker`. Project and Worker report lifecycle health, not provider reachability or remote worker-instance health. Component names are public identifiers, not credentials or private endpoint URLs. An absent service is not an implicit healthy service.

See [how healthchecks work](../../explanation/healthchecks.md) for collection behavior and limitations, and [serve](../serve.md) for running the server.

## Expected response

A healthy response is HTTP `200` with JSON:

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
    },
    "project": { "bindings": 200 },
    "worker": { "registrations": 200 }
  }
}
```

| Property                         | Type            | Purpose                                                                           |
| -------------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `status`                         | `"ok"`          | Confirms all reported components are healthy.                                     |
| `services`                       | object          | Maps each registered service name to its component report.                        |
| `services.<service>`             | nonempty object | Maps the service's component names to integer health codes.                       |
| `services.<service>.<component>` | `200` or `503`  | `200` means healthy; `503` means unavailable. Success contains only `200` values. |

### Failures and cancellation

An unavailable component produces HTTP `503`, code `gateway.healthcheck.unhealthy`, through the shared [error envelope](../errors.md). `error.details` contains the complete service map, including healthy siblings, at the same nesting level as `services` on success:

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
      },
      "project": { "bindings": 200 },
      "worker": { "registrations": 200 }
    }
  },
  "requestId": "request_01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

A failed, empty, malformed, or timed-out probe is represented by `{ "healthcheck": 503 }` under its service name. Other service reports remain visible; exception messages are not exposed.

A client disconnect or process shutdown cancels collection rather than producing a successful health response. Before Gateway readiness, the server returns `503 gateway.lifecycle.not_ready` without collecting component reports.

## API shape

| Item                  | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| Method and path       | `GET /api/healthcheck`                                |
| Operation ID          | `gateway.healthcheck`                                 |
| Access                | Public                                                |
| Timeout               | 30 seconds for the route; 5 seconds per service probe |
| Path/query parameters | None                                                  |
| Request body          | None                                                  |

```sh
curl -i http://127.0.0.1:31415/api/healthcheck
```

Public access still requires an allowed host and a ready server.

## CLI shape

No dedicated CLI command is implemented. Use the cURL request above; there are no CLI arguments or options for this feature.
