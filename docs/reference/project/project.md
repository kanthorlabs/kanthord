# Manage projects

[Reference index](../README.md)

## Function description

A project is the named owner of a binding set and of one Mission. The Project Service creates, lists, reads, renames, pauses and resumes projects. No operation deletes a project.

### project create

Create a project with the given name and an empty binding set. The same transaction creates the Mission of the project. After the commit, the service creates the project workspace directory `<state-directory>/projects/<project-id>`. The state directory is `$XDG_STATE_HOME/kanthord`, or `~/.local/state/kanthord` when `XDG_STATE_HOME` is not an absolute path. A failure to create the directory does not fail the request.

A project name has 1 to 63 characters. It starts with a lower-case ASCII letter and contains only lower-case letters, digits and hyphens. Project names are unique.

### project list

List projects one page at a time, highest project ID first. A page holds at most `limit` projects. A `next_cursor` value continues the list; `null` marks the last page.

### project get

Read one project by its [project ID](../identities.md).

### project rename

Change the name of a project. The new name follows the create rule and must not belong to a different project. A rename to the current name succeeds. The project ID, binding set and workspace directory do not change.

### project pause

Stop a project from admitting new claims. A new project is active. A paused project has a `paused_at` time.

A worker instance of a paused project stays registered. Each work pull of the project waits for work and then answers `no-work`. A live execution runs to its release, its revocation or its loss. The pause changes no node, job or binding. Mission writes, node controls, releases and Intake events proceed.

A pause of a paused project changes nothing. The response holds the first `paused_at`. The operation takes no body and no version. The last write wins.

### project resume

Let a paused project admit claims again. The service sets `paused_at` to `null` and wakes the waiting work pulls of the project. A resume of an active project changes nothing. The operation takes no body and no version.

## Expected response

Every operation returns HTTP `200`. The CLI writes one JSON line to stdout and exits `0` (shown formatted here). The CLI adds `idempotency_key` to the output of `create`, `rename`, `pause` and `resume`.

### project create

```json
{
  "id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
  "name": "payments",
  "binding_set_version": 1,
  "created_at": 1759900000000,
  "paused_at": null,
  "workspace_directory": "~/.local/state/kanthord/projects/project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property              | Type                  | Surface     | Purpose                                                                                        |
| --------------------- | --------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `id`                  | string                | API and CLI | Project ID with the `project` prefix.                                                          |
| `name`                | string                | API and CLI | Project name.                                                                                  |
| `binding_set_version` | positive integer      | API and CLI | Current binding set version. A new project has version `1`.                                    |
| `created_at`          | integer               | API and CLI | Creation time in Unix milliseconds.                                                            |
| `paused_at`           | integer or null       | API and CLI | Time of the pause in Unix milliseconds. `null` for an active project.                          |
| `workspace_directory` | string                | API and CLI | Workspace directory path on the server host. A path inside the home directory starts with `~`. |
| `idempotency_key`     | canonical ULID string | CLI only    | Key of this request. Supply it again to retry the same request.                                |

### project list

```json
{
  "items": [
    {
      "id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
      "name": "payments",
      "binding_set_version": 4,
      "created_at": 1759900000000,
      "paused_at": null,
      "workspace_directory": "~/.local/state/kanthord/projects/project_01JD3W8QF4Q7J8M9N0P1R2S3T4"
    }
  ],
  "next_cursor": null
}
```

| Property      | Type           | Purpose                                                                         |
| ------------- | -------------- | ------------------------------------------------------------------------------- |
| `items`       | array          | Project records with the fields of `project create`, without `idempotency_key`. |
| `next_cursor` | string or null | Opaque cursor for the next page; `null` on the last page.                       |

### project get

The response is one project record with the fields of `project create`, without `idempotency_key`.

### project rename

The response is the renamed project record. The CLI adds `idempotency_key`.

### project pause

The response is the project record with `paused_at` set to the time of the pause. The CLI adds `idempotency_key`.

### project resume

The response is the project record with `paused_at` set to `null`. The CLI adds `idempotency_key`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Commands                              | Meaning                                                                                      |
| -------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | All                                   | Absent, invalid, expired or banned token, or a machine token.                                |
| `400 gateway.request.validation_failed`      | All                                   | A parameter, query value or body field fails the schema, for example an invalid name.        |
| `400 system.pagination.cursor_invalid`       | `list`                                | The cursor does not decode to a project ID.                                                  |
| `404 project.project.not_found`              | `get`, `rename`, `pause`, `resume`    | No project has this ID.                                                                      |
| `409 project.name.conflict`                  | `create`, `rename`                    | A different project holds the name. `details.id` holds the ID of that project.               |
| `400 gateway.idempotency.invalid_key`        | `create`, `rename`, `pause`, `resume` | Absent or malformed `Idempotency-Key`.                                                       |
| `409 gateway.idempotency.conflict`           | `create`, `rename`, `pause`, `resume` | The key is in use for a different request, or the first request with the key is in progress. |
| `415 gateway.request.unsupported_media_type` | `create`, `rename`                    | The request body is not `application/json`.                                                  |
| `400 gateway.request.unexpected_body`        | `list`, `get`, `pause`, `resume`      | The request has a body.                                                                      |
| `504 gateway.invocation.timeout`             | All                                   | The operation exceeded 30 seconds. A mutation can still complete.                            |

Within the replay TTL, a repeated key with the same request and caller returns the recorded response, success or failure.

The CLI checks its input before it sends a request. Each local failure exits `1` and writes `<code>: <message>` to stderr.

| Code                                    | Commands                              | Meaning                                           |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| `cli.project.create.invalid_name`       | `create`                              | The `--name` value does not follow the name rule. |
| `cli.project.rename.invalid_name`       | `rename`                              | The `--name` value does not follow the name rule. |
| `cli.project.get.invalid_project_id`    | `get`                                 | The argument is not a valid project ID.           |
| `cli.project.rename.invalid_project_id` | `rename`                              | The argument is not a valid project ID.           |
| `cli.project.pause.invalid_project_id`  | `pause`                               | The argument is not a valid project ID.           |
| `cli.project.resume.invalid_project_id` | `resume`                              | The argument is not a valid project ID.           |
| `cli.pagination.limit_invalid`          | `list`                                | `--limit` is not a positive decimal integer.      |
| `cli.pagination.limit_out_of_range`     | `list`                                | `--limit` is more than `1000`.                    |
| `cli.idempotency_key.invalid`           | `create`, `rename`, `pause`, `resume` | `--idempotency-key` is not a canonical ULID.      |
| `cli.option.duplicate`                  | All                                   | An option occurs more than once.                  |
| `cli.project.<command>.token_required`  | All                                   | No nonblank token resolves.                       |

A declared server failure exits `1`. The CLI writes `<code>: request failed` and the row `status`. For `create`, `rename`, `pause` and `resume`, it also writes the row `idempotency_key`. A transport failure, a timeout or a malformed response exits `1` with `cli.project.<command>.indeterminate`. For `create`, `rename`, `pause` and `resume`, the message is `the result is unknown; retry with the same idempotency key`, and the row `idempotency_key` holds the key. For a read, the message is `the result is unknown; retry the command`. There is no automatic retry.

## API shape

| Item             | `project create`           | `project list`     | `project get`                  | `project rename`                 |
| ---------------- | -------------------------- | ------------------ | ------------------------------ | -------------------------------- |
| Method and path  | `POST /api/project`        | `GET /api/project` | `GET /api/project/:project_id` | `PATCH /api/project/:project_id` |
| Operation ID     | `project.create`           | `project.list`     | `project.get`                  | `project.rename`                 |
| Access           | `human` (human bearer JWT) | `human`            | `human`                        | `human`                          |
| Timeout          | 30 seconds                 | 30 seconds         | 30 seconds                     | 30 seconds                       |
| Mutation         | Yes                        | No                 | No                             | Yes                              |
| Path parameters  | None                       | None               | `project_id`                   | `project_id`                     |
| Query parameters | None                       | `limit`, `cursor`  | None                           | None                             |
| Request body     | `{ "name": "<name>" }`     | None               | None                           | `{ "name": "<name>" }`           |

| Item             | `project pause`                       | `project resume`                       |
| ---------------- | ------------------------------------- | -------------------------------------- |
| Method and path  | `POST /api/project/:project_id/pause` | `POST /api/project/:project_id/resume` |
| Operation ID     | `project.pause`                       | `project.resume`                       |
| Access           | `human`                               | `human`                                |
| Timeout          | 30 seconds                            | 30 seconds                             |
| Mutation         | Yes                                   | Yes                                    |
| Path parameters  | `project_id`                          | `project_id`                           |
| Query parameters | None                                  | None                                   |
| Request body     | None                                  | None                                   |

| Query parameter | Default | Rule                          |
| --------------- | ------- | ----------------------------- |
| `limit`         | `100`   | Integer from `1` to `1000`.   |
| `cursor`        | None    | Nonempty `next_cursor` value. |

The body object of `create` and `rename` accepts no other field. The body limit is 10 MiB. `pause` and `resume` accept no body.

| Header            | Required                                 | Purpose                                                                |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `Authorization`   | Yes                                      | `Bearer <human-jwt>`.                                                  |
| `Idempotency-Key` | `create`, `rename`, `pause` and `resume` | Fresh canonical ULID for a new request. Keep it to retry that request. |
| `Content-Type`    | `create` and `rename`                    | `application/json`.                                                    |

```sh
curl -i -X POST http://127.0.0.1:31415/api/project \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"name":"payments"}'

curl -i 'http://127.0.0.1:31415/api/project?limit=50' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4 \
  -H 'Authorization: Bearer <human-jwt>'

curl -i -X PATCH http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4 \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PQR' \
  -H 'Content-Type: application/json' \
  -d '{"name":"billing"}'

curl -i -X POST http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/pause \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PQS'

curl -i -X POST http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/resume \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PQT'
```

## CLI shape

```text
kanthord project create --name <name> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord project list [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord project get <project-id> [--token <jwt>] [--endpoint <url>]
kanthord project rename <project-id> --name <name> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord project pause <project-id> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord project resume <project-id> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord project create --name payments
kanthord project list --limit 50
kanthord project get project_01JD3W8QF4Q7J8M9N0P1R2S3T4
kanthord project rename project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --name billing
kanthord project pause project_01JD3W8QF4Q7J8M9N0P1R2S3T4
kanthord project resume project_01JD3W8QF4Q7J8M9N0P1R2S3T4
```

`kanthord project` without a subcommand displays help.

### project create

There are no positional arguments.

| Option                     | Default / resolution       | Purpose                                               |
| -------------------------- | -------------------------- | ----------------------------------------------------- |
| `--name <name>`            | Required                   | Project name.                                         |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets `Idempotency-Key`. Supply the same key to retry. |

### project list

There are no positional arguments.

| Option              | Default / resolution | Purpose                                              |
| ------------------- | -------------------- | ---------------------------------------------------- |
| `--limit <count>`   | `100`                | Maximum projects per page, from `1` to `1000`.       |
| `--cursor <cursor>` | None                 | Continues from the `next_cursor` of a previous page. |

### project get

| Argument       | Purpose             |
| -------------- | ------------------- |
| `<project-id>` | Project ID to read. |

There are no command options.

### project rename

| Argument       | Purpose               |
| -------------- | --------------------- |
| `<project-id>` | Project ID to rename. |

| Option                     | Default / resolution       | Purpose                                               |
| -------------------------- | -------------------------- | ----------------------------------------------------- |
| `--name <name>`            | Required                   | New project name.                                     |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets `Idempotency-Key`. Supply the same key to retry. |

### project pause

| Argument       | Purpose              |
| -------------- | -------------------- |
| `<project-id>` | Project ID to pause. |

| Option                     | Default / resolution       | Purpose                                               |
| -------------------------- | -------------------------- | ----------------------------------------------------- |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets `Idempotency-Key`. Supply the same key to retry. |

### project resume

| Argument       | Purpose               |
| -------------- | --------------------- |
| `<project-id>` | Project ID to resume. |

| Option                     | Default / resolution       | Purpose                                               |
| -------------------------- | -------------------------- | ----------------------------------------------------- |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets `Idempotency-Key`. Supply the same key to retry. |

### Shared options

Every command accepts these `project` group options.

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). Each option occurs at most once. The HTTP client has a 31-second deadline for these 30-second operations.
