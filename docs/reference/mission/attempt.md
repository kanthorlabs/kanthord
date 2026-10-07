# Read attempts and external actions

[Reference index](../README.md)

## Function description

Read the attempt records of a runnable node and the required external actions of each attempt. A runnable node is an initiative or an objective. A task has no attempts.

- `attempt list` returns one page of the attempts of a node, highest attempt first.
- `attempt get` returns one attempt of a node.
- `external-action list` returns one page of the required external actions across the attempts of a node.
- `external-action get` returns one required external action of one attempt.

An attempt pins one node revision. The server derives the required external actions of an attempt at read time from the repository bindings of that pinned revision. Each repository binding with a configured action yields one action. An initiative has no required external actions.

An external-action record joins the frozen action with its request evidence and resolution. These reads do not inspect a platform. To read the request evidence, use [`mission evidence get`](evidence.md).

These operations change nothing. Each list call reads one page. The CLI does not follow `next_cursor`. The reads take no shared snapshot with other reads.

## Expected response

All four operations return HTTP `200`. The CLI writes the same JSON value as one line to stdout and exits `0` (shown formatted here).

### `attempt list`

```json
{
  "items": [
    {
      "node_id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4",
      "attempt": 1,
      "node_revision": 3,
      "required_external_actions": [
        {
          "key": "app.pull_request",
          "binding_id": "binding_01M4C5G6BP5EWTVTTXFH1R25MC",
          "action": "pull_request",
          "expected_end_state": "pull_request_merged",
          "follows": null,
          "configuration": { "base_branch": "main" }
        }
      ],
      "opened_at": 1791398400000,
      "closed_at": null,
      "outcome_ids": [],
      "opened_by": {
        "kind": "execution",
        "execution_id": "execution_01M4C5G6BP0355Z52M6JCYZCSK",
        "client_id": "client_identity_01M4C5G6BPC5C40S9NFE96N5FB",
        "name": "worker-a"
      }
    }
  ],
  "next_cursor": null
}
```

| Property      | Type               | Purpose                                                     |
| ------------- | ------------------ | ----------------------------------------------------------- |
| `items`       | array of `Attempt` | At most `limit` attempts, highest attempt number first.     |
| `next_cursor` | string or `null`   | Opaque cursor for the next page. `null` ends the traversal. |

### `attempt get`

The answer is one `Attempt` record.

### `Attempt`

| Property                    | Type                        | Purpose                                                                                                             |
| --------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `node_id`                   | `node_<ulid>`               | Node that owns the attempt.                                                                                         |
| `attempt`                   | positive safe integer       | Attempt number. The first attempt is `1`.                                                                           |
| `node_revision`             | positive safe integer       | Node revision that the attempt pins.                                                                                |
| `required_external_actions` | array of `FrozenAction`     | Actions derived from the pinned revision, sorted by `key`. Empty for an initiative.                                 |
| `opened_at`                 | Unix milliseconds           | Time that the attempt opened.                                                                                       |
| `closed_at`                 | Unix milliseconds or `null` | Time that the attempt closed; `null` while the attempt is open.                                                     |
| `outcome_ids`               | array of `outcome_<ulid>`   | Outcomes of the attempt.                                                                                            |
| `opened_by`                 | `Actor`                     | Actor that opened the attempt. A claim, `ready` or `resume` opens attempt 1; only an unblock opens a later attempt. |

`Actor` has one of three forms, selected by `kind`:

| `kind`      | Other properties                                                                             |
| ----------- | -------------------------------------------------------------------------------------------- |
| `human`     | `account` and `name` strings.                                                                |
| `execution` | `execution_id`, `client_id` (`client_identity_<ulid>` or `null`), `name` (string or `null`). |
| `service`   | `service` (`scheduler` or `mission`) and an optional `inbound_event_id`.                     |

### `FrozenAction`

| Property             | Type                                          | Purpose                                                               |
| -------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `key`                | string                                        | Action key `<binding name>.<action>`, for example `app.pull_request`. |
| `binding_id`         | `binding_<ulid>`                              | Repository binding that owns the action.                              |
| `action`             | `pull_request` or `merge_push`                | Configured repository action.                                         |
| `expected_end_state` | `pull_request_merged` or `base_branch_pushed` | End state that counts as success for the action.                      |
| `follows`            | action key or `null`                          | Predecessor action. The current derivation always writes `null`.      |
| `configuration`      | object with `base_branch` string              | Base branch of the repository binding.                                |

### `external-action list`

```json
{
  "items": [
    {
      "node_id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4",
      "attempt": 1,
      "action": {
        "key": "app.pull_request",
        "binding_id": "binding_01M4C5G6BP5EWTVTTXFH1R25MC",
        "action": "pull_request",
        "expected_end_state": "pull_request_merged",
        "follows": null,
        "configuration": { "base_branch": "main" }
      },
      "requested": true,
      "request_evidence_id": "evidence_01M4C5G6BN71J38HW3MFCKMAT6",
      "resolution": "unresolved"
    }
  ],
  "next_cursor": null
}
```

The list orders records by attempt, highest first, then by action key in reverse order. Without `attempt`, the list covers every attempt of the node.

### `external-action get`

The answer is one `ExternalAction` record.

### `ExternalAction`

| Property              | Type                        | Purpose                                                     |
| --------------------- | --------------------------- | ----------------------------------------------------------- |
| `node_id`             | `node_<ulid>`               | Node that owns the attempt.                                 |
| `attempt`             | nonnegative safe integer    | Attempt that froze the action.                              |
| `action`              | `FrozenAction`              | The required action.                                        |
| `requested`           | boolean                     | `true` when a request evidence exists for the action.       |
| `request_evidence_id` | `evidence_<ulid>` or `null` | Request evidence of the action in this attempt.             |
| `resolution`          | string                      | `unrequested`, `unresolved`, `expected-end` or `other-end`. |

The resolution values have these meanings:

| Value          | Meaning                                               |
| -------------- | ----------------------------------------------------- |
| `unrequested`  | The attempt holds no request evidence for the action. |
| `unresolved`   | The request evidence holds no end state.              |
| `expected-end` | The request evidence reached the expected end state.  |
| `other-end`    | The request evidence reached a different end state.   |

Identity formats follow the [identity reference](../identities.md). Timestamps are integer Unix milliseconds in UTC.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                        | Commands    | Meaning                                                                                          |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `401 gateway.authentication.unauthorized` | All         | Absent, invalid or expired token, or a machine token.                                            |
| `400 gateway.request.validation_failed`   | All         | Invalid path parameter, `limit` outside 1 to 1000, invalid `attempt`, or an unknown query field. |
| `400 gateway.request.unexpected_body`     | All         | The request carries a body.                                                                      |
| `400 system.pagination.cursor_invalid`    | Both `list` | The `cursor` value is not a cursor that this operation issued.                                   |
| `404 mission.node.not_found`              | All         | The node does not exist.                                                                         |
| `400 mission.node.control_task`           | All         | The node is a task. Details hold `node_id`.                                                      |
| `404 mission.record.not_found`            | Both `get`  | The attempt does not exist, or the attempt has no required action with that key.                 |
| `504 gateway.invocation.timeout`          | All         | The operation did not complete in 30 seconds.                                                    |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                                                                                                                                                                 | Commands               | Meaning                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `cli.mission.attempt.list.invalid_node_id`                                                                                                                                               | `attempt list`         | `<node-id>` is not a canonical `node_<ulid>` identity.                      |
| `cli.mission.attempt.get.invalid_node_id`                                                                                                                                                | `attempt get`          | `<node-id>` is not a canonical `node_<ulid>` identity.                      |
| `cli.mission.attempt.get.invalid_attempt`                                                                                                                                                | `attempt get`          | `<attempt>` is not a positive safe integer in canonical form.               |
| `cli.mission.external_action.list.invalid_node_id`                                                                                                                                       | `external-action list` | `<node-id>` is not a canonical `node_<ulid>` identity.                      |
| `cli.mission.external_action.list.invalid_attempt`                                                                                                                                       | `external-action list` | `--attempt` is not a nonnegative safe integer in canonical form.            |
| `cli.mission.external_action.get.invalid_node_id`                                                                                                                                        | `external-action get`  | `<node-id>` is not a canonical `node_<ulid>` identity.                      |
| `cli.mission.external_action.get.invalid_attempt`                                                                                                                                        | `external-action get`  | `<attempt>` is not a positive safe integer in canonical form.               |
| `cli.mission.external_action.get.invalid_action_key`                                                                                                                                     | `external-action get`  | `<action-key>` does not match `<name>.pull_request` or `<name>.merge_push`. |
| `cli.mission.attempt.list.token_required`, `cli.mission.attempt.get.token_required`, `cli.mission.external_action.list.token_required`, `cli.mission.external_action.get.token_required` | Same command           | No nonblank token resolves.                                                 |
| `cli.pagination.limit_invalid`                                                                                                                                                           | Both `list`            | `--limit` is not a positive decimal integer.                                |
| `cli.pagination.limit_out_of_range`                                                                                                                                                      | Both `list`            | `--limit` is greater than 1000.                                             |
| `cli.option.duplicate`                                                                                                                                                                   | `list` commands        | An option occurs more than once.                                            |

Canonical form means decimal digits with no sign and no zero before another digit. A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. A transport failure, timeout or malformed response exits `1` with `cli.mission.attempt.list.indeterminate`, `cli.mission.attempt.get.indeterminate`, `cli.mission.external_action.list.indeterminate` or `cli.mission.external_action.get.indeterminate`. These reads change nothing, so run the command again.

## API shape

All four operations share these properties:

| Item         | Value                      |
| ------------ | -------------------------- |
| Access       | `human` (human bearer JWT) |
| Timeout      | 30 seconds                 |
| Mutation     | No                         |
| Request body | None                       |

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

### `attempt list`

| Item                  | Value                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/mission/node/:node_id/attempt`                                                          |
| Operation ID          | `mission.attempt.list`                                                                            |
| Path/query parameters | `node_id` (path, required); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |

### `attempt get`

| Item                  | Value                                                                                |
| --------------------- | ------------------------------------------------------------------------------------ |
| Method and path       | `GET /api/mission/node/:node_id/attempt/:attempt`                                    |
| Operation ID          | `mission.attempt.get`                                                                |
| Path/query parameters | `node_id` (path, required); `attempt` (path, positive safe integer); no query fields |

### `external-action list`

| Item                  | Value                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/mission/node/:node_id/external-action`                                                                                                        |
| Operation ID          | `mission.externalAction.list`                                                                                                                           |
| Path/query parameters | `node_id` (path, required); `attempt` (query, optional nonnegative safe integer); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |

### `external-action get`

| Item                  | Value                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/mission/node/:node_id/attempt/:attempt/external-action/:action_key`                                       |
| Operation ID          | `mission.externalAction.get`                                                                                        |
| Path/query parameters | `node_id` (path, required); `attempt` (path, positive safe integer); `action_key` (path, required); no query fields |

```sh
curl -i 'http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/attempt?limit=20' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/attempt/1 \
  -H 'Authorization: Bearer <human-jwt>'

curl -i 'http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/external-action?attempt=1' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/attempt/1/external-action/app.pull_request \
  -H 'Authorization: Bearer <human-jwt>'
```

To read the next page, send the `next_cursor` value as the `cursor` query parameter with the same `limit` and `attempt`.

## CLI shape

`--token` and `--endpoint` belong to the `mission` group, and each leaf command accepts them. Every command below takes these two options:

| Option             | Default / resolution                                                        | Purpose                                  |
| ------------------ | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                         |

Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.

### `attempt list`

```text
kanthord mission attempt list <node-id> [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission attempt list node_01M4C5G6BNQQPFNM7M8W0GW1W4 --limit 20
```

| Positional argument | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `<node-id>`         | Required `node_<ulid>` of a runnable node. |

| Option              | Default / resolution | Purpose                                   |
| ------------------- | -------------------- | ----------------------------------------- |
| `--limit <count>`   | `100`                | Maximum attempts on the page, 1 to 1000.  |
| `--cursor <cursor>` | None; the first page | `next_cursor` value of the previous page. |

### `attempt get`

```text
kanthord mission attempt get <node-id> <attempt> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission attempt get node_01M4C5G6BNQQPFNM7M8W0GW1W4 1
```

| Positional argument | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `<node-id>`         | Required `node_<ulid>` of a runnable node.         |
| `<attempt>`         | Required positive attempt number, for example `1`. |

### `external-action list`

```text
kanthord mission external-action list <node-id> [--attempt <attempt>] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission external-action list node_01M4C5G6BNQQPFNM7M8W0GW1W4 --attempt 1
```

| Positional argument | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `<node-id>`         | Required `node_<ulid>` of a runnable node. |

| Option                | Default / resolution | Purpose                                              |
| --------------------- | -------------------- | ---------------------------------------------------- |
| `--attempt <attempt>` | None; every attempt  | Nonnegative attempt number that selects one attempt. |
| `--limit <count>`     | `100`                | Maximum records on the page, 1 to 1000.              |
| `--cursor <cursor>`   | None; the first page | `next_cursor` value of the previous page.            |

### `external-action get`

```text
kanthord mission external-action get <node-id> <attempt> <action-key> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission external-action get node_01M4C5G6BNQQPFNM7M8W0GW1W4 1 app.pull_request
```

| Positional argument | Purpose                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `<node-id>`         | Required `node_<ulid>` of a runnable node.                                                  |
| `<attempt>`         | Required positive attempt number.                                                           |
| `<action-key>`      | Required action key: a lower-case binding name, a dot, then `pull_request` or `merge_push`. |
