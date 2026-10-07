# Read, submit and delete evidence

[Reference index](../README.md)

## Function description

Evidence records what an execution produced or observed for one attempt of a runnable node. A runnable node is an initiative or an objective. Each evidence holds one or more assets.

| Command                      | Caller                                                    | Effect                                                       |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| `evidence list`              | Human JWT                                                 | Returns one page of the evidence of a node.                  |
| `evidence get`               | Human JWT                                                 | Returns one evidence.                                        |
| `evidence submit`            | Machine JWT; the execution holds a live claim on the node | Records a new evidence for the claimed attempt.              |
| `evidence delete`            | Human JWT                                                 | Deletes an evidence, its assets and its stored objects.      |
| `evidence asset delete`      | Human JWT                                                 | Deletes one asset and its stored object; keeps the evidence. |
| `evidence asset content get` | Human JWT                                                 | Returns the stored content of one asset.                     |

An asset has one of four kinds:

| Kind         | Content                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `repository` | An address: a repository binding and a commit. The server stores no repository snapshot.            |
| `produced`   | Inline bytes, base64 encoded, at most 5 MiB decoded. The server stores the bytes and their SHA-256. |
| `object`     | A stored object of at most 5 GiB in the storage binding of the pinned revision.                     |
| `platform`   | The address of an external object, such as a pull request. Only a request evidence holds this kind. |

Two submissions with identical content produce two evidence records. A correction is a new evidence; an assessment names the evidence that it weighs. Request evidence comes from the Worker action performer through `POST /api/mission/node/:node_id/evidence/request`. No CLI command calls that route.

An `object` asset starts unpublished. The submit answer holds a presigned PUT URL with a lifetime of 1 hour. The uploader then calls `POST /api/mission/evidence/asset/:asset_id/complete` to publish the asset. No CLI command uploads an object or calls that route, and `evidence submit` refuses an `object` asset.

A delete without `force` requires that the node of the evidence and each of its ancestors is `Completed` or `Discarded`. A delete with `force` skips that check and requires a nonblank `reason`. The server validates `reason` and stores it in no mission record. After the commit, the server writes one operational log record of the delete. That record holds the asset or evidence ID, the human account, `force`, `reason` and the time. A delete removes stored objects first, then commits the record change.

`evidence delete` also removes the evidence identity from every assessment and outcome of the node. A request evidence requires `force`. A forced delete of a request evidence of the open attempt pauses the node. That delete ends the live claim and moves the node to `Paused`, unless the node is already `Paused`, `Completed` or `Discarded`. After `evidence delete`, the server wakes the scheduler of the project.

The list and get operations change nothing. Each list call reads one page. The CLI does not follow `next_cursor`.

**Current limitation:** the standalone Server wires no object storage. An operation that calls object storage answers `503 mission.evidence.storage_unavailable`, so no `object` asset exists there.

## Expected response

### `evidence list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "id": "evidence_01M4C5G6BN71J38HW3MFCKMAT6",
      "node_id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4",
      "attempt": 1,
      "subject": "Unit test report",
      "assets": [
        {
          "id": "evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR",
          "kind": "produced",
          "published_at": 1791398400000,
          "expired_at": null,
          "address": {
            "kind": "produced",
            "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
          }
        }
      ],
      "provenance": {
        "kind": "execution",
        "execution_id": "execution_01M4C5G6BP0355Z52M6JCYZCSK",
        "client_id": "client_identity_01M4C5G6BPC5C40S9NFE96N5FB",
        "name": "worker-a"
      },
      "created_at": 1791398400000
    }
  ],
  "next_cursor": null
}
```

| Property      | Type                | Purpose                                                      |
| ------------- | ------------------- | ------------------------------------------------------------ |
| `items`       | array of `Evidence` | At most `limit` evidence records, in reverse identity order. |
| `next_cursor` | string or `null`    | Opaque cursor for the next page. `null` ends the traversal.  |

Without `attempt`, the list covers every attempt of the node.

### `evidence get`

The API returns HTTP `200` with one `Evidence`. The CLI writes it as one JSON line to stdout and exits `0`.

### `Evidence`

| Property          | Type                     | Purpose                                                                   |
| ----------------- | ------------------------ | ------------------------------------------------------------------------- |
| `id`              | `evidence_<ulid>`        | Identity of the evidence.                                                 |
| `node_id`         | `node_<ulid>`            | Node that owns the evidence.                                              |
| `attempt`         | nonnegative safe integer | Attempt of the evidence.                                                  |
| `subject`         | string                   | Short description of the evidence.                                        |
| `assets`          | array of `EvidenceAsset` | Assets in identity order. An asset delete can leave the array empty.      |
| `provenance`      | `Actor`                  | Actor that recorded the evidence. See [attempts](attempt.md#attempt).     |
| `created_at`      | Unix milliseconds        | Time of the record.                                                       |
| `requirement_key` | action key               | Present only on a request evidence: the required action that it requests. |
| `end_state`       | `expected` or `other`    | Present only on a request evidence that reached an end state.             |
| `verification`    | `Verification`           | Present only when the submit supplied one.                                |

`EvidenceAsset` holds these properties:

| Property             | Type                        | Purpose                                                                       |
| -------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `id`                 | `evidence_asset_<ulid>`     | Identity of the asset.                                                        |
| `kind`               | string                      | `repository`, `produced`, `object` or `platform`.                             |
| `published_at`       | Unix milliseconds or `null` | Time of publication; `null` for an unpublished `object` asset.                |
| `expired_at`         | Unix milliseconds or `null` | Upload deadline of an unpublished `object` asset; otherwise `null`.           |
| `address`            | object                      | Address of the content; its `kind` equals the asset kind, or a platform kind. |
| `storage_binding_id` | `binding_<ulid>`            | `object` only: the storage binding that holds the object.                     |
| `size`               | nonnegative safe integer    | `object` only: declared size in bytes.                                        |
| `media_type`         | string                      | `object` only: declared media type.                                           |

The `address` forms are:

| Address `kind` | Other properties                                                                   |
| -------------- | ---------------------------------------------------------------------------------- |
| `repository`   | `binding_id` (`binding_<ulid>`) and `commit` (40 or 64 lower-case hex characters). |
| `produced`     | `sha256` of the decoded bytes.                                                     |
| `object`       | `location` (`s3://` URI), optional `version`, optional `sha256`.                   |
| `pull_request` | `resource_identity` string and positive `number`.                                  |
| `branch_push`  | `resource_identity`, `branch` and `commit` strings.                                |

`Verification` holds `tested_input` and `results`. `tested_input` is one address of kind `repository`, `produced` or `object`, or a nonempty array of repository addresses. Each item of `results` holds these properties:

| Property    | Type              | Purpose                                      |
| ----------- | ----------------- | -------------------------------------------- |
| `command`   | nonblank string   | Verification command that ran.               |
| `exit_code` | integer or `null` | Exit code; `null` when the command had none. |
| `signal`    | string or `null`  | Signal that ended the command, if any.       |
| `timed_out` | boolean           | `true` when the command hit its time limit.  |

### `evidence submit`

The API returns HTTP `200`:

```json
{
  "evidence": {
    "id": "evidence_01M4C5G6BN71J38HW3MFCKMAT6",
    "subject": "Unit test report"
  },
  "uploads": []
}
```

The example abbreviates the evidence record.

| Property   | Type             | Purpose                                                                                                      |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `evidence` | `Evidence`       | The new evidence.                                                                                            |
| `uploads`  | array of objects | One item for each `object` asset: `asset_id`, `put_url`, `headers` and `expires_at`. Empty for other assets. |

The CLI refuses `object` assets, so its `uploads` array is always empty. The CLI adds `idempotency_key` (canonical ULID) to the object and writes one JSON line to stdout, then exits `0`. Retain the key with the same machine token for retries.

### `evidence delete` and `evidence asset delete`

The API returns HTTP `204` with no body. The CLI writes one JSON line with the retry key and exits `0`:

```json
{ "idempotency_key": "01M4C5G6DGWEVZYSPETSQR65JH" }
```

### `evidence asset content get`

The API returns HTTP `200` with a `StoredContent` object. The CLI writes it as one JSON line to stdout and exits `0`.

For a `produced` asset, the answer holds the inline bytes:

```json
{
  "asset_id": "evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR",
  "address": {
    "kind": "produced",
    "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  },
  "media_type": "text/plain",
  "encoding": "base64",
  "data": "dGVzdA=="
}
```

For an `object` asset, the answer holds `asset_id`, `address`, `media_type`, `size`, `get_url` and `expires_at`. `get_url` is a presigned GET URL for the recorded object version. The human CLI writes that URL to stdout. Treat stdout as a secret in that case.

A `repository` or `platform` asset has no stored content. The read fails with `409` and names the address in `details`.

Identity formats follow the [identity reference](../identities.md). Timestamps are integer Unix milliseconds in UTC.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Commands                              | Meaning                                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | All                                   | Absent, invalid or expired token. A machine token on a human command, or a human token on `submit`.                                                                                                                           |
| `400 gateway.request.validation_failed`         | All                                   | Invalid path, query or body. On `submit`, details also name `subject`, `assets`, `tested_input` or a verification text field. On a delete, details name `reason` when `force` has no reason or `reason` is blank or too long. |
| `400 gateway.request.unexpected_body`           | `list`, `get`, `content get`          | The request carries a body.                                                                                                                                                                                                   |
| `415 gateway.request.unsupported_media_type`    | `submit`, both deletes                | The body is not `application/json`.                                                                                                                                                                                           |
| `413 gateway.request.body_too_large`            | `submit`, both deletes                | The body exceeds 10 MiB.                                                                                                                                                                                                      |
| `400 gateway.idempotency.invalid_key`           | `submit`, both deletes                | Absent or malformed idempotency key.                                                                                                                                                                                          |
| `409 gateway.idempotency.conflict`              | `submit`, both deletes                | Conflict on the reuse of an idempotency key.                                                                                                                                                                                  |
| `400 system.pagination.cursor_invalid`          | `list`                                | The `cursor` value is not a cursor that this operation issued.                                                                                                                                                                |
| `404 mission.node.not_found`                    | `list`                                | The node does not exist.                                                                                                                                                                                                      |
| `400 mission.node.control_task`                 | `list`                                | The node is a task.                                                                                                                                                                                                           |
| `404 mission.record.not_found`                  | `get`, both deletes, `content get`    | The evidence or asset does not exist.                                                                                                                                                                                         |
| `403 gateway.registration.required`             | `submit`                              | The machine identity holds no live worker registration.                                                                                                                                                                       |
| `403 gateway.invocation.execution_proof_failed` | `submit`                              | `execution_id` is not a live claim of this registration.                                                                                                                                                                      |
| `409 scheduler.execution.not_running`           | `submit`                              | The claim of the execution is no longer live.                                                                                                                                                                                 |
| `409 mission.execution.context_mismatch`        | `submit`                              | The route node, `execution_id`, `attempt` or `node_revision` differs from the claim. Details name the `field`.                                                                                                                |
| `400 mission.evidence.binding_mismatch`         | `submit`                              | A repository address names a binding that does not match the node. Details hold `binding_id`.                                                                                                                                 |
| `413 mission.evidence.too_large`                | `submit`                              | A `produced` asset exceeds 5 MiB decoded.                                                                                                                                                                                     |
| `409 mission.evidence.storage_binding_absent`   | `submit`                              | An `object` asset meets a pinned revision without a storage binding.                                                                                                                                                          |
| `403 mission.authorization.refused`             | `submit`, both deletes, `content get` | The claim is not live, or the storage binding is removed or disabled. Details hold `reason`.                                                                                                                                  |
| `404 mission.mission.not_found`                 | Both deletes                          | The mission of the node does not exist.                                                                                                                                                                                       |
| `409 mission.version.conflict`                  | Both deletes                          | `expected_mission_version` is stale. Details hold `current`.                                                                                                                                                                  |
| `409 mission.evidence.remove_node_live`         | Both deletes                          | Without `force`, the node or an ancestor is not `Completed` or `Discarded`.                                                                                                                                                   |
| `409 mission.evidence.request_force_required`   | `evidence delete`                     | The evidence is a request evidence, and `force` is `false`.                                                                                                                                                                   |
| `409 mission.evidence.request_asset_refused`    | `evidence asset delete`               | The asset is the `platform` asset of a request evidence.                                                                                                                                                                      |
| `409 mission.evidence.content_repository`       | `content get`                         | The asset is a `repository` address. Details hold `evidence_id` and `address`.                                                                                                                                                |
| `409 mission.evidence.content_platform`         | `content get`                         | The asset is a `platform` address. Details hold `evidence_id` and `address`.                                                                                                                                                  |
| `503 mission.evidence.storage_unavailable`      | `submit`, both deletes, `content get` | The operation needs object storage for an `object` asset, and the Server wires none.                                                                                                                                          |
| `504 gateway.invocation.timeout`                | All                                   | The operation did not complete in 30 seconds.                                                                                                                                                                                 |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                                                                                                                                                 | Commands               | Meaning                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `cli.mission.evidence.list.invalid_node_id`                                                                                                                              | `list`                 | `<node-id>` is not a canonical `node_<ulid>` identity.                                                               |
| `cli.mission.evidence.list.invalid_attempt`                                                                                                                              | `list`                 | `--attempt` is not a nonnegative safe integer in canonical form.                                                     |
| `cli.mission.evidence.get.invalid_evidence_id`                                                                                                                           | `get`                  | `<evidence-id>` is not a canonical `evidence_<ulid>` identity.                                                       |
| `cli.mission.evidence.submit.invalid_node_id`                                                                                                                            | `submit`               | `<node-id>` is not a canonical `node_<ulid>` identity.                                                               |
| `cli.mission.evidence.submit.object_asset`                                                                                                                               | `submit`               | The file holds an `object` asset.                                                                                    |
| `cli.mission.evidence.delete.invalid_evidence_id`                                                                                                                        | `delete`               | `<evidence-id>` is not a canonical `evidence_<ulid>` identity.                                                       |
| `cli.mission.evidence.delete.invalid_expected_mission_version`                                                                                                           | `delete`               | `--expected-mission-version` is not a positive decimal integer.                                                      |
| `cli.mission.evidence.asset.delete.invalid_asset_id`                                                                                                                     | `asset delete`         | `<asset-id>` is not a canonical `evidence_asset_<ulid>` identity.                                                    |
| `cli.mission.evidence.asset.delete.invalid_expected_mission_version`                                                                                                     | `asset delete`         | `--expected-mission-version` is not a positive decimal integer.                                                      |
| `cli.mission.evidence.asset.content.get.invalid_asset_id`                                                                                                                | `content get`          | `<asset-id>` is not a canonical `evidence_asset_<ulid>` identity.                                                    |
| `cli.mission.evidence.<command>.token_required`                                                                                                                          | All                    | No nonblank token resolves. `<command>` is `list`, `get`, `submit`, `delete`, `asset.delete` or `asset.content.get`. |
| `cli.idempotency_key.invalid`                                                                                                                                            | `submit`, both deletes | `--idempotency-key` is not a canonical ULID.                                                                         |
| `cli.file.invalid_path`, `cli.file.not_found`, `cli.file.not_regular`, `cli.file.encoding_invalid`, `cli.file.not_json`, `cli.file.duplicate_key`, `cli.file.not_object` | `submit`               | `--file` is `-`, absent, not a regular file, not UTF-8, not JSON, holds a duplicate key, or is not a JSON object.    |
| `cli.file.schema_invalid`                                                                                                                                                | `submit`               | The file does not match the `EvidenceSubmit` schema.                                                                 |
| `gateway.request.validation_failed`                                                                                                                                      | All                    | The local copy of the operation schema rejects the input, for example `--force` without `--reason`.                  |
| `cli.pagination.limit_invalid`                                                                                                                                           | `list`                 | `--limit` is not a positive decimal integer.                                                                         |
| `cli.pagination.limit_out_of_range`                                                                                                                                      | `list`                 | `--limit` is greater than 1000.                                                                                      |
| `cli.option.duplicate`                                                                                                                                                   | All with options       | An option occurs more than once.                                                                                     |

Canonical form means decimal digits with no sign and no zero before another digit. A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. For `submit` and the deletes, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. A transport failure, timeout or malformed response exits `1`:

- The reads report `cli.mission.evidence.list.indeterminate`, `cli.mission.evidence.get.indeterminate` or `cli.mission.evidence.asset.content.get.indeterminate`. Run the command again.
- `submit` and the deletes report `cli.mission.evidence.submit.indeterminate`, `cli.mission.evidence.delete.indeterminate` or `cli.mission.evidence.asset.delete.indeterminate` with the retry key. Reuse the same key and token. There is no automatic retry.

## API shape

Every operation has a 30-second timeout.

### `evidence list`

| Item                  | Value                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/mission/node/:node_id/evidence`                                                                                                               |
| Operation ID          | `mission.evidence.list`                                                                                                                                 |
| Access                | `human` (human bearer JWT)                                                                                                                              |
| Mutation              | No                                                                                                                                                      |
| Path/query parameters | `node_id` (path, required); `attempt` (query, optional nonnegative safe integer); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |
| Request body          | None                                                                                                                                                    |

### `evidence get`

| Item                  | Value                                           |
| --------------------- | ----------------------------------------------- |
| Method and path       | `GET /api/mission/evidence/:evidence_id`        |
| Operation ID          | `mission.evidence.get`                          |
| Access                | `human` (human bearer JWT)                      |
| Mutation              | No                                              |
| Path/query parameters | `evidence_id` (path, required); no query fields |
| Request body          | None                                            |

### `evidence asset content get`

| Item                  | Value                                               |
| --------------------- | --------------------------------------------------- |
| Method and path       | `GET /api/mission/evidence/asset/:asset_id/content` |
| Operation ID          | `mission.evidence.asset.content.get`                |
| Access                | `human` (human bearer JWT)                          |
| Mutation              | No                                                  |
| Path/query parameters | `asset_id` (path, required); no query fields        |
| Request body          | None                                                |

The three reads use one header:

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/evidence?attempt=1' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/mission/evidence/evidence_01M4C5G6BN71J38HW3MFCKMAT6 \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/mission/evidence/asset/evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR/content \
  -H 'Authorization: Bearer <human-jwt>'
```

To read the next page, send the `next_cursor` value as the `cursor` query parameter with the same `limit` and `attempt`.

### `evidence submit`

| Item                  | Value                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Method and path       | `POST /api/mission/node/:node_id/evidence`                                                |
| Operation ID          | `mission.evidence.submit`                                                                 |
| Access                | `client` (machine bearer JWT) with a live registration and a live claim on `execution_id` |
| Mutation              | Yes                                                                                       |
| Path/query parameters | `node_id` (path, required); no query fields                                               |
| Request body          | `EvidenceSubmit` JSON object; unknown fields are rejected                                 |

| Header            | Required | Purpose                                                               |
| ----------------- | -------- | --------------------------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the registered worker that holds the claim. |
| `Idempotency-Key` | Yes      | Canonical ULID; retain it for retries of that request.                |
| `Content-Type`    | Yes      | `application/json`.                                                   |

| Body field      | Type                   | Rule                                                                                                                                                                |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_id`  | `execution_<ulid>`     | Required. The live execution; the Gateway proves it against the caller registration.                                                                                |
| `attempt`       | positive safe integer  | Required. Equal to the claimed attempt.                                                                                                                             |
| `node_revision` | positive safe integer  | Required. Equal to the pinned revision of the claim.                                                                                                                |
| `subject`       | nonblank string        | Required. At most `mission.text_max_bytes` UTF-8 bytes, 32768 by default.                                                                                           |
| `assets`        | array of `AssetSubmit` | Required, at least one item.                                                                                                                                        |
| `verification`  | `Verification`         | Optional. Each `command` and `signal` follows the `subject` text bound. `tested_input` follows the rules of [assessment submit](assessment.md#assessment-submit-1). |

`AssetSubmit` has one of three forms, selected by `kind`:

| `kind`       | Other fields                                              | Rule                                                                                                         |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `repository` | `address`: a repository address                           | An objective names its own repository binding. An initiative names a repository binding of the same project. |
| `produced`   | `content`: `media_type`, `encoding` (`base64`) and `data` | `data` is canonical base64 of at most 5 MiB decoded.                                                         |
| `object`     | `size` (0 to 5 GiB), `media_type`, optional `sha256`      | The pinned revision holds a storage binding. The CLI refuses this kind.                                      |

A `media_type` has the form `type/subtype` and holds at most 255 characters.

```sh
curl -i -X POST http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/evidence \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Idempotency-Key: 01M4C5G6DGWEVZYSPETSQR65JH' \
  -H 'Content-Type: application/json' \
  -d '{"execution_id":"execution_01M4C5G6BP0355Z52M6JCYZCSK","attempt":1,"node_revision":3,"subject":"Unit test report","assets":[{"kind":"produced","content":{"media_type":"text/plain","encoding":"base64","data":"dGVzdA=="}}],"verification":{"tested_input":{"kind":"repository","binding_id":"binding_01M4C5G6BP5EWTVTTXFH1R25MC","commit":"4b825dc642cb6eb9a060e54bf8d69288fbee4904"},"results":[{"command":"npm test","exit_code":0,"signal":null,"timed_out":false}]}}'
```

### `evidence delete`

| Item                  | Value                                                     |
| --------------------- | --------------------------------------------------------- |
| Method and path       | `DELETE /api/mission/evidence/:evidence_id`               |
| Operation ID          | `mission.evidence.delete`                                 |
| Access                | `human` (human bearer JWT)                                |
| Mutation              | Yes                                                       |
| Path/query parameters | `evidence_id` (path, required); no query fields           |
| Request body          | `EvidenceDelete` JSON object; unknown fields are rejected |

### `evidence asset delete`

| Item                  | Value                                                     |
| --------------------- | --------------------------------------------------------- |
| Method and path       | `DELETE /api/mission/evidence/asset/:asset_id`            |
| Operation ID          | `mission.evidence.asset.delete`                           |
| Access                | `human` (human bearer JWT)                                |
| Mutation              | Yes                                                       |
| Path/query parameters | `asset_id` (path, required); no query fields              |
| Request body          | `EvidenceDelete` JSON object; unknown fields are rejected |

Both deletes use these headers and body:

| Header            | Required | Purpose                                                |
| ----------------- | -------- | ------------------------------------------------------ |
| `Authorization`   | Yes      | `Bearer <human-jwt>`.                                  |
| `Idempotency-Key` | Yes      | Canonical ULID; retain it for retries of that request. |
| `Content-Type`    | Yes      | `application/json`.                                    |

| Body field                 | Type                  | Rule                                                                         |
| -------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `expected_mission_version` | positive safe integer | Required. Equal to the current version of the mission.                       |
| `force`                    | boolean               | Required. `true` skips the terminal-chain check.                             |
| `reason`                   | nonblank string       | Required when `force` is `true`; otherwise optional. Follows the text bound. |

```sh
curl -i -X DELETE http://127.0.0.1:31415/api/mission/evidence/evidence_01M4C5G6BN71J38HW3MFCKMAT6 \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Idempotency-Key: 01M4C5G6DGWEVZYSPETSQR65JH' \
  -H 'Content-Type: application/json' \
  -d '{"expected_mission_version":7,"force":true,"reason":"Remove exposed material"}'
```

The Gateway keeps idempotency records in process memory for `gateway.idempotency_ttl` seconds, 86400 by default. A repeat of the same key, caller and body replays the recorded answer, failures included.

## CLI shape

`--token` and `--endpoint` belong to the `mission` group, and each leaf command accepts them:

| Option             | Default / resolution                                                        | Purpose                                                      |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT for `submit`; human JWT for every other command. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                             |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.

### `evidence list`

```text
kanthord mission evidence list <node-id> [--attempt <attempt>] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission evidence list node_01M4C5G6BNQQPFNM7M8W0GW1W4 --attempt 1
```

| Positional argument | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `<node-id>`         | Required `node_<ulid>` of a runnable node. |

| Option                | Default / resolution | Purpose                                              |
| --------------------- | -------------------- | ---------------------------------------------------- |
| `--attempt <attempt>` | None; every attempt  | Nonnegative attempt number that selects one attempt. |
| `--limit <count>`     | `100`                | Maximum evidence records on the page, 1 to 1000.     |
| `--cursor <cursor>`   | None; the first page | `next_cursor` value of the previous page.            |

### `evidence get`

```text
kanthord mission evidence get <evidence-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission evidence get evidence_01M4C5G6BN71J38HW3MFCKMAT6
```

| Positional argument | Purpose                             |
| ------------------- | ----------------------------------- |
| `<evidence-id>`     | Required `evidence_<ulid>` to read. |

### `evidence submit`

```text
kanthord mission evidence submit <node-id> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
KANTHORD_TOKEN='<machine-jwt>' kanthord mission evidence submit node_01M4C5G6BNQQPFNM7M8W0GW1W4 \
  --file evidence.json \
  --idempotency-key 01M4C5G6DGWEVZYSPETSQR65JH
```

| Positional argument | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `<node-id>`         | Required `node_<ulid>` of the claimed node. |

| Option                     | Default / resolution       | Purpose                                                                                      |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `--file <path>`            | Required                   | Regular UTF-8 file that holds the `EvidenceSubmit` JSON object. Stdin (`-`) is not accepted. |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets the `Idempotency-Key` header; supply the same key when you retry.                       |

The CLI sends the file content as the request body. The CLI help labels `--file` as "Node JSON file"; the file holds an `EvidenceSubmit` object.

### `evidence delete`

```text
kanthord mission evidence delete <evidence-id> --expected-mission-version <version> [--force] [--reason <text>] [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission evidence delete evidence_01M4C5G6BN71J38HW3MFCKMAT6 \
  --expected-mission-version 7 --force --reason 'Remove exposed material'
```

| Positional argument | Purpose                               |
| ------------------- | ------------------------------------- |
| `<evidence-id>`     | Required `evidence_<ulid>` to delete. |

### `evidence asset delete`

```text
kanthord mission evidence asset delete <asset-id> --expected-mission-version <version> [--force] [--reason <text>] [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission evidence asset delete evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR \
  --expected-mission-version 7
```

| Positional argument | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `<asset-id>`        | Required `evidence_asset_<ulid>` to delete. |

Both delete commands take these options:

| Option                                 | Default / resolution       | Purpose                                                                |
| -------------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `--expected-mission-version <version>` | Required                   | Positive decimal integer sent as `expected_mission_version`.           |
| `--force`                              | `false`                    | Sends `force: true`, which skips the terminal-chain check.             |
| `--reason <text>`                      | None                       | Sent as `reason`. Required with `--force`.                             |
| `--idempotency-key <ulid>`             | A generated canonical ULID | Sets the `Idempotency-Key` header; supply the same key when you retry. |

The CLI always sends `force` as an explicit boolean.

### `evidence asset content get`

```text
kanthord mission evidence asset content get <asset-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission evidence asset content get evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR
```

| Positional argument | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `<asset-id>`        | Required `evidence_asset_<ulid>` to read. |
