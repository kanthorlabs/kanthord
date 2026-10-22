# Read the worker placements

[Reference index](../README.md)

## Function description

List the three worker placements and tell whether this server can host an instance at each one. The read starts no container and writes no state.

| Placement   | Where the instances of a binding run                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| `server`    | The server runs each instance as a thread.                                              |
| `container` | The server runs each instance in its own container on the server host.                  |
| `worker`    | Each listed [worker instance](instance.md) runs as one `kanthord serve worker` process. |

The `server` and `worker` placements are always available. The `container` placement depends on a runtime check of the server. The check reads the container runtime of the server user, Podman first, then Docker. The server reuses the newest answer for 10 seconds.

The dashboard reads this list when the worker binding sheet opens. It preselects `server`, and it shows `worker` only under **Advanced settings**. It turns `container` off for the three reasons that [`project binding apply`](../project/binding.md#placement) refuses. That command reads the same check and refuses a new `container` binding for these reasons.

## Expected response

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "placement": "server",
      "available": true,
      "reason": null,
      "detail": null,
      "container_runtime": null
    },
    {
      "placement": "container",
      "available": false,
      "reason": "runtime_failed",
      "detail": "Cannot connect to Podman. Please verify your connection to the Linux system.",
      "container_runtime": "podman"
    },
    {
      "placement": "worker",
      "available": true,
      "reason": null,
      "detail": null,
      "container_runtime": null
    }
  ]
}
```

The list holds one item for each placement, in the order `server`, `container`, `worker`.

| Property                    | Type           | Purpose                                                                                                         |
| --------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| `items[].placement`         | string         | `server`, `container` or `worker`.                                                                              |
| `items[].available`         | boolean        | `true` when the server can host an instance at this placement.                                                  |
| `items[].reason`            | string or null | A reason of the table below when `available` is `false`; otherwise `null`.                                      |
| `items[].detail`            | string or null | First line of the answer of the container runtime, at most 200 bytes, when the runtime states one; else `null`. |
| `items[].container_runtime` | string or null | `podman` or `docker` when the server found a container runtime; otherwise `null`.                               |

The items `server` and `worker` always answer `available: true` and `null` in the three other properties. The item `container` answers the runtime check:

| `reason`              | Condition                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `server_in_container` | The server runs inside a container, so it cannot start a container for each instance.                     |
| `runtime_absent`      | Neither `podman` nor `docker` resolves on the `PATH` of the server.                                       |
| `runtime_failed`      | The runtime does not answer, or it fails a check. `detail` states why. A stopped Podman machine gives it. |
| `runtime_rootful`     | The host is Linux, the runtime is rootful and the server user is not root. Docker Desktop is exempt.      |

The reason `runtime_failed` is transient. The slots of a `container` binding start again with a backoff when the runtime recovers. The other reasons stay until a human changes the host.

The check runs with the full environment of the server. A server with a custom `XDG_CONFIG_HOME` or `XDG_DATA_HOME` loses the Podman machine connection and answers `runtime_failed`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). The answer has no error code of its own.

| HTTP status / code                        | Meaning                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Absent, invalid, expired or banned token, or a machine token. The read needs a human token. |
| `400 gateway.request.validation_failed`   | The request carries a query value.                                                          |
| `400 gateway.request.unexpected_body`     | The request has a body.                                                                     |

A declared failure makes the CLI exit `1` and print `<code>: request failed` and the row `status: <status>` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.worker.placement.list.indeterminate`. Run the command again.

## API shape

| Item             | Value                       |
| ---------------- | --------------------------- |
| Method and path  | `GET /api/worker/placement` |
| Operation ID     | `worker.placement.list`     |
| Access           | `human` (human bearer JWT)  |
| Timeout          | 30 seconds                  |
| Mutation         | No                          |
| Path parameters  | None                        |
| Query parameters | None                        |
| Request body     | None                        |

```sh
curl -i http://127.0.0.1:31415/api/worker/placement \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord worker placement list [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker placement list
```

There are no positional arguments.

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

A missing token fails with `cli.worker.placement.list.token_required`. A repeated `--token` fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration) for the token and endpoint precedence. The HTTP client deadline is 31 seconds.
