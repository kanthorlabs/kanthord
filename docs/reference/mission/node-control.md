# Control mission nodes

[Reference index](../README.md)

## Function description

Human controls change the state, the attempt or the priority of an initiative or an objective. A task has no state, no attempt and no priority, and every control on a task fails.

A runnable node has one of these states: `Pending`, `Available`, `Executing`, `Waiting`, `Evaluating`, `Blocked`, `Paused`, `Completed`, `Discarded`, `External.Requested`, `External.Success` and `External.Failed`. `Completed` and `Discarded` are terminal. Only `Completed` satisfies a dependency.

An attempt is one try to complete a node. The attempt number starts at `0`, which means no attempt. At most one attempt is open. An attempt pins the node revision that it opens with.

Every state control sends the expected state and attempt. The service checks these values after it settles the Scheduler claims of the node. A control commits in one transaction, routes the mission, and wakes the Scheduler of the project. Controls do not change the mission version, except an `unblock` that changes content.

| Command    | Admitted states                                                                                                           | Effect                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pause`    | `Pending`, `Available`, `Executing`, `Waiting`, `Evaluating`, `External.Requested`, `External.Success`, `External.Failed` | Revokes a live execution or evaluation claim and sets `Paused`. The open attempt stays open.           |
| `resume`   | `Paused`                                                                                                                  | Selects the next state, below.                                                                         |
| `block`    | `Paused`                                                                                                                  | Closes the open attempt, records an `undetermined` human assessment and outcome, and sets `Blocked`.   |
| `unblock`  | `Blocked`                                                                                                                 | Writes an optional content change, opens the next attempt, and sets `Available` or `Pending`.          |
| `ready`    | `Available`                                                                                                               | Asserts that execution needs no further work, opens attempt `1` if none exists, and sets `Waiting`.    |
| `override` | `Pending`, `Available`, `Executing`, `Waiting`, `Blocked`, `Paused`, `External.Success`, `External.Failed`                | Records a `success` human assessment and outcome, closes the open attempt, and sets `Completed`.       |
| `discard`  | `Pending`, `Available`, `Executing`, `Waiting`, `Evaluating`, `Blocked`, `Paused`, `External.Success`, `External.Failed`  | Records an `undetermined` human assessment and outcome, closes the open attempt, and sets `Discarded`. |

### resume

`resume` reads the required external actions of the open attempt first:

1. If an action ended in another state than expected, the node goes to `External.Failed`.
2. Otherwise, if an action has a request, the node goes to `External.Success` when every action reached its expected end. It goes to `External.Requested` in other cases.
3. Otherwise, `target` selects the state. `Available` becomes `Available` or `Pending` by the dependency closure. `Waiting` requires readiness and a satisfied dependency closure, and opens attempt `1` if none exists.

After `External.Success` or `External.Failed`, a current assessment with result `success` closes the attempt. The node then goes to `Completed` or `Blocked`, and the answer holds the new outcome.

### ready

Readiness requires two conditions. For an initiative, every current objective is terminal. For the open attempt, no request is unresolved. An objective needs no task. Child success is not required. `ready` publishes no assessment.

### block, discard and override

- An attempt closes only when the node holds an open attempt that is not `Blocked`. With attempt `0`, the outcome records attempt `0`.
- `override` and `discard` revoke a live claim. They fail while the open attempt has an unresolved external request.
- `override` with `landed_commit` adds repository evidence attributed to the human. The node must be an objective, and the binding must be a repository binding that the revision of the act pins. The service does not check the repository.
- `discard` cancels no external request. A `Discarded` node satisfies no dependency.

### unblock

- `blocked_attempt` must equal the current attempt, and `expected_revision` must equal the current revision.
- `change` holds new `content`, a `reason` and, for an objective, the complete current task set. A task in the set has no bindings. An initiative sends no `tasks`.
- A content change writes a revision with `change.write` `unblock` and increases the mission version.
- With attempt `0`, `unblock` opens no attempt. Otherwise it opens the next attempt, pinned to the current revision, with the human as `opened_by`.

To redirect an open attempt, pause the node, block it, and unblock it with the changed content.

### check

`node check` checks each unresolved external request of the open attempt through the Intake service. Each result commits in its own transaction. An expected end adds landed-commit evidence. A node in `External.Requested` can move to `External.Success` or `External.Failed`, and then close its attempt. A request whose node has a live claim is not changed.

**Current limitation:** the standalone server wires no Intake check. Each request then appears in `failures`, and no end state changes.

### priority set

`priority set` writes the priority of a nonterminal initiative or objective without a live claim. Any signed safe integer is valid. The default priority is `0`. The write keeps no history, records no actor or reason, and does not change the mission version.

**Authority:** every authenticated human holds the same authority under the server-owner ruling. Any verified human token controls any mission.

## Expected response

All operations return HTTP `200`. The CLI writes the API answer plus `idempotency_key` as one JSON line to stdout and exits `0`.

### State controls

`pause`, `resume`, `block`, `unblock`, `ready`, `override` and `discard` return a control result:

```json
{
  "node": {
    "id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
    "kind": "objective",
    "state": "Paused",
    "attempt": 1,
    "...": "..."
  },
  "attempt": {
    "node_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
    "attempt": 1,
    "node_revision": 3,
    "required_external_actions": [],
    "opened_at": 1791446400000,
    "closed_at": null,
    "outcome_ids": [],
    "opened_by": { "kind": "human", "account": "<account>", "name": "<name>" }
  },
  "outcome": null,
  "actor": { "kind": "human", "account": "<account>", "name": "<name>" },
  "accepted_at": 1791446460000
}
```

| Property      | Type             | Purpose                                                                                                                                                          |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`        | object           | The [node record](node.md#node-record) after the control.                                                                                                        |
| `attempt`     | object or `null` | The current [attempt record](attempt.md); `null` while the attempt number is `0`.                                                                                |
| `outcome`     | object or `null` | The [outcome](outcome.md) that the control wrote, with `closing_event`, `result`, `assessment_id` and `evidence_ids`. `null` for `pause`, `ready` and `unblock`. |
| `actor`       | object           | The human that sent the control.                                                                                                                                 |
| `accepted_at` | integer          | Acceptance time in Unix milliseconds.                                                                                                                            |

### node check

```json
{
  "results": [
    {
      "evidence_id": "evidence_01M4C5J3SBKF4M6X325KZGRKHH",
      "requirement_key": "main-repository.pull_request",
      "resolution": "expected-end"
    }
  ],
  "failures": [
    {
      "evidence_id": "evidence_01M4C5J3SBY59S8V480WVEDRMG",
      "error": {
        "error": {
          "code": "mission.node.claim_live",
          "message": "Node has a live claim.",
          "details": {
            "node_id": "node_01M4C5J3SAMS4Z4KZD8DQ9GFTB",
            "execution_id": "<execution-id>"
          }
        },
        "request_id": "<request-id>"
      }
    }
  ]
}
```

| Property                    | Type              | Purpose                                                                                 |
| --------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `results[].evidence_id`     | `evidence_<ulid>` | Checked request evidence.                                                               |
| `results[].requirement_key` | string            | Action key of the request.                                                              |
| `results[].resolution`      | string            | `unresolved`, `expected-end` or `other-end` after the check.                            |
| `failures[].evidence_id`    | `evidence_<ulid>` | Request that the call could not check or record.                                        |
| `failures[].error`          | object            | An error envelope for that request. An unknown failure uses `system.operation.unknown`. |

### node priority set

The API returns the [node record](node.md#node-record) with the new `priority`.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures). These failures apply to every operation on this page:

| HTTP status / code                           | Meaning                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`    | Absent, invalid or expired token, or a machine token.                             |
| `415 gateway.request.unsupported_media_type` | `Content-Type` is not `application/json`.                                         |
| `400 gateway.request.invalid_json`           | The body is not valid JSON with unique object members.                            |
| `400 gateway.request.validation_failed`      | A path or body value fails the schema, for example an unknown field.              |
| `413 gateway.request.body_too_large`         | The body exceeds 10 MiB.                                                          |
| `400 gateway.idempotency.invalid_key`        | Absent or malformed `Idempotency-Key`.                                            |
| `409 gateway.idempotency.conflict`           | The key belongs to another request, or its first request is still in progress.    |
| `504 gateway.invocation.timeout`             | The operation exceeded 30 seconds. The control can still complete.                |
| `404 mission.node.not_found`                 | The node ID is unknown.                                                           |
| `409 mission.version.conflict`               | `expected_mission_version` is stale; `details.current` holds the current version. |

The state controls check in this order, and the first failure answers:

| HTTP status / code                 | Meaning                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `409 mission.node.retired`         | The node is retired.                                                                                                     |
| `400 mission.node.control_task`    | The node is a task.                                                                                                      |
| `409 mission.version.conflict`     | The mission version is stale.                                                                                            |
| `409 mission.node.terminal`        | The node is `Completed` or `Discarded`.                                                                                  |
| `409 mission.node.state_conflict`  | `expected_state` or `expected_attempt` (`blocked_attempt` for `unblock`) differs; `details` holds `state` and `attempt`. |
| `409 mission.node.control_refused` | The control does not admit the current state; `details.state` holds it.                                                  |
| `400 mission.node.content_invalid` | `reason` is blank or exceeds the text limit.                                                                             |

Command-specific failures:

| HTTP status / code                       | Operation             | Meaning                                                                                                                                                             |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `409 mission.node.not_ready`             | `ready`, `resume`     | Readiness fails, or for `resume` with `Waiting` a dependency is unsatisfied. `details` holds `objectives_not_terminal`, `unresolved_actions` and `unsatisfied_ids`. |
| `409 mission.node.action_unresolved`     | `override`, `discard` | The open attempt has unresolved requests; `details.requirement_keys` lists them.                                                                                    |
| `400 mission.evidence.binding_mismatch`  | `override`            | `landed_commit` does not name a repository binding that the objective pins.                                                                                         |
| `409 mission.revision.conflict`          | `unblock`             | `expected_revision` is stale; `details.current` holds the current revision.                                                                                         |
| `400 mission.node.content_invalid`       | `unblock`             | The change content is invalid, or `tasks` does not match the current task set.                                                                                      |
| `400 mission.node.bindings_invalid`      | `unblock`             | A change binding does not resolve or breaks the binding rule.                                                                                                       |
| `409 mission.node.filename_conflict`     | `unblock`             | A task file name is in use by another current node.                                                                                                                 |
| `400 mission.node.control_task`          | `check`               | The node is a task.                                                                                                                                                 |
| `409 mission.node.no_unresolved_request` | `check`               | The open attempt has no unresolved request.                                                                                                                         |
| `409 mission.node.retired`               | `priority set`        | The node is retired.                                                                                                                                                |
| `400 mission.node.priority_task`         | `priority set`        | The node is a task.                                                                                                                                                 |
| `409 mission.node.terminal`              | `priority set`        | The node is `Completed` or `Discarded`.                                                                                                                             |
| `409 mission.node.claim_live`            | `priority set`        | The node has a live claim; `details` holds `node_id` and `execution_id`.                                                                                            |

`node check` checks the mission version again before it records each result. A stale version then fails the call with `409 mission.version.conflict`, and the results that committed before stay committed. The text limit is the server configuration value `mission.text_max_bytes`, 32768 UTF-8 bytes by default.

The CLI exits `1` on every failure and writes `<code>: <message>` to stderr. A declared remote failure prints `<code>: request failed (HTTP <status>); idempotency key <key>.`

| CLI code                                     | Meaning                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli.mission.node.<command>.invalid_node_id` | `<node-id>` is not a `node_<ulid>` value.                                                                                                                |
| `cli.mission.node.override.invalid_result`   | `--result` is not `success`.                                                                                                                             |
| `cli.mission.node.<command>.token_required`  | No nonblank token resolves.                                                                                                                              |
| `cli.mission.node.<command>.indeterminate`   | A transport failure, a timeout or a malformed answer. Retry with the printed key.                                                                        |
| `cli.file.*`                                 | `--file` is absent, not a regular file, `-`, not UTF-8, not JSON, has a repeated key, is not an object, or fails the schema (`cli.file.schema_invalid`). |
| `cli.idempotency_key.invalid`                | `--idempotency-key` is not a canonical ULID.                                                                                                             |

`<command>` is `check`, `pause`, `resume`, `block`, `unblock`, `ready`, `override`, `discard` or `priority.set`.

## API shape

All operations use `POST`, access `human` (human bearer JWT), a 30-second timeout, and are mutations. The path parameter `node_id` is a `node_<ulid>`. No operation has query parameters.

| CLI command         | Path                                  | Operation ID                | Request body                                |
| ------------------- | ------------------------------------- | --------------------------- | ------------------------------------------- |
| `node check`        | `/api/mission/node/:node_id/check`    | `mission.node.check`        | `{ expected_mission_version }`              |
| `node pause`        | `/api/mission/node/:node_id/pause`    | `mission.node.pause`        | Human act                                   |
| `node resume`       | `/api/mission/node/:node_id/resume`   | `mission.node.resume`       | Human act plus `target`                     |
| `node block`        | `/api/mission/node/:node_id/block`    | `mission.node.block`        | Human act                                   |
| `node unblock`      | `/api/mission/node/:node_id/unblock`  | `mission.node.unblock`      | Unblock body                                |
| `node ready`        | `/api/mission/node/:node_id/ready`    | `mission.node.ready`        | Human act                                   |
| `node override`     | `/api/mission/node/:node_id/override` | `mission.node.override`     | Human act plus `result` and `landed_commit` |
| `node discard`      | `/api/mission/node/:node_id/discard`  | `mission.node.discard`      | Human act                                   |
| `node priority set` | `/api/mission/node/:node_id/priority` | `mission.node.priority.set` | `{ value, expected_mission_version }`       |

| Body field                 | Type                     | Required             | Purpose                                                                                            |
| -------------------------- | ------------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| `reason`                   | nonblank string          | Human act            | Reason recorded on the assessment, or the reason of the act.                                       |
| `expected_mission_version` | positive integer         | All                  | Current mission version.                                                                           |
| `expected_state`           | state name               | Human act            | Current state of the node.                                                                         |
| `expected_attempt`         | integer `>= 0`           | Human act            | Current attempt number.                                                                            |
| `target`                   | `Available` or `Waiting` | `resume`             | Resume target when no external action decides the state.                                           |
| `result`                   | `success`                | `override`           | Asserted result; the only value.                                                                   |
| `landed_commit`            | object                   | `override`, optional | `{ "kind": "repository", "binding_id": "binding_<ulid>", "commit": "<40 or 64 lower-case hex>" }`. |
| `blocked_attempt`          | integer `>= 0`           | `unblock`            | Current attempt number of the blocked node.                                                        |
| `expected_revision`        | positive integer         | `unblock`            | Current revision of the node.                                                                      |
| `change`                   | object                   | `unblock`, optional  | `{ content, tasks?, reason }`; `tasks` holds `{ id, filename, content }`.                          |
| `value`                    | signed safe integer      | `priority set`       | New priority.                                                                                      |

The human act fields are `reason`, `expected_mission_version`, `expected_state` and `expected_attempt`. The content object has `name`, `requirement`, `criterion`, `verifications` and `bindings` (binding IDs). Bodies accept no unknown field.

| Header            | Required | Purpose                                              |
| ----------------- | -------- | ---------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <human-jwt>`.                                |
| `Content-Type`    | Yes      | `application/json`.                                  |
| `Idempotency-Key` | Yes      | Canonical ULID; retain it to retry the same control. |

```sh
curl -i -X POST http://127.0.0.1:31415/api/mission/node/node_01M4C5J3SAMS4Z4KZD8DQ9GFTB/pause \
  -H 'Authorization: Bearer <human-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 01M4C5J3SBXJ52XQ9FSFRTK4PR' \
  -d '{"reason":"Review the plan","expected_mission_version":8,"expected_state":"Executing","expected_attempt":1}'
```

The Gateway keeps the answer of a mutation for its idempotency key in process memory for `idempotency_ttl` seconds, 86400 by default. A retry with the same key, human account and request replays that answer. This rule also applies to a failure. The controls carry no other request identifier. After a lost answer and an expired key, a retry answers a version or state conflict; read the node again.

## CLI shape

```text
kanthord mission node check <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node pause <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node resume <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node block <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node unblock <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node ready <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node override <node-id> --result success --file <path> [--idempotency-key <ulid>]
kanthord mission node discard <node-id> --file <path> [--idempotency-key <ulid>]
kanthord mission node priority set <node-id> --file <path> [--idempotency-key <ulid>]
```

Every command also accepts `--token <jwt>` and `--endpoint <url>`.

```sh
kanthord mission node pause node_01M4C5J3SAMS4Z4KZD8DQ9GFTB --file pause.json
kanthord mission node override node_01M4C5J3SAMS4Z4KZD8DQ9GFTB --result success --file override.json \
  --idempotency-key 01M4C5J3SBXJ52XQ9FSFRTK4PR
```

| Positional argument | Purpose                 |
| ------------------- | ----------------------- |
| `<node-id>`         | Required `node_<ulid>`. |

| Option                     | Default / resolution                                                        | Purpose                                               |
| -------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `--file <path>`            | Required; no default                                                        | JSON request body file.                               |
| `--result <result>`        | `override` only; required; no default                                       | Must be `success`. The CLI sets `result` in the body. |
| `--idempotency-key <ulid>` | A generated canonical ULID                                                  | Sets `Idempotency-Key`; supply the same key to retry. |
| `--token <jwt>`            | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT sent as the bearer credential.              |
| `--endpoint <url>`         | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                      |

The `--file` of each command holds the complete request body, except for `override`. The `override` file holds no `result` field, and a `result` field fails the schema.

The CLI validates the ID, the token, the key and the file before it sends a request. Each option is accepted once. See [client configuration](../README.md#client-configuration). The HTTP client has a 31-second deadline.
