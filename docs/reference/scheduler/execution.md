# Inspect and release executions

[Reference index](../README.md)

## Function description

An execution records one claim of one node by one worker instance. A [work pull](work.md) creates it. These operations read executions and end a running execution.

- `execution get` reads one execution, live or ended. Any human identity can read any execution.
- `execution list` returns one page of the executions of a project, live and ended, newest `execution_id` first. A `node_id` filter limits the page to one node. An `attempt` filter limits it further to one attempt of that node and requires `node_id`. A filter that matches nothing returns an empty page.
- `execution release` ends a running execution of the caller and routes the node through the Mission Service.

Each `execution list` call reads one page. The CLI does not follow `next_cursor`.

`execution release` accepts only an execution that is live and that belongs to the runtime identity of the caller. The gateway proves this before the idempotency check and before the handler. The release transaction checks it again. The Mission Service then applies the release rule of the node state:

| Node state   | `further_work` | Requirement                                                                                                         | Node state after release |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `Executing`  | `false`        | The execution has evidence; otherwise `obligation` is `evidence`.                                                   | `Waiting`                |
| `Executing`  | `true`         | None.                                                                                                               | `Available`              |
| `Evaluating` | Either value   | A current successful assessment; otherwise `assessment`. No eligible action without a request; otherwise `request`. | `External.Requested`     |

A successful release sets `ended_at`, so `claim_state` becomes `finished`, and frees the live count of the binding. It wakes the pulls that wait in the project. A refused release changes no execution, node or job.

A release ends an execution at most once. The gateway stores no receipt that it can replay after the end. A retry after a committed release, with the same key or a new key, fails the execution proof with `403`. To confirm the result after a lost answer, read the execution with [`claim get`](claim.md) or `execution get`; `claim_state` is `finished`.

## Expected response

### `execution get`

The API returns HTTP `200` with one `ExecutionRecord`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "project_id": "project_01JZ8PZ0A1B2C3D4E5F6G7H8J9",
  "node_id": "node_01JZ8Q0K4M6N8P0R2S4T6V8W0X",
  "claimant": {
    "worker_binding_id": "binding_01JZ8PZ5N6P7Q8R9S0T1V2W3X4",
    "resource_identity": "<resource-identity>",
    "runtime_identity": "worker_instance_01JZ8R0Y1Z2A3B4C5D6E7F8G9H",
    "client_id": "client_identity_01JZ8QZW2X3Y4Z5A6B7C8D9E0F",
    "name": "Worker display name"
  },
  "attempt": 1,
  "pinned_revision": 3,
  "credentials": [],
  "claim_state": "finished",
  "expired_at": 1791449400000,
  "created_at": 1791447600000,
  "ended_at": 1791448200000,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "root_span_id": "00f067aa0ba902b7"
}
```

### `execution list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "items": [
    { "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M", "...": "..." }
  ],
  "next_cursor": null
}
```

| Property      | Type                       | Purpose                                                                                    |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `items`       | array of `ExecutionRecord` | At most `limit` records, `execution_id` descending. An empty array is a successful result. |
| `next_cursor` | string or `null`           | Opaque cursor for the next page. `null` ends the traversal.                                |

### `execution release`

The API returns HTTP `200`:

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "ended_at": 1791448200000
}
```

The CLI adds the retry key, writes one JSON line to stdout, and exits `0` (shown formatted here).

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "ended_at": 1791448200000,
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property          | Type                  | Surface     | Purpose                    |
| ----------------- | --------------------- | ----------- | -------------------------- |
| `execution_id`    | `execution_<ulid>`    | API and CLI | The released execution.    |
| `ended_at`        | timestamp             | API and CLI | Time of the release.       |
| `idempotency_key` | canonical ULID string | CLI only    | Key used for this request. |

### `ExecutionRecord`

Every timestamp is a safe integer of Unix epoch milliseconds in UTC.

| Property                     | Type                                               | Purpose                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_id`               | `execution_<ulid>`                                 | Identity of the execution.                                                                                                                                             |
| `project_id`                 | `project_<ulid>`                                   | Project of the claimed node.                                                                                                                                           |
| `node_id`                    | `node_<ulid>`                                      | Claimed Mission node.                                                                                                                                                  |
| `claimant.worker_binding_id` | `binding_<ulid>`                                   | Worker binding of the claimant at the claim.                                                                                                                           |
| `claimant.resource_identity` | nonempty string                                    | Resource identity of the claimant.                                                                                                                                     |
| `claimant.runtime_identity`  | `worker_instance_<ulid>`                           | Runtime identity of the claimant.                                                                                                                                      |
| `claimant.client_id`         | `client_identity_<ulid>`, optional                 | Client identity of the registration. Absent when the runtime identity has no registered client.                                                                        |
| `claimant.name`              | string of 1 to 64 characters, optional             | Display name of the registration. Present together with `client_id`.                                                                                                   |
| `attempt`                    | positive safe integer                              | Attempt of the node that this execution serves.                                                                                                                        |
| `pinned_revision`            | positive safe integer                              | Node revision that the attempt pins.                                                                                                                                   |
| `credentials`                | array of `credential_<ulid>`                       | Credentials that the execution pins; `[]` at the claim.                                                                                                                |
| `claim_state`                | `running`, `lost` or `finished`                    | `running`: not ended and before `expired_at`. `finished`: ended before `expired_at`. `lost`: ended at or after `expired_at`, or not ended and `expired_at` has passed. |
| `expired_at`                 | timestamp                                          | Fixed deadline that the claim sets once.                                                                                                                               |
| `created_at`                 | timestamp                                          | Time of the claim.                                                                                                                                                     |
| `ended_at`                   | timestamp or `null`                                | Time of the end; `null` while the execution has not ended.                                                                                                             |
| `trace_id`                   | 32 lower-case hexadecimal characters, not all zero | Trace identity that the Scheduler mints at the claim.                                                                                                                  |
| `root_span_id`               | 16 lower-case hexadecimal characters, not all zero | Root span identity that the Scheduler mints at the claim.                                                                                                              |

Identity formats follow the [identity reference](../identities.md).

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Commands      | Meaning                                                                                                                                                        |
| ----------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | All           | Missing, invalid or expired token. `get` and `list` reject a machine token; `release` rejects a human token or a machine token whose binding does not resolve. |
| `400 gateway.request.validation_failed`         | All           | Invalid path parameter, query field or body; also `attempt` without `node_id`, or `limit` outside 1 to 1000.                                                   |
| `400 system.pagination.cursor_invalid`          | `list`        | The `cursor` value is not a cursor that this operation issued.                                                                                                 |
| `400 gateway.request.unexpected_body`           | `get`, `list` | The request carries a body.                                                                                                                                    |
| `404 scheduler.execution.not_found`             | `get`         | No execution has this identity.                                                                                                                                |
| `403 gateway.registration.required`             | `release`     | The machine identity holds no live worker registration.                                                                                                        |
| `415 gateway.request.unsupported_media_type`    | `release`     | The `Content-Type` is not `application/json`.                                                                                                                  |
| `400 gateway.request.invalid_json`              | `release`     | The body is not valid JSON, or an object repeats a member name.                                                                                                |
| `403 gateway.invocation.execution_proof_failed` | `release`     | The execution does not exist, has ended, has passed `expired_at`, or belongs to another runtime identity.                                                      |
| `400 gateway.idempotency.invalid_key`           | `release`     | Missing or malformed `Idempotency-Key`.                                                                                                                        |
| `409 gateway.idempotency.conflict`              | `release`     | The key is in use by a request that has not completed, or by a different request.                                                                              |
| `409 scheduler.execution.not_running`           | `release`     | The execution is no longer a running claim of the caller when the release transaction checks it.                                                               |
| `409 mission.release.obligation_unmet`          | `release`     | The release rule of the node fails. `details.obligation` is `evidence`, `assessment` or `request`.                                                             |
| `413 gateway.request.body_too_large`            | `release`     | The body exceeds 10 MiB.                                                                                                                                       |
| `504 gateway.invocation.timeout`                | All           | The operation did not complete in 30 seconds.                                                                                                                  |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                               | Commands  | Meaning                                                                                |
| ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------- |
| `cli.scheduler.execution.get.invalid_execution_id`     | `get`     | `<execution-id>` is not a canonical `execution_<ulid>` identity.                       |
| `cli.scheduler.execution.release.invalid_execution_id` | `release` | `<execution-id>` is not a canonical `execution_<ulid>` identity.                       |
| `cli.scheduler.execution.list.invalid_project_id`      | `list`    | `<project-id>` is not a canonical `project_<ulid>` identity.                           |
| `cli.scheduler.execution.list.invalid_node_id`         | `list`    | `--node` is not a canonical `node_<ulid>` identity.                                    |
| `cli.scheduler.execution.list.invalid_attempt`         | `list`    | `--attempt` is not a positive decimal integer.                                         |
| `cli.pagination.limit_invalid`                         | `list`    | `--limit` is not a positive decimal integer.                                           |
| `cli.pagination.limit_out_of_range`                    | `list`    | `--limit` is outside 1 to 1000.                                                        |
| `cli.scheduler.execution.get.token_required`           | `get`     | No nonblank token resolves.                                                            |
| `cli.scheduler.execution.list.token_required`          | `list`    | No nonblank token resolves.                                                            |
| `cli.scheduler.execution.release.token_required`       | `release` | No nonblank token resolves.                                                            |
| `cli.file.*`                                           | `release` | The `--file` value fails a file check; the codes are in [pull work](work.md#failures). |
| `cli.idempotency_key.invalid`                          | `release` | `--idempotency-key` is not a canonical ULID.                                           |
| `cli.option.duplicate`                                 | All       | An option occurs more than once.                                                       |

The CLI does not check `--attempt` without `--node`; the API rejects it with `400 gateway.request.validation_failed`.

A declared API failure makes the CLI exit `1`. The diagnostic starts with the error code of the API; for `release` it also includes the retry key. A transport failure, timeout or malformed response exits `1` with `cli.scheduler.execution.get.indeterminate`, `cli.scheduler.execution.list.indeterminate` or `cli.scheduler.execution.release.indeterminate`. For a read, run the command again. For a release, the diagnostic tells you to run `kanthord scheduler execution get <execution-id>` before any retry. A retry after a committed release fails the execution proof, so read the execution first.

## API shape

### `execution get`

| Item                  | Value                                            |
| --------------------- | ------------------------------------------------ |
| Method and path       | `GET /api/scheduler/execution/:execution_id`     |
| Operation ID          | `scheduler.execution.get`                        |
| Access                | `human` (human bearer JWT)                       |
| Timeout               | 30 seconds                                       |
| Mutation              | No                                               |
| Path/query parameters | `execution_id` (path, required); no query fields |
| Request body          | None                                             |

### `execution list`

| Item                  | Value                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method and path       | `GET /api/scheduler/project/:project_id/execution`                                                                                                                                         |
| Operation ID          | `scheduler.execution.list`                                                                                                                                                                 |
| Access                | `human` (human bearer JWT)                                                                                                                                                                 |
| Timeout               | 30 seconds                                                                                                                                                                                 |
| Mutation              | No                                                                                                                                                                                         |
| Path/query parameters | `project_id` (path, required); `node_id` (query, optional); `attempt` (query, positive integer, requires `node_id`); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |
| Request body          | None                                                                                                                                                                                       |

`execution get` and `execution list` use one header:

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i http://127.0.0.1:31415/api/scheduler/execution/execution_01JZ8R2B3C4D5E6F7G8H9J0K1M \
  -H 'Authorization: Bearer <human-jwt>'

curl -i 'http://127.0.0.1:31415/api/scheduler/project/project_01JZ8PZ0A1B2C3D4E5F6G7H8J9/execution?node_id=node_01JZ8Q0K4M6N8P0R2S4T6V8W0X&attempt=1' \
  -H 'Authorization: Bearer <human-jwt>'
```

### `execution release`

| Item                  | Value                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Method and path       | `POST /api/scheduler/execution/:execution_id/release`                                                   |
| Operation ID          | `scheduler.execution.release`                                                                           |
| Access                | `client` (machine bearer JWT) with a live worker registration and a live execution of that registration |
| Timeout               | 30 seconds                                                                                              |
| Mutation              | Yes                                                                                                     |
| Path/query parameters | `execution_id` (path, required); no query fields                                                        |
| Request body          | Closed JSON object `{ "further_work": <boolean> }`; `further_work` is required                          |

| Header            | Required | Purpose                                                      |
| ----------------- | -------- | ------------------------------------------------------------ |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the instance that holds the claim. |
| `Content-Type`    | Yes      | `application/json`.                                          |
| `Idempotency-Key` | Yes      | Canonical ULID for the release request.                      |

```sh
curl -i -X POST http://127.0.0.1:31415/api/scheduler/execution/execution_01JZ8R2B3C4D5E6F7G8H9J0K1M/release \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"further_work":false}'
```

## CLI shape

### `execution get`

```text
kanthord scheduler execution get <execution-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler execution get execution_01JZ8R2B3C4D5E6F7G8H9J0K1M
```

| Positional argument | Purpose                              |
| ------------------- | ------------------------------------ |
| `<execution-id>`    | Required `execution_<ulid>` to read. |

### `execution list`

```text
kanthord scheduler execution list <project-id> [--node <node-id>] [--attempt <n>] [--limit <count>] [--cursor <opaque>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler execution list project_01JZ8PZ0A1B2C3D4E5F6G7H8J9 \
  --node node_01JZ8Q0K4M6N8P0R2S4T6V8W0X --attempt 1
```

| Positional argument | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `<project-id>`      | Required `project_<ulid>` of the executions. |

| Option              | Default / resolution | Purpose                                                           |
| ------------------- | -------------------- | ----------------------------------------------------------------- |
| `--node <node-id>`  | None; all nodes      | Sets the `node_id` filter.                                        |
| `--attempt <n>`     | None; all attempts   | Sets the `attempt` filter, a positive integer. Requires `--node`. |
| `--limit <count>`   | `100`                | Maximum records on the page, from 1 to 1000.                      |
| `--cursor <opaque>` | None; the first page | `next_cursor` value of the previous page.                         |

### `execution release`

```text
kanthord scheduler execution release <execution-id> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
printf '{ "further_work": false }\n' > release.json
kanthord scheduler execution release execution_01JZ8R2B3C4D5E6F7G8H9J0K1M \
  --file release.json --token '<machine-jwt>'
```

| Positional argument | Purpose                                 |
| ------------------- | --------------------------------------- |
| `<execution-id>`    | Required `execution_<ulid>` to release. |

| Option                     | Default / resolution       | Purpose                                                                       |
| -------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `--file <path>`            | Required; no default       | JSON file that holds the request body. The file must be a regular UTF-8 file. |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets the `Idempotency-Key` header.                                            |

### Shared options

Every command on this page accepts these options:

| Option             | Default / resolution                                                        | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Bearer credential: a human JWT for `get` and `list`, a machine JWT for `release`. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                                  |

`--token` and `--endpoint` belong to the `scheduler` group, and each leaf command accepts them. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.
