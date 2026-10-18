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

| Code                                             | Meaning                                                                     |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `system.config.not_found`                        | The server configuration file is absent.                                    |
| `system.config.version_behind`                   | The configuration version is older than the binary. Run `kanthord upgrade`. |
| `system.config.version_ahead`                    | The configuration version is newer than the binary.                         |
| `system.database.migration.pending`              | The database has a pending migration. Run `kanthord upgrade`.               |
| `system.database.migration.incompatible_history` | The recorded migration history cannot be applied by this binary.            |
| `system.config.master_key_mismatch`              | `master_key` does not match the database. Restore the backups.              |
| `system.context.deadline_exceeded`               | A context's deadline expired.                                               |
| `cli.config.invalid_endpoint`                    | Client endpoint validation failed.                                          |
| `cli.config.invalid_allowed_host`                | An `--gateway-allowed-host` value is not a host with an optional port.      |
| `cli.worker.register.indeterminate`              | The CLI cannot determine the registration result.                           |
| `gateway.authentication.unauthorized`            | Authentication or caller access was rejected.                               |
| `gateway.registration.stale`                     | The recorded registration has ended and cannot be replayed.                 |
| `gateway.request.validation_failed`              | Operation input validation failed.                                          |
| `gateway.client.answer_invalid`                  | An answer with the expected status fails the operation output schema.       |
| `gateway.idempotency.conflict`                   | The key cannot be replayed for this request.                                |
| `gateway.routing.not_found`                      | No route matches the request.                                               |
| `gateway.openapi.not_found`                      | The requested OpenAPI fragment is not allowlisted.                          |
| `gateway.healthcheck.unhealthy`                  | At least one registered service is unavailable.                             |

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

Responses and OpenAPI use the same error-code format. Bare uppercase codes are not accepted; there are no legacy aliases.

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
| `details`           | Compact JSON of the `details` of the error body. The row is absent for `null`. |

A read prints `<code>: request failed` and the row `status`. A mutation prints `<code>: request failed` and the rows `status` and `idempotency_key`. `gateway verify`, `worker register` and `worker handover` put the command name before `request failed`.

```text
credential.name.conflict: request failed
status:          409
idempotency_key: 01M34JC4BJ66JHP41M4MYY6PST
details:         {"id":"credential_01K6ZB3Q8X2M4N5P6R7S8T9V0W"}
```

A transport failure, a timeout or a malformed answer is indeterminate. A mutation prints `<code>: the result is unknown; retry with the same idempotency key` and the row `idempotency_key`. A read prints `<code>: the result is unknown; retry the command`. A scheduler release prints `<code>: the result is unknown; read the execution before any retry` and the row `command`. The three commands `gateway verify`, `worker register` and `worker handover` also put the command name before the indeterminate message. `gateway verify` says `retry the command`. `worker register` says `retry with the same idempotency key` and prints the row `idempotency_key`. `worker handover` says `retry with a new idempotency key`, because a repeated handover key conflicts. The handover indeterminate message prints no row.

An absent configuration prints `<code>: configuration is absent` and the rows `config` and `command`. A `cli.file.*` failure that names a path prints the row `path`. `cli.file.duplicate_key` prints the row `key`. `cli.file.schema_invalid` prints `the file does not match the schema` and a `details` row of `{path, code}` issues. `cli.file.not_json` and `cli.file.invalid_path` print no row. A repeated option prints `cli.option.duplicate: option may not be repeated` and the row `option`.

A system diagnostic puts its values in rows:

| Code                                             | Message and rows                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.config.version_behind`                   | The message says that the configuration version is older than the binary. The rows are `config_version`, `supported_version` and `command: kanthord upgrade`. |
| `system.config.version_ahead`                    | The message says that the configuration version is newer than the binary. The rows are `config_version` and `supported_version`.                              |
| `system.config.invalid_field`                    | `invalid configuration fields`, with the issues as a JSON list in the `details` row. A bad `version` field prints the row `field`.                            |
| `system.config.rename_conflict`                  | The rows are `old_key` and `new_key`.                                                                                                                         |
| `system.config.master_key_mismatch`              | The rows are `database` and `config`.                                                                                                                         |
| `system.database.migration.pending`              | The rows are `path` and `command: kanthord upgrade`.                                                                                                          |
| `system.database.migration.incompatible_history` | The row is `path`. `system.database.open_failed`, `system.database.initialization_failed` and `system.database.backup_failed` also print the row `path`.      |
| `system.files.*`                                 | The row is `path`.                                                                                                                                            |
| `gateway.listener.bind_failed`                   | `gateway: cannot bind the listener address.` The rows are `bind` and `port`.                                                                                  |
| `worker.version.mismatch`                        | `worker: the package version differs from the server version.` The rows are `version` and `server_version`.                                                   |
| `worker.thread.directory_invalid`                | `worker: the directory variables must be absolute paths.` The row is `variables`.                                                                             |
| `repository.connector.tool_missing`              | The row is `tool`. An exit with an error also prints the row `exit_status`.                                                                                   |
| `repository.connector.tool_version`              | `tool version is below the minimum version`. The rows are `tool`, `tool_version` and `minimum_version`.                                                       |
| `worker.start.tool_missing`                      | The row is `tool`. The rows `target`, `license`, `reason` and `exit_status` name the failed step when it has a value.                                         |

An operational log record that holds a diagnostic as `reason` also holds its rows as `fields`, an object of row name to value. The record holds no `fields` when the diagnostic has no rows.

Unexpected exceptions use `system.operation.unknown: Operation failed.` without disclosing their message or cause.

Native and dependency codes, such as `ENOENT`, Commander's parser codes and Zod issue codes inside validation details, keep their upstream representation. They are not engine-defined error codes. HTTP statuses, process exit codes and integer health statuses are also separate from this naming rule.
