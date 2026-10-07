# Manage project bindings

[Reference index](../README.md)

## Function description

A binding connects a project to one resource under a project-local name. The binding set of a project is the complete map of its current bindings. The Project Service reads the set, replaces it as a whole, lists binding revisions, and probes repository bindings.

A binding has one of three kinds. The kind and configuration give the resource identity of the binding:

| Kind         | Resource identity                            | Resource                                         |
| ------------ | -------------------------------------------- | ------------------------------------------------ |
| `repository` | `repository:<platform>:<owner>/<repository>` | A Git repository on GitHub, GitLab or Bitbucket. |
| `worker`     | `worker:kanthord:<binding-name>`             | A group of worker instances of one worker.       |
| `storage`    | `storage:s3:<endpoint-host>/<bucket>`        | An S3 bucket.                                    |

Each stored change of a binding is a revision with its own binding ID and a revision number. Revision numbers start at `1` for each resource identity in a project. A removal stores a tombstone revision: a copy of the last configuration with `removed_at` set. The binding set version of a project is `1` plus the number of stored revisions in the project. A binding name follows the project name rule: 1 to 63 characters, `^[a-z][a-z0-9-]*$`.

### project binding list

List the latest revision of each resource identity in the project, highest binding ID first. The `state` filter selects `current` (the default), `removed` or `all` bindings. A current binding has a latest revision that is not a tombstone. The `kind` filter accepts one or more kinds and keeps bindings of any given kind.

### project binding get

Read one binding revision by its binding ID. The revision can be old, current or a tombstone. It must belong to the project.

### project binding export

Read the current binding set in the input form of `project binding apply`. The output holds the current version and each current binding with its kind and configuration. Optional fields with defaults, such as `working_layer`, appear with their values.

### project binding apply

Replace the complete binding set of a project. The request gives the expected binding set version and every binding that the project keeps. Export the set, edit it, and apply it with the exported version.

The service compares each submitted name with the current set:

| Change      | Condition                                                        | Effect                                                                         |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `created`   | The name is new, or its resource identity changed.               | Stores revision `1` of the new resource. A replaced resource gets a tombstone. |
| `revised`   | The resource identity is the same and the configuration changed. | Stores the next revision.                                                      |
| `unchanged` | The configuration is the same.                                   | Stores nothing. The change gives the current binding ID.                       |
| `removed`   | A current binding name is absent from the submission.            | Stores a tombstone. The change gives the tombstone binding ID.                 |

An apply without changes keeps the version. Two submitted bindings must not have the same resource identity. A worker binding cannot change its `worker` value.

Before the service commits, it checks each submitted repository binding over the network:

1. The address host equals the SSH host of the `ssh_credential`.
2. The SSH host resolves to the hostname, port and identity file that the SSH credential records.
3. The resolved hostname is an SSH host of the platform, for example `github.com` or `ssh.github.com` for `github`.
4. `git ls-remote` reads the repository.

These checks run before the version check. Inside the commit transaction, the service validates each binding, checks the version, and stores the revisions. A worker binding that the apply removes, or sets to `instance_count` `0`, ends the live worker registrations of its group. After the commit, the service wakes the scheduler for the project.

### project binding revision list

List every retained revision of the resource identity of one binding revision, highest revision first. Tombstones appear in the list. Any binding ID of the resource selects the same list.

### project binding verify

Probe a stored repository binding revision without a write. The revision must be a repository binding of the project that no later tombstone follows. The service probes three resources:

- `address`: the service resolves the SSH host of the address and runs `git ls-remote`, with a 10-second budget.
- `ssh_credential`: the Credential Service checks the SSH credential, with a 10-second budget.
- `credential`: the Credential Service checks the optional platform credential. The entry is `null` when the binding has no `credential`.

A failed probe reports `unhealthy` and is not an error. A probe that exceeds its budget reports `unknown`.

### project binding check

Probe an unsaved repository configuration with the same three probes as `verify`. The service writes nothing. Before the probes, the service applies the action rules, checks the credential platforms, and compares the address host with the SSH credential host. Use `check` to test a repository binding before an apply.

### Binding configuration

The `config` object of each kind accepts only the fields below.

**Repository**

| Field                  | Type                            | Rule                                                                                                                          |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `available`            | boolean                         | Required.                                                                                                                     |
| `platform`             | `github`, `gitlab`, `bitbucket` | Required.                                                                                                                     |
| `address`              | string                          | Required. Form `git@<host>:<owner>/<repository>.git`; `<host>` is the SSH host of `ssh_credential`.                           |
| `strategy.base_branch` | string                          | Required, nonblank.                                                                                                           |
| `strategy.action`      | object                          | Optional. `name` is `pull_request` or `merge_push`; `follows` is `{ "type": "assessment_passed" }`.                           |
| `ssh_credential`       | string                          | Required. Name of a live credential of platform `ssh`.                                                                        |
| `credential`           | string                          | Optional. Name of a live credential of platform `github`. Required for `pull_request`; refused on `gitlab` and `bitbucket`.   |
| `project_prompt`       | string                          | Optional. At most 32768 UTF-8 bytes.                                                                                          |
| `working_layer`        | object                          | Optional. Booleans `agents_md`, `agents_local_md`, `claude_md`, `claude_local_md`, `project_prompt`; each defaults to `true`. |

The schema accepts `follows` type `action_end_state` with a `binding` name, but a refinement refuses it.

**Worker**

| Field             | Type    | Rule                                                                                                                                                                                        |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker`          | string  | Required. Name of a declared worker.                                                                                                                                                        |
| `instance_count`  | integer | Required. From `0` to `64`. The value `0` disables the group.                                                                                                                               |
| `resource_budget` | object  | Optional. Positive integers `turns` and `wall_time_ms`. Refused for a worker that declares no agent.                                                                                        |
| `entries`         | array   | Optional. Items `{ "agent", "agent_provider"?, "model_identifier"?, "reasoning_effort"? }`. Each `agent` is unique and declared by the worker. Refused for a worker that declares no agent. |

The Agent Service validates the effective configuration of each agent of the worker.

**Storage**

| Field        | Type    | Rule                                                  |
| ------------ | ------- | ----------------------------------------------------- |
| `available`  | boolean | Required.                                             |
| `endpoint`   | string  | Required URL.                                         |
| `bucket`     | string  | Required, nonblank.                                   |
| `region`     | string  | Required, nonblank.                                   |
| `prefix`     | string  | Required. Can be empty.                               |
| `credential` | string  | Required. Name of a live credential of platform `s3`. |

## Expected response

Every operation returns HTTP `200`. The CLI writes one JSON line to stdout and exits `0` (shown formatted here). The CLI adds `idempotency_key` to the output of `apply` only.

### project binding list

```json
{
  "items": [
    {
      "id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D3",
      "project_id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
      "name": "builder",
      "kind": "worker",
      "resource_identity": "worker:kanthord:builder",
      "revision": 2,
      "config": { "worker": "<worker-name>", "instance_count": 2 },
      "created_at": 1759900000000,
      "removed_at": null
    }
  ],
  "next_cursor": null
}
```

| Property            | Type             | Purpose                                                   |
| ------------------- | ---------------- | --------------------------------------------------------- |
| `id`                | string           | Binding ID of this revision, with the `binding` prefix.   |
| `project_id`        | string           | Project ID.                                               |
| `name`              | string           | Binding name.                                             |
| `kind`              | string           | `repository`, `worker` or `storage`.                      |
| `resource_identity` | string           | Resource identity of the binding.                         |
| `revision`          | positive integer | Revision number for the resource identity.                |
| `config`            | object           | Stored configuration of the revision.                     |
| `created_at`        | integer          | Revision time in Unix milliseconds.                       |
| `removed_at`        | integer or null  | Removal time for a tombstone; `null` otherwise.           |
| `next_cursor`       | string or null   | Opaque cursor for the next page; `null` on the last page. |

### project binding get

The response is one binding record with the fields of the list items.

### project binding export

```json
{
  "version": 4,
  "bindings": {
    "builder": {
      "kind": "worker",
      "config": { "worker": "<worker-name>", "instance_count": 2 }
    }
  }
}
```

| Property   | Type             | Purpose                                                     |
| ---------- | ---------------- | ----------------------------------------------------------- |
| `version`  | positive integer | Current binding set version. Submit it with the next apply. |
| `bindings` | object           | Map from binding name to `{ "kind", "config" }`.            |

### project binding apply

```json
{
  "project_id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
  "binding_set_version": 5,
  "bindings": {
    "builder": {
      "id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4",
      "project_id": "project_01JD3W8QF4Q7J8M9N0P1R2S3T4",
      "name": "builder",
      "kind": "worker",
      "resource_identity": "worker:kanthord:builder",
      "revision": 3,
      "config": { "worker": "<worker-name>", "instance_count": 3 },
      "created_at": 1759900100000,
      "removed_at": null
    }
  },
  "changes": [
    { "kind": "revised", "binding_id": "binding_01JD3WA2K5V6X7Y8Z9A0B1C2D4" }
  ],
  "idempotency_key": "01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property              | Type                  | Surface     | Purpose                                                                 |
| --------------------- | --------------------- | ----------- | ----------------------------------------------------------------------- |
| `project_id`          | string                | API and CLI | Project ID.                                                             |
| `binding_set_version` | positive integer      | API and CLI | Binding set version after the apply.                                    |
| `bindings`            | object                | API and CLI | Map from name to the binding record of each current binding.            |
| `changes`             | array                 | API and CLI | One `{ "kind", "binding_id" }` item for each submitted or removed name. |
| `idempotency_key`     | canonical ULID string | CLI only    | Key of this request. Supply it again to retry the same request.         |

### project binding revision list

The response has the page form of `project binding list`. Each item is one revision of the same resource identity.

### project binding verify and project binding check

```json
{
  "address": { "status": "healthy", "capability": "network git read" },
  "ssh_credential": { "status": "healthy", "capability": "<capability>" },
  "credential": null
}
```

| Property         | Type           | Purpose                                                                       |
| ---------------- | -------------- | ----------------------------------------------------------------------------- |
| `address`        | object         | Address probe. `capability` is `network git read`.                            |
| `ssh_credential` | object         | SSH credential probe. The Credential Service gives `capability`.              |
| `credential`     | object or null | Platform credential probe; `null` when the configuration has no `credential`. |
| `*.status`       | string         | `healthy`, `unhealthy` or `unknown`.                                          |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                                         | Commands                                           | Meaning                                                                                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`                  | All                                                | Absent, invalid, expired or banned token, or a machine token.                                                                                                    |
| `400 gateway.request.validation_failed`                    | All                                                | A parameter, query value or body field fails the schema or a schema refinement.                                                                                  |
| `400 system.pagination.cursor_invalid`                     | `list`, `revision list`                            | The cursor does not decode to a valid position.                                                                                                                  |
| `404 project.project.not_found`                            | `list`, `export`, `apply`, `verify`, `check`       | No project has this ID.                                                                                                                                          |
| `404 project.binding.not_found`                            | `get`, `revision list`, `verify`                   | No revision with this ID belongs to the project. For `get` and `revision list`, also an unknown project. For `verify`, also a removed or non-repository binding. |
| `409 project.binding_set.version_conflict`                 | `apply`                                            | The submitted version is not current. `details.binding_set_version` holds the current version.                                                                   |
| `400 project.bindings.duplicate_resource`                  | `apply`                                            | Two submitted bindings have the same resource identity.                                                                                                          |
| `409 project.bindings.worker.resource_changed`             | `apply`                                            | A submitted worker binding changes its `worker` value.                                                                                                           |
| `400 project.bindings.worker.instance_count_range`         | `apply`                                            | `instance_count` is outside `0` to `64`.                                                                                                                         |
| `400 project.bindings.worker.field_forbidden`              | `apply`                                            | `entries` or `resource_budget` is set for a worker that declares no agent. `details` holds `binding` and `field`.                                                |
| `400 project.bindings.worker.agent_unknown`                | `apply`                                            | An entry names an agent that the worker does not declare.                                                                                                        |
| `400 agent.configuration.invalid`                          | `apply`                                            | The `worker` value names no declared worker.                                                                                                                     |
| `agent.configuration.*`, `agent.enablement.*`              | `apply`                                            | The Agent Service refuses the effective configuration of an agent, for example a disabled agent.                                                                 |
| `400 project.bindings.repository.address_invalid`          | `apply`, `check`                                   | The address does not match the form, or its SSH host does not resolve to a host of the platform.                                                                 |
| `400 project.bindings.repository.ssh_host_mismatch`        | `apply`, `check`                                   | The address host differs from the SSH credential host.                                                                                                           |
| `400 project.bindings.repository.action_unsupported`       | `apply`, `check`                                   | A `gitlab` or `bitbucket` binding sets `credential` or the `pull_request` action.                                                                                |
| `400 project.bindings.repository.credential_required`      | `apply`, `check`                                   | The `pull_request` action has no `credential`.                                                                                                                   |
| `400 project.bindings.repository.project_prompt_too_large` | `apply`                                            | `project_prompt` exceeds 32768 UTF-8 bytes.                                                                                                                      |
| `400 repository.credential.ssh_drift`                      | `apply`                                            | The SSH host resolves to values that differ from the SSH credential.                                                                                             |
| `422 project.bindings.repository.ssh_unreachable`          | `apply`                                            | `git ls-remote` fails for the repository.                                                                                                                        |
| `404 credential.credential.not_found`                      | `apply`, `verify`, `check`                         | A named credential has no live revision, or the probe cannot use it.                                                                                             |
| `400 credential.platform.mismatch`                         | `apply`, `check`                                   | A named credential has a different platform.                                                                                                                     |
| `409 credential.credential.archived`                       | `verify`, `check`                                  | A named credential is archived.                                                                                                                                  |
| `400 credential.check.unsupported`                         | `verify`, `check`                                  | The credential platform has no check.                                                                                                                            |
| `400 gateway.idempotency.invalid_key`                      | `apply`                                            | Absent or malformed `Idempotency-Key`.                                                                                                                           |
| `409 gateway.idempotency.conflict`                         | `apply`                                            | The key is in use for a different request, or the first request with the key is in progress.                                                                     |
| `413 gateway.request.body_too_large`                       | `apply`, `check`                                   | The body exceeds 10 MiB.                                                                                                                                         |
| `415 gateway.request.unsupported_media_type`               | `apply`, `check`                                   | The request body is not `application/json`.                                                                                                                      |
| `400 gateway.request.unexpected_body`                      | `list`, `get`, `export`, `revision list`, `verify` | The request has a body.                                                                                                                                          |
| `504 gateway.invocation.timeout`                           | All                                                | The operation exceeded 30 seconds. An apply can still complete.                                                                                                  |

Within the replay TTL, a repeated apply key with the same request and caller returns the recorded response, success or failure.

The CLI checks its input before it sends a request. Each local failure exits `1` and writes `<code>: <message>` to stderr.

| Code                                               | Commands                         | Meaning                                                                       |
| -------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `cli.project.binding.<command>.invalid_project_id` | All                              | The project argument is not a valid project ID.                               |
| `cli.project.binding.<command>.invalid_binding_id` | `get`, `verify`, `revision list` | The binding argument is not a valid binding ID.                               |
| `cli.project.binding.list.invalid_kind`            | `list`                           | A `--kind` value is not a binding kind.                                       |
| `cli.project.binding.list.invalid_state`           | `list`                           | `--state` is not `current`, `removed` or `all`.                               |
| `cli.pagination.limit_invalid`                     | `list`, `revision list`          | `--limit` is not a positive decimal integer.                                  |
| `cli.pagination.limit_out_of_range`                | `list`, `revision list`          | `--limit` is more than `1000`.                                                |
| `cli.idempotency_key.invalid`                      | `apply`                          | `--idempotency-key` is not a canonical ULID.                                  |
| `cli.file.invalid_path`                            | `apply`, `check`                 | `--file` is `-`. The CLI does not read stdin.                                 |
| `cli.file.not_found`                               | `apply`, `check`                 | The file does not exist.                                                      |
| `cli.file.not_regular`                             | `apply`, `check`                 | The path is not a regular file.                                               |
| `cli.file.encoding_invalid`                        | `apply`, `check`                 | The file is not valid UTF-8.                                                  |
| `cli.file.not_json`                                | `apply`, `check`                 | The file is not a JSON document.                                              |
| `cli.file.duplicate_key`                           | `apply`, `check`                 | A JSON object in the file repeats a key.                                      |
| `cli.file.not_object`                              | `apply`, `check`                 | The JSON document is not an object.                                           |
| `cli.file.schema_invalid`                          | `apply`, `check`                 | The object fails the request schema. The message lists issue paths and codes. |
| `cli.option.duplicate`                             | All                              | A single-value option occurs more than once.                                  |
| `cli.project.binding.<command>.token_required`     | All                              | No nonblank token resolves.                                                   |

For `revision list`, `<command>` is `revision.list`, for example `cli.project.binding.revision.list.token_required`.

A declared server failure exits `1`. The CLI writes the server code, then the error object as JSON. For `apply`, the JSON also holds `idempotency_key`. A transport failure, a timeout or a malformed response exits `1` with `cli.project.binding.<command>.indeterminate`. For `apply`, the message gives the key to retry with. There is no automatic retry.

## API shape

| Command         | Method and path                                             | Operation ID                   | Mutation | Timeout    |
| --------------- | ----------------------------------------------------------- | ------------------------------ | -------- | ---------- |
| `list`          | `GET /api/project/:project_id/binding`                      | `project.binding.list`         | No       | 30 seconds |
| `get`           | `GET /api/project/:project_id/binding/:binding_id`          | `project.binding.get`          | No       | 30 seconds |
| `export`        | `GET /api/project/:project_id/binding-set`                  | `project.bindingSet.get`       | No       | 30 seconds |
| `apply`         | `PUT /api/project/:project_id/binding-set`                  | `project.bindingSet.write`     | Yes      | 30 seconds |
| `revision list` | `GET /api/project/:project_id/binding/:binding_id/revision` | `project.bindingRevision.list` | No       | 30 seconds |
| `verify`        | `POST /api/project/:project_id/binding/:binding_id/verify`  | `project.binding.verify`       | No       | 30 seconds |
| `check`         | `POST /api/project/:project_id/binding/check`               | `project.binding.check`        | No       | 30 seconds |

Every operation has `human` access: it requires a human bearer JWT.

| Parameter    | In    | Operations                       | Default   | Rule                                                           |
| ------------ | ----- | -------------------------------- | --------- | -------------------------------------------------------------- |
| `project_id` | path  | All                              | None      | Project ID.                                                    |
| `binding_id` | path  | `get`, `revision list`, `verify` | None      | Binding ID of any revision of the project.                     |
| `kind`       | query | `list`                           | All kinds | `repository`, `worker` or `storage`. Repeat it for more kinds. |
| `state`      | query | `list`                           | `current` | `current`, `removed` or `all`.                                 |
| `limit`      | query | `list`, `revision list`          | `100`     | Integer from `1` to `1000`.                                    |
| `cursor`     | query | `list`, `revision list`          | None      | Nonempty `next_cursor` value.                                  |

| Operation | Request body                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `apply`   | `{ "version": <positive integer>, "bindings": { "<name>": { "kind": "<kind>", "config": { ... } } } }` |
| `check`   | `{ "kind": "repository", "config": { ... } }` with a repository configuration.                         |
| Others    | None. `verify` is a `POST` without a body.                                                             |

The body limit is 10 MiB.

| Header            | Required         | Purpose                                                                |
| ----------------- | ---------------- | ---------------------------------------------------------------------- |
| `Authorization`   | Yes              | `Bearer <human-jwt>`.                                                  |
| `Idempotency-Key` | `apply`          | Fresh canonical ULID for a new request. Keep it to retry that request. |
| `Content-Type`    | `apply`, `check` | `application/json`.                                                    |

```sh
curl -i 'http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding?kind=repository&kind=worker&state=all' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding-set \
  -H 'Authorization: Bearer <human-jwt>'

curl -i -X PUT http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding-set \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  --data-binary @bindings.json

curl -i -X POST http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding/binding_01JD3WA2K5V6X7Y8Z9A0B1C2D5/verify \
  -H 'Authorization: Bearer <human-jwt>'

curl -i -X POST http://127.0.0.1:31415/api/project/project_01JD3W8QF4Q7J8M9N0P1R2S3T4/binding/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  --data-binary @repository.json
```

An example `bindings.json`:

```json
{
  "version": 4,
  "bindings": {
    "app": {
      "kind": "repository",
      "config": {
        "available": true,
        "platform": "github",
        "address": "git@github.com:acme/app.git",
        "strategy": {
          "base_branch": "main",
          "action": {
            "name": "pull_request",
            "follows": { "type": "assessment_passed" }
          }
        },
        "ssh_credential": "<ssh-credential-name>",
        "credential": "<github-credential-name>"
      }
    },
    "builder": {
      "kind": "worker",
      "config": { "worker": "<worker-name>", "instance_count": 2 }
    },
    "artifacts": {
      "kind": "storage",
      "config": {
        "available": true,
        "endpoint": "https://s3.example.com",
        "bucket": "artifacts",
        "region": "us-east-1",
        "prefix": "",
        "credential": "<s3-credential-name>"
      }
    }
  }
}
```

A `repository.json` for `check` holds one `{ "kind": "repository", "config": { ... } }` object, with the configuration of `app` above.

## CLI shape

```text
kanthord project binding list <project-id> [--kind <kind>]... [--state <state>] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord project binding get <project-id> <binding-id> [--token <jwt>] [--endpoint <url>]
kanthord project binding export <project-id> [--token <jwt>] [--endpoint <url>]
kanthord project binding apply <project-id> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord project binding revision list <project-id> <binding-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord project binding verify <project-id> <binding-id> [--token <jwt>] [--endpoint <url>]
kanthord project binding check <project-id> --file <path> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord project binding list project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --kind repository --kind worker --state all
kanthord project binding export project_01JD3W8QF4Q7J8M9N0P1R2S3T4 > bindings.json
kanthord project binding apply project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --file bindings.json
kanthord project binding revision list project_01JD3W8QF4Q7J8M9N0P1R2S3T4 binding_01JD3WA2K5V6X7Y8Z9A0B1C2D3
kanthord project binding verify project_01JD3W8QF4Q7J8M9N0P1R2S3T4 binding_01JD3WA2K5V6X7Y8Z9A0B1C2D5
kanthord project binding check project_01JD3W8QF4Q7J8M9N0P1R2S3T4 --file repository.json
```

`kanthord project binding` and `kanthord project binding revision` without a subcommand display help.

### Positional arguments

| Argument       | Commands                         | Purpose                                  |
| -------------- | -------------------------------- | ---------------------------------------- |
| `<project-id>` | All                              | Project ID.                              |
| `<binding-id>` | `get`, `revision list`, `verify` | Binding ID of a revision of the project. |

### project binding list

| Option              | Default / resolution | Purpose                                                        |
| ------------------- | -------------------- | -------------------------------------------------------------- |
| `--kind <kind>`     | All kinds            | Keeps bindings of this kind. Repeat the option for more kinds. |
| `--state <state>`   | `current`            | `current`, `removed` or `all`.                                 |
| `--limit <count>`   | `100`                | Maximum bindings per page, from `1` to `1000`.                 |
| `--cursor <cursor>` | None                 | Continues from the `next_cursor` of a previous page.           |

### project binding get, export and verify

There are no command options.

### project binding apply

| Option                     | Default / resolution       | Purpose                                                            |
| -------------------------- | -------------------------- | ------------------------------------------------------------------ |
| `--file <path>`            | Required                   | JSON file with the complete binding set: `version` and `bindings`. |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets `Idempotency-Key`. Supply the same key to retry.              |

The CLI reads the file as UTF-8 JSON, refuses repeated keys, and checks it against the request schema before it sends the request. The output of `export` is a valid input file.

### project binding revision list

| Option              | Default / resolution | Purpose                                              |
| ------------------- | -------------------- | ---------------------------------------------------- |
| `--limit <count>`   | `100`                | Maximum revisions per page, from `1` to `1000`.      |
| `--cursor <cursor>` | None                 | Continues from the `next_cursor` of a previous page. |

### project binding check

| Option          | Default / resolution | Purpose                                                                  |
| --------------- | -------------------- | ------------------------------------------------------------------------ |
| `--file <path>` | Required             | JSON file with one `{ "kind": "repository", "config": { ... } }` object. |

The CLI applies the file rules of `apply` to this file.

### Shared options

Every command accepts these `project` group options.

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). Only `--kind` can occur more than once. The HTTP client has a 31-second deadline for these 30-second operations.
