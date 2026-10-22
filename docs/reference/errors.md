# Error codes

[Reference index](README.md)

Engine-defined error codes use at least three nonempty, dot-separated parts:

```text
<namespace>.<component>[.<component>...].<error>
```

- The namespace is the owning service name, `system` for shared server mechanisms, or `cli` for CLI-local failures.
- One or more components identify the location, from broadest to most specific.
- The final part identifies the failure condition.
- Each part starts with a lower-case ASCII letter and contains lower-case letters or digits, with single underscores between words. Spaces, hyphens, empty parts and trailing dots are invalid.
- Codes identify fixed conditions, never request values, entity IDs or secrets.

Examples used by the implementation:

| Code                                             | Meaning                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.config.not_found`                        | The server configuration file is absent.                                                                                                                                                                                                                                                                                                                                        |
| `system.config.version_behind`                   | The configuration version is older than the binary. Run `kanthord upgrade`.                                                                                                                                                                                                                                                                                                     |
| `system.config.version_ahead`                    | The configuration version is newer than the binary.                                                                                                                                                                                                                                                                                                                             |
| `system.database.migration.pending`              | The database has a pending migration. Run `kanthord upgrade`.                                                                                                                                                                                                                                                                                                                   |
| `system.database.migration.incompatible_history` | The recorded migration history cannot be applied by this binary.                                                                                                                                                                                                                                                                                                                |
| `system.database.migration.schema_mismatch`      | The schema of a recorded service differs from its migration text. Stop the server, delete `kanthord.db`, `tracking.db` and their `-wal` and `-shm` files, then start the server. See the [reset procedure](upgrade.md#reset-a-pre-release-database).                                                                                                                            |
| `system.database.binding_placement_missing`      | A worker binding of a worker that kanthord hosts holds no `placement`. Run the [reset procedure](upgrade.md#reset-a-pre-release-database).                                                                                                                                                                                                                                      |
| `system.config.master_key_mismatch`              | `master_key` does not match the database. Restore the backups.                                                                                                                                                                                                                                                                                                                  |
| `system.context.deadline_exceeded`               | A context's deadline expired.                                                                                                                                                                                                                                                                                                                                                   |
| `system.config.invalid_yaml`                     | A configuration file, `kanthord.yaml` or `cli.yaml`, is not valid YAML with unique string keys.                                                                                                                                                                                                                                                                                 |
| `system.config.invalid_mapping`                  | A configuration file is empty or holds no YAML mapping.                                                                                                                                                                                                                                                                                                                         |
| `system.files.invalid_permissions`               | A private file or directory has the wrong type, owner or mode. A file needs the mode `0600`, a directory the mode `0700`, and the user of the process as owner. A symlink is refused. The diagnostic prints the row `path`.                                                                                                                                                     |
| `cli.config.invalid`                             | `cli.yaml` does not match the client schema, for example with an unknown field or a `master_key` field. The diagnostic prints the row `path`.                                                                                                                                                                                                                                   |
| `cli.config.invalid_endpoint`                    | Client endpoint validation failed.                                                                                                                                                                                                                                                                                                                                              |
| `cli.config.invalid_allowed_host`                | An `--gateway-allowed-host` value is not a host with an optional port.                                                                                                                                                                                                                                                                                                          |
| `cli.worker.register.indeterminate`              | The CLI cannot determine the registration result.                                                                                                                                                                                                                                                                                                                               |
| `cli.gateway.liveness.indeterminate`             | `kanthord gateway liveness` gets no usable HTTP answer: a refused connection, a transport failure, a deadline, invalid JSON, a redirect, or an answer other than `200` with no error envelope. See [liveness](gateway/liveness.md#cli-shape).                                                                                                                                   |
| `gateway.http.host_not_allowed`                  | HTTP `403`. The `Host` header is absent or not in `gateway.allowed_hosts`. The message is "Host is not allowed. Add it to gateway.allowed_hosts." `details.host` holds the received `Host` header in lower case, at most 255 characters, or `null` when the header is absent or empty. `details.field` holds `gateway.allowed_hosts`. The answer never lists the allowed hosts. |
| `gateway.authentication.unauthorized`            | Authentication or caller access was rejected.                                                                                                                                                                                                                                                                                                                                   |
| `gateway.registration.stale`                     | The recorded registration has ended and cannot be replayed.                                                                                                                                                                                                                                                                                                                     |
| `gateway.request.validation_failed`              | Operation input validation failed.                                                                                                                                                                                                                                                                                                                                              |
| `gateway.client.answer_invalid`                  | An answer with the expected status fails the operation output schema.                                                                                                                                                                                                                                                                                                           |
| `gateway.idempotency.conflict`                   | The key cannot be replayed for this request.                                                                                                                                                                                                                                                                                                                                    |
| `gateway.routing.not_found`                      | No route matches the request.                                                                                                                                                                                                                                                                                                                                                   |
| `gateway.openapi.not_found`                      | The requested OpenAPI fragment is not allowlisted.                                                                                                                                                                                                                                                                                                                              |
| `gateway.liveness.unhealthy`                     | HTTP `503`. A registered service is unavailable, or no service is registered. `details` holds the complete service map. See [liveness](gateway/liveness.md).                                                                                                                                                                                                                    |
| `gateway.healthcheck.inventory_failed`           | HTTP `503`. A resource owner cannot supply its inventory. `details.missing_inventories` names each owner. See [resource health](gateway/healthcheck.md).                                                                                                                                                                                                                        |

## API failures

HTTP and direct clients use the same failure envelope:

```json
{
  "error": {
    "code": "gateway.authentication.unauthorized",
    "message": "Authentication required.",
    "details": null
  },
  "request_id": "request_01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

A declared failure preserves its originating code, HTTP status and safe details. Unknown exceptions become `gateway.invocation.unknown` with status `500` and no exception text or details. A malformed error envelope, including an invalid error code or a request ID outside the [identity contract](identities.md#request-ids), produces an indeterminate client result rather than a declared failure. An answer with the expected status whose body fails the operation output schema produces the declared failure `gateway.client.answer_invalid` with the received status.

A request with a `Host` header outside `gateway.allowed_hosts` gets this answer:

```json
{
  "error": {
    "code": "gateway.http.host_not_allowed",
    "message": "Host is not allowed. Add it to gateway.allowed_hosts.",
    "details": {
      "host": "kanthord.example.com",
      "field": "gateway.allowed_hosts"
    }
  },
  "request_id": "request_01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

To accept the host, add it to `gateway.allowed_hosts` in `kanthord.yaml`, or create the file with `kanthord config init --gateway-allowed-host <host>`. Then restart the server.

Responses and OpenAPI use the same error-code format. Bare uppercase codes are not accepted; there are no legacy aliases.

## Failure reasons of a health entry

A health entry is the object `{ status, capability, failure_reason }`. The [resource healthcheck](gateway/healthcheck.md), the [binding verify and check](project/binding.md#project-binding-verify-and-project-binding-check) and the credential `verify` and `check` answer it. `details.failure_reason` of `project.bindings.repository.ssh_unreachable` carries the same values.

`failure_reason` is `null` if and only if `status` is `healthy`. Every entry that is not healthy carries a value. A failure with no reported cause carries `unclassified`. A check that exceeds its deadline reports `unknown` with `unclassified`.

A failure reason is not an error code. It is a value of one closed list:

| Value                  | Kind | Meaning                                                                                                                                                                       |
| ---------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address_invalid`      | git  | The repository address host is outside the SSH host set of the platform. No read runs.                                                                                        |
| `host_key_unknown`     | git  | The repository host holds no [host key pin](repository/host-key.md), or ssh does not accept its host key.                                                                     |
| `host_key_changed`     | git  | The repository host presented a key other than its pin. It can mean an interception.                                                                                          |
| `key_refused`          | git  | The repository host refuses the SSH key.                                                                                                                                      |
| `repository_not_found` | git  | The repository host does not find the repository, or the key has no access to it.                                                                                             |
| `host_unreachable`     | git  | ssh cannot resolve or reach the repository host.                                                                                                                              |
| `identity_unavailable` | git  | The server cannot load the [SSH key](repository/ssh-key.md): a legacy `ssh` credential, a key that does not parse, or an SSH agent that does not start or load.               |
| `held_by_instance`     | none | Only worker instances hold live copies of the LLM credential, so the server holds no secret to check. No read runs. See [instance copies](llm/credential.md#instance-copies). |
| `unauthorized`         | HTTP | The remote answers `401`, or a stored OAuth access token is expired.                                                                                                          |
| `forbidden`            | HTTP | The remote answers `403`.                                                                                                                                                     |
| `rate_limited`         | HTTP | The remote answers `429`.                                                                                                                                                     |
| `invalid_response`     | HTTP | The remote answers another status, or a body that the check cannot read.                                                                                                      |
| `unreachable`          | HTTP | The request fails before an HTTP answer.                                                                                                                                      |
| `unclassified`         | both | Any other failure, a check that exceeds its deadline included.                                                                                                                |

The same value can map to a different status for each check. For example, `rate_limited` is `unhealthy` for a `github` credential and `unknown` for an `s3` credential. Each check page states its own mapping: [project binding](project/binding.md#failure-reasons-of-the-address-entry), [LLM credential](llm/credential.md#check-and-verify-answer), [repository credential](repository/credential.md#verify-and-check) and [storage credential](storage/credential.md#verify-and-check). No answer holds remote text. The server log keeps the redacted remote text under `reason`.

## CLI diagnostics

Safe diagnostics print `<code>: <message>` to standard error and exit nonzero. Line 1 starts with the code, and the message holds no value. Each value goes to its own `name: value` row after line 1. A remote declared failure retains its API code. The CLI reports safe local context and does not display the remote message.

The rows after line 1 align with each other. Line 1 takes no part in the alignment. A row name is lower snake_case.

| Row                 | Content                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `status`            | HTTP status of a declared remote failure.                                      |
| `idempotency_key`   | Idempotency key of a mutation. The operator uses it to retry.                  |
| `command`           | Command that the operator runs next.                                           |
| `config`            | Configuration path of a configuration failure.                                 |
| `database`          | Database path of a `master_key` mismatch.                                      |
| `path`              | File path of a file, client configuration or database failure.                 |
| `key`               | JSON key that the file repeats.                                                |
| `option`            | Option that the command receives more than once.                               |
| `field`             | Configuration field that holds an invalid or missing value.                    |
| `old_key`           | Old configuration key of a rename conflict.                                    |
| `new_key`           | New configuration key of a rename conflict.                                    |
| `config_version`    | Configuration version that the file holds.                                     |
| `supported_version` | Configuration version of the binary.                                           |
| `bind`              | Listener address that the gateway cannot bind.                                 |
| `port`              | Listener port that the gateway cannot bind.                                    |
| `version`           | Package version of the worker.                                                 |
| `server_version`    | Package version that the server publishes.                                     |
| `tool_version`      | Version of a repository tool.                                                  |
| `minimum_version`   | Lowest repository tool version that the binary accepts.                        |
| `variables`         | Directory variables of a worker thread that hold no absolute path.             |
| `tool`              | Repository tool or pi tool that cannot run or install.                         |
| `target`            | Host target that the pi tool manifest does not hold.                           |
| `license`           | License file of a pi tool that has no source.                                  |
| `exit_status`       | Exit status of a tool that exits with an error.                                |
| `reason`            | Reason that a pi tool cannot install or run.                                   |
| `step`              | Step of the SSH agent of an operation that fails.                              |
| `details`           | Compact JSON of the `details` of the error body. The row is absent for `null`. |

A read prints `<code>: request failed` and the row `status`. A mutation prints `<code>: request failed` and the rows `status` and `idempotency_key`. `gateway verify`, `worker register` and `worker handover` put the command name before `request failed`.

```text
credential.name.conflict: request failed
status:          409
idempotency_key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST
details:         {"id":"credential_01K6ZB3Q8X2M4N5P6R7S8T9V0W"}
```

A transport failure, a timeout or a malformed answer is indeterminate. A mutation prints `<code>: the result is unknown; retry with the same idempotency key` and the row `idempotency_key`. A read prints `<code>: the result is unknown; retry the command`. A scheduler release prints `<code>: the result is unknown; read the execution before any retry` and the row `command`. The three commands `gateway verify`, `worker register` and `worker handover` also put the command name before the indeterminate message. `gateway verify` says `retry the command`. `worker register` says `retry with the same idempotency key` and prints the row `idempotency_key`. `worker handover` says `retry with a new idempotency key`, because a repeated handover key conflicts. The handover indeterminate message prints no row.

An absent configuration prints `<code>: configuration is absent` and the rows `config` and `command`. A `cli.file.*` failure that names a path prints the row `path`. `cli.file.duplicate_key` prints the row `key`. `cli.file.schema_invalid` prints `the file does not match the schema` and a `details` row of `{path, code}` issues. `cli.file.not_json` and `cli.file.invalid_path` print no row. A repeated option prints `cli.option.duplicate: option may not be repeated` and the row `option`.

A system diagnostic puts its values in rows:

| Code                                             | Message and rows                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.config.version_behind`                   | The message says that the configuration version is older than the binary. The rows are `config_version`, `supported_version` and `command: kanthord upgrade`.                                                                                             |
| `system.config.version_ahead`                    | The message says that the configuration version is newer than the binary. The rows are `config_version` and `supported_version`.                                                                                                                          |
| `system.config.invalid_field`                    | `invalid configuration fields`, with the issues as a JSON list in the `details` row. A bad `version` field prints the row `field`.                                                                                                                        |
| `system.config.rename_conflict`                  | The rows are `old_key` and `new_key`.                                                                                                                                                                                                                     |
| `system.config.master_key_mismatch`              | The rows are `database` and `config`.                                                                                                                                                                                                                     |
| `system.database.migration.pending`              | The rows are `path` and `command: kanthord upgrade`.                                                                                                                                                                                                      |
| `system.database.migration.schema_mismatch`      | The message says that the schema of this service differs from its migration text and names the reset. The rows are `path`, `service` and `object`. `object` is the name of the first differing schema object, in the order of the type and then the name. |
| `system.database.binding_placement_missing`      | The message names the reset. The rows are `path`, `project_id` and `binding`.                                                                                                                                                                             |
| `system.database.migration.incompatible_history` | The row is `path`. `system.database.open_failed`, `system.database.initialization_failed` and `system.database.backup_failed` also print the row `path`.                                                                                                  |
| `system.files.*`                                 | The row is `path`.                                                                                                                                                                                                                                        |
| `gateway.listener.bind_failed`                   | `gateway: cannot bind the listener address.` The rows are `bind` and `port`.                                                                                                                                                                              |
| `worker.version.mismatch`                        | `worker: the package version differs from the server version.` The rows are `version` and `server_version`.                                                                                                                                               |
| `worker.thread.directory_invalid`                | `worker: the directory variables must be absolute paths.` The row is `variables`.                                                                                                                                                                         |
| `worker.slot.init_absent`                        | `slot: no init frame arrived before the deadline.` No row.                                                                                                                                                                                                |
| `worker.slot.frame_invalid`                      | `slot: a line of the slot channel is no valid frame.` The row is `reason`.                                                                                                                                                                                |
| `worker.slot.channel_closed`                     | `slot: the slot channel closed.` The row is `reason`.                                                                                                                                                                                                     |
| `worker.handover.sealed_unopened`                | `worker: the sealed credential copy cannot be opened with the instance key.` No row.                                                                                                                                                                      |
| `repository.connector.tool_missing`              | The row is `tool`. An exit with an error also prints the row `exit_status`.                                                                                                                                                                               |
| `repository.connector.tool_version`              | `tool version is below the minimum version`. The rows are `tool`, `tool_version` and `minimum_version`.                                                                                                                                                   |
| `repository.connector.ssh_agent_failed`          | `<step>: SSH agent failed.` The row is `step`: `directory`, `socket_path`, `files`, `agent` or `load`. [SSH keys](repository/ssh-key.md#the-agent-of-one-operation) states each step.                                                                     |
| `worker.start.tool_missing`                      | The row is `tool`. The rows `target`, `license`, `reason` and `exit_status` name the failed step when it has a value.                                                                                                                                     |

An operational log record that holds a diagnostic as `reason` also holds its rows as `fields`, an object of row name to value. The record holds no `fields` when the diagnostic has no rows.

Unexpected exceptions use `system.operation.unknown: Operation failed.` without disclosing their message or cause.

Native and dependency codes, such as `ENOENT`, Commander's parser codes and Zod issue codes inside validation details, keep their upstream representation. They are not engine-defined error codes. HTTP statuses, process exit codes and integer health statuses are also separate from this naming rule.
