# Manage worker instances

[Reference index](../README.md)

## Function description

Read, resume and end worker instance registrations. A worker instance is one registration of a machine client identity in a worker binding. Its runtime identity is `worker_instance_<ulid>`; see the [identity contract](../identities.md).

- `worker instance list` pages the live registrations in descending runtime-identity order. Filter by project, and by worker binding within that project.
- `worker instance get` reads one live registration. An unknown or ended registration answers not found.
- `worker instance resume` reopens an ended registration that still has a running execution. The registration keeps its runtime identity, and its heartbeat window starts again. A live registration stays unchanged and gives the same answer.
- `worker instance deregister` ends the live registration of the caller and frees its slot in the same transaction. Only the machine client that owns the registration ends it.

List and get are read-only. Resume and deregister are mutations and take an `Idempotency-Key`. A repeated key with the same request replays the recorded answer within the gateway idempotency TTL.

## Expected response

### `worker instance list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "runtime_identity": "worker_instance_01M34JC4BJ66JHP41M4MYY6PST",
      "project_id": "project_01M34JC4BJ66JHP41M4MYY6PSA",
      "resource_identity": "worker:kanthord:general",
      "worker_name": "general@1",
      "host": "kanthord",
      "placement": "worker",
      "client_id": "client_identity_01M34JC4BJ66JHP41M4MYY6PSB",
      "name": "builder-1",
      "activity": "executing",
      "execution_id": "execution_01M34JC4BJ66JHP41M4MYY6PSC",
      "draining": false,
      "registered": true
    }
  ],
  "next_cursor": null
}
```

| Property      | Type           | Purpose                                                   |
| ------------- | -------------- | --------------------------------------------------------- |
| `items`       | array          | Instance records, as described for `worker instance get`. |
| `next_cursor` | string or null | Opaque cursor for the next page; `null` on the last page. |

### `worker instance get`

The API returns HTTP `200` with one instance record. The CLI writes the same object as one JSON line to stdout and exits `0`.

| Property            | Type    | Purpose                                                                          |
| ------------------- | ------- | -------------------------------------------------------------------------------- |
| `runtime_identity`  | string  | Runtime identity of the instance, `worker_instance_<ulid>`.                      |
| `project_id`        | string  | Project of the worker binding.                                                   |
| `resource_identity` | string  | Worker binding, `worker:kanthord:<binding-name>`.                                |
| `worker_name`       | string  | Supplied worker of the binding, for example `general@1`.                         |
| `host`              | string  | `kanthord` or `external-harness`.                                                |
| `placement`         | string  | `worker`; present only when `host` is `kanthord`.                                |
| `client_id`         | string  | Machine client identity that owns the registration, `client_identity_<ulid>`.    |
| `name`              | string  | Display name of the machine client, 1 to 64 characters.                          |
| `activity`          | string  | `idle`, `pulling` or `executing`.                                                |
| `execution_id`      | string  | Execution that the instance claims; present only when `activity` is `executing`. |
| `draining`          | boolean | Always `false` in the current implementation.                                    |
| `registered`        | boolean | Always `true`, because the operation returns live registrations only.            |

### `worker instance resume` and `worker instance deregister`

The API returns HTTP `200`. Resume returns `registered: true`, and deregister returns `registered: false`:

```json
{
  "runtime_identity": "worker_instance_01M34JC4BJ66JHP41M4MYY6PST",
  "registered": false
}
```

The CLI adds the retry key, writes one JSON line to stdout and exits `0` (shown formatted here):

```json
{
  "runtime_identity": "worker_instance_01M34JC4BJ66JHP41M4MYY6PST",
  "registered": false,
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PSD"
}
```

| Property           | Type                  | Surface     | Purpose                                                 |
| ------------------ | --------------------- | ----------- | ------------------------------------------------------- |
| `runtime_identity` | string                | API and CLI | Runtime identity from the request path.                 |
| `registered`       | boolean               | API and CLI | `true` after resume; `false` after deregister.          |
| `idempotency_key`  | canonical ULID string | CLI only    | Key used for this request; supply it again for a retry. |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands                | Meaning                                                                                                                                           |
| ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | All                     | Missing, invalid or expired token, or a token of the wrong kind. List, get and resume require a human token; deregister requires a machine token. |
| `400 gateway.request.validation_failed`   | All                     | Invalid runtime identity, query or body; also `resource_identity` without `project_id`.                                                           |
| `400 system.pagination.cursor_invalid`    | list                    | The cursor is not a cursor that this operation issued.                                                                                            |
| `400 worker.instance.binding_unknown`     | list                    | The worker binding does not exist in the project, or it is removed.                                                                               |
| `404 worker.instance.not_found`           | get, resume, deregister | Get: no live registration. Resume: no registration. Deregister: no live registration that the caller owns.                                        |
| `409 worker.instance.no_live_execution`   | resume                  | The ended registration has no running execution.                                                                                                  |
| `409 worker.instance.client_live`         | resume                  | The client identity already holds another live registration.                                                                                      |
| `409 worker.instance.slot_unavailable`    | resume                  | The worker binding is absent or removed, or all its instance slots are in use.                                                                    |
| `400 gateway.idempotency.invalid_key`     | resume, deregister      | Missing or malformed idempotency key.                                                                                                             |
| `409 gateway.idempotency.conflict`        | resume, deregister      | Conflicting reuse of an idempotency key.                                                                                                          |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. For resume and deregister, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead.

A transport failure, timeout or malformed response exits `1` with an indeterminate code:

| Command      | Code                                           | Recovery                                         |
| ------------ | ---------------------------------------------- | ------------------------------------------------ |
| `list`       | `cli.worker.instance.list.indeterminate`       | Run the command again.                           |
| `get`        | `cli.worker.instance.get.indeterminate`        | Run the command again.                           |
| `resume`     | `cli.worker.instance.resume.indeterminate`     | Run again with the reported `--idempotency-key`. |
| `deregister` | `cli.worker.instance.deregister.indeterminate` | Run again with the reported `--idempotency-key`. |

## API shape

### `worker instance list`

| Item             | Value                      |
| ---------------- | -------------------------- |
| Method and path  | `GET /api/worker/instance` |
| Operation ID     | `worker.instance.list`     |
| Access           | `human` (human bearer JWT) |
| Timeout          | 30 seconds                 |
| Mutation         | No                         |
| Path parameters  | None                       |
| Query parameters | See the table below.       |
| Request body     | None                       |

| Query parameter     | Required                  | Purpose                                                                       |
| ------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `project_id`        | No                        | Canonical project identity; returns instances of this project only.           |
| `resource_identity` | No; requires `project_id` | Worker binding, `worker:kanthord:<binding-name>`; returns its instances only. |
| `limit`             | No                        | Integer from 1 to 1000; default 100.                                          |
| `cursor`            | No                        | `next_cursor` of the previous page.                                           |

```sh
curl -i 'http://127.0.0.1:31415/api/worker/instance?project_id=<project-id>&resource_identity=worker:kanthord:general' \
  -H 'Authorization: Bearer <human-jwt>'
```

### `worker instance get`

| Item             | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Method and path  | `GET /api/worker/instance/:runtime_identity`              |
| Operation ID     | `worker.instance.get`                                     |
| Access           | `human` (human bearer JWT)                                |
| Timeout          | 30 seconds                                                |
| Mutation         | No                                                        |
| Path parameters  | `runtime_identity`: canonical `worker_instance` identity. |
| Query parameters | None                                                      |
| Request body     | None                                                      |

```sh
curl -i http://127.0.0.1:31415/api/worker/instance/<runtime-identity> \
  -H 'Authorization: Bearer <human-jwt>'
```

The list and get operations take only the `Authorization: Bearer <human-jwt>` header.

### `worker instance resume`

| Item             | Value                                                     |
| ---------------- | --------------------------------------------------------- |
| Method and path  | `POST /api/worker/instance/:runtime_identity/resume`      |
| Operation ID     | `worker.instance.resume`                                  |
| Access           | `human` (human bearer JWT)                                |
| Timeout          | 30 seconds                                                |
| Mutation         | Yes                                                       |
| Path parameters  | `runtime_identity`: canonical `worker_instance` identity. |
| Query parameters | None                                                      |
| Request body     | None                                                      |

| Header            | Required | Purpose                                                        |
| ----------------- | -------- | -------------------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <human-jwt>`.                                          |
| `Idempotency-Key` | Yes      | Fresh canonical ULID for a new request; retain it for retries. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/worker/instance/<runtime-identity>/resume \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PSD'
```

### `worker instance deregister`

| Item             | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Method and path  | `DELETE /api/worker/instance/:runtime_identity`                    |
| Operation ID     | `worker.instance.deregister`                                       |
| Access           | `client` (machine bearer JWT); a live registration is not required |
| Timeout          | 30 seconds                                                         |
| Mutation         | Yes                                                                |
| Path parameters  | `runtime_identity`: canonical `worker_instance` identity.          |
| Query parameters | None                                                               |
| Request body     | None                                                               |

| Header            | Required | Purpose                                                          |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the client that owns the registration. |
| `Idempotency-Key` | Yes      | Fresh canonical ULID for a new request; retain it for retries.   |

```sh
curl -i -X DELETE http://127.0.0.1:31415/api/worker/instance/<runtime-identity> \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PSD'
```

After the registration ends, a retry with the same key replays the recorded `200` answer. A new key answers `404 worker.instance.not_found`.

## CLI shape

### `worker instance list`

```text
kanthord worker instance list [--project <project-id>] [--binding <binding-name>] [--limit <count>] [--cursor <opaque>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker instance list --project '<project-id>' --binding general --limit 50
```

There are no positional arguments.

| Option                     | Default / resolution | Purpose                                                                             |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `--project <project-id>`   | None                 | Sets `project_id`.                                                                  |
| `--binding <binding-name>` | None                 | Requires `--project`. Sets `resource_identity` to `worker:kanthord:<binding-name>`. |
| `--limit <count>`          | `100`                | Page size; a positive integer up to `1000`.                                         |
| `--cursor <opaque>`        | None (first page)    | `next_cursor` of the previous page.                                                 |

The CLI checks the options before it resolves the token:

| Code                                               | Condition                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `cli.worker.instance.list.invalid_project_id`      | `--project` is not a canonical project identity.                                           |
| `cli.worker.instance.list.invalid_binding_name`    | `--binding` is not 1 to 63 lower-case letters, digits or hyphens that start with a letter. |
| `cli.worker.instance.list.binding_without_project` | `--binding` without `--project`.                                                           |
| `cli.pagination.limit_invalid`                     | `--limit` is not a positive decimal integer.                                               |
| `cli.pagination.limit_out_of_range`                | `--limit` is above `1000`.                                                                 |
| `cli.worker.instance.list.token_required`          | No nonblank token resolves.                                                                |

### `worker instance get`

```text
kanthord worker instance get <runtime-identity> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker instance get worker_instance_01M34JC4BJ66JHP41M4MYY6PST
```

| Argument             | Purpose                               |
| -------------------- | ------------------------------------- |
| `<runtime-identity>` | Canonical `worker_instance` identity. |

An invalid identity fails with `cli.worker.instance.get.invalid_runtime_identity`. A missing token fails with `cli.worker.instance.get.token_required`.

### `worker instance resume`

```text
kanthord worker instance resume <runtime-identity> [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker instance resume worker_instance_01M34JC4BJ66JHP41M4MYY6PST \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PSD
```

| Argument             | Purpose                               |
| -------------------- | ------------------------------------- |
| `<runtime-identity>` | Canonical `worker_instance` identity. |

| Option                    | Default / resolution       | Purpose                                                             |
| ------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `--idempotency-key <key>` | A generated canonical ULID | Sets the `Idempotency-Key` header; supply the same key for a retry. |

An invalid identity fails with `cli.worker.instance.resume.invalid_runtime_identity`. A missing token fails with `cli.worker.instance.resume.token_required`. A malformed key fails with `cli.idempotency_key.invalid`.

### `worker instance deregister`

```text
kanthord worker instance deregister <runtime-identity> [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord worker instance deregister worker_instance_01M34JC4BJ66JHP41M4MYY6PST \
  --token '<machine-jwt>' \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PSD
```

| Argument             | Purpose                               |
| -------------------- | ------------------------------------- |
| `<runtime-identity>` | Canonical `worker_instance` identity. |

| Option                    | Default / resolution       | Purpose                                                             |
| ------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `--idempotency-key <key>` | A generated canonical ULID | Sets the `Idempotency-Key` header; supply the same key for a retry. |

An invalid identity fails with `cli.worker.instance.deregister.invalid_runtime_identity`. A missing token fails with `cli.worker.instance.deregister.token_required`. A malformed key fails with `cli.idempotency_key.invalid`.

### Shared options

Every `worker instance` command accepts these group options:

| Option             | Default / resolution                                                        | Purpose                                                                                |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Bearer credential: a human JWT for list, get and resume; a machine JWT for deregister. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                                       |

A repeated option other than `--endpoint` fails with `cli.option.duplicate`. See [client configuration](../README.md#client-configuration) for the token and endpoint precedence. The HTTP client deadline is 31 seconds.
