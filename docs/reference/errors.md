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

Safe diagnostics print `<code>: <message>` to standard error and exit nonzero. A remote declared failure retains its API code; the CLI reports safe local context and does not display the remote message. When the error body holds `details` that are not null, the CLI writes a second line `details: <compact JSON>`. A read prints `<code>: request failed (HTTP <status>).` A mutation prints `<code>: request failed (HTTP <status>); idempotency key <key>.` `gateway verify`, `worker register` and `worker handover` put the command name before `request failed`. Unexpected exceptions use `system.operation.unknown: Operation failed.` without disclosing their message or cause.

Native and dependency codes, such as `ENOENT`, Commander's parser codes and Zod issue codes inside validation details, keep their upstream representation. They are not engine-defined error codes. HTTP statuses, process exit codes and integer health statuses are also separate from this naming rule.
