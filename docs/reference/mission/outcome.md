# Read outcomes

[Reference index](../README.md)

## Function description

An outcome records how an attempt of a runnable node closed. A runnable node is an initiative or an objective. Clients cannot write an outcome directly; an [assessment submit](assessment.md) or a human control writes it.

- `outcome list` returns one page of the outcomes of a node.
- `outcome get` returns one outcome.

Every outcome names one assessment. A human assessment does not mean that an evaluation ran. The `evidence_ids` of an outcome are the union of its own evidence and the evidence of its assessment.

The server derives `closing_event` at read time from the assessment, the outcome result and the node:

| `closing_event`         | Condition                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `success-override`      | A human assessment with result `success`.                                                               |
| `human-discard`         | A human assessment with result `undetermined`, on a `Discarded` node whose current outcome is this one. |
| `human-block`           | Any other human assessment.                                                                             |
| `assessment-not-passed` | An execution assessment with a result other than `success`.                                             |
| `external-failed`       | An execution assessment with result `success`, and an outcome result of `undetermined`.                 |
| `assessment-passed`     | An execution assessment with result `success`, and no required external action on the attempt.          |
| `external-success`      | An execution assessment with result `success`, and required external actions on the attempt.            |

These operations change nothing. Each list call reads one page. The CLI does not follow `next_cursor`.

## Expected response

### `outcome list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "id": "outcome_01M4C5G6BPV831HTV1HKEXK8MT",
      "node_id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4",
      "attempt": 1,
      "node_revision": 3,
      "closing_event": "assessment-passed",
      "result": "success",
      "assessment_id": "assessment_01M4C5G6BPZCGBK0EFKVT5AXH2",
      "evidence_ids": ["evidence_01M4C5G6BN71J38HW3MFCKMAT6"],
      "created_at": 1791398400000
    }
  ],
  "next_cursor": null
}
```

| Property      | Type               | Purpose                                                     |
| ------------- | ------------------ | ----------------------------------------------------------- |
| `items`       | array of `Outcome` | At most `limit` outcomes, in reverse identity order.        |
| `next_cursor` | string or `null`   | Opaque cursor for the next page. `null` ends the traversal. |

Without `attempt`, the list covers every attempt of the node. With `attempt`, the list selects outcomes whose assessment belongs to that attempt.

### `outcome get`

The API returns HTTP `200` with one `Outcome`. The CLI writes it as one JSON line to stdout and exits `0`.

### `Outcome`

| Property        | Type                       | Purpose                                                                                                         |
| --------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`            | `outcome_<ulid>`           | Identity of the outcome.                                                                                        |
| `node_id`       | `node_<ulid>`              | Node that owns the outcome.                                                                                     |
| `attempt`       | nonnegative safe integer   | Attempt of the assessment that the outcome names.                                                               |
| `node_revision` | positive safe integer      | Node revision of that assessment.                                                                               |
| `closing_event` | string                     | Event that closed the attempt; see the table above.                                                             |
| `result`        | string                     | `success`, `criterion-not-met` or `undetermined`.                                                               |
| `assessment_id` | `assessment_<ulid>`        | Assessment that the outcome names.                                                                              |
| `evidence_ids`  | array of `evidence_<ulid>` | Sorted union of the outcome evidence and the assessment evidence. A delete of an evidence removes its identity. |
| `created_at`    | Unix milliseconds          | Time of the outcome.                                                                                            |

Identity formats follow the [identity reference](../identities.md). Timestamps are integer Unix milliseconds in UTC.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands | Meaning                                                                                          |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `401 gateway.authentication.unauthorized` | Both     | Absent, invalid or expired token, or a machine token.                                            |
| `400 gateway.request.validation_failed`   | Both     | Invalid path parameter, `limit` outside 1 to 1000, invalid `attempt`, or an unknown query field. |
| `400 gateway.request.unexpected_body`     | Both     | The request carries a body.                                                                      |
| `400 system.pagination.cursor_invalid`    | `list`   | The `cursor` value is not a cursor that this operation issued.                                   |
| `404 mission.node.not_found`              | `list`   | The node does not exist.                                                                         |
| `400 mission.node.control_task`           | `list`   | The node is a task. Details hold `node_id`.                                                      |
| `404 mission.record.not_found`            | `get`    | The outcome does not exist.                                                                      |
| `504 gateway.invocation.timeout`          | Both     | The operation did not complete in 30 seconds.                                                    |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                     | Commands | Meaning                                                          |
| -------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `cli.mission.outcome.list.invalid_node_id`   | `list`   | `<node-id>` is not a canonical `node_<ulid>` identity.           |
| `cli.mission.outcome.list.invalid_attempt`   | `list`   | `--attempt` is not a nonnegative safe integer in canonical form. |
| `cli.mission.outcome.get.invalid_outcome_id` | `get`    | `<outcome-id>` is not a canonical `outcome_<ulid>` identity.     |
| `cli.mission.outcome.list.token_required`    | `list`   | No nonblank token resolves.                                      |
| `cli.mission.outcome.get.token_required`     | `get`    | No nonblank token resolves.                                      |
| `cli.pagination.limit_invalid`               | `list`   | `--limit` is not a positive decimal integer.                     |
| `cli.pagination.limit_out_of_range`          | `list`   | `--limit` is greater than 1000.                                  |
| `cli.option.duplicate`                       | `list`   | An option occurs more than once.                                 |

Canonical form means decimal digits with no sign and no zero before another digit. A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.mission.outcome.list.indeterminate` or `cli.mission.outcome.get.indeterminate`. These reads change nothing, so run the command again.

## API shape

### `outcome list`

| Item                  | Value                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/mission/node/:node_id/outcome`                                                                                                                |
| Operation ID          | `mission.outcome.list`                                                                                                                                  |
| Access                | `human` (human bearer JWT)                                                                                                                              |
| Timeout               | 30 seconds                                                                                                                                              |
| Mutation              | No                                                                                                                                                      |
| Path/query parameters | `node_id` (path, required); `attempt` (query, optional nonnegative safe integer); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |
| Request body          | None                                                                                                                                                    |

### `outcome get`

| Item                  | Value                                          |
| --------------------- | ---------------------------------------------- |
| Method and path       | `GET /api/mission/outcome/:outcome_id`         |
| Operation ID          | `mission.outcome.get`                          |
| Access                | `human` (human bearer JWT)                     |
| Timeout               | 30 seconds                                     |
| Mutation              | No                                             |
| Path/query parameters | `outcome_id` (path, required); no query fields |
| Request body          | None                                           |

Both operations use one header:

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/outcome?limit=20' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/mission/outcome/outcome_01M4C5G6BPV831HTV1HKEXK8MT \
  -H 'Authorization: Bearer <human-jwt>'
```

To read the next page, send the `next_cursor` value as the `cursor` query parameter with the same `limit` and `attempt`.

## CLI shape

`--token` and `--endpoint` belong to the `mission` group, and each leaf command accepts them:

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.

### `outcome list`

```text
kanthord mission outcome list <node-id> [--attempt <attempt>] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission outcome list node_01M4C5G6BNQQPFNM7M8W0GW1W4 --limit 20
```

| Positional argument | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `<node-id>`         | Required `node_<ulid>` of a runnable node. |

| Option                | Default / resolution | Purpose                                              |
| --------------------- | -------------------- | ---------------------------------------------------- |
| `--attempt <attempt>` | None; every attempt  | Nonnegative attempt number that selects one attempt. |
| `--limit <count>`     | `100`                | Maximum outcomes on the page, 1 to 1000.             |
| `--cursor <cursor>`   | None; the first page | `next_cursor` value of the previous page.            |

### `outcome get`

```text
kanthord mission outcome get <outcome-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission outcome get outcome_01M4C5G6BPV831HTV1HKEXK8MT
```

| Positional argument | Purpose                            |
| ------------------- | ---------------------------------- |
| `<outcome-id>`      | Required `outcome_<ulid>` to read. |
