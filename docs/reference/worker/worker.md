# Read the worker catalog

[Reference index](../README.md)

## Function description

Read the catalog of supplied workers. The catalog is fixed in the server binary. The API and the CLI do not change it.

The catalog contains these workers:

| Worker          | Host               | Method or harness     | Declared node states                         |
| --------------- | ------------------ | --------------------- | -------------------------------------------- |
| `claude-code@1` | `external-harness` | harness `claude-code` | `Available`, `Waiting`, `External.Requested` |
| `general@1`     | `kanthord`         | method `steps`        | `Available`                                  |
| `opencode@1`    | `external-harness` | harness `opencode`    | `Available`, `Waiting`, `External.Requested` |
| `reviewer@1`    | `kanthord`         | method `evaluation`   | `Waiting`, `External.Requested`              |

`worker list` returns a page of summaries in ascending worker-name order. `worker get` returns the full declaration of one worker. Both operations are read-only.

## Expected response

### `worker list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "name": "claude-code@1",
      "host": "external-harness",
      "declared_node_states": ["Available", "Waiting", "External.Requested"],
      "required_node_format": [
        "name",
        "requirement",
        "criterion",
        "verifications",
        "bindings"
      ]
    }
  ],
  "next_cursor": "Y2xhdWRlQDE"
}
```

| Property                       | Type           | Purpose                                                           |
| ------------------------------ | -------------- | ----------------------------------------------------------------- |
| `items[].name`                 | string         | Exact worker name, for example `general@1`.                       |
| `items[].host`                 | string         | `kanthord` for a native worker, `external-harness` for a harness. |
| `items[].declared_node_states` | string array   | Node states that the worker accepts.                              |
| `items[].required_node_format` | string array   | Node fields that the worker requires.                             |
| `next_cursor`                  | string or null | Opaque cursor for the next page; `null` on the last page.         |

### `worker get`

The API returns HTTP `200` with the declaration. The CLI writes the same object as one JSON line to stdout and exits `0`. A native worker has `method`, `agent_name` and a `resource_budget` with `turns`:

```json
{
  "name": "general@1",
  "host": "kanthord",
  "method": "steps",
  "agent_name": "swe@1",
  "resource_budget": { "turns": 200, "wall_time_ms": 7200000 },
  "declared_node_states": ["Available"],
  "required_node_format": [
    "name",
    "requirement",
    "criterion",
    "verifications",
    "bindings"
  ]
}
```

An external harness has `harness` in place of `method` and `agent_name`, and its `resource_budget` has no `turns`:

```json
{
  "name": "claude-code@1",
  "host": "external-harness",
  "harness": "claude-code",
  "resource_budget": { "wall_time_ms": 7200000 },
  "declared_node_states": ["Available", "Waiting", "External.Requested"],
  "required_node_format": [
    "name",
    "requirement",
    "criterion",
    "verifications",
    "bindings"
  ]
}
```

| Property                       | Type         | Surface            | Purpose                                             |
| ------------------------------ | ------------ | ------------------ | --------------------------------------------------- |
| `name`                         | string       | All workers        | Exact worker name.                                  |
| `host`                         | string       | All workers        | `kanthord` or `external-harness`.                   |
| `method`                       | string       | `kanthord` only    | `steps` or `evaluation`.                            |
| `agent_name`                   | string       | `kanthord` only    | Agent that the native worker runs.                  |
| `harness`                      | string       | `external-harness` | External harness name, for example `claude-code`.   |
| `resource_budget.wall_time_ms` | integer      | All workers        | Wall-time budget of one execution, in milliseconds. |
| `resource_budget.turns`        | integer      | `kanthord` only    | Turn budget of one execution.                       |
| `declared_node_states`         | string array | All workers        | Node states that the worker accepts.                |
| `required_node_format`         | string array | All workers        | Node fields that the worker requires.               |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                         |
| ----------------------------------------- | -------- | --------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Both     | Missing, invalid or expired token, or a machine token.          |
| `400 gateway.request.validation_failed`   | `list`   | `limit` is not an integer from 1 to 1000, or `cursor` is empty. |
| `400 system.pagination.cursor_invalid`    | `list`   | The cursor is not a cursor that this operation issued.          |
| `404 worker.catalog.not_found`            | `get`    | No supplied worker has this exact name.                         |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.worker.list.indeterminate` or `cli.worker.get.indeterminate`. Run the command again after an indeterminate result.

## API shape

### `worker list`

| Item             | Value                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Method and path  | `GET /api/worker/catalog`                                                                   |
| Operation ID     | `worker.catalog.list`                                                                       |
| Access           | `human` (human bearer JWT)                                                                  |
| Timeout          | 30 seconds                                                                                  |
| Mutation         | No                                                                                          |
| Path parameters  | None                                                                                        |
| Query parameters | `limit`: integer from 1 to 1000, default 100. `cursor`: `next_cursor` of the previous page. |
| Request body     | None                                                                                        |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/worker/catalog?limit=2' \
  -H 'Authorization: Bearer <human-jwt>'
```

### `worker get`

| Item             | Value                                       |
| ---------------- | ------------------------------------------- |
| Method and path  | `GET /api/worker/catalog/:worker_name`      |
| Operation ID     | `worker.catalog.get`                        |
| Access           | `human` (human bearer JWT)                  |
| Timeout          | 30 seconds                                  |
| Mutation         | No                                          |
| Path parameters  | `worker_name`: exact worker name, nonempty. |
| Query parameters | None                                        |
| Request body     | None                                        |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i http://127.0.0.1:31415/api/worker/catalog/general@1 \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

### `worker list`

```text
kanthord worker list [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker list --limit 2
kanthord worker list --limit 2 --cursor '<next-cursor>'
```

There are no positional arguments.

| Option              | Default / resolution                                                        | Purpose                                     |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------- |
| `--limit <count>`   | `100`                                                                       | Page size; a positive integer up to `1000`. |
| `--cursor <cursor>` | None (first page)                                                           | `next_cursor` of the previous page.         |
| `--token <jwt>`     | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.    |
| `--endpoint <url>`  | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                            |

The CLI checks `--limit` before the request. A value that is not a positive decimal integer fails with `cli.pagination.limit_invalid`. A value above `1000` fails with `cli.pagination.limit_out_of_range`. A missing token fails with `cli.worker.list.token_required`.

### `worker get`

```text
kanthord worker get <worker-name> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker get general@1
```

| Argument        | Purpose                                     |
| --------------- | ------------------------------------------- |
| `<worker-name>` | Exact worker name, for example `general@1`. |

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

A missing token fails with `cli.worker.get.token_required`.

`--token` and `--endpoint` belong to the `worker` group, and every `worker` subcommand accepts them. A repeated `--token` fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration) for the token and endpoint precedence. The HTTP client deadline is one second longer than the operation timeout.
