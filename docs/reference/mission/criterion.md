# Set a node criterion

[Reference index](../README.md)

## Function description

The criterion is the condition that a node must meet. The verifications are the checks that support it. Both are fields of the node content. `criterion set` replaces both fields of one node in one human revision and keeps the other content fields.

- For an initiative or an objective, the write creates the next revision of that node.
- For a task, the write creates the next revision of its objective and changes the task inside it.
- The write creates no separate criterion record, state or ID. Read the criterion with [`node get` or `node revision get`](node.md).
- A write that changes neither field returns an empty change and keeps the mission version. Otherwise the mission version increases by one.
- The node, and for a task its objective, must be current and nonterminal. A node with an open attempt stays editable. The open attempt keeps its pinned revision.

**Authority:** every authenticated human holds the same authority under the server-owner ruling. Any verified human token changes any mission.

## Expected response

The API returns HTTP `200` with a [node change result](node.md#node-change-result). `revisions` holds the new revision. Its `change.write` is `criterion.set`, and `change.changed_fields` lists `criterion`, `verifications` or both. For a task, `change.changed_fields` is `["tasks"]`, and `change.tasks` names the task with its changed fields.

```json
{
  "mission_version": 10,
  "revisions": [
    {
      "node_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
      "filename": "login.md",
      "revision": 4,
      "reason": "Require an audit log entry",
      "actor": { "kind": "human", "account": "<account>", "name": "<name>" },
      "created_at": 1791446400000,
      "content": {
        "name": "Add the login page",
        "requirement": "The application shows a login form.",
        "criterion": "A user with valid credentials reaches the dashboard, and the audit log records the login.",
        "verifications": ["pnpm test", "pnpm test:audit"],
        "bindings": ["binding_01M4C5J3SA3P10JFTRYWW3AD0Y"]
      },
      "tasks": [],
      "change": {
        "write": "criterion.set",
        "previous_revision": 3,
        "changed_fields": ["criterion", "verifications"],
        "tasks": []
      },
      "pinned_by_attempts": []
    }
  ],
  "retired_node_ids": [],
  "added_edges": [],
  "removed_edges": [],
  "open_attempts_unchanged": []
}
```

| Property                  | Purpose                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `mission_version`         | Mission version after the write.                              |
| `revisions`               | The new node revision, with its `change` record.              |
| `retired_node_ids`        | Always empty for this command.                                |
| `added_edges`             | Always empty for this command.                                |
| `removed_edges`           | Always empty for this command.                                |
| `open_attempts_unchanged` | Open attempts that keep their pinned revision.                |
| `idempotency_key`         | CLI only. Key of this request; reuse it to retry the request. |

The [node change result](node.md#node-change-result) describes each property in detail.

The CLI writes the API answer plus `idempotency_key` as one JSON line to stdout and exits `0`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Meaning                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Absent, invalid or expired token, or a machine token.                                                 |
| `415 gateway.request.unsupported_media_type` | `Content-Type` is not `application/json`.                                                             |
| `400 gateway.request.invalid_json`           | The body is not valid JSON with unique object members.                                                |
| `400 gateway.request.validation_failed`      | The path or body fails the schema, for example empty `verifications` or an unknown field.             |
| `413 gateway.request.body_too_large`         | The body exceeds 10 MiB.                                                                              |
| `400 gateway.idempotency.invalid_key`        | Absent or malformed `Idempotency-Key`.                                                                |
| `409 gateway.idempotency.conflict`           | The key belongs to another request, or its first request is still in progress.                        |
| `404 mission.node.not_found`                 | The node ID is unknown.                                                                               |
| `409 mission.node.retired`                   | The node or the objective of the task is retired.                                                     |
| `409 mission.version.conflict`               | `expected_mission_version` is stale; `details.current` holds the current version.                     |
| `409 mission.node.terminal`                  | The node or the objective of the task is `Completed` or `Discarded`.                                  |
| `409 mission.revision.conflict`              | `expected_revision` is stale; `details.current` holds the current revision.                           |
| `400 mission.node.content_invalid`           | `criterion`, a verification or `reason` is blank or exceeds the text limit; `details.field` names it. |
| `504 gateway.invocation.timeout`             | The operation exceeded 30 seconds. The write can still complete.                                      |

The text limit is the server configuration value `mission.text_max_bytes`, 32768 UTF-8 bytes by default.

The CLI exits `1` on every failure and writes `<code>: <message>` to stderr. A declared remote failure prints `<code>: request failed (HTTP <status>); idempotency key <key>.`

| CLI code                                    | Meaning                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.mission.criterion.set.invalid_node_id` | `<node-id>` is not a `node_<ulid>` value.                                                                                                                |
| `cli.mission.criterion.set.token_required`  | No nonblank token resolves.                                                                                                                              |
| `cli.mission.criterion.set.indeterminate`   | A transport failure, a timeout or a malformed answer. Retry with the printed key.                                                                        |
| `cli.file.*`                                | `--file` is absent, not a regular file, `-`, not UTF-8, not JSON, has a repeated key, is not an object, or fails the schema (`cli.file.schema_invalid`). |
| `cli.idempotency_key.invalid`               | `--idempotency-key` is not a canonical ULID.                                                                                                             |

## API shape

| Item             | Value                                      |
| ---------------- | ------------------------------------------ |
| Method and path  | `PUT /api/mission/node/:node_id/criterion` |
| Operation ID     | `mission.criterion.set`                    |
| Access           | `human` (human bearer JWT)                 |
| Timeout          | 30 seconds                                 |
| Mutation         | Yes                                        |
| Path parameters  | `node_id`: `node_<ulid>`                   |
| Query parameters | None                                       |
| Request body     | JSON object, below                         |

| Body field                 | Type                      | Required | Purpose                                                           |
| -------------------------- | ------------------------- | -------- | ----------------------------------------------------------------- |
| `criterion`                | nonblank string           | Yes      | New criterion text.                                               |
| `verifications`            | array of nonblank strings | Yes      | New verifications; at least one.                                  |
| `reason`                   | nonblank string           | Yes      | Reason recorded on the revision.                                  |
| `expected_revision`        | positive integer          | Yes      | Current revision of the content owner; for a task, its objective. |
| `expected_mission_version` | positive integer          | Yes      | Current mission version.                                          |

The body accepts no unknown field.

| Header            | Required | Purpose                                            |
| ----------------- | -------- | -------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <human-jwt>`.                              |
| `Content-Type`    | Yes      | `application/json`.                                |
| `Idempotency-Key` | Yes      | Canonical ULID; retain it to retry the same write. |

```sh
curl -i -X PUT http://127.0.0.1:31415/api/mission/node/node_01M4C5J3SAMS4Z4KZD8DQ9GFTB/criterion \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M4C5J3SBXJ52XQ9FSFRTK4PR' \
  -d '{"criterion":"A user with valid credentials reaches the dashboard, and the audit log records the login.","verifications":["pnpm test","pnpm test:audit"],"reason":"Require an audit log entry","expected_revision":3,"expected_mission_version":9}'
```

The Gateway keeps the answer of a mutation for its idempotency key in process memory for `idempotency_ttl` seconds, 86400 by default. A retry with the same key, human account and request replays that answer. This rule also applies to a failure.

## CLI shape

```text
kanthord mission criterion set <node-id> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission criterion set node_01M4C5J3SAMS4Z4KZD8DQ9GFTB --file criterion.json \
  --idempotency-key 01M4C5J3SBXJ52XQ9FSFRTK4PR
```

| Positional argument | Purpose                 |
| ------------------- | ----------------------- |
| `<node-id>`         | Required `node_<ulid>`. |

| Option                     | Default / resolution                                                        | Purpose                                               |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `--file <path>`            | Required; no default                                                        | JSON file with the complete request body.             |
| `--idempotency-key <ulid>` | A generated canonical ULID                                                  | Sets `Idempotency-Key`; supply the same key to retry. |
| `--token <jwt>`            | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.              |
| `--endpoint <url>`         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                      |

The CLI validates the ID, the token, the key and the file before it sends a request. Each option is accepted once. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline.
