# Mission edges and dependencies

[Reference index](../README.md)

## Function description

Dependency is the only edge kind of a mission. A dependency edge relates a dependent to a prerequisite. Both endpoints are nodes of the same mission, whatever their work. A task has no dependency.

An edge has no ID. Its endpoints identify it.

The dependency closure of a node is its direct dependencies. A dependent waits for the targets of its own dependencies alone. Only `Completed` satisfies a dependency; `Discarded` does not. An unsatisfied dependency keeps a node in `Pending`, not in `Blocked`.

- `edge list` returns the current edges of a mission. An edge with a retired endpoint is not current.
- `dependency add` adds a dependency edge.
- `dependency remove` removes a dependency edge.

A dependency edit routes each claim-free node whose closure changes between `Pending` and `Available` in the same transaction. A node in `Waiting` does not move back. An edit that changes the graph increases the mission version by one. A request for an edge that already exists, or for an absent edge, changes nothing and keeps the version.

`dependency add` checks these conditions:

- Both nodes are current nodes of the same mission.
- The dependent is not terminal.
- No live claim holds the dependent.
- The dependent is not in a guarded state. A dependent in `Waiting`, `Evaluating`, `External.Requested`, `External.Success` or `External.Failed` fails with `mission.node.state_conflict`. A `Paused` dependent whose open attempt holds a request evidence fails with the same code.
- The new edge creates no cycle. A dependency of a node on itself is a cycle.

`dependency remove` requires a current, nonterminal dependent. A dependent in a guarded state fails with `mission.node.state_conflict`.

**Authority:** every authenticated human holds the same authority under the server-owner ruling. Any verified human token reads and changes any mission.

## Expected response

### edge list

The API returns HTTP `200` with one page of edges:

```json
{
  "items": [
    {
      "dependent_id": "node_01M4C5J3SBEB4P8KDXAZ6GKB6R",
      "depends_on_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB"
    }
  ],
  "next_cursor": null
}
```

| Property                                | Type             | Purpose                                                        |
| --------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `items[].dependent_id`, `depends_on_id` | `node_<ulid>`    | Dependency endpoints; the dependent waits for `depends_on_id`. |
| `next_cursor`                           | string or `null` | Cursor of the next page; `null` on the last page.              |

The list orders edges by the key `<dependent-id>|<depends-on-id>`, from the highest key to the lowest.

### dependency add and dependency remove

The API returns HTTP `200` with a [node change result](node.md#node-change-result). `added_edges` or `removed_edges` holds the edited edge. `revisions` is empty, because a dependency edit writes no revision.

```json
{
  "mission_version": 9,
  "revisions": [],
  "retired_node_ids": [],
  "added_edges": [
    {
      "dependent_id": "node_01M4C5J3SBEB4P8KDXAZ6GKB6R",
      "depends_on_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB"
    }
  ],
  "removed_edges": [],
  "open_attempts_unchanged": []
}
```

The CLI writes the API answer as one JSON line to stdout and exits `0`. A dependency command adds `idempotency_key` to the printed object.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Operation  | Meaning                                                                           |
| -------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | All        | Absent, invalid or expired token, or a machine token.                             |
| `400 gateway.request.validation_failed`      | All        | A path, query or body value fails the schema.                                     |
| `400 gateway.request.unexpected_body`        | Edge list  | The request has a body.                                                           |
| `415 gateway.request.unsupported_media_type` | Dependency | `Content-Type` is not `application/json`.                                         |
| `400 gateway.request.invalid_json`           | Dependency | The body is not valid JSON with unique object members.                            |
| `413 gateway.request.body_too_large`         | Dependency | The body exceeds 10 MiB.                                                          |
| `400 gateway.idempotency.invalid_key`        | Dependency | Absent or malformed `Idempotency-Key`.                                            |
| `409 gateway.idempotency.conflict`           | Dependency | The key belongs to another request, or its first request is still in progress.    |
| `404 mission.mission.not_found`              | Edge list  | The mission ID is unknown.                                                        |
| `400 system.pagination.cursor_invalid`       | Edge list  | The cursor is not a cursor that the list returned.                                |
| `404 mission.node.not_found`                 | Dependency | The dependent is unknown. For `add`, the prerequisite is unknown.                 |
| `409 mission.node.retired`                   | Dependency | The dependent is retired. For `add`, the prerequisite is retired.                 |
| `409 mission.version.conflict`               | Dependency | `expected_mission_version` is stale; `details.current` holds the current version. |
| `409 mission.dependency.endpoint_invalid`    | Add        | The endpoints belong to different missions. `details.reason` is `cross_mission`.  |
| `409 mission.node.state_conflict`            | Dependency | The dependent is in a guarded state; `details` holds `state` and `attempt`.       |
| `409 mission.node.terminal`                  | Dependency | The dependent is `Completed` or `Discarded`.                                      |
| `409 mission.node.claim_live`                | Add        | The dependent has a live claim; `details` holds `node_id` and `execution_id`.     |
| `400 mission.node.content_invalid`           | Dependency | `reason` is blank or exceeds the text limit.                                      |
| `409 mission.import.cycle`                   | Add        | The edge creates a dependency cycle.                                              |
| `504 gateway.invocation.timeout`             | All        | The operation exceeded 30 seconds. An edit can still complete.                    |

The text limit is the server configuration value `mission.text_max_bytes`, 32768 UTF-8 bytes by default.

The CLI exits `1` on every failure and writes `<code>: <message>` to stderr. A declared remote failure of a dependency command prints `<code>: request failed (HTTP <status>); idempotency key <key>.`

| CLI code                                                                                 | Meaning                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.mission.edge.list.invalid_mission_id`                                               | `<mission-id>` is not a `mission_<ulid>` value.                                                                                                          |
| `cli.mission.edge.list.invalid_node_id`                                                  | `--node` is not a `node_<ulid>` value.                                                                                                                   |
| `cli.pagination.limit_invalid`, `cli.pagination.limit_out_of_range`                      | `--limit` is not a positive integer, or exceeds 1000.                                                                                                    |
| `cli.mission.dependency.<action>.invalid_node_id`                                        | `<node-id>` is not a `node_<ulid>` value.                                                                                                                |
| `cli.mission.dependency.<action>.invalid_depends_on_id`                                  | `<depends-on-id>` is not a `node_<ulid>` value.                                                                                                          |
| `cli.mission.edge.list.token_required`, `cli.mission.dependency.<action>.token_required` | No nonblank token resolves.                                                                                                                              |
| `cli.mission.edge.list.indeterminate`, `cli.mission.dependency.<action>.indeterminate`   | A transport failure, a timeout or a malformed answer. For a dependency command, retry with the printed key.                                              |
| `cli.file.*`                                                                             | `--file` is absent, not a regular file, `-`, not UTF-8, not JSON, has a repeated key, is not an object, or fails the schema (`cli.file.schema_invalid`). |
| `cli.idempotency_key.invalid`                                                            | `--idempotency-key` is not a canonical ULID.                                                                                                             |

`<action>` is `add` or `remove`.

## API shape

All operations use access `human` (human bearer JWT) and a 30-second timeout.

| CLI command         | Method and path                                               | Operation ID                | Mutation |
| ------------------- | ------------------------------------------------------------- | --------------------------- | -------- |
| `edge list`         | `GET /api/mission/:mission_id/edge`                           | `mission.edge.list`         | No       |
| `dependency add`    | `PUT /api/mission/node/:node_id/dependency/:depends_on_id`    | `mission.dependency.add`    | Yes      |
| `dependency remove` | `DELETE /api/mission/node/:node_id/dependency/:depends_on_id` | `mission.dependency.remove` | Yes      |

Path parameters: `mission_id` is a `mission_<ulid>`. `node_id` is the dependent and `depends_on_id` is the prerequisite; both are `node_<ulid>` values.

| Query parameter | Operation | Default | Purpose                                  |
| --------------- | --------- | ------- | ---------------------------------------- |
| `limit`         | Edge list | `100`   | Page size, `1` to `1000`.                |
| `cursor`        | Edge list | Absent  | `next_cursor` of the previous page.      |
| `node_id`       | Edge list | Absent  | Edges with this node as either endpoint. |

The dependency operations take the body `{ "reason": "<nonblank string>", "expected_mission_version": <positive integer> }` and accept no unknown field. `DELETE` also requires this JSON body.

| Header            | Required        | Purpose                                           |
| ----------------- | --------------- | ------------------------------------------------- |
| `Authorization`   | Yes             | `Bearer <human-jwt>`.                             |
| `Content-Type`    | Dependency only | `application/json`.                               |
| `Idempotency-Key` | Dependency only | Canonical ULID; retain it to retry the same edit. |

```sh
curl -i -X PUT http://127.0.0.1:31415/api/mission/node/node_01M4C5J3SBEB4P8KDXAZ6GKB6R/dependency/node_01M4C5J3SAMS4Z4KZD8DQ9GFTB \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M4C5J3SBXJ52XQ9FSFRTK4PR' \
  -d '{"reason":"Sign-up needs the login page","expected_mission_version":8}'
```

```sh
curl -i 'http://127.0.0.1:31415/api/mission/mission_01M4C5J3SA6W8RBBC92HA9SSDS/edge?node_id=node_01M4C5J3SAMS4Z4KZD8DQ9GFTB' \
  -H 'Authorization: Bearer <human-jwt>'
```

The Gateway keeps the answer of a mutation for its idempotency key in process memory for `idempotency_ttl` seconds, 86400 by default. A retry with the same key, human account and request replays that answer. This rule also applies to a failure.

## CLI shape

```text
kanthord mission edge list <mission-id> [--node <node-id>] [--limit <count>] [--cursor <cursor>]
kanthord mission dependency add <node-id> <depends-on-id> --file <path> [--idempotency-key <ulid>]
kanthord mission dependency remove <node-id> <depends-on-id> --file <path> [--idempotency-key <ulid>]
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord mission edge list mission_01M4C5J3SA6W8RBBC92HA9SSDS --node node_01M4C5J3SAMS4Z4KZD8DQ9GFTB
kanthord mission dependency add node_01M4C5J3SBEB4P8KDXAZ6GKB6R node_01M4C5J3SAMS4Z4KZD8DQ9GFTB --file edit.json
```

| Positional argument | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `<mission-id>`      | Required `mission_<ulid>`.                  |
| `<node-id>`         | Required `node_<ulid>` of the dependent.    |
| `<depends-on-id>`   | Required `node_<ulid>` of the prerequisite. |

| Option                     | Commands   | Default / resolution                                                        | Purpose                                                      |
| -------------------------- | ---------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `--node <node-id>`         | Edge list  | Absent                                                                      | Sets `node_id`.                                              |
| `--limit <count>`          | Edge list  | `100`                                                                       | Page size, `1` to `1000`.                                    |
| `--cursor <cursor>`        | Edge list  | Absent                                                                      | Continues from `next_cursor`.                                |
| `--file <path>`            | Dependency | Required; no default                                                        | JSON body file with `reason` and `expected_mission_version`. |
| `--idempotency-key <ulid>` | Dependency | A generated canonical ULID                                                  | Sets `Idempotency-Key`; supply the same key to retry.        |
| `--token <jwt>`            | All        | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                     |
| `--endpoint <url>`         | All        | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                             |

The CLI validates IDs, the token, the key and the file before it sends a request. Each option is accepted once. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline.
