# Repository credentials

[Reference index](../README.md)

## Function description

A repository credential is a named, revisioned secret record for a repository platform. Custody stores the records; the Repository component declares their routes. A credential belongs to no project.

The Repository component owns two platforms:

| Platform | Secret shape | Secret object | Metadata                                                    | Platform check                                                 |
| -------- | ------------ | ------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `github` | `api_key`    | `{ "key" }`   | None; send `null`.                                          | `rate-limit read`: reads `https://api.github.com/rate_limit`.  |
| `ssh`    | `none`       | `{}`          | `{ "host", "hostname", "port", "identity_file" }`, all set. | `ssh identity`: compares `ssh -G -- <host>` with the metadata. |

A credential name has 1 to 63 characters. It starts with a lower-case letter, then holds lower-case letters, digits and hyphens. The names `login`, `platform`, `check` and `ssh` are reserved. A name stays taken after an archive. A name whose platform belongs to another component answers `404 credential.credential.not_found` on every command that takes a name.

Each change adds a revision with an identity `credential_<ULID>` (see [identities](../identities.md)). The newest live revision is the current secret. An older live revision stays live while a live execution pins it. A drain sets `ended_at` on each older live revision that no live execution pins. The `api_key` secret has a limit of 48,914 UTF-8 bytes of normalized credential JSON.

The `ssh` metadata pins an alias of `~/.ssh/config` on the server host. `host` matches `^[A-Za-z0-9][A-Za-z0-9.-]*$`, and `port` is an integer from 1 to 65535. The resolved alias needs `identitiesonly yes` and exactly one `identityfile`. Create, rotate and update-metadata of an `ssh` record run `ssh -G -- <host>` on the server before the write. A different `hostname`, `port` or `identity_file` refuses the write. To find aliases, use [SSH alias discovery](ssh-discover.md).

No answer contains a secret.

### list

`list` returns one page of credentials of the repository platforms, in ascending name order. By default, it leaves out an archived name. The read drains each returned name before it projects the page.

### get

`get` returns one credential with all its revisions and the bindings that name it. The read drains the name before it projects the answer.

### verify

`verify` runs the platform check on the newest live revision of a stored record. The check has a 10-second deadline. The command stores no result and pins or drains no revision.

### platforms

`platforms` lists the repository platforms, their secret shapes and their metadata fields.

### create

`create` adds a credential with revision 1. The `github` create makes no remote call. The `ssh` create runs `ssh -G` first.

### rotate

`rotate` adds the next revision with a new secret under the same name. An absent `metadata` copies the metadata of the newest live revision. The same transaction drains the name. Rotation changes no binding.

### update-metadata

`update-metadata` adds the next revision with a full metadata replacement and the secret of the newest live revision. It drains no revision. For `github`, the only valid metadata is `null`.

### revoke

`revoke` ends one older live revision at once. An execution that pins that revision is refused at its next use of the credential. The same transaction drains the other older revisions. The newest live revision cannot be revoked.

### archive

`archive` ends every live revision of a credential and keeps the rows. A dependent refuses the archive: an agent provider, a binding revision or an inbound that names the credential. The dependency check and the archive run in one transaction. An archive is final.

### check

`check` runs the platform check on a typed secret before a create. It stores nothing, and the check has a 10-second deadline.

## Expected response

Every API success returns HTTP `200` with JSON. The CLI writes the same object as one JSON line to stdout and exits `0`. A CLI mutation adds `idempotency_key`, the canonical ULID that it sent.

### Credential answer

`create`, `rotate`, `update-metadata`, `revoke` and `archive` return a credential answer. `get` adds `bindings`. `list` returns credential answers in `items`.

```json
{
  "name": "github-main",
  "platform": "github",
  "revisions": [
    {
      "id": "credential_01M34JC4BJ66JHP41M4MYY6PST",
      "revision": 2,
      "metadata": null,
      "created_at": 1791441600000,
      "ended_at": null
    },
    {
      "id": "credential_01M34J9Q2C8X7KZ0V5R3T6W1NB",
      "revision": 1,
      "metadata": null,
      "created_at": 1791355200000,
      "ended_at": 1791441600000
    }
  ]
}
```

| Property                 | Type                  | Purpose                                                           |
| ------------------------ | --------------------- | ----------------------------------------------------------------- |
| `name`                   | string                | Credential name.                                                  |
| `platform`               | string                | `github` or `ssh`.                                                |
| `revisions`              | array                 | Every revision, newest first.                                     |
| `revisions[].id`         | string                | Revision identity `credential_<ULID>`.                            |
| `revisions[].revision`   | positive integer      | Revision number; the first is `1`.                                |
| `revisions[].metadata`   | object or `null`      | Metadata of the revision; `null` for `github`.                    |
| `revisions[].created_at` | integer               | Creation time in Unix milliseconds.                               |
| `revisions[].ended_at`   | integer or `null`     | End time in Unix milliseconds; `null` while the revision is live. |
| `idempotency_key`        | canonical ULID string | CLI mutations only; key of the request, for a retry.              |

An archived credential has no revision with `ended_at` set to `null`.

### list

```json
{
  "items": [{ "name": "github-main", "platform": "github", "revisions": [] }],
  "next_cursor": null
}
```

| Property      | Type             | Purpose                                                                          |
| ------------- | ---------------- | -------------------------------------------------------------------------------- |
| `items`       | array            | Credential answers of this page, in ascending name order.                        |
| `next_cursor` | string or `null` | Cursor of the next page; `null` on the last page. The CLI fetches one page only. |

### get

The answer is a credential answer with one more property:

```json
{
  "name": "deploy-ssh",
  "platform": "ssh",
  "revisions": [],
  "bindings": [
    {
      "project_id": "<project-id>",
      "project_name": "<project-name>",
      "binding_id": "<binding-id>",
      "name": "<binding-name>"
    }
  ]
}
```

| Property                  | Type   | Purpose                                           |
| ------------------------- | ------ | ------------------------------------------------- |
| `bindings`                | array  | Every binding revision that names the credential. |
| `bindings[].project_id`   | string | Project of the binding.                           |
| `bindings[].project_name` | string | Name of that project.                             |
| `bindings[].binding_id`   | string | Binding identity.                                 |
| `bindings[].name`         | string | Binding name.                                     |

### verify and check

```json
{ "status": "healthy", "capability": "rate-limit read" }
```

| Property     | Type   | Purpose                                                   |
| ------------ | ------ | --------------------------------------------------------- |
| `status`     | string | `healthy`, `unhealthy` or `unknown`.                      |
| `capability` | string | `rate-limit read` for `github`; `ssh identity` for `ssh`. |

The `github` check answers `healthy` for HTTP `200`, `unknown` for HTTP `403`, and `unhealthy` for another status. A network error or an expired deadline answers `unknown`. The `ssh` check answers `healthy` when `ssh -G` resolves exactly the stored or typed metadata. A refusal answers `unhealthy`, and an expired deadline answers `unknown`.

### platforms

```json
{
  "items": [
    {
      "platform": "github",
      "secret_shape": "api_key",
      "login_modes": [],
      "metadata_fields": [],
      "verifiable": true
    },
    {
      "platform": "ssh",
      "secret_shape": "none",
      "login_modes": [],
      "metadata_fields": ["host", "hostname", "identity_file"],
      "verifiable": true
    }
  ]
}
```

| Property          | Type    | Purpose                                               |
| ----------------- | ------- | ----------------------------------------------------- |
| `platform`        | string  | Platform name.                                        |
| `secret_shape`    | string  | Secret shape: `api_key` or `none` for this component. |
| `login_modes`     | array   | Login modes; empty for both repository platforms.     |
| `metadata_fields` | array   | Names of the string fields of the metadata schema.    |
| `verifiable`      | boolean | `true` when the platform has a check.                 |

`metadata_fields` lists string fields only. The `ssh` field `port` is an integer, so the list leaves it out.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                                 | Commands                                      | Meaning                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `401 gateway.authentication.unauthorized`          | All                                           | Missing, invalid, expired or banned token, or a machine token.                                                           |
| `400 gateway.request.validation_failed`            | All                                           | Params, query or body fail the operation schema; `details` lists each path and issue code.                               |
| `400 gateway.request.invalid_json`                 | create, rotate, update-metadata, check        | The body is not valid JSON with unique object members.                                                                   |
| `415 gateway.request.unsupported_media_type`       | create, rotate, update-metadata, check        | The body is not `application/json`.                                                                                      |
| `413 gateway.request.body_too_large`               | create, rotate, update-metadata, check        | The body exceeds the route limit.                                                                                        |
| `400 gateway.request.unexpected_body`              | list, get, verify, platforms, revoke, archive | The operation accepts no body.                                                                                           |
| `400 gateway.idempotency.invalid_key`              | Mutations                                     | Absent or malformed `Idempotency-Key`.                                                                                   |
| `409 gateway.idempotency.conflict`                 | Mutations                                     | The key cannot be replayed for this request.                                                                             |
| `504 gateway.invocation.timeout`                   | All                                           | The 30-second operation timeout expired; a mutation can still complete.                                                  |
| `400 system.pagination.cursor_invalid`             | list                                          | The cursor is not a cursor of this list.                                                                                 |
| `404 credential.credential.not_found`              | get, verify, rotate, update-metadata, archive | The name is unknown, or its platform belongs to another component.                                                       |
| `400 credential.input.invalid`                     | create, rotate, update-metadata, check        | Invalid or reserved name, invalid secret or metadata, or a secret over the byte limit.                                   |
| `400 credential.platform.unsupported`              | create, check                                 | The platform is not `github` or `ssh`.                                                                                   |
| `409 credential.name.conflict`                     | create                                        | The name is taken; `details.id` holds the newest revision identity of the holder.                                        |
| `409 credential.revision.conflict`                 | rotate, update-metadata                       | `expected_revision` is not the newest live revision; `details.revision` holds it.                                        |
| `409 credential.credential.archived`               | verify, rotate, update-metadata, archive      | The credential is archived.                                                                                              |
| `400 credential.check.unsupported`                 | verify, check                                 | The platform has no check.                                                                                               |
| `404 credential.revision.not_found`                | revoke                                        | The name has no such revision, or the name is unknown.                                                                   |
| `409 credential.revision.ended`                    | revoke                                        | The revision is already ended.                                                                                           |
| `409 credential.revision.newest_live`              | revoke                                        | The revision is the newest live revision.                                                                                |
| `409 credential.credential.in_use`                 | archive                                       | A dependent names the credential; see below.                                                                             |
| `400 repository.credential.ssh_identity_ambiguous` | create, rotate, update-metadata (`ssh`)       | The alias resolves without `identitiesonly yes` or without exactly one `identityfile`; `details` holds `host` and `key`. |
| `400 repository.credential.ssh_drift`              | create, rotate, update-metadata (`ssh`)       | The alias resolves to other values; `details` holds `host` and `keys`, the keys that differ.                             |
| `422 repository.credential.ssh_resolve_failed`     | create, rotate, update-metadata (`ssh`)       | The `ssh -G` process fails on the server or exceeds its deadline; `details` holds `host`.                                |

The `credential.credential.in_use` details list the dependents:

```json
{
  "agent_providers": [
    { "agent_name": "<agent-name>", "provider_name": "<provider-name>" }
  ],
  "bindings": [{ "binding_id": "<binding-id>", "project_id": "<project-id>" }],
  "inbounds": [{ "inbound_id": "<inbound-id>" }]
}
```

The CLI exits `1` for every failure and writes one diagnostic line to stderr in the form `<code>: <message>`. A declared API failure of a read prints `<code>: request failed (HTTP <status>).` A declared API failure of a mutation prints `<code>: request failed (HTTP <status>); idempotency key <key>.` A transport failure, timeout or malformed response gives `cli.repository.credential.<command>.indeterminate`. A read diagnostic says `retry the command`. A mutation diagnostic says `retry with --idempotency-key <key>`. For `update-metadata`, `<command>` is `update_metadata`.

| CLI code                                                             | Commands                               | Meaning                                                                            |
| -------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `cli.repository.credential.<command>.token_required`                 | All                                    | The resolved token is absent or blank. The CLI sends no request.                   |
| `cli.repository.credential.revoke.invalid_revision`                  | revoke                                 | `<revision>` is not a positive safe integer in decimal digits.                     |
| `cli.pagination.limit_invalid`                                       | list                                   | `--limit` is not a positive safe integer in decimal digits.                        |
| `cli.pagination.limit_out_of_range`                                  | list                                   | `--limit` is above 1000.                                                           |
| `cli.idempotency_key.invalid`                                        | Mutations                              | `--idempotency-key` is not a canonical ULID.                                       |
| `cli.option.duplicate`                                               | All                                    | An option occurs more than once.                                                   |
| `cli.file.invalid_path`                                              | create, rotate, update-metadata, check | `--file -`; the CLI does not read stdin.                                           |
| `cli.file.not_found`, `cli.file.not_regular`                         | create, rotate, update-metadata, check | The file is absent or is not a regular file.                                       |
| `system.files.invalid_permissions`                                   | create, rotate, check                  | The secret file is a symlink, has a mode other than `0600`, or has another owner.  |
| `cli.file.encoding_invalid`                                          | update-metadata                        | The metadata file is not valid UTF-8.                                              |
| `cli.file.not_json`, `cli.file.duplicate_key`, `cli.file.not_object` | create, rotate, update-metadata, check | The file is not one JSON object with unique keys.                                  |
| `cli.file.schema_invalid`                                            | create, rotate, update-metadata, check | The JSON object fails the body schema; the message lists each path and issue code. |

## API shape

Common properties of every operation:

| Item    | Value                                                                            |
| ------- | -------------------------------------------------------------------------------- |
| Access  | `human` (human bearer JWT)                                                       |
| Timeout | 30 seconds; `verify` and `check` also apply a 10-second check deadline           |
| Query   | Closed; an unknown query parameter fails validation                              |
| Body    | A closed JSON object where a body is accepted; an unknown field fails validation |

| Header            | Required    | Purpose                                                       |
| ----------------- | ----------- | ------------------------------------------------------------- |
| `Authorization`   | Yes         | `Bearer <human-jwt>`.                                         |
| `Content-Type`    | With a body | `application/json`.                                           |
| `Idempotency-Key` | Mutations   | Canonical ULID; reuse the same key to retry the same request. |

The `:credential_name` parameter is a nonempty string. The static paths `/platform`, `/check` and `/ssh/discover` take precedence over `/:credential_name`.

### list

| Item            | Value                            |
| --------------- | -------------------------------- |
| Method and path | `GET /api/repository/credential` |
| Operation ID    | `repository.credential.list`     |
| Mutation        | No                               |
| Request body    | None                             |

| Query parameter    | Required | Value                                              |
| ------------------ | -------- | -------------------------------------------------- |
| `platform`         | No       | Returns only this platform.                        |
| `include_archived` | No       | `true` or `false`; default `false`.                |
| `limit`            | No       | Positive integer, at most `1000`; default `100`.   |
| `cursor`           | No       | Nonempty `next_cursor` value of the previous page. |

```sh
curl -i 'http://127.0.0.1:31415/api/repository/credential?platform=github&limit=50' \
  -H 'Authorization: Bearer <human-jwt>'
```

### get

| Item            | Value                                             |
| --------------- | ------------------------------------------------- |
| Method and path | `GET /api/repository/credential/:credential_name` |
| Operation ID    | `repository.credential.get`                       |
| Mutation        | No                                                |
| Parameters      | `credential_name`                                 |
| Request body    | None                                              |

```sh
curl -i http://127.0.0.1:31415/api/repository/credential/github-main \
  -H 'Authorization: Bearer <human-jwt>'
```

### verify

| Item            | Value                                                     |
| --------------- | --------------------------------------------------------- |
| Method and path | `POST /api/repository/credential/:credential_name/verify` |
| Operation ID    | `repository.credential.verify`                            |
| Mutation        | No; no `Idempotency-Key`                                  |
| Parameters      | `credential_name`                                         |
| Request body    | None                                                      |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/github-main/verify \
  -H 'Authorization: Bearer <human-jwt>'
```

### platforms

| Item            | Value                                     |
| --------------- | ----------------------------------------- |
| Method and path | `GET /api/repository/credential/platform` |
| Operation ID    | `repository.credential.platform_list`     |
| Mutation        | No                                        |
| Parameters      | None                                      |
| Request body    | None                                      |

```sh
curl -i http://127.0.0.1:31415/api/repository/credential/platform \
  -H 'Authorization: Bearer <human-jwt>'
```

### create

| Item            | Value                             |
| --------------- | --------------------------------- |
| Method and path | `POST /api/repository/credential` |
| Operation ID    | `repository.credential.create`    |
| Mutation        | Yes                               |
| Parameters      | None                              |
| Body limit      | 64 KiB                            |

| Body field | Required | Value                                                                     |
| ---------- | -------- | ------------------------------------------------------------------------- |
| `name`     | Yes      | Credential name.                                                          |
| `platform` | Yes      | `github` or `ssh`.                                                        |
| `metadata` | Yes      | Platform metadata; `null` for `github`.                                   |
| `secret`   | Yes      | `{ "key": "<token>" }` for `github`, with a nonblank key; `{}` for `ssh`. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"name":"github-main","platform":"github","metadata":null,"secret":{"key":"<github-token>"}}'
```

An `ssh` body:

```json
{
  "name": "deploy-ssh",
  "platform": "ssh",
  "metadata": {
    "host": "github-deploy",
    "hostname": "github.com",
    "port": 22,
    "identity_file": "<identity-file-path>"
  },
  "secret": {}
}
```

### rotate

| Item            | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Method and path | `POST /api/repository/credential/:credential_name/revision` |
| Operation ID    | `repository.credential.rotate`                              |
| Mutation        | Yes                                                         |
| Parameters      | `credential_name`                                           |
| Body limit      | 64 KiB                                                      |

| Body field          | Required | Value                                                               |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `expected_revision` | Yes      | Positive integer; the newest live revision that the caller read.    |
| `secret`            | Yes      | Secret object of the platform.                                      |
| `metadata`          | No       | Full metadata replacement; when absent, the current metadata stays. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/github-main/revision \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":1,"secret":{"key":"<github-token>"}}'
```

### update-metadata

| Item            | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| Method and path | `PUT /api/repository/credential/:credential_name/metadata` |
| Operation ID    | `repository.credential.update_metadata`                    |
| Mutation        | Yes                                                        |
| Parameters      | `credential_name`                                          |
| Body limit      | 16 KiB                                                     |

| Body field          | Required | Value                                                            |
| ------------------- | -------- | ---------------------------------------------------------------- |
| `expected_revision` | Yes      | Positive integer; the newest live revision that the caller read. |
| `metadata`          | Yes      | Full metadata replacement; `null` for `github`.                  |

```sh
curl -i -X PUT http://127.0.0.1:31415/api/repository/credential/deploy-ssh/metadata \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  -d '{"expected_revision":1,"metadata":{"host":"github-deploy","hostname":"github.com","port":22,"identity_file":"<identity-file-path>"}}'
```

### revoke

| Item            | Value                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| Method and path | `POST /api/repository/credential/:credential_name/revision/:revision/revoke` |
| Operation ID    | `repository.credential.revoke`                                               |
| Mutation        | Yes                                                                          |
| Parameters      | `credential_name`; `revision`, a positive integer                            |
| Request body    | None                                                                         |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/github-main/revision/1/revoke \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

### archive

| Item            | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| Method and path | `POST /api/repository/credential/:credential_name/archive` |
| Operation ID    | `repository.credential.archive`                            |
| Mutation        | Yes                                                        |
| Parameters      | `credential_name`                                          |
| Request body    | None                                                       |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/github-main/archive \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

### check

| Item            | Value                                   |
| --------------- | --------------------------------------- |
| Method and path | `POST /api/repository/credential/check` |
| Operation ID    | `repository.credential.check`           |
| Mutation        | No; no `Idempotency-Key`                |
| Parameters      | None                                    |
| Body limit      | 64 KiB                                  |

| Body field | Required | Value                                   |
| ---------- | -------- | --------------------------------------- |
| `platform` | Yes      | `github` or `ssh`.                      |
| `metadata` | Yes      | Platform metadata; `null` for `github`. |
| `secret`   | Yes      | Secret object of the platform.          |

```sh
curl -i -X POST http://127.0.0.1:31415/api/repository/credential/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"platform":"github","metadata":null,"secret":{"key":"<github-token>"}}'
```

## CLI shape

```text
kanthord repository credential list [--platform <platform>] [--include-archived] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential get <credential-name> [--token <jwt>] [--endpoint <url>]
kanthord repository credential verify <credential-name> [--token <jwt>] [--endpoint <url>]
kanthord repository credential platforms [--token <jwt>] [--endpoint <url>]
kanthord repository credential create --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential rotate <credential-name> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential update-metadata <credential-name> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential revoke <credential-name> <revision> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential archive <credential-name> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord repository credential check --file <path> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord repository credential list --platform github --limit 50
kanthord repository credential get github-main
kanthord repository credential verify github-main
kanthord repository credential platforms
kanthord repository credential create --file ./github-main.json
kanthord repository credential rotate github-main --file ./github-main-rotate.json
kanthord repository credential update-metadata deploy-ssh --file ./deploy-ssh-metadata.json
kanthord repository credential revoke github-main 1 --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
kanthord repository credential archive github-main
kanthord repository credential check --file ./github-main-check.json
```

Invoke `kanthord repository` or `kanthord repository credential` without a command to show its help.

### Positional arguments

| Argument            | Commands                                              | Value                                                                        |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<credential-name>` | get, verify, rotate, update-metadata, revoke, archive | Credential name; sent as `credential_name`.                                  |
| `<revision>`        | revoke                                                | Positive safe integer in decimal digits; the CLI checks it before the token. |

### Options

| Option                     | Commands                                         | Default / resolution                                                  | Purpose                                                                |
| -------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `--token <jwt>`            | All                                              | `KANTHORD_TOKEN` → client-file token; a nonblank token is required    | Human JWT sent in the `Authorization` header.                          |
| `--endpoint <url>`         | All                                              | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415` | Server base URL.                                                       |
| `--platform <platform>`    | list                                             | No filter                                                             | Sets query `platform`.                                                 |
| `--include-archived`       | list                                             | Off; the CLI sends `include_archived=false`                           | Sends `include_archived=true`.                                         |
| `--limit <count>`          | list                                             | `100`; at most `1000`                                                 | Sets query `limit`.                                                    |
| `--cursor <cursor>`        | list                                             | No cursor                                                             | Sets query `cursor` to a `next_cursor` value.                          |
| `--file <path>`            | create, rotate, update-metadata, check           | Required; no default                                                  | JSON file that supplies the request body.                              |
| `--idempotency-key <ulid>` | create, rotate, update-metadata, revoke, archive | A generated canonical ULID                                            | Sets the `Idempotency-Key` header; supply the same key when you retry. |

Each option is single-use. Read commands reject `--idempotency-key` as an unknown option. Explicit options take precedence; see [client configuration](../README.md#client-configuration). Prefer `KANTHORD_TOKEN` or a private `cli.yaml` to a literal token in shell history.

The `--file` object is the API body of the command: `create` and `check` take the body fields above, and `rotate` and `update-metadata` take the body without `credential_name`. The CLI rejects `-` (stdin). It parses one JSON object with unique keys and checks the body schema before the request. For `create`, `rotate` and `check`, the file is a secret file. It must be a regular file, not a symlink, with mode `0600`, and owned by the current user. The CLI repairs no permission and never echoes the secret. The `update-metadata` file must be valid UTF-8 and has no mode rule.

The CLI fetches no further `list` page and makes no automatic retry. After an indeterminate mutation, rerun the command with the same `--idempotency-key`. The HTTP client has a 31-second deadline for these 30-second operations.
