# Inspect the work queue

[Reference index](../README.md)

## Function description

Read the jobs in the work queue of one project. The queue holds one job for each node that a worker can claim now. The Mission Service writes the jobs; these operations only read them.

- `queue list` returns one page of jobs in queue order.
- `queue peek` returns the first job in queue order, or `null` for an empty queue.

Queue order is `priority` descending, then `job_id` ascending. A work pull uses the same order when it selects a job. A read removes no job, reserves no node and does not predict which instance claims a job.

Each `queue list` call reads one page. The CLI does not follow `next_cursor`. The list is a live view and holds no history.

Both operations accept any project identity in the canonical format. A project that holds no jobs, or that does not exist, returns an empty result.

## Expected response

### `queue list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "job_id": "job_01JZ8Q4W5N2V7K3M9P0R1S2T3V",
      "project_id": "project_01JZ8PZ0A1B2C3D4E5F6G7H8J9",
      "node_id": "node_01JZ8Q0K4M6N8P0R2S4T6V8W0X",
      "priority": 5
    }
  ],
  "next_cursor": null
}
```

| Property      | Type             | Purpose                                                                     |
| ------------- | ---------------- | --------------------------------------------------------------------------- |
| `items`       | array of `Job`   | At most `limit` jobs in queue order. An empty array is a successful result. |
| `next_cursor` | string or `null` | Opaque cursor for the next page. `null` ends the traversal.                 |

### `queue peek`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "job": {
    "job_id": "job_01JZ8Q4W5N2V7K3M9P0R1S2T3V",
    "project_id": "project_01JZ8PZ0A1B2C3D4E5F6G7H8J9",
    "node_id": "node_01JZ8Q0K4M6N8P0R2S4T6V8W0X",
    "priority": 5
  }
}
```

| Property | Type            | Purpose                                                   |
| -------- | --------------- | --------------------------------------------------------- |
| `job`    | `Job` or `null` | First job in queue order; `null` when the queue is empty. |

### `Job`

| Property     | Type             | Purpose                                                     |
| ------------ | ---------------- | ----------------------------------------------------------- |
| `job_id`     | `job_<ulid>`     | Identity of the job. A priority change keeps this identity. |
| `project_id` | `project_<ulid>` | Project that owns the queue.                                |
| `node_id`    | `node_<ulid>`    | Mission node that the job represents.                       |
| `priority`   | safe integer     | Priority of the node, copied from the Mission Service.      |

Identity formats follow the [identity reference](../identities.md).

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                                     |
| ----------------------------------------- | -------- | --------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Both     | Missing, invalid or expired token, or a machine token.                      |
| `400 gateway.request.validation_failed`   | Both     | Invalid `project_id`, `limit` outside 1 to 1000, or an unknown query field. |
| `400 system.pagination.cursor_invalid`    | `list`   | The `cursor` value is not a cursor that this operation issued.              |
| `400 gateway.request.unexpected_body`     | Both     | The request carries a body.                                                 |
| `504 gateway.invocation.timeout`          | Both     | The operation did not complete in 30 seconds.                               |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                      | Commands | Meaning                                                      |
| --------------------------------------------- | -------- | ------------------------------------------------------------ |
| `cli.scheduler.queue.list.invalid_project_id` | `list`   | `<project-id>` is not a canonical `project_<ulid>` identity. |
| `cli.scheduler.queue.peek.invalid_project_id` | `peek`   | `<project-id>` is not a canonical `project_<ulid>` identity. |
| `cli.scheduler.queue.list.token_required`     | `list`   | No nonblank token resolves.                                  |
| `cli.scheduler.queue.peek.token_required`     | `peek`   | No nonblank token resolves.                                  |
| `cli.pagination.limit_invalid`                | `list`   | `--limit` is not a positive decimal integer.                 |
| `cli.pagination.limit_out_of_range`           | `list`   | `--limit` is outside 1 to 1000.                              |
| `cli.option.duplicate`                        | Both     | An option occurs more than once.                             |

A declared API failure makes the CLI exit `1`. The diagnostic starts with the error code of the API. A transport failure, timeout or malformed response exits `1` with `cli.scheduler.queue.list.indeterminate` or `cli.scheduler.queue.peek.indeterminate`. These reads change nothing, so run the command again.

## API shape

### `queue list`

| Item                  | Value                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/scheduler/project/:project_id/queue`                                                       |
| Operation ID          | `scheduler.queue.list`                                                                               |
| Access                | `human` (human bearer JWT)                                                                           |
| Timeout               | 30 seconds                                                                                           |
| Mutation              | No                                                                                                   |
| Path/query parameters | `project_id` (path, required); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |
| Request body          | None                                                                                                 |

### `queue peek`

| Item                  | Value                                               |
| --------------------- | --------------------------------------------------- |
| Method and path       | `GET /api/scheduler/project/:project_id/queue/peek` |
| Operation ID          | `scheduler.queue.peek`                              |
| Access                | `human` (human bearer JWT)                          |
| Timeout               | 30 seconds                                          |
| Mutation              | No                                                  |
| Path/query parameters | `project_id` (path, required); no query fields      |
| Request body          | None                                                |

Both operations use one header:

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/scheduler/project/project_01JZ8PZ0A1B2C3D4E5F6G7H8J9/queue?limit=50' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/scheduler/project/project_01JZ8PZ0A1B2C3D4E5F6G7H8J9/queue/peek \
  -H 'Authorization: Bearer <human-jwt>'
```

To read the next page, send the `next_cursor` value as the `cursor` query parameter with the same `limit`.

## CLI shape

### `queue list`

```text
kanthord scheduler queue list <project-id> [--limit <count>] [--cursor <opaque>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler queue list project_01JZ8PZ0A1B2C3D4E5F6G7H8J9 --limit 50
```

| Positional argument | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `<project-id>`      | Required `project_<ulid>` of the queue to read. |

| Option              | Default / resolution                                                        | Purpose                                   |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `--limit <count>`   | `100`                                                                       | Maximum jobs on the page, from 1 to 1000. |
| `--cursor <opaque>` | None; the first page                                                        | `next_cursor` value of the previous page. |
| `--token <jwt>`     | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.  |
| `--endpoint <url>`  | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                          |

### `queue peek`

```text
kanthord scheduler queue peek <project-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler queue peek project_01JZ8PZ0A1B2C3D4E5F6G7H8J9
```

| Positional argument | Purpose                                         |
| ------------------- | ----------------------------------------------- |
| `<project-id>`      | Required `project_<ulid>` of the queue to read. |

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

`--token` and `--endpoint` belong to the `scheduler` group, and each leaf command accepts them. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.
