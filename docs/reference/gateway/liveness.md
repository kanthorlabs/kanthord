# Check server liveness

[Reference index](../README.md)

## Function description

Report whether the server process and its services run. The API and `kanthord gateway liveness` perform the same read. The read needs no token, so a container supervisor can run it.

Each service of the server registers one component map. A liveness read starts every registered probe at the same time and collects the maps. A probe reads local state only: the SQLite store, the log descriptor, the lifecycle state of each service, and the version commands of `bash`, `git` and `ssh`. No probe calls a remote repository, an LLM provider, a bucket or a worker host. A failed remote resource therefore changes no liveness answer. The [resource healthcheck](healthcheck.md) checks the remote resources. See [how healthchecks work](../../explanation/healthchecks.md) for the collection.

The answer is HTTP `200` when every registered service returns a nonempty map and every component in it is healthy. Any other result is HTTP `503`.

| Service      | Components                                                            | What the probe checks                                                                          |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `server`     | `gateway`, `store`, `log`                                             | The summary of the `gateway` map, a SQLite query and the operational log descriptor.           |
| `gateway`    | `listener`, `authentication`, `idempotency`, `registry`, `invocation` | The listener, the token checks, the idempotency memory, the operation registry and invocation. |
| `custody`    | `credential`                                                          | The Custody Service started and did not stop.                                                  |
| `scheduler`  | `queue`                                                               | The Scheduler Service started and did not stop.                                                |
| `worker`     | `registrations`                                                       | The Worker Service started and did not stop.                                                   |
| `repository` | `toolchain`                                                           | The version commands of `bash`, `git` and `ssh` run.                                           |
| `project`    | `bindings`                                                            | The Project Service started and did not stop.                                                  |
| `mission`    | `operations`                                                          | The Mission Service started and did not stop.                                                  |
| `intake`     | `events`                                                              | The Intake Service dispatcher started and did not stop.                                        |
| `tracking`   | `store`                                                               | The Tracking Service started and its SQLite store answers.                                     |

## Expected response

The API returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`. This answer comes from a fresh server:

```json
{
  "status": "ok",
  "services": {
    "server": { "gateway": 200, "store": 200, "log": 200 },
    "repository": { "toolchain": 200 },
    "scheduler": { "queue": 200 },
    "tracking": { "store": 200 },
    "custody": { "credential": 200 },
    "worker": { "registrations": 200 },
    "mission": { "operations": 200 },
    "project": { "bindings": 200 },
    "gateway": {
      "listener": 200,
      "authentication": 200,
      "idempotency": 200,
      "registry": 200,
      "invocation": 200
    },
    "intake": { "events": 200 }
  }
}
```

| Property                         | Type            | Purpose                                                                  |
| -------------------------------- | --------------- | ------------------------------------------------------------------------ |
| `status`                         | `"ok"`          | Every registered service reports, and every component is healthy.        |
| `services`                       | object          | Maps each registered service name to its component map.                  |
| `services.<service>`             | nonempty object | Maps each component name to its code.                                    |
| `services.<service>.<component>` | `200` or `503`  | `200` is healthy. `503` is unavailable. A `200` answer holds only `200`. |

The order of the services is not fixed. A client reads the services by name.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                  | Meaning                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503 gateway.liveness.unhealthy`    | A component is unavailable, a probe failed, or no service is registered. `error.details` holds the complete service map.                                  |
| `503 gateway.lifecycle.not_ready`   | The Gateway Service is not ready. The server collects no map.                                                                                             |
| `403 gateway.http.host_not_allowed` | The `Host` header is absent or not in `gateway.allowed_hosts`. `details.host` holds the received host, and `details.field` holds `gateway.allowed_hosts`. |
| `404 gateway.routing.not_found`     | The request path is outside `gateway.base_path`. Put the base path into the endpoint, for example `http://127.0.0.1:31415/s/kanthord`.                    |
| `504 gateway.invocation.timeout`    | The read exceeded 30 seconds.                                                                                                                             |

`error.details` of `gateway.liveness.unhealthy` has the shape of `services` in a `200` answer. It keeps the healthy components next to the unavailable ones. This example is shortened to three services:

```json
{
  "error": {
    "code": "gateway.liveness.unhealthy",
    "message": "One or more services are unavailable.",
    "details": {
      "server": { "gateway": 200, "store": 200, "log": 503 },
      "project": { "bindings": 200 },
      "intake": { "healthcheck": 503 }
    }
  },
  "request_id": "request_01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

A probe that throws, returns an empty or malformed map, or exceeds its deadline of 5 seconds gives `{ "healthcheck": 503 }` under its service name. This marker reports a failed probe, not the state of one component. The answer holds no exception text.

A client disconnect or a server stop cancels the read, and the server sends no `200` answer.

## API shape

| Item                  | Value                                                      |
| --------------------- | ---------------------------------------------------------- |
| Method and path       | `GET /api/liveness`                                        |
| Operation ID          | `gateway.liveness`                                         |
| Access                | Public. The request needs no token.                        |
| Timeout               | 30 seconds for the route; 5 seconds for each service probe |
| Path/query parameters | None                                                       |
| Request body          | None                                                       |

```sh
curl -i http://127.0.0.1:31415/api/liveness
```

The host check and the readiness check apply also to this public route.

## CLI shape

```text
kanthord gateway [--endpoint <url>] liveness
```

```sh
kanthord gateway liveness
kanthord gateway liveness --endpoint http://127.0.0.1:31415/s/kanthord
```

There are no positional arguments.

| Option             | Default / resolution                                                  | Purpose          |
| ------------------ | --------------------------------------------------------------------- | ---------------- |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL. |

The command sends no `Authorization` header. It reads no token from `KANTHORD_TOKEN` or `cli.yaml`, and it refuses the option `--token`.

Before the request, the command checks the optional [client file](../README.md#client-configuration) `cli.yaml`. The check also runs when `--endpoint` or `KANTHORD_ENDPOINT` gives the endpoint. The file must be a regular file, not a symlink, with the mode `0600` and the user of the process as owner. Its content must match the client schema, the `token` field included. An invalid file fails the command while the server is healthy.

| Result                                                                                                                                | Stdout               | Stderr                                                                                                          | Exit |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| HTTP `200`                                                                                                                            | The answer, one line | Empty                                                                                                           | `0`  |
| A declared API failure, for example `503 gateway.liveness.unhealthy`                                                                  | Empty                | `<code>: gateway liveness: request failed`, the row `status` and, when `details` is not null, the row `details` | `1`  |
| A refused connection, a transport failure, a deadline, invalid JSON, a redirect, or an answer other than `200` with no error envelope | Empty                | `cli.gateway.liveness.indeterminate: gateway liveness: the result is unknown; retry the command`                | `1`  |
| A `200` answer that fails the output schema                                                                                           | Empty                | `gateway.client.answer_invalid: gateway liveness: request failed`, the row `status: 200` and the row `details`  | `1`  |
| An invalid `cli.yaml` or endpoint value                                                                                               | Empty                | The local diagnostic                                                                                            | `1`  |

The local diagnostics of an invalid client file:

| Cause                                                                   | Stderr                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `cli.yaml` is not valid YAML                                            | `system.config.invalid_yaml: configuration: expected one valid YAML mapping with unique string keys.`             |
| `cli.yaml` holds a field outside the client schema                      | `cli.config.invalid: invalid client configuration` and the row `path`                                             |
| `cli.yaml` has a mode other than `0600`, another owner, or is a symlink | `system.files.invalid_permissions: expected an owned file with mode 600 on a POSIX filesystem` and the row `path` |
| `cli.yaml` is empty or holds no mapping                                 | `system.config.invalid_mapping: configuration: expected one YAML mapping.`                                        |
| The endpoint is not an absolute HTTP(S) URL                             | `cli.config.invalid_endpoint: endpoint: expected an absolute HTTP(S) URL without credentials, query or fragment.` |

A stopped server gives `cli.gateway.liveness.indeterminate`, because the connection is refused. The HTTP client has a 31-second deadline for this 30-second operation. The command makes no retry.

### Container healthcheck

The container image runs this command as its healthcheck:

```text
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["kanthord","gateway","liveness"]
```

Exit `0` means that the server answers HTTP `200`. The command sends its request from inside the container. A healthy result therefore does not prove that a published host port reaches the server. A container with another `gateway.port` or a `gateway.base_path` sets `KANTHORD_ENDPOINT`, for example `http://127.0.0.1:31415/s/kanthord`. The `Host` header of that endpoint must be in `gateway.allowed_hosts`.

The container timeout of 5 seconds equals the probe deadline. A probe that reaches its deadline therefore ends the check by the timeout, and the health log holds no `details`.
