# Storage credentials

[Reference index](../README.md)

## Function description

A storage credential is an encrypted secret for an object-storage platform, with a name and a history of revisions. The Storage component owns the credential routes of its platforms. Custody keeps the records. A credential belongs to no project.

The only storage platform is `s3`. Its secret is an S3 access key pair. Its metadata names the `endpoint`, `bucket` and `region` that the health check probes.

Each credential has a name that is unique on the server across all components. A name has 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens. The names `login`, `platform`, `check` and `ssh` are reserved.

Each revision has a `credential_<ulid>` identity under the [identity contract](../identities.md), a revision number, metadata, a creation time and an end time. A revision is live while its `ended_at` is `null`. The newest live revision is the current secret. No answer contains a secret.

**Drain.** A drain ends every live revision older than the newest live revision, unless a live execution pins that revision. `get`, `list`, `rotate` and `revoke` drain the revisions of each name that they answer. `update-metadata`, `verify` and `archive` do not drain.

A name of a platform that another component owns is invisible here. Each command that takes such a name answers `404`, and `list` leaves it out.

### list

List the credentials of the Storage component, one page at a time, in ascending name order. The list leaves out archived credentials unless the request includes them. A platform filter keeps only the credentials of that platform. A filter value that is not a storage platform gives an empty page.

### get

Get one credential with all its revisions, newest first, and the project bindings that name it. An archived credential stays readable.

### verify

Check one stored credential against its platform and store no result. The component decrypts the newest live revision and runs the platform probe with a 10-second deadline. For `s3`, the probe sends an S3 `HeadBucket` request to the stored endpoint, bucket and region. The command pins no revision, drains no revision and writes no row.

### platforms

List the storage platforms with their secret shape, login modes, metadata fields and probe support. The answer comes from the platform table of the component and reads no record.

### create

Create a credential and its first revision. The component validates the name, the platform, the secret and the metadata, and makes no remote call. Use [`check`](#check) to probe a secret before you create the credential.

### rotate

Add a new revision with a new secret under the same name, then drain the older live revisions. The request names the newest live revision that the caller read. An absent `metadata` copies the metadata of the newest live revision. Rotation makes no remote call and changes no binding.

### update-metadata

Add a new revision that keeps the secret of the newest live revision and replaces its metadata. The request names the newest live revision that the caller read. The metadata replaces the previous metadata completely. Older revisions stay live until a later drain or a revoke ends them.

### revoke

End one older revision at once. An execution that pins that revision fails at its next use of the credential. The newest live revision cannot be revoked; use [`rotate`](#rotate) first. After the revoke, the component drains the other older live revisions.

### archive

End every live revision of a credential that no dependent names. The dependents are agent providers, project bindings and inbounds. The rows stay, because execution records refer to them. An archive is final: the name stays taken, and no command restores the credential.

### check

Check a typed secret against its platform before a `create`, and store nothing. The component validates the secret and the metadata as `create` does, then runs the platform probe with a 10-second deadline. For `s3`, the probe sends an S3 `HeadBucket` request with the typed key.

## Expected response

Each API operation returns HTTP `200` with a JSON body. Each CLI command writes one JSON line to stdout and exits `0`. The examples here are formatted.

The mutation commands (`create`, `rotate`, `update-metadata`, `revoke` and `archive`) add `idempotency_key` to the API answer. The read commands print the API answer without change.

### Credential answer

`create`, `rotate`, `update-metadata`, `revoke` and `archive` return the credential answer. `get` adds `bindings`. `list` returns credential answers in `items`.

```json
{
  "name": "backup-store",
  "platform": "s3",
  "revisions": [
    {
      "id": "credential_<ulid>",
      "revision": 2,
      "metadata": {
        "endpoint": "https://s3.eu-central-1.amazonaws.com",
        "bucket": "kanthord-backup",
        "region": "eu-central-1"
      },
      "created_at": 1767225600000,
      "ended_at": null
    },
    {
      "id": "credential_<ulid>",
      "revision": 1,
      "metadata": {
        "endpoint": "https://s3.eu-central-1.amazonaws.com",
        "bucket": "kanthord-backup",
        "region": "eu-central-1"
      },
      "created_at": 1767139200000,
      "ended_at": 1767225600000
    }
  ]
}
```

| Property                 | Type                  | Purpose                                                                 |
| ------------------------ | --------------------- | ----------------------------------------------------------------------- |
| `name`                   | string                | Credential name.                                                        |
| `platform`               | string                | Platform of the credential, `s3`.                                       |
| `revisions`              | array                 | Every revision of the credential, newest first.                         |
| `revisions[].id`         | string                | Revision identity, `credential_<ulid>`.                                 |
| `revisions[].revision`   | positive integer      | Revision number, 1 for the first revision.                              |
| `revisions[].metadata`   | object or `null`      | Metadata of the revision.                                               |
| `revisions[].created_at` | integer               | Creation time in Unix milliseconds.                                     |
| `revisions[].ended_at`   | integer or `null`     | End time in Unix milliseconds; `null` while the revision is live.       |
| `idempotency_key`        | canonical ULID string | CLI only, mutations only. The key of this request; keep it for retries. |

#### list

```json
{
  "items": [{ "name": "backup-store", "platform": "s3", "revisions": [] }],
  "next_cursor": null
}
```

| Property      | Type             | Purpose                                                                    |
| ------------- | ---------------- | -------------------------------------------------------------------------- |
| `items`       | array            | One credential answer for each name on this page, in ascending name order. |
| `next_cursor` | string or `null` | Opaque cursor of the next page; `null` on the last page.                   |

The example shows an empty `revisions` array for brevity. A real item holds every revision of the name.

#### get

The answer is the credential answer with one more property:

```json
{
  "name": "backup-store",
  "platform": "s3",
  "revisions": [],
  "bindings": [
    {
      "project_id": "project_<ulid>",
      "project_name": "kanthord",
      "binding_id": "<binding-id>",
      "name": "backup"
    }
  ]
}
```

| Property                  | Type   | Purpose                                    |
| ------------------------- | ------ | ------------------------------------------ |
| `bindings`                | array  | Project bindings that name the credential. |
| `bindings[].project_id`   | string | Project of the binding.                    |
| `bindings[].project_name` | string | Name of that project.                      |
| `bindings[].binding_id`   | string | Identity of the binding.                   |
| `bindings[].name`         | string | Name of the binding.                       |

The Project service answers this list. A binding in this list blocks [`archive`](#archive).

#### verify and check

```json
{ "status": "healthy", "capability": "bucket head" }
```

| Property     | Type   | Purpose                                                   |
| ------------ | ------ | --------------------------------------------------------- |
| `status`     | string | `healthy`, `unhealthy` or `unknown`.                      |
| `capability` | string | Capability of the platform probe; `bucket head` for `s3`. |

The `s3` probe maps the `HeadBucket` result to a status:

| `HeadBucket` result                                  | `status`    |
| ---------------------------------------------------- | ----------- |
| HTTP `200`                                           | `healthy`   |
| HTTP `404`                                           | `unhealthy` |
| Another HTTP status, for example `403`               | `unknown`   |
| A transport failure, a 10-second timeout or a cancel | `unknown`   |

A key that can only write can get `unknown` from a forbidden probe and still work. The server logs a reason for a failed probe, without key material.

#### platforms

```json
{
  "items": [
    {
      "platform": "s3",
      "secret_shape": "s3_access_key",
      "login_modes": [],
      "metadata_fields": ["endpoint", "bucket", "region"],
      "verifiable": true
    }
  ]
}
```

| Property                  | Type    | Purpose                                                  |
| ------------------------- | ------- | -------------------------------------------------------- |
| `items[].platform`        | string  | Platform name.                                           |
| `items[].secret_shape`    | string  | Shape of the secret object; `s3_access_key` for `s3`.    |
| `items[].login_modes`     | array   | Login modes of the platform; empty for `s3`.             |
| `items[].metadata_fields` | array   | String fields of the platform metadata.                  |
| `items[].verifiable`      | boolean | `true` when `check` and `verify` can probe the platform. |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

These failures apply to every operation on this page:

| HTTP status / code                        | Meaning                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized` | Absent, invalid, expired or banned token, or a machine token.                                      |
| `400 gateway.request.validation_failed`   | A path parameter, query parameter or body field fails the operation schema, or a field is unknown. |
| `504 gateway.invocation.timeout`          | The operation did not finish in 30 seconds. It can still complete after this answer.               |

Operations with a request body (`create`, `rotate`, `update-metadata`, `check`) can also fail with:

| HTTP status / code                           | Meaning                                                    |
| -------------------------------------------- | ---------------------------------------------------------- |
| `415 gateway.request.unsupported_media_type` | The `Content-Type` is not `application/json`.              |
| `400 gateway.request.invalid_json`           | The body is not valid JSON, or an object repeats a member. |
| `413 gateway.request.body_too_large`         | The body exceeds the route limit.                          |

Operations without a request body fail with `400 gateway.request.unexpected_body` when the request has a nonempty body.

Mutations (`create`, `rotate`, `update-metadata`, `revoke`, `archive`) can also fail with:

| HTTP status / code                    | Meaning                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `400 gateway.idempotency.invalid_key` | Absent or malformed `Idempotency-Key`, checked after authentication and schema validation. |
| `409 gateway.idempotency.conflict`    | The key is in use by a different request, or its first request is still in progress.       |

Credential failures:

| HTTP status / code                     | Commands                                                          | Meaning                                                                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 system.pagination.cursor_invalid` | `list`                                                            | The cursor is not a cursor that `list` returned.                                                                                               |
| `404 credential.credential.not_found`  | `get`, `verify`, `rotate`, `update-metadata`, `archive`, `revoke` | The name does not exist, or its platform belongs to another component. For `revoke`, only the second case gives this code.                     |
| `400 credential.input.invalid`         | `create`, `rotate`, `update-metadata`, `check`                    | The name is malformed or reserved, or the secret or the metadata fails the platform schema.                                                    |
| `400 credential.platform.unsupported`  | `create`, `check`                                                 | The platform is not a storage platform.                                                                                                        |
| `400 credential.check.unsupported`     | `check`, `verify`                                                 | The platform has no probe. The `s3` platform has a probe.                                                                                      |
| `409 credential.name.conflict`         | `create`                                                          | A credential of any component already has this name, archived names included. `details.id` is the newest revision identity of that credential. |
| `409 credential.credential.archived`   | `verify`, `rotate`, `update-metadata`, `archive`                  | The credential is archived.                                                                                                                    |
| `409 credential.revision.conflict`     | `rotate`, `update-metadata`                                       | `expected_revision` is not the newest live revision. `details.revision` is the newest live revision.                                           |
| `404 credential.revision.not_found`    | `revoke`                                                          | The name has no revision with this number. An unknown name also gives this code.                                                               |
| `409 credential.revision.ended`        | `revoke`                                                          | The revision already ended, by a revoke, a drain or an archive.                                                                                |
| `409 credential.revision.newest_live`  | `revoke`                                                          | The revision is the newest live revision.                                                                                                      |
| `409 credential.credential.in_use`     | `archive`                                                         | A dependent names the credential. `details` holds `agent_providers`, `bindings` and `inbounds`.                                                |

The `credential.credential.in_use` details have this shape:

```json
{
  "agent_providers": [
    { "agent_name": "<agent>", "provider_name": "<provider>" }
  ],
  "bindings": [
    { "binding_id": "<binding-id>", "project_id": "project_<ulid>" }
  ],
  "inbounds": [{ "inbound_id": "<inbound-id>" }]
}
```

The gateway records each mutation answer, failures included, under the caller and the key. A retry with the same key and the same request replays that answer while the record lives. The record is process-local, and `gateway.idempotency_ttl` sets its lifetime, 86400 seconds by default.

#### CLI failures

Each CLI failure writes one `<code>: <message>` line to stderr and exits `1`.

- A declared API failure of a read prints `<code>: request failed (HTTP <status>).` A declared API failure of a mutation prints `<code>: request failed (HTTP <status>); idempotency key <key>.`
- A transport failure, a 31-second client timeout or a malformed answer gives `cli.storage.credential.<command>.indeterminate`. For a read, the message is `retry the command`. For a mutation, the message is `retry with --idempotency-key <key>`. The CLI does not retry automatically.
- An absent or blank token gives `cli.storage.credential.<command>.token_required` before a request.

`<command>` is the command name, with `update_metadata` for `update-metadata`.

Local failures before a request:

| Code                                             | Commands                                                                  | Meaning                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cli.option.duplicate`                           | All                                                                       | A single-use option occurs more than once.                                                             |
| `cli.config.invalid_endpoint`                    | All                                                                       | The resolved endpoint is not an absolute HTTP(S) URL without credentials, query or fragment.           |
| `cli.pagination.limit_invalid`                   | `list`                                                                    | `--limit` is not a positive decimal integer.                                                           |
| `cli.pagination.limit_out_of_range`              | `list`                                                                    | `--limit` is greater than 1000.                                                                        |
| `cli.storage.credential.revoke.invalid_revision` | `revoke`                                                                  | `<revision>` is not a positive decimal integer.                                                        |
| `cli.idempotency_key.invalid`                    | Mutations                                                                 | `--idempotency-key` is not a canonical ULID.                                                           |
| `cli.file.invalid_path`                          | `create`, `rotate`, `update-metadata`, `check`                            | `--file` is `-`; the CLI does not read stdin.                                                          |
| `cli.file.not_found`                             | `create`, `rotate`, `update-metadata`, `check`                            | The file does not exist.                                                                               |
| `cli.file.not_regular`                           | `create`, `rotate`, `update-metadata`, `check`                            | The path is not a regular file.                                                                        |
| `system.files.invalid_permissions`               | `create`, `rotate`, `check`                                               | The secret file is a symbolic link, is not owned by the current user, or has a mode other than `0600`. |
| `cli.file.encoding_invalid`                      | `update-metadata`                                                         | The file is not valid UTF-8.                                                                           |
| `cli.file.not_json`                              | `create`, `rotate`, `update-metadata`, `check`                            | The file is not valid JSON.                                                                            |
| `cli.file.duplicate_key`                         | `create`, `rotate`, `update-metadata`, `check`                            | A JSON object repeats a key.                                                                           |
| `cli.file.not_object`                            | `create`, `rotate`, `update-metadata`, `check`                            | The JSON value is not an object.                                                                       |
| `cli.file.schema_invalid`                        | `create`, `rotate`, `update-metadata`, `check`                            | The object fails the body schema. The message lists each issue path and code.                          |
| `gateway.request.validation_failed`              | `get`, `verify`, `rotate`, `update-metadata`, `revoke`, `archive`, `list` | The client-side input check fails, for example an empty name or an empty `--cursor`.                   |

Unknown options, extra arguments and an absent required option fail through the command parser and exit `1`.

## API shape

All operations on this page share these values:

| Item    | Value                                                                           |
| ------- | ------------------------------------------------------------------------------- |
| Access  | `human` (human bearer JWT)                                                      |
| Timeout | 30 seconds; the `verify` and `check` probes have a 10-second deadline inside it |
| Query   | Closed; only `list` accepts query parameters                                    |

| Header            | Required            | Purpose                                                                      |
| ----------------- | ------------------- | ---------------------------------------------------------------------------- |
| `Authorization`   | Yes                 | `Bearer <human-jwt>`.                                                        |
| `Idempotency-Key` | Yes, mutations only | Fresh canonical ULID for a new mutation; reuse it to retry the same request. |
| `Content-Type`    | Yes, with a body    | `application/json`.                                                          |

The path parameter `credential_name` is a nonempty string. Encode it as a URL path segment. The routes `/api/storage/credential/platform` and `/api/storage/credential/check` match before `/:credential_name`. For this reason, `platform` and `check` are reserved names.

The body objects are closed. An unknown member fails with `400 gateway.request.validation_failed`. A `null` value does not mean an absent member.

### list

| Item            | Value                         |
| --------------- | ----------------------------- |
| Method and path | `GET /api/storage/credential` |
| Operation ID    | `storage.credential.list`     |
| Mutation        | No                            |
| Path parameters | None                          |
| Request body    | None                          |

| Query parameter    | Required | Default    | Purpose                                                              |
| ------------------ | -------- | ---------- | -------------------------------------------------------------------- |
| `platform`         | No       | No filter  | Keep only the credentials of this platform.                          |
| `include_archived` | No       | `false`    | `true` adds archived credentials. Only `true` and `false` are valid. |
| `limit`            | No       | `100`      | Page size, a positive integer up to `1000`.                          |
| `cursor`           | No       | First page | The `next_cursor` of the previous page.                              |

```sh
curl -i 'http://127.0.0.1:31415/api/storage/credential?platform=s3&limit=50' \
  -H 'Authorization: Bearer <human-jwt>'
```

### get

| Item            | Value                                          |
| --------------- | ---------------------------------------------- |
| Method and path | `GET /api/storage/credential/:credential_name` |
| Operation ID    | `storage.credential.get`                       |
| Mutation        | No                                             |
| Path parameters | `credential_name`                              |
| Request body    | None                                           |

```sh
curl -i http://127.0.0.1:31415/api/storage/credential/backup-store \
  -H 'Authorization: Bearer <human-jwt>'
```

### verify

| Item            | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Method and path | `POST /api/storage/credential/:credential_name/verify` |
| Operation ID    | `storage.credential.verify`                            |
| Mutation        | No; no `Idempotency-Key`                               |
| Path parameters | `credential_name`                                      |
| Request body    | None                                                   |

```sh
curl -i -X POST http://127.0.0.1:31415/api/storage/credential/backup-store/verify \
  -H 'Authorization: Bearer <human-jwt>'
```

### platforms

| Item            | Value                                  |
| --------------- | -------------------------------------- |
| Method and path | `GET /api/storage/credential/platform` |
| Operation ID    | `storage.credential.platform_list`     |
| Mutation        | No                                     |
| Path parameters | None                                   |
| Request body    | None                                   |

```sh
curl -i http://127.0.0.1:31415/api/storage/credential/platform \
  -H 'Authorization: Bearer <human-jwt>'
```

### create

| Item            | Value                          |
| --------------- | ------------------------------ |
| Method and path | `POST /api/storage/credential` |
| Operation ID    | `storage.credential.create`    |
| Mutation        | Yes                            |
| Path parameters | None                           |
| Request body    | JSON, 64 KiB limit             |

| Body field | Type   | Required | Purpose                                                                                                             |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `name`     | string | Yes      | New credential name.                                                                                                |
| `platform` | string | Yes      | Storage platform, `s3`.                                                                                             |
| `secret`   | object | Yes      | Secret of the platform shape. For `s3`: `access_key_id` and `secret_access_key`, nonblank strings, no other member. |
| `metadata` | object | Yes      | Metadata of the platform. For `s3`: `endpoint` (URL), `bucket` and `region` (nonblank strings), no other member.    |

The component checks the name form first, then the platform, the name availability, the secret and the metadata.

```sh
curl -i -X POST http://127.0.0.1:31415/api/storage/credential \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  --data '{"name":"backup-store","platform":"s3","secret":{"access_key_id":"<access-key-id>","secret_access_key":"<secret-access-key>"},"metadata":{"endpoint":"https://s3.eu-central-1.amazonaws.com","bucket":"kanthord-backup","region":"eu-central-1"}}'
```

### rotate

| Item            | Value                                                    |
| --------------- | -------------------------------------------------------- |
| Method and path | `POST /api/storage/credential/:credential_name/revision` |
| Operation ID    | `storage.credential.rotate`                              |
| Mutation        | Yes                                                      |
| Path parameters | `credential_name`                                        |
| Request body    | JSON, 64 KiB limit                                       |

| Body field          | Type             | Required | Purpose                                                                           |
| ------------------- | ---------------- | -------- | --------------------------------------------------------------------------------- |
| `expected_revision` | positive integer | Yes      | Newest live revision that the caller read.                                        |
| `secret`            | object           | Yes      | New secret of the platform shape, as for `create`.                                |
| `metadata`          | object           | No       | New metadata of the platform schema. When absent, the newest live metadata stays. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/storage/credential/backup-store/revision \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  --data '{"expected_revision":1,"secret":{"access_key_id":"<access-key-id>","secret_access_key":"<secret-access-key>"}}'
```

### update-metadata

| Item            | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Method and path | `PUT /api/storage/credential/:credential_name/metadata` |
| Operation ID    | `storage.credential.update_metadata`                    |
| Mutation        | Yes                                                     |
| Path parameters | `credential_name`                                       |
| Request body    | JSON, 16 KiB limit                                      |

| Body field          | Type             | Required | Purpose                                       |
| ------------------- | ---------------- | -------- | --------------------------------------------- |
| `expected_revision` | positive integer | Yes      | Newest live revision that the caller read.    |
| `metadata`          | object           | Yes      | Complete new metadata of the platform schema. |

The body accepts no secret and no platform.

```sh
curl -i -X PUT http://127.0.0.1:31415/api/storage/credential/backup-store/metadata \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST' \
  -H 'Content-Type: application/json' \
  --data '{"expected_revision":2,"metadata":{"endpoint":"https://s3.eu-central-1.amazonaws.com","bucket":"kanthord-archive","region":"eu-central-1"}}'
```

### revoke

| Item            | Value                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| Method and path | `POST /api/storage/credential/:credential_name/revision/:revision/revoke` |
| Operation ID    | `storage.credential.revoke`                                               |
| Mutation        | Yes                                                                       |
| Path parameters | `credential_name`; `revision`, a positive integer                         |
| Request body    | None                                                                      |

```sh
curl -i -X POST http://127.0.0.1:31415/api/storage/credential/backup-store/revision/1/revoke \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

### archive

| Item            | Value                                                   |
| --------------- | ------------------------------------------------------- |
| Method and path | `POST /api/storage/credential/:credential_name/archive` |
| Operation ID    | `storage.credential.archive`                            |
| Mutation        | Yes                                                     |
| Path parameters | `credential_name`                                       |
| Request body    | None                                                    |

```sh
curl -i -X POST http://127.0.0.1:31415/api/storage/credential/backup-store/archive \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M34JC4BJ66JHP41M4MYY6PST'
```

### check

| Item            | Value                                |
| --------------- | ------------------------------------ |
| Method and path | `POST /api/storage/credential/check` |
| Operation ID    | `storage.credential.check`           |
| Mutation        | No; no `Idempotency-Key`             |
| Path parameters | None                                 |
| Request body    | JSON, 64 KiB limit                   |

The body is the `create` body without `name`: `platform`, `secret` and `metadata`, all required. The component checks the platform first, then the probe support, the secret and the metadata.

```sh
curl -i -X POST http://127.0.0.1:31415/api/storage/credential/check \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  --data '{"platform":"s3","secret":{"access_key_id":"<access-key-id>","secret_access_key":"<secret-access-key>"},"metadata":{"endpoint":"https://s3.eu-central-1.amazonaws.com","bucket":"kanthord-backup","region":"eu-central-1"}}'
```

A literal secret in a cURL command stays in the shell history. Prefer a private file and `--data @<path>`, or the CLI.

## CLI shape

```text
kanthord storage credential list [--platform <platform>] [--include-archived] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
kanthord storage credential get <credential-name> [--token <jwt>] [--endpoint <url>]
kanthord storage credential verify <credential-name> [--token <jwt>] [--endpoint <url>]
kanthord storage credential platforms [--token <jwt>] [--endpoint <url>]
kanthord storage credential create --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord storage credential rotate <credential-name> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord storage credential update-metadata <credential-name> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord storage credential revoke <credential-name> <revision> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord storage credential archive <credential-name> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
kanthord storage credential check --file <path> [--token <jwt>] [--endpoint <url>]
```

`kanthord storage` and `kanthord storage credential` without a command show their help.

### Options of all commands

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Both options belong to the `storage` group. They are valid before or after the command name, and each occurs at most once. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration, reject `--config` and read no interactive input.

The mutation commands also accept this option. The read commands `list`, `get`, `verify`, `platforms` and `check` reject it.

| Option                     | Default / resolution       | Purpose                                                                |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets the `Idempotency-Key` header. Supply the same key when you retry. |

### File rules

`create`, `rotate`, `update-metadata` and `check` read the request body from `--file`. The file holds one JSON object with unique keys. The CLI validates the object before the request and sends it as the body.

`create`, `rotate` and `check` read a secret. Their file is a regular file, not a symbolic link, owned by the current user, with mode `0600`. The CLI does not repair the mode. `update-metadata` reads a regular UTF-8 file without a mode rule. No command accepts `-` for stdin.

Prefer `KANTHORD_TOKEN` or a private `cli.yaml` over literal tokens in shell history.

### list

```sh
kanthord storage credential list --platform s3 --limit 50
```

There are no positional arguments.

| Option                  | Default / resolution | Purpose                                                          |
| ----------------------- | -------------------- | ---------------------------------------------------------------- |
| `--platform <platform>` | No filter            | Sets the `platform` query parameter.                             |
| `--include-archived`    | Off; sends `false`   | Sends `include_archived=true`.                                   |
| `--limit <count>`       | `100`                | Page size, a positive decimal integer up to `1000`.              |
| `--cursor <cursor>`     | First page           | Sets the `cursor` query parameter from a previous `next_cursor`. |

The command fetches one page. It does not follow `next_cursor`.

### get

```sh
kanthord storage credential get backup-store
```

| Argument            | Purpose                 |
| ------------------- | ----------------------- |
| `<credential-name>` | Name of the credential. |

There are no command options.

### verify

```sh
kanthord storage credential verify backup-store
```

| Argument            | Purpose                          |
| ------------------- | -------------------------------- |
| `<credential-name>` | Name of the credential to probe. |

There are no command options.

### platforms

```sh
kanthord storage credential platforms
```

There are no positional arguments and no command options.

### create

```sh
kanthord storage credential create \
  --file ./backup-store.json \
  --idempotency-key 01M34JC4BJ66JHP41M4MYY6PST
```

The file holds the `create` body. All four members are required:

```json
{
  "name": "backup-store",
  "platform": "s3",
  "secret": {
    "access_key_id": "<access-key-id>",
    "secret_access_key": "<secret-access-key>"
  },
  "metadata": {
    "endpoint": "https://s3.eu-central-1.amazonaws.com",
    "bucket": "kanthord-backup",
    "region": "eu-central-1"
  }
}
```

There are no positional arguments.

| Option          | Default / resolution | Purpose                                   |
| --------------- | -------------------- | ----------------------------------------- |
| `--file <path>` | Required             | Private JSON file with the `create` body. |

### rotate

```sh
kanthord storage credential rotate backup-store --file ./backup-store-rotate.json
```

The file holds `expected_revision`, `secret` and an optional `metadata`:

```json
{
  "expected_revision": 1,
  "secret": {
    "access_key_id": "<access-key-id>",
    "secret_access_key": "<secret-access-key>"
  }
}
```

| Argument            | Purpose                 |
| ------------------- | ----------------------- |
| `<credential-name>` | Name of the credential. |

| Option          | Default / resolution | Purpose                                   |
| --------------- | -------------------- | ----------------------------------------- |
| `--file <path>` | Required             | Private JSON file with the `rotate` body. |

### update-metadata

```sh
kanthord storage credential update-metadata backup-store --file ./backup-store-metadata.json
```

The file holds exactly `expected_revision` and `metadata`:

```json
{
  "expected_revision": 2,
  "metadata": {
    "endpoint": "https://s3.eu-central-1.amazonaws.com",
    "bucket": "kanthord-archive",
    "region": "eu-central-1"
  }
}
```

| Argument            | Purpose                 |
| ------------------- | ----------------------- |
| `<credential-name>` | Name of the credential. |

| Option          | Default / resolution | Purpose                                    |
| --------------- | -------------------- | ------------------------------------------ |
| `--file <path>` | Required             | JSON file with the `update-metadata` body. |

### revoke

```sh
kanthord storage credential revoke backup-store 1
```

| Argument            | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `<credential-name>` | Name of the credential.                             |
| `<revision>`        | Revision number to end, a positive decimal integer. |

There are no command options other than `--idempotency-key`.

### archive

```sh
kanthord storage credential archive backup-store
```

| Argument            | Purpose                        |
| ------------------- | ------------------------------ |
| `<credential-name>` | Name of the credential to end. |

There are no command options other than `--idempotency-key`.

### check

```sh
kanthord storage credential check --file ./backup-store-check.json
```

The file holds the `create` body without `name`: `platform`, `secret` and `metadata`, all required.

There are no positional arguments.

| Option          | Default / resolution | Purpose                                  |
| --------------- | -------------------- | ---------------------------------------- |
| `--file <path>` | Required             | Private JSON file with the `check` body. |

The HTTP client has a 31-second deadline for each of these 30-second operations.
