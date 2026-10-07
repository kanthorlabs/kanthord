# Execution-bound mission reads

[Reference index](../README.md)

## Function description

A worker execution reads the mission records of its own claim through these operations. Each operation takes the execution identity as its first path parameter. The server derives the node, the attempt and the pinned revision from the live claim. An execution cannot select another node, and no read returns a revision newer than the pin.

| Command                                | Answer                                                              |
| -------------------------------------- | ------------------------------------------------------------------- |
| `execution pinned-revision get`        | The pinned revision of the claimed node.                            |
| `execution revision list`              | One page of the revisions of the claimed node, at or below the pin. |
| `execution revision get`               | One revision at or below the pin.                                   |
| `execution evidence list`              | One page of the evidence of the claimed node and attempt.           |
| `execution evidence asset content get` | The stored content of one asset inside the execution bound.         |
| `execution objective list`             | One page of the current child objectives of a claimed initiative.   |
| `execution objective outcome list`     | One page of the current outcomes of those objectives.               |
| `execution objective evidence list`    | One page of the evidence that those outcomes name.                  |
| `execution cleared-outcome get`        | The outcome of the previous attempt, which an unblock cleared.      |

Every operation requires a machine JWT of a registered worker. The Gateway proves that `execution_id` is a live claim of that registration before the handler runs.

The execution bound for asset content covers two sets of evidence:

- The evidence of the claimed node and attempt.
- For a claimed initiative, the evidence that the current outcome of a current child objective names.

A current child objective is a child objective of the claimed initiative that is not retired. The three objective reads return empty pages for a claimed objective.

Only an unblock opens an attempt after attempt 1. `execution cleared-outcome get` returns the last outcome of the attempt before the claimed attempt. For a claim on attempt 1, it fails with `404 mission.record.not_found`.

These operations change nothing. Each list call reads one page. The CLI does not follow `next_cursor`. Each read takes its own snapshot.

## Expected response

All operations return HTTP `200`. The CLI writes the same JSON value as one line to stdout and exits `0`, except for an `object` asset content answer.

### `execution pinned-revision get` and `execution revision get`

The answer is one `Revision`:

```json
{
  "node_id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4",
  "filename": "checkout.md",
  "revision": 3,
  "reason": "Clarify the criterion",
  "actor": { "kind": "human", "account": "ulrich", "name": "Ulrich" },
  "created_at": 1791398400000,
  "content": {
    "name": "Checkout flow",
    "requirement": "Add a checkout page.",
    "criterion": "The checkout page submits an order.",
    "verifications": ["npm test"],
    "bindings": ["binding_01M4C5G6BP5EWTVTTXFH1R25MC"]
  },
  "tasks": [],
  "change": {
    "write": "criterion.set",
    "previous_revision": 2,
    "changed_fields": ["criterion"]
  },
  "pinned_by_attempts": [1]
}
```

| Property             | Type                            | Purpose                                                                                        |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `node_id`            | `node_<ulid>`                   | Node of the revision.                                                                          |
| `filename`           | string                          | Plan file name at this revision.                                                               |
| `revision`           | positive safe integer           | Revision number.                                                                               |
| `reason`             | string                          | Reason of the write that made the revision.                                                    |
| `actor`              | `Actor`                         | Actor of that write. See [attempts](attempt.md#attempt).                                       |
| `created_at`         | Unix milliseconds               | Time of the revision.                                                                          |
| `content`            | object                          | `name`, `requirement`, `criterion`, `verifications` and `bindings` of the node.                |
| `tasks`              | array                           | Optional. For an objective, each task with `id`, `filename` and `content`.                     |
| `change`             | object                          | `write` kind, `previous_revision` (or `null`), `changed_fields`, and optional `tasks` changes. |
| `pinned_by_attempts` | array of positive safe integers | Attempts that pin this revision.                                                               |

### `execution revision list`

The answer is a page: `items` holds `Revision` records highest revision first, at or below the pin. `next_cursor` is an opaque string, or `null` at the end.

### `execution evidence list` and `execution objective evidence list`

The answer is a page: `items` holds [`Evidence`](evidence.md#evidence) records in reverse identity order, and `next_cursor` is a string or `null`.

### `execution objective outcome list`

The answer is a page: `items` holds [`Outcome`](outcome.md#outcome) records in reverse identity order, and `next_cursor` is a string or `null`.

### `execution objective list`

The answer is a page in reverse node identity order. Each item has one of two forms:

```json
{
  "items": [{ "id": "node_01M4C5G6BNJGY6SEGYRDETDPK7", "state": "Executing" }],
  "next_cursor": null
}
```

| Form                  | When                                    | Content                                                                                                                                                                |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective node record | The objective holds a current outcome.  | The node record, as `kanthord mission node get` returns it. `filename`, `content`, `visible_revision` and `pinned_by_attempts` come from the revision of that outcome. |
| `{ id, state }`       | The objective holds no current outcome. | The `node_<ulid>` identity and the current state only.                                                                                                                 |

### `execution cleared-outcome get`

The answer is one [`Outcome`](outcome.md#outcome).

### `execution evidence asset content get`

The answer is a `StoredContent` object, as for [`evidence asset content get`](evidence.md#evidence-asset-content-get). A `produced` asset returns `asset_id`, `address`, `media_type`, `encoding` (`base64`) and `data`. An `object` asset returns `asset_id`, `address`, `media_type`, `size`, a presigned `get_url` and `expires_at`.

The CLI writes a `produced` answer to stdout. For an `object` answer, the CLI writes no URL and exits `1` with `cli.mission.execution.evidence.asset.content.get.object_content`. The reader component of kanthord owns object downloads.

Identity formats follow the [identity reference](../identities.md). Timestamps are integer Unix milliseconds in UTC.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Commands                             | Meaning                                                                                                               |
| ----------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | All                                  | Absent, invalid or expired token, or a human token.                                                                   |
| `403 gateway.registration.required`             | All                                  | The machine identity holds no live worker registration.                                                               |
| `400 gateway.request.validation_failed`         | All                                  | Invalid path parameter, `limit` outside 1 to 1000, or an unknown query field.                                         |
| `400 gateway.request.unexpected_body`           | All                                  | The request carries a body.                                                                                           |
| `403 gateway.invocation.execution_proof_failed` | All                                  | `execution_id` is not a live claim of this registration.                                                              |
| `409 scheduler.execution.not_running`           | All                                  | The claim of the execution is no longer live.                                                                         |
| `400 system.pagination.cursor_invalid`          | All `list` commands                  | The `cursor` value is not a cursor that this operation issued.                                                        |
| `404 mission.execution.revision_above_pin`      | `revision get`, `revision list`      | The revision, or the cursor revision, is above the pinned revision.                                                   |
| `404 mission.record.not_found`                  | `cleared-outcome get`, `content get` | The claimed attempt is attempt 1; or the asset does not exist or lies outside the execution bound.                    |
| `403 mission.authorization.refused`             | `content get`                        | The claim is not live for the node and attempt, or the storage binding is removed or disabled. Details hold `reason`. |
| `409 mission.evidence.content_repository`       | `content get`                        | The asset is a `repository` address. Details hold `evidence_id` and `address`.                                        |
| `409 mission.evidence.content_platform`         | `content get`                        | The asset is a `platform` address. Details hold `evidence_id` and `address`.                                          |
| `503 mission.evidence.storage_unavailable`      | `content get`                        | An `object` asset needs object storage, and the Server wires none.                                                    |
| `504 gateway.invocation.timeout`                | All                                  | The operation did not complete in 30 seconds.                                                                         |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                                                | Commands                  | Meaning                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.mission.execution.pinned_revision.get.invalid_execution_id`        | `pinned-revision get`     | `<execution-id>` is not a canonical `execution_<ulid>` identity.                                                                                                                                                                                    |
| `cli.mission.execution.revision.list.invalid_execution_id`              | `revision list`           | Same check.                                                                                                                                                                                                                                         |
| `cli.mission.execution.revision.get.invalid_execution_id`               | `revision get`            | Same check.                                                                                                                                                                                                                                         |
| `cli.mission.execution.revision.get.invalid_revision`                   | `revision get`            | `<revision>` is not a positive decimal integer.                                                                                                                                                                                                     |
| `cli.mission.execution.evidence.list.invalid_execution_id`              | `evidence list`           | `<execution-id>` is not a canonical `execution_<ulid>` identity.                                                                                                                                                                                    |
| `cli.mission.execution.evidence.asset.content.get.invalid_execution_id` | `content get`             | Same check.                                                                                                                                                                                                                                         |
| `cli.mission.execution.evidence.asset.content.get.invalid_asset_id`     | `content get`             | `<asset-id>` is not a canonical `evidence_asset_<ulid>` identity.                                                                                                                                                                                   |
| `cli.mission.execution.objective.list.invalid_execution_id`             | `objective list`          | `<execution-id>` is not a canonical `execution_<ulid>` identity.                                                                                                                                                                                    |
| `cli.mission.execution.objective.outcome.list.invalid_execution_id`     | `objective outcome list`  | Same check.                                                                                                                                                                                                                                         |
| `cli.mission.execution.objective.evidence.list.invalid_execution_id`    | `objective evidence list` | Same check.                                                                                                                                                                                                                                         |
| `cli.mission.execution.cleared_outcome.get.invalid_execution_id`        | `cleared-outcome get`     | Same check.                                                                                                                                                                                                                                         |
| `cli.mission.execution.<operation>.token_required`                      | All                       | No nonblank token resolves. `<operation>` is `pinned_revision.get`, `revision.list`, `revision.get`, `evidence.list`, `evidence.asset.content.get`, `objective.list`, `objective.outcome.list`, `objective.evidence.list` or `cleared_outcome.get`. |
| `cli.pagination.limit_invalid`                                          | All `list` commands       | `--limit` is not a positive decimal integer.                                                                                                                                                                                                        |
| `cli.pagination.limit_out_of_range`                                     | All `list` commands       | `--limit` is greater than 1000.                                                                                                                                                                                                                     |
| `cli.option.duplicate`                                                  | All `list` commands       | An option occurs more than once.                                                                                                                                                                                                                    |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.mission.execution.<operation>.indeterminate`, with `<operation>` as above. These reads change nothing, so run the command again.

## API shape

All operations share these properties:

| Item         | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Access       | `client` (machine bearer JWT) with a live registration and a live claim on `execution_id` |
| Timeout      | 30 seconds                                                                                |
| Mutation     | No                                                                                        |
| Request body | None                                                                                      |

| Header          | Required | Purpose                                                               |
| --------------- | -------- | --------------------------------------------------------------------- |
| `Authorization` | Yes      | `Bearer <machine-jwt>` of the registered worker that holds the claim. |

| Command                                | Method and path                                                             | Operation ID                                   | Parameters besides `execution_id`                           |
| -------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| `execution pinned-revision get`        | `GET /api/mission/execution/:execution_id/pinned-revision`                  | `mission.execution.pinnedRevision.get`         | None                                                        |
| `execution revision list`              | `GET /api/mission/execution/:execution_id/revision`                         | `mission.execution.revision.list`              | `limit` (query, 1 to 1000, default `100`); `cursor` (query) |
| `execution revision get`               | `GET /api/mission/execution/:execution_id/revision/:revision`               | `mission.execution.revision.get`               | `revision` (path, positive integer)                         |
| `execution evidence list`              | `GET /api/mission/execution/:execution_id/evidence`                         | `mission.execution.evidence.list`              | `limit`; `cursor`                                           |
| `execution evidence asset content get` | `GET /api/mission/execution/:execution_id/evidence/asset/:asset_id/content` | `mission.execution.evidence.asset.content.get` | `asset_id` (path, `evidence_asset_<ulid>`)                  |
| `execution objective list`             | `GET /api/mission/execution/:execution_id/objective`                        | `mission.execution.objective.list`             | `limit`; `cursor`                                           |
| `execution objective outcome list`     | `GET /api/mission/execution/:execution_id/objective/outcome`                | `mission.execution.objective.outcome.list`     | `limit`; `cursor`                                           |
| `execution objective evidence list`    | `GET /api/mission/execution/:execution_id/objective/evidence`               | `mission.execution.objective.evidence.list`    | `limit`; `cursor`                                           |
| `execution cleared-outcome get`        | `GET /api/mission/execution/:execution_id/cleared-outcome`                  | `mission.execution.clearedOutcome.get`         | None                                                        |

`execution_id` is a required `execution_<ulid>` path parameter. Operations without `limit` and `cursor` accept no query fields.

```sh
curl -i http://127.0.0.1:31415/api/mission/execution/execution_01M4C5G6BP0355Z52M6JCYZCSK/pinned-revision \
  -H 'Authorization: Bearer <machine-jwt>'

curl -i 'http://127.0.0.1:31415/api/mission/execution/execution_01M4C5G6BP0355Z52M6JCYZCSK/revision?limit=10' \
  -H 'Authorization: Bearer <machine-jwt>'

curl -i http://127.0.0.1:31415/api/mission/execution/execution_01M4C5G6BP0355Z52M6JCYZCSK/evidence/asset/evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR/content \
  -H 'Authorization: Bearer <machine-jwt>'
```

To read the next page, send the `next_cursor` value as the `cursor` query parameter with the same `limit`.

## CLI shape

`--token` and `--endpoint` belong to the `mission` group, and each leaf command accepts them:

| Option             | Default / resolution                                                        | Purpose                                                    |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Machine JWT of the registered worker that holds the claim. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                           |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.

Every list command takes these options:

| Option              | Default / resolution | Purpose                                   |
| ------------------- | -------------------- | ----------------------------------------- |
| `--limit <count>`   | `100`                | Maximum items on the page, 1 to 1000.     |
| `--cursor <cursor>` | None; the first page | `next_cursor` value of the previous page. |

Every command takes this positional argument first:

| Positional argument | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `<execution-id>`    | Required `execution_<ulid>` of the live execution. |

### `execution pinned-revision get`

```text
kanthord mission execution pinned-revision get <execution-id> [--token <jwt>] [--endpoint <url>]
```

```sh
KANTHORD_TOKEN='<machine-jwt>' kanthord mission execution pinned-revision get execution_01M4C5G6BP0355Z52M6JCYZCSK
```

### `execution revision list`

```text
kanthord mission execution revision list <execution-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution revision list execution_01M4C5G6BP0355Z52M6JCYZCSK --limit 10
```

### `execution revision get`

```text
kanthord mission execution revision get <execution-id> <revision> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution revision get execution_01M4C5G6BP0355Z52M6JCYZCSK 2
```

| Positional argument | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `<revision>`        | Required positive revision number at or below the pin. |

### `execution evidence list`

```text
kanthord mission execution evidence list <execution-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution evidence list execution_01M4C5G6BP0355Z52M6JCYZCSK
```

### `execution evidence asset content get`

```text
kanthord mission execution evidence asset content get <execution-id> <asset-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution evidence asset content get execution_01M4C5G6BP0355Z52M6JCYZCSK \
  evidence_asset_01M4C5G6BPAK4AZ9KWFEMWPGRR
```

| Positional argument | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `<asset-id>`        | Required `evidence_asset_<ulid>` inside the execution bound. |

### `execution objective list`

```text
kanthord mission execution objective list <execution-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution objective list execution_01M4C5G6BP0355Z52M6JCYZCSK
```

### `execution objective outcome list`

```text
kanthord mission execution objective outcome list <execution-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution objective outcome list execution_01M4C5G6BP0355Z52M6JCYZCSK
```

### `execution objective evidence list`

```text
kanthord mission execution objective evidence list <execution-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution objective evidence list execution_01M4C5G6BP0355Z52M6JCYZCSK
```

### `execution cleared-outcome get`

```text
kanthord mission execution cleared-outcome get <execution-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission execution cleared-outcome get execution_01M4C5G6BP0355Z52M6JCYZCSK
```
