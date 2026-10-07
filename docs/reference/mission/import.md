# Import a mission plan

[Reference index](../README.md)

## Function description

An import replaces the whole plan of a mission in one transaction. The import set holds one entry for each node that the plan keeps:

- An entry without `id` creates a node.
- An entry with the `id` of a current node updates that node.
- A current node that no entry names is retired.

`mission import preview` validates an import set and reports its effect. It writes nothing and stores no receipt. `mission import apply` validates the same set again, checks the preview digest and the confirmed retirements, and then writes all changes atomically.

The import set has one of two formats:

- `markdown`: plan files `{ filename, content }`. The Mission service parses each file. The [mission export](mission.md#function-description) page shows the plan file format.
- `json`: plan entries with the fields of a JSON [mission export](mission.md#mission-export) entry. `id`, `parent` and `depends_on` are optional.

`parent` and `depends_on` name plan files inside the import set, never node IDs or paths. `bindings` holds binding names of the project. The service resolves each name to the current binding revision.

The import condition is state `Pending` or `Available` with attempt `0`. The import applies it to these current nodes:

- Each initiative or objective with changed content. For a task with changed content, the condition applies to its objective.
- Each current parent whose child set changes by a create, a move or a retirement.
- Each retired initiative or objective, and the objective of each retired task.

These additional rules apply:

- No terminal node (`Completed` or `Discarded`) changes. An entry that keeps a terminal node unchanged is a no-op and is allowed.
- A change of only `depends_on` requires a nonterminal node, not the import condition.
- A new dependency of a kept node requires no live claim on that node or on its descendants. Only apply checks this rule.

One failed check fails the whole import. A changed `depends_on` list counts as an update even if the content is unchanged. An apply that changes nothing keeps the mission version. An apply that changes the plan increases the mission version by one.

The preview digest covers the mission ID, the mission version, the normalized entries and the retirement set. A stale mission version fails the preview and the apply. A preview reserves no node.

The import does not unblock a node, reopen an attempt or change priority. It records the human that submits the import as the actor of each revision.

## Expected response

### import preview

The API returns HTTP `200` with the preview. A plan violation does not fail the request; the answer lists it in `violations`.

```json
{
  "mission_id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS",
  "expected_mission_version": 7,
  "preview_digest": "4f0c2e6a9b1d3c5e7f8a0b2c4d6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e",
  "creates": ["signup.md"],
  "updates": ["node_01M4C5J3SAMS4Z4KZD8DQ9GFTB"],
  "retirements": ["node_01M4C5J3SBEB4P8KDXAZ6GKB6R"],
  "removed_edges": [
    {
      "kind": "containment",
      "parent_id": "node_01M4C5J3SAYFD1BFNQB3BEBN6P",
      "child_id": "node_01M4C5J3SBEB4P8KDXAZ6GKB6R"
    }
  ],
  "no_ops": ["node_01M4C5J3SAYFD1BFNQB3BEBN6P"],
  "violations": []
}
```

| Property                   | Type                    | Purpose                                                                                                |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `mission_id`               | `mission_<ulid>`        | Mission of the route.                                                                                  |
| `expected_mission_version` | positive integer        | The `mission_version` of the request.                                                                  |
| `preview_digest`           | 64 lower-case hex chars | Send this value as `preview_digest` to apply.                                                          |
| `creates`                  | array of file names     | Entries without `id`.                                                                                  |
| `updates`                  | array of node IDs       | Kept nodes with changed content or changed dependencies.                                               |
| `retirements`              | array of node IDs       | Current nodes that the import set omits. Send this set as `confirmed_retirements`.                     |
| `removed_edges`            | array of edges          | Current containment and dependency edges that the import removes.                                      |
| `no_ops`                   | array of node IDs       | Kept nodes without a change.                                                                           |
| `violations`               | array                   | `{ code, message, filename, node_id, details }` for each failed check. Empty when the import is valid. |

The violation codes are `mission.import.mission_mismatch`, `mission.import.duplicate_file`, `mission.import.plan_invalid`, `mission.import.duplicate_id`, `mission.import.unknown_id`, `mission.import.foreign_id`, `mission.import.retired_id`, `mission.import.kind_changed`, `mission.import.unresolved_reference`, `mission.import.reference_kind_invalid`, `mission.import.cycle`, `mission.import.terminal_change`, `mission.import.condition_failed`, `mission.node.content_invalid`, `mission.node.verifications_missing` and `mission.node.bindings_invalid`.

### import apply

The API returns HTTP `200` with the import result:

```json
{
  "mission_id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS",
  "mission_version": 8,
  "assigned_ids": [
    { "filename": "login.md", "node_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB" },
    { "filename": "platform.md", "node_id": "node_01M4C5J3SAYFD1BFNQB3BEBN6P" },
    { "filename": "signup.md", "node_id": "node_01M4C5J3SBKF4M6X325KZGRKHH" }
  ],
  "changes": {
    "mission_version": 8,
    "revisions": [],
    "retired_node_ids": ["node_01M4C5J3SBEB4P8KDXAZ6GKB6R"],
    "added_edges": [],
    "removed_edges": [],
    "open_attempts_unchanged": []
  },
  "actor": { "kind": "human", "account": "<account>", "name": "<name>" },
  "accepted_at": 1791446400000
}
```

| Property          | Type             | Purpose                                                                                  |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `mission_id`      | `mission_<ulid>` | Imported mission.                                                                        |
| `mission_version` | positive integer | Mission version after the apply.                                                         |
| `assigned_ids`    | array            | `{ filename, node_id }` for every entry, sorted by file name, with the IDs of new nodes. |
| `changes`         | object           | The [node change result](node.md#node-change-result) of the import.                      |
| `actor`           | object           | The human that submitted the import.                                                     |
| `accepted_at`     | integer          | Acceptance time in Unix milliseconds.                                                    |

The CLI writes the result plus `idempotency_key` as one JSON line to stdout and exits `0`. The CLI writes no assigned ID back to a plan file. Run `mission export` to get plan files with IDs.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                           | Operation | Meaning                                                                                                                                                                         |
| -------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Both      | Absent, invalid or expired token, or a machine token.                                                                                                                           |
| `415 gateway.request.unsupported_media_type` | Both      | `Content-Type` is not `application/json`.                                                                                                                                       |
| `400 gateway.request.invalid_json`           | Both      | The body is not valid JSON with unique object members.                                                                                                                          |
| `400 gateway.request.validation_failed`      | Both      | The body fails the schema, for example an unknown field.                                                                                                                        |
| `413 gateway.request.body_too_large`         | Both      | The body exceeds 10 MiB.                                                                                                                                                        |
| `400 gateway.idempotency.invalid_key`        | Apply     | Absent or malformed `Idempotency-Key`.                                                                                                                                          |
| `409 gateway.idempotency.conflict`           | Apply     | The key belongs to another request, or its first request is still in progress.                                                                                                  |
| `404 mission.mission.not_found`              | Both      | The mission ID is unknown.                                                                                                                                                      |
| `409 mission.version.conflict`               | Both      | `mission_version` is stale; `details.current` holds the current version.                                                                                                        |
| `400 mission.node.content_invalid`           | Both      | `reason` is blank or exceeds the text limit.                                                                                                                                    |
| `400` or `409` with a violation code         | Apply     | The first violation of the preview. `409` for `mission.import.condition_failed` and `mission.import.terminal_change`, otherwise `400`. `details` adds `filename` and `node_id`. |
| `409 mission.import.retirement_mismatch`     | Apply     | `preview_digest` or `confirmed_retirements` does not match the current preview.                                                                                                 |
| `409 mission.node.claim_live`                | Apply     | A new dependency names a node whose subtree has a live claim.                                                                                                                   |
| `504 gateway.invocation.timeout`             | Both      | The operation exceeded 30 seconds. An apply can still complete.                                                                                                                 |

The text limit is the server configuration value `mission.text_max_bytes`, 32768 UTF-8 bytes by default.

The CLI exits `1` on every failure and writes `<code>: <message>` to stderr. A declared remote failure prints `<code>: request failed (HTTP <status>).` For apply, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead.

| CLI code                                                                                          | Meaning                                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `cli.mission.import.<action>.invalid_mission_id`                                                  | `<mission-id>` is not a `mission_<ulid>` value.                                               |
| `cli.mission.import.<action>.positionals_not_accepted`                                            | The file sets `format: "json"` and the command has plan-file positionals.                     |
| `cli.mission.import.<action>.files_conflict`                                                      | The file sets `format: "markdown"`, holds `files`, and the command has plan-file positionals. |
| `cli.mission.import.<action>.token_required`                                                      | No nonblank token resolves.                                                                   |
| `cli.mission.import.<action>.indeterminate`                                                       | A transport failure, a timeout or a malformed answer. For apply, retry with the printed key.  |
| `cli.file.not_found`, `cli.file.not_regular`                                                      | `--file` or a plan file is absent or is not a regular file.                                   |
| `cli.file.invalid_path`                                                                           | `--file` is `-`; the CLI does not read stdin.                                                 |
| `cli.file.encoding_invalid`, `cli.file.not_json`, `cli.file.duplicate_key`, `cli.file.not_object` | `--file` is not UTF-8, not JSON, has a repeated key, or is not an object.                     |
| `cli.file.schema_invalid`                                                                         | The completed body fails the request schema.                                                  |
| `cli.idempotency_key.invalid`                                                                     | `--idempotency-key` is not a canonical ULID.                                                  |

`<action>` is `preview` or `apply`.

## API shape

### import preview

| Item             | Value                                          |
| ---------------- | ---------------------------------------------- |
| Method and path  | `POST /api/mission/:mission_id/import/preview` |
| Operation ID     | `mission.import.preview`                       |
| Access           | `human` (human bearer JWT)                     |
| Timeout          | 30 seconds                                     |
| Mutation         | No; the POST writes nothing                    |
| Path parameters  | `mission_id`: `mission_<ulid>`                 |
| Query parameters | None                                           |
| Request body     | Import snapshot, below                         |

### import apply

| Item             | Value                                        |
| ---------------- | -------------------------------------------- |
| Method and path  | `POST /api/mission/:mission_id/import`       |
| Operation ID     | `mission.import.apply`                       |
| Access           | `human` (human bearer JWT)                   |
| Timeout          | 30 seconds                                   |
| Mutation         | Yes                                          |
| Path parameters  | `mission_id`: `mission_<ulid>`               |
| Query parameters | None                                         |
| Request body     | Import snapshot plus the apply fields, below |

### Request body

| Field                   | Type                             | Required   | Purpose                                                                                |
| ----------------------- | -------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `format`                | `markdown` or `json`             | Yes        | Selects `files` or `entries`.                                                          |
| `mission_id`            | `mission_<ulid>`                 | Yes        | Must equal the route mission; otherwise a `mission.import.mission_mismatch` violation. |
| `mission_version`       | positive integer                 | Yes        | Expected current mission version.                                                      |
| `reason`                | nonblank string                  | Yes        | Reason recorded on each revision.                                                      |
| `files`                 | array of `{ filename, content }` | Markdown   | Plan files. `filename` is a nonempty string; `content` is a string.                    |
| `entries`               | array of entries                 | JSON       | Plan entries, below.                                                                   |
| `preview_digest`        | 64 lower-case hex chars          | Apply only | Digest from the preview.                                                               |
| `confirmed_retirements` | array of `node_<ulid>`           | Apply only | Exactly the `retirements` set of the preview.                                          |

| Entry field                        | Type                              | Required | Purpose                                                                                                                                                |
| ---------------------------------- | --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `filename`                         | string                            | Yes      | Plan file name, `^[a-z][a-z0-9_-]*\.md$`.                                                                                                              |
| `kind`                             | `initiative`, `objective`, `task` | Yes      | Node kind; it cannot change for a kept node.                                                                                                           |
| `name`, `requirement`, `criterion` | nonblank string                   | Yes      | Node content.                                                                                                                                          |
| `verifications`                    | array of nonblank strings         | Yes      | At least one verification.                                                                                                                             |
| `bindings`                         | array of binding names            | Yes      | An objective names exactly one repository binding and at most one storage binding. An initiative names at most one storage binding. A task names none. |
| `id`                               | `node_<ulid>`                     | No       | Current node to keep.                                                                                                                                  |
| `parent`                           | plan file name                    | No       | Required for an objective or a task; forbidden for an initiative.                                                                                      |
| `depends_on`                       | array of plan file names          | No       | Dependency targets; forbidden for a task.                                                                                                              |

The body accepts no unknown field.

| Header            | Required   | Purpose                                            |
| ----------------- | ---------- | -------------------------------------------------- |
| `Authorization`   | Yes        | `Bearer <human-jwt>`.                              |
| `Content-Type`    | Yes        | `application/json`.                                |
| `Idempotency-Key` | Apply only | Canonical ULID; retain it to retry the same apply. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/mission/mission_01M4C5J3SA6W8RBBC92HA9SSDS/import \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M4C5J3SBXJ52XQ9FSFRTK4PR' \
  -d '{"format":"json","mission_id":"mission_01M4C5J3SA6W8RBBC92HA9SSDS","mission_version":7,"reason":"Add sign-up","entries":[],"preview_digest":"<digest>","confirmed_retirements":[]}'
```

The Gateway keeps the answer of a mutation for its idempotency key in process memory for `idempotency_ttl` seconds, 86400 by default. A retry with the same key, human account and request replays that answer. This rule also applies to a failure.

## CLI shape

```text
kanthord mission import preview <mission-id> [plan-file...] --file <path> [--token <jwt>] [--endpoint <url>]
kanthord mission import apply <mission-id> [plan-file...] --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission import preview mission_01M4C5J3SA6W8RBBC92HA9SSDS plan/*.md --file import.json
kanthord mission import apply mission_01M4C5J3SA6W8RBBC92HA9SSDS plan/*.md \
  --file apply.json --idempotency-key 01M4C5J3SBXJ52XQ9FSFRTK4PR
```

| Positional argument | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- |
| `<mission-id>`      | Required `mission_<ulid>`.                                          |
| `[plan-file...]`    | Markdown plan files in import order. Only for `format: "markdown"`. |

| Option                     | Default / resolution                                                        | Purpose                                                             |
| -------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--file <path>`            | Required; no default                                                        | JSON file with the import controls and, for JSON format, `entries`. |
| `--idempotency-key <ulid>` | Apply only; a generated canonical ULID                                      | Sets `Idempotency-Key`; supply the same key to retry.               |
| `--token <jwt>`            | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                            |
| `--endpoint <url>`         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                    |

The CLI builds the request body from `--file` as follows:

- If the file has no `mission_id`, the CLI sets it from `<mission-id>`.
- For `format: "markdown"` with positionals, the CLI reads each plan file and sends its base name as `filename` and its text as `content`. It does not parse Markdown.
- For `format: "markdown"` without positionals, the CLI sends the `files` of the file unchanged. If the file has no `files`, the schema check fails with `cli.file.schema_invalid`, and the CLI sends no request. An empty set needs an explicit `"files": []`.
- For `format: "json"`, the CLI sends the `entries` of the file.

The CLI does not scan directories and asks for no confirmation. Each option is accepted once. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline.
