# Plan mission nodes

[Reference index](../README.md)

## Function description

A mission node is an initiative, an objective or a task. An initiative is a root. An objective belongs to one initiative. A task belongs to one objective. Each node has a plan file name that is unique among the current nodes of its mission.

Node content has `name`, `requirement`, `criterion`, `verifications` and `bindings`. In the node API, `bindings` holds binding IDs of the project. The service stores the latest revision of each named binding. An objective names exactly one repository binding and at most one storage binding. An initiative names at most one storage binding. A task names no binding. No node names a worker binding.

An initiative or an objective owns revisions, a state, attempts and a priority. A task has none of these. The content of a task is part of each revision of its objective. A task write creates a new revision of its objective. Revision numbers start at `1` for each content owner.

These commands read and change the plan:

- `node list` and `node get` read nodes. `node revision list` and `node revision get` read the revisions of the content owner.
- `node create` adds a node. `node update` replaces the content and the file name of a node.
- `node move` changes the parent of an objective or a task.
- `node retire preview` reports a retirement. `node retire` retires a node and its current descendants.
- `node rebind` moves binding pins to a later revision of the same binding.

Every write requires the current mission version in `expected_mission_version`. A write that changes the plan increases the mission version by one. A write that changes nothing returns an empty change and keeps the version. A human edit does not change the state of a node or the pinned revision of an open attempt.

No write reaches a retired node or a terminal node (`Completed` or `Discarded`), except that `node rebind` reports these nodes as skipped. The [node control](node-control.md) page describes states and controls.

**Authority:** every authenticated human holds the same authority under the server-owner ruling. Any verified human token reads and changes any mission.

### node create

- An initiative has no `parent_id` and no `expected_parent_revision`.
- An objective names a current initiative of the same mission. A task names a current objective of the same mission.
- The parent state must be `Pending`, `Available`, `Executing`, `Blocked` or `Paused`.
- `expected_parent_revision` must equal the current revision of the parent.
- A new initiative or objective starts at revision `1`. A new task adds a revision to its objective.

### node update

- The command replaces `filename` and `content` and records `reason`. It does not change the kind, the parent, the dependencies, the priority or the state.
- `expected_revision` names the current revision of the content owner. For a task, the content owner is its objective.
- The node, and for a task its objective, must be nonterminal. A node with an open attempt stays editable.

### node move

- An objective moves to an initiative of the same mission and takes no revision. A task moves to an objective and revises both objectives. An initiative does not move.
- `expected_revision` names the current revision of the content owner of the node. For a task, this is the old objective.
- `expected_old_parent_revision` and `expected_new_parent_revision` name the current revisions of both parents.
- The moved objective, or for a task both objectives, must be nonterminal. A move that creates a dependency cycle fails.
- A move to the current parent changes nothing.

### node retire preview and node retire

- The retirement set holds the node and its current descendants.
- Each initiative or objective in the set, and the objective of each task in the set, must be `Pending` or `Available` with attempt `0`.
- A dependent is a nonterminal node outside the set that depends on a node in the set. Without `force`, a dependent fails the retirement. With `force`, the retirement removes those dependency edges. A terminal dependent keeps its edge.
- The preview returns a digest of its result. The digest also covers `force`. The retirement recomputes the plan and requires the same digest.
- A retirement is final. The node rows remain readable. A current objective that loses tasks takes a new revision.

### node rebind

- `binding_id` names the target binding revision. It must belong to the project of the mission and must not be removed or disabled.
- A node pin is replaced when it names an earlier revision of the same binding resource.
- Without `node_id`, the command checks every initiative and objective of the mission. A retired or terminal node with a replaceable pin is reported in `skipped` and keeps its pin.
- With `node_id`, the node must be a current, nonterminal initiative or objective of the mission. It must pin an earlier or equal revision of the binding.
- Each changed node takes one revision. The new pin applies to the next attempt.

## Expected response

All operations return HTTP `200`. The CLI writes the API answer as one JSON line to stdout and exits `0`. A write command adds `idempotency_key` to the printed object.

### Node record

`node get` returns one node. `node list` returns `{ "items": [<node>], "next_cursor": <string or null> }`.

```json
{
  "id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
  "filename": "login.md",
  "mission_id": "mission_01M4C5J3SA6W8RBBC92HA9SSDS",
  "parent_id": "node_01M4C5J3SAYFD1BFNQB3BEBN6P",
  "visible_revision": 3,
  "content": {
    "name": "Add the login page",
    "requirement": "The application shows a login form.",
    "criterion": "A user with valid credentials reaches the dashboard.",
    "verifications": ["pnpm test"],
    "bindings": ["binding_01M4C5J3SA3P10JFTRYWW3AD0Y"]
  },
  "retired_at": null,
  "pinned_by_attempts": [],
  "kind": "objective",
  "state": "Available",
  "attempt": 0,
  "priority": 0,
  "depends_on": []
}
```

| Property             | Type                              | Purpose                                                                                                |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                 | `node_<ulid>`                     | Node ID.                                                                                               |
| `filename`           | plan file name                    | Unique name among current nodes of the mission.                                                        |
| `mission_id`         | `mission_<ulid>`                  | Mission of the node.                                                                                   |
| `parent_id`          | `node_<ulid>` or `null`           | Parent; `null` for an initiative.                                                                      |
| `kind`               | `initiative`, `objective`, `task` | Node kind.                                                                                             |
| `visible_revision`   | positive integer                  | Current revision of the content owner.                                                                 |
| `content`            | object                            | Current content; `bindings` holds binding revision IDs.                                                |
| `retired_at`         | integer or `null`                 | Retirement time in Unix milliseconds.                                                                  |
| `pinned_by_attempts` | array of integers                 | Attempts that pin the current revision of the content owner.                                           |
| `state`              | state name                        | Initiative and objective only.                                                                         |
| `attempt`            | integer                           | Current attempt number; `0` before the first attempt. Not on a task.                                   |
| `priority`           | safe integer                      | Scheduling priority; `0` by default. Not on a task.                                                    |
| `depends_on`         | array of `node_<ulid>`            | Direct dependency targets. Not on a task.                                                              |
| `blocked_context`    | object                            | Only in state `Blocked`: the `outcome` that closed the attempt and its request evidence in `requests`. |

A retired task shows the content of its last objective revision that held it.

### Revision record

`node revision get` returns one revision. `node revision list` returns `{ "items": [<revision>], "next_cursor": <string or null> }` from the highest revision to the lowest.

```json
{
  "node_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
  "filename": "login.md",
  "revision": 3,
  "reason": "Add a task",
  "actor": { "kind": "human", "account": "<account>", "name": "<name>" },
  "created_at": 1791446400000,
  "content": {
    "name": "Add the login page",
    "requirement": "...",
    "criterion": "...",
    "verifications": ["pnpm test"],
    "bindings": ["binding_01M4C5J3SA3P10JFTRYWW3AD0Y"]
  },
  "tasks": [
    {
      "id": "node_01M4C5J3SACNE2WP46QAMA4Q4F",
      "filename": "login-form.md",
      "content": {
        "name": "...",
        "requirement": "...",
        "criterion": "...",
        "verifications": ["..."],
        "bindings": []
      }
    }
  ],
  "change": {
    "write": "node.create",
    "previous_revision": 2,
    "changed_fields": ["tasks"],
    "tasks": [
      {
        "id": "node_01M4C5J3SACNE2WP46QAMA4Q4F",
        "change": "created",
        "changed_fields": [
          "filename",
          "name",
          "requirement",
          "criterion",
          "verifications",
          "bindings"
        ]
      }
    ]
  },
  "pinned_by_attempts": []
}
```

| Property                        | Type              | Purpose                                                                                                          |
| ------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `node_id`                       | `node_<ulid>`     | Content owner: the initiative or the objective.                                                                  |
| `filename`                      | plan file name    | File name of the owner at this revision.                                                                         |
| `revision`                      | positive integer  | Revision number of the owner.                                                                                    |
| `reason`, `actor`, `created_at` | mixed             | Who wrote the revision, why, and when. `actor.kind` is `human`, `execution` or `service`.                        |
| `content`                       | object            | Owner content at this revision.                                                                                  |
| `tasks`                         | array             | Objective only: `{ id, filename, content }` of each task at this revision.                                       |
| `change.write`                  | string            | `import`, `node.create`, `node.update`, `node.move`, `node.retire`, `node.rebind`, `criterion.set` or `unblock`. |
| `change.previous_revision`      | integer or `null` | Previous revision; `null` for revision `1`.                                                                      |
| `change.changed_fields`         | array of strings  | Changed owner fields, or `tasks`.                                                                                |
| `change.tasks`                  | array             | Task changes: `created`, `updated`, `moved-in`, `moved-out` or `retired`.                                        |
| `pinned_by_attempts`            | array of integers | Attempts that pin this revision.                                                                                 |

### Node change result

`node create`, `node update`, `node move` and `node retire` return a node change. Other plan writes return it too.

```json
{
  "mission_version": 8,
  "revisions": [],
  "retired_node_ids": [],
  "added_edges": [
    {
      "kind": "containment",
      "parent_id": "node_01M4C5J3SAYFD1BFNQB3BEBN6P",
      "child_id": "node_01M4C5J3SBEB4P8KDXAZ6GKB6R"
    }
  ],
  "removed_edges": [],
  "open_attempts_unchanged": []
}
```

| Property                  | Type             | Purpose                                                                                               |
| ------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `mission_version`         | positive integer | Mission version after the write.                                                                      |
| `revisions`               | array            | Revision records that the write created.                                                              |
| `retired_node_ids`        | array            | Nodes that the write retired.                                                                         |
| `added_edges`             | array of edges   | Added containment or dependency edges.                                                                |
| `removed_edges`           | array of edges   | Removed containment or dependency edges.                                                              |
| `open_attempts_unchanged` | array            | `{ node_id, attempt }` of open attempts of revised owners. These attempts keep their pinned revision. |

An edge is `{ "kind": "containment", "parent_id", "child_id" }` or `{ "kind": "dependency", "dependent_id", "depends_on_id" }`.

### node retire preview

```json
{
  "node_id": "node_01M4C5J3SBEB4P8KDXAZ6GKB6R",
  "force": false,
  "mission_version": 8,
  "retired_node_ids": ["node_01M4C5J3SBEB4P8KDXAZ6GKB6R"],
  "removed_edges": [],
  "preview_digest": "9a1c3e5f7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a"
}
```

| Property           | Type                    | Purpose                                |
| ------------------ | ----------------------- | -------------------------------------- |
| `node_id`          | `node_<ulid>`           | Named node.                            |
| `force`            | boolean                 | The `force` value of the preview.      |
| `mission_version`  | positive integer        | Current mission version.               |
| `retired_node_ids` | array, sorted           | Node and current descendants.          |
| `removed_edges`    | array of edges          | Dependency edges that `force` removes. |
| `preview_digest`   | 64 lower-case hex chars | Send this value to `node retire`.      |

### node rebind

```json
{
  "node_change": {
    "mission_version": 9,
    "revisions": [],
    "retired_node_ids": [],
    "added_edges": [],
    "removed_edges": [],
    "open_attempts_unchanged": []
  },
  "skipped": [
    {
      "node": { "id": "node_01M4C5J3SBEB4P8KDXAZ6GKB6R", "...": "..." },
      "condition": "terminal"
    }
  ]
}
```

| Property      | Type   | Purpose                                                                                            |
| ------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `node_change` | object | [Node change result](#node-change-result) with one revision for each rebound node.                 |
| `skipped`     | array  | `{ node, condition }` for each node that keeps an old pin; `condition` is `terminal` or `retired`. |

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). These failures apply to every operation on this page:

| HTTP status / code                           | Meaning                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Absent, invalid or expired token, or a machine token.                                                                                                |
| `400 gateway.request.validation_failed`      | A path, query or body value fails the schema, for example an unknown body field or `kind=task` with `state`.                                         |
| `400 gateway.request.unexpected_body`        | A read request has a body.                                                                                                                           |
| `415 gateway.request.unsupported_media_type` | A write request has no `application/json` content type.                                                                                              |
| `400 gateway.request.invalid_json`           | The body is not valid JSON with unique object members.                                                                                               |
| `413 gateway.request.body_too_large`         | The body exceeds 10 MiB.                                                                                                                             |
| `400 gateway.idempotency.invalid_key`        | A write request has an absent or malformed `Idempotency-Key`.                                                                                        |
| `409 gateway.idempotency.conflict`           | The key belongs to another request, or its first request is still in progress.                                                                       |
| `504 gateway.invocation.timeout`             | The operation exceeded 30 seconds. A write can still complete.                                                                                       |
| `404 mission.mission.not_found`              | The mission ID is unknown.                                                                                                                           |
| `404 mission.node.not_found`                 | The node, the parent or the revision is unknown.                                                                                                     |
| `400 system.pagination.cursor_invalid`       | A list cursor is not a cursor that the list returned.                                                                                                |
| `409 mission.version.conflict`               | `expected_mission_version` is stale; `details.current` holds the current version.                                                                    |
| `409 mission.revision.conflict`              | An expected revision is stale; `details.current` holds the current revision.                                                                         |
| `409 mission.node.retired`                   | The node, a parent or the content owner is retired.                                                                                                  |
| `409 mission.node.terminal`                  | The node or its content owner is `Completed` or `Discarded`.                                                                                         |
| `400 mission.node.content_invalid`           | A text field or `reason` is blank or exceeds the text limit, or `node create` has wrong parent fields for its kind. `details.field` names the field. |

Command-specific failures:

| HTTP status / code                       | Operation       | Meaning                                                                                                         |
| ---------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `400 mission.node.bindings_invalid`      | Create, update  | A binding ID does not resolve in the project, or the count of a binding kind breaks the rule for the node kind. |
| `409 mission.node.filename_conflict`     | Create, update  | Another current node of the mission uses the file name.                                                         |
| `409 mission.node.create_refused`        | Create, move    | The parent has the wrong kind or mission, the parent state refuses a child, or the node is an initiative.       |
| `409 mission.import.cycle`               | Move            | The objective move creates a dependency cycle.                                                                  |
| `409 mission.node.retire_refused`        | Retire, preview | A node in the set fails the state and attempt condition; `details` holds `node_id`, `state` and `attempt`.      |
| `409 mission.node.retire_has_dependents` | Retire, preview | Nonterminal dependents exist and `force` is false; `details.dependents` lists them.                             |
| `409 mission.node.retire_mismatch`       | Retire          | `preview_digest` does not match the current retirement plan.                                                    |
| `404 mission.binding.not_found`          | Rebind          | The binding revision is unknown or belongs to another project.                                                  |
| `409 mission.binding.removed`            | Rebind          | The binding is removed.                                                                                         |
| `409 mission.binding.disabled`           | Rebind          | The binding is disabled.                                                                                        |
| `409 mission.binding.mismatch`           | Rebind          | The named node is a task or pins no earlier or equal revision of the binding.                                   |

The text limit is the server configuration value `mission.text_max_bytes`, 32768 UTF-8 bytes by default.

The CLI exits `1` on every failure and writes `<code>: <message>` to stderr. A declared remote failure of a read prints `<code>: request failed (HTTP <status>).` A declared remote failure of a write prints `<code>: request failed (HTTP <status>); idempotency key <key>.`

| CLI code                                                                                      | Meaning                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.mission.node.<command>.invalid_mission_id`, `cli.mission.node.<command>.invalid_node_id` | A positional or option ID has the wrong prefix or is not a canonical ULID.                                                                               |
| `cli.mission.node.list.invalid_kind`, `cli.mission.node.list.invalid_state`                   | `--kind` or `--state` is not a known value.                                                                                                              |
| `cli.mission.node.list.kind_state_conflict`                                                   | `--kind task` with `--state`.                                                                                                                            |
| `cli.mission.node.rebind.invalid_binding_id`                                                  | `<binding-id>` is not a `binding_<ulid>` value.                                                                                                          |
| `cli.mission.node.revision.get.invalid_revision`                                              | `<revision>` is not a positive safe integer.                                                                                                             |
| `cli.pagination.limit_invalid`, `cli.pagination.limit_out_of_range`                           | `--limit` is not a positive integer, or exceeds 1000.                                                                                                    |
| `cli.mission.node.<command>.token_required`                                                   | No nonblank token resolves.                                                                                                                              |
| `cli.mission.node.<command>.indeterminate`                                                    | A transport failure, a timeout or a malformed answer. For a write, retry with the printed key.                                                           |
| `cli.file.*`                                                                                  | `--file` is absent, not a regular file, `-`, not UTF-8, not JSON, has a repeated key, is not an object, or fails the schema (`cli.file.schema_invalid`). |
| `cli.idempotency_key.invalid`                                                                 | `--idempotency-key` is not a canonical ULID.                                                                                                             |

`<command>` is the dotted command path, for example `retire.preview` or `revision.list`. `node retire` without `--file` fails with the Commander message for a required option. `node retire preview` rejects `--file` and `--idempotency-key` as unknown options.

## API shape

All operations use access `human` (human bearer JWT) and a 30-second timeout.

| CLI command           | Method and path                                     | Operation ID                  | Mutation |
| --------------------- | --------------------------------------------------- | ----------------------------- | -------- |
| `node list`           | `GET /api/mission/:mission_id/node`                 | `mission.node.list`           | No       |
| `node get`            | `GET /api/mission/node/:node_id`                    | `mission.node.get`            | No       |
| `node create`         | `POST /api/mission/:mission_id/node`                | `mission.node.create`         | Yes      |
| `node update`         | `PUT /api/mission/node/:node_id`                    | `mission.node.update`         | Yes      |
| `node move`           | `POST /api/mission/node/:node_id/move`              | `mission.node.move`           | Yes      |
| `node retire preview` | `GET /api/mission/node/:node_id/retire/preview`     | `mission.node.retire.preview` | No       |
| `node retire`         | `POST /api/mission/node/:node_id/retire`            | `mission.node.retire`         | Yes      |
| `node rebind`         | `POST /api/mission/:mission_id/rebind`              | `mission.node.rebind`         | Yes      |
| `node revision list`  | `GET /api/mission/node/:node_id/revision`           | `mission.node.revision.list`  | No       |
| `node revision get`   | `GET /api/mission/node/:node_id/revision/:revision` | `mission.node.revision.get`   | No       |

Path parameters: `mission_id` is `mission_<ulid>`, `node_id` is `node_<ulid>`, and `revision` is a positive safe integer.

| Header            | Required    | Purpose                                            |
| ----------------- | ----------- | -------------------------------------------------- |
| `Authorization`   | Yes         | `Bearer <human-jwt>`.                              |
| `Content-Type`    | Writes only | `application/json`.                                |
| `Idempotency-Key` | Writes only | Canonical ULID; retain it to retry the same write. |

The Gateway keeps the answer of a write for its idempotency key in process memory for `idempotency_ttl` seconds, 86400 by default. A retry with the same key, human account and request replays that answer. This rule also applies to a failure. Read requests send no body.

### Query parameters

| Operation             | Parameter         | Default | Purpose                                                                               |
| --------------------- | ----------------- | ------- | ------------------------------------------------------------------------------------- |
| List operations       | `limit`           | `100`   | Page size, `1` to `1000`.                                                             |
| List operations       | `cursor`          | Absent  | `next_cursor` of the previous page.                                                   |
| `node list`           | `kind`            | Absent  | `initiative`, `objective` or `task`.                                                  |
| `node list`           | `state`           | Absent  | Exact state name; selects initiatives and objectives only. Rejected with `kind=task`. |
| `node list`           | `parent_id`       | Absent  | Direct children of this node.                                                         |
| `node list`           | `include_retired` | `false` | `true` or `false`.                                                                    |
| `node retire preview` | `force`           | `false` | `true` or `false`.                                                                    |

`node list` returns nodes from the highest node ID to the lowest. `node revision list` returns revisions from the highest revision to the lowest.

### Request bodies

| Operation     | Field                                                                               | Type                              | Required                       |
| ------------- | ----------------------------------------------------------------------------------- | --------------------------------- | ------------------------------ |
| `node create` | `filename`                                                                          | plan file name                    | Yes                            |
| `node create` | `kind`                                                                              | `initiative`, `objective`, `task` | Yes                            |
| `node create` | `content`                                                                           | content object, below             | Yes                            |
| `node create` | `reason`                                                                            | nonblank string                   | Yes                            |
| `node create` | `expected_mission_version`                                                          | positive integer                  | Yes                            |
| `node create` | `parent_id`                                                                         | `node_<ulid>`                     | Objective and task only        |
| `node create` | `expected_parent_revision`                                                          | positive integer                  | Objective and task only        |
| `node update` | `filename`, `content`, `reason`, `expected_mission_version`                         | as above                          | Yes                            |
| `node update` | `expected_revision`                                                                 | positive integer                  | Yes                            |
| `node move`   | `new_parent_id`                                                                     | `node_<ulid>`                     | Yes                            |
| `node move`   | `reason`, `expected_mission_version`                                                | as above                          | Yes                            |
| `node move`   | `expected_revision`, `expected_old_parent_revision`, `expected_new_parent_revision` | positive integers                 | Yes                            |
| `node retire` | `reason`, `expected_mission_version`                                                | as above                          | Yes                            |
| `node retire` | `preview_digest`                                                                    | 64 lower-case hex chars           | Yes                            |
| `node retire` | `force`                                                                             | boolean                           | Yes; must match the preview    |
| `node rebind` | `binding_id`                                                                        | `binding_<ulid>`                  | Yes                            |
| `node rebind` | `reason`, `expected_mission_version`                                                | as above                          | Yes                            |
| `node rebind` | `node_id`                                                                           | `node_<ulid>`                     | No; absent rebinds the mission |

The content object has `name`, `requirement` and `criterion` (nonblank strings), `verifications` (at least one nonblank string) and `bindings` (binding IDs). A plan file name matches `^[a-z][a-z0-9_-]*\.md$`. Bodies accept no unknown field.

```sh
curl -i -X POST http://127.0.0.1:31415/api/mission/mission_01M4C5J3SA6W8RBBC92HA9SSDS/node \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M4C5J3SBXJ52XQ9FSFRTK4PR' \
  -d '{"filename":"signup.md","kind":"objective","parent_id":"node_01M4C5J3SAYFD1BFNQB3BEBN6P","expected_parent_revision":1,"expected_mission_version":7,"reason":"Add sign-up","content":{"name":"Add sign-up","requirement":"Users create accounts.","criterion":"A new user signs in.","verifications":["pnpm test"],"bindings":["binding_01M4C5J3SA3P10JFTRYWW3AD0Y"]}}'
```

```sh
curl -i 'http://127.0.0.1:31415/api/mission/mission_01M4C5J3SA6W8RBBC92HA9SSDS/node?kind=objective&state=Available&limit=50' \
  -H 'Authorization: Bearer <human-jwt>'
```

## CLI shape

```text
kanthord mission node list <mission-id> [--kind <kind>] [--state <state>] [--parent <node-id>] [--include-retired] [--limit <count>] [--cursor <cursor>]
kanthord mission node get <node-id>
kanthord mission node create <mission-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node update <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node move <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node retire preview <node-id> [--force]
kanthord mission node retire <node-id> --file <path> [--force] [--idempotency-key <ulid>]
kanthord mission node rebind <mission-id> <binding-id> --file <path> [--node <node-id>] [--idempotency-key <ulid>]
kanthord mission node revision list <node-id> [--limit <count>] [--cursor <cursor>]
kanthord mission node revision get <node-id> <revision>
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord mission node create mission_01M4C5J3SA6W8RBBC92HA9SSDS --file signup.json
kanthord mission node retire preview node_01M4C5J3SBEB4P8KDXAZ6GKB6R --force
kanthord mission node retire node_01M4C5J3SBEB4P8KDXAZ6GKB6R --force --file retire.json \
  --idempotency-key 01M4C5J3SBXJ52XQ9FSFRTK4PR
```

| Positional argument | Purpose                                                 |
| ------------------- | ------------------------------------------------------- |
| `<mission-id>`      | Required `mission_<ulid>`.                              |
| `<node-id>`         | Required `node_<ulid>`.                                 |
| `<binding-id>`      | Required `binding_<ulid>`: the target binding revision. |
| `<revision>`        | Required positive safe integer.                         |

| Option                     | Commands                             | Default / resolution                                                        | Purpose                                                              |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `--kind <kind>`            | `node list`                          | Absent                                                                      | Sets `kind`.                                                         |
| `--state <state>`          | `node list`                          | Absent                                                                      | Sets `state`.                                                        |
| `--parent <node-id>`       | `node list`                          | Absent                                                                      | Sets `parent_id`.                                                    |
| `--include-retired`        | `node list`                          | `false`                                                                     | Sets `include_retired=true`; the CLI always sends this value.        |
| `--limit <count>`          | List commands                        | `100`                                                                       | Page size, `1` to `1000`.                                            |
| `--cursor <cursor>`        | List commands                        | Absent                                                                      | Continues from `next_cursor`.                                        |
| `--file <path>`            | Writes                               | Required; no default                                                        | JSON body file. See the file contents below.                         |
| `--force`                  | `node retire`, `node retire preview` | `false`                                                                     | Sets `force`. Use the same value for the preview and the retirement. |
| `--node <node-id>`         | `node rebind`                        | Absent                                                                      | Sets `node_id`; rebinds only this node.                              |
| `--idempotency-key <ulid>` | Writes                               | A generated canonical ULID                                                  | Sets `Idempotency-Key`; supply the same key to retry.                |
| `--token <jwt>`            | All                                  | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.                             |
| `--endpoint <url>`         | All                                  | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                     |

The `--file` contents:

- `node create`, `node update` and `node move`: the complete request body.
- `node retire`: `reason`, `expected_mission_version` and `preview_digest`. The CLI sets `force` from `--force`. A `force` field in the file fails the schema.
- `node rebind`: `reason` and `expected_mission_version`. The CLI sets `binding_id` from `<binding-id>` and `node_id` from `--node`. Either field in the file fails the schema.

The CLI validates IDs, the token, the key and the file before it sends a request. The CLI does not read stdin. Each option is accepted once. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline.
