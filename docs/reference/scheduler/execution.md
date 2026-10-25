# Inspect and release executions

[Reference index](../README.md)

## Function description

An execution records one claim of one node by one worker instance. A [work pull](work.md) creates it. These operations read executions and end a running execution.

- `execution get` reads one execution, live or ended. Any human identity can read any execution.
- `execution list` returns one page of the executions of a project, live and ended, newest `execution_id` first. A `node_id` filter limits the page to one node. An `attempt` filter limits it further to one attempt of that node and requires `node_id`. A filter that matches nothing returns an empty page.
- `execution release` ends a running execution of the caller and routes the node through the Mission Service.

Each `execution list` call reads one page. The CLI does not follow `next_cursor`.

`execution release` accepts only an execution that is live and that belongs to the runtime identity of the caller. The gateway proves this before the idempotency check and before the handler. The release transaction checks it again. The Mission Service then applies the release rule of the node state:

| Node state   | `further_work` | Requirement                                                                                                                                                                                                               | Node state after release |
| ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `Executing`  | `false`        | A published evidence of the execution: for an `implement` node, a `repository` asset of the repository binding of the pinned revision; for an `examine` node, one `produced` asset. Otherwise `obligation` is `evidence`. | `Waiting`                |
| `Executing`  | `true`         | None.                                                                                                                                                                                                                     | `Available`              |
| `Evaluating` | Either value   | A current successful assessment; otherwise `assessment`. No eligible action without a request; otherwise `request`.                                                                                                       | `External.Requested`     |

The release body can carry a `stop`, which tells why the execution ended early. A `stop` requires `further_work: true`. A `stop` with a reason other than `budget_end` counts as a failure toward `mission.consecutive_failure_limit`, except a `provider_failed` stop with `rate_limited`, `quota_exhausted` or `unavailable`. Such a stop neither counts nor ends the count. A lost claim also counts as a failure. An execution that ends before `expired_at` with no stop or with the stop `budget_end` resets the failure count: a release with no stop, a `budget_end` release and a revoked claim. A `budget_end` stop counts toward `mission.further_work_limit`. Any other end of an execution resets that count: a release with no stop, a release with any other stop, a revoked claim and a lost claim. A revoked claim, for example after a human pause, ends the execution with no stop and is no failure. [ERD 2](../erd/02-execution.md) holds the exact count rules.

A `stop` can also carry `detail`, the cause text or the JSON facts of the stop. A native worker sets it from one of these sources:

- the error text of a provider error reply, with the reason `provider_failed`;
- `<error name>: <message>` of an error with no code that a prompt to the agent session or another step of the execution throws, with the reason `operation_failed`;
- the text of a git state violation after an agent turn, with the reason `operation_failed` and a code `worker.turn.*`;
- the JSON result of a verification that failed twice because of the infrastructure, with the reason `operation_failed` and the code `worker.verification.infrastructure_failed`;
- the JSON facts of the progress rule, with the reason `no_progress`. The JSON holds no text, and the worker does not cut it.

Any other error with a code, for example `repository.node_branch.missing`, gives the code and no `detail`. A `budget_end` stop and the code `worker.merge.markers_left` carry no `detail`. In a cause text, the worker removes the secrets of the credential, bearer values, JWTs and tokens of 32 or more characters, and cuts the text to 300 characters. A file path stays visible when it holds at least three `/`, no segment of 32 or more characters, and no `+` or `=`. `detail` is optional, a nonempty string of at most 2048 characters, and changes no count. The server stores the whole `stop`, `detail` included, as JSON in the `stop` column of the execution row, so `detail` needs no new column.

The JSON facts of a `no_progress` stop hold `rule`, `count`, `limit` and `verification`. `rule` is `unchanged_revision` or `verdict_rule_unmet`. `count` is the count of unchanged turns at the stop, and `limit` is the count that stops the execution. `verification` is `null`, or the last verification of any unit of the execution. It holds `passed`, `ran` (the count of commands that ran) and `exit_code` (the exit code of the last command that ran) and `timed_out`. `exit_code` is `null` when the command has no exit code or no command ran. `timed_out` is `true` when the last command that ran reached its command limit, and `false` otherwise.

A `stop` also carries `cause`, the cause of the failure that the worker computes. `cause` is `{ category, assigner, subcategory?, suspects? }`.
`category` is `prompt`, `plan`, `worker_action`, `llm_provider`, `model`, `environment`, `infrastructure`, `human` or `unattributed`. `assigner` is `rule` or `reviewer`.
`subcategory` is a value of the set of its category:

| `category`       | `subcategory`                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`         | `context_missing`, `instruction_conflict`, `rule_absent`                                                                                                                    |
| `plan`           | `criterion_unstated`, `dependency`, `verification_context`, `verification_insufficient`, `decomposition`, `oversized`                                                       |
| `worker_action`  | `gate_commit`, `merge_base`, `release_gate`, `review_flow`, `step_failed`                                                                                                   |
| `llm_provider`   | `rate_limited`, `quota_exhausted`, `unavailable`                                                                                                                            |
| `model`          | `work_defect`, `standard_violation`, `verification_failed`, `no_progress`, `reply_invalid`, `protocol_violation`, `output_truncated`, `budget_exhausted`, `judgement_wrong` |
| `environment`    | `setup_failed`, `command_absent`, `flaky_verification`, `verification_hang`, `repository_hook`                                                                              |
| `infrastructure` | `verification_killed`, `network`, `execution_lost`                                                                                                                          |
| `human`          | `intervention`, `configuration`                                                                                                                                             |

`suspects` is a list of categories, the best guess first. It stands only with the category `unattributed`, and `subcategory` stands with every other category.
The Scheduler writes `cause` on the root span end as `kanthord.cause.*`. The execution record stores no `cause`, so `stop` in the record holds `reason`, `code` and `detail` only.

| `stop.reason`                                                                                     | `stop.code`                                                                     |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `budget_end`                                                                                      | `turns` or `wall_time`                                                          |
| `provider_failed`                                                                                 | `rate_limited`, `quota_exhausted`, `unauthorized`, `bad_request`, `unavailable` |
| `no_progress`                                                                                     | `null`                                                                          |
| `operation_failed`, `judgement_invalid`, `report_absent`, `action_unsettled`, `assessment_absent` | A nonempty string or `null`                                                     |

A native steps execution sends `operation_failed` with these codes of its own:

| `stop.code`                                 | Cause                                                                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository.node_branch.missing`            | The node branch is missing at the repository after a recorded push.                                                                                            |
| `worker.turn.branch_changed`                | An agent turn left a checkout off the node branch.                                                                                                             |
| `worker.turn.history_rewritten`             | An agent turn moved the head to a commit that does not contain the head before the turn.                                                                       |
| `worker.turn.git_in_progress`               | An agent turn left a merge, `am`, cherry-pick or revert in progress on the node branch. An open rebase detaches `HEAD` and gives `worker.turn.branch_changed`. |
| `worker.turn.merge_missing`                 | A conflict turn ended with no open merge of the base.                                                                                                          |
| `worker.merge.markers_left`                 | A conflicted file still holds a conflict marker after the conflict turn.                                                                                       |
| `worker.verification.infrastructure_failed` | A verification failed because of the infrastructure on its run and on its rerun.                                                                               |

A native evaluation execution also sends `worker.verification.infrastructure_failed`. [How the coder@1 worker works](../../explanation/coder-worker.md#how-the-execution-ends) explains each end of a steps execution.

A successful release sets `ended_at`, so `claim_state` becomes `finished`, and frees the live count of the binding. It wakes the pulls that wait in the project. A refused release changes no execution, node or job.

A release ends an execution at most once. The gateway stores no receipt that it can replay after the end. A retry after a committed release, with the same key or a new key, fails the execution proof with `403`. To confirm the result after a lost answer, read the execution with [`claim get`](claim.md) or `execution get`; `claim_state` is `finished`.

## Expected response

### `execution get`

The API returns HTTP `200` with one `ExecutionRecord`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "project_id": "project_01JZ8PZ0A1B2C3D4E5F6G7H8J9",
  "node_id": "node_01JZ8Q0K4M6N8P0R2S4T6V8W0X",
  "claimant": {
    "worker_binding_id": "binding_01JZ8PZ5N6P7Q8R9S0T1V2W3X4",
    "resource_identity": "<resource-identity>",
    "runtime_identity": "worker_registration_01JZ8R0Y1Z2A3B4C5D6E7F8G9H",
    "client_id": "client_identity_01JZ8QZW2X3Y4Z5A6B7C8D9E0F",
    "name": "Worker display name"
  },
  "attempt": 1,
  "pinned_revision": 3,
  "node_branch": "kanthord/node_01JZ8Q0K4M6N8P0R2S4T6V8W0X",
  "credentials": [],
  "agent_selections": [
    {
      "agent_name": "swe@1",
      "position": 0,
      "level": "enablement",
      "agent_provider": "main",
      "provider": "anthropic",
      "credential": "<credential-name>",
      "model_identifier": "claude-sonnet-4-5",
      "reasoning_effort": "high"
    }
  ],
  "claim_state": "finished",
  "expired_at": 1791449400000,
  "created_at": 1791447600000,
  "ended_at": 1791448200000,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "root_span_id": "00f067aa0ba902b7"
}
```

### `execution list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0`.

```json
{
  "items": [
    { "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M", "...": "..." }
  ],
  "next_cursor": null
}
```

| Property      | Type                       | Purpose                                                                                    |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `items`       | array of `ExecutionRecord` | At most `limit` records, `execution_id` descending. An empty array is a successful result. |
| `next_cursor` | string or `null`           | Opaque cursor for the next page. `null` ends the traversal.                                |

### `execution release`

The API returns HTTP `200`:

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "ended_at": 1791448200000
}
```

The CLI adds the retry key, writes one JSON line to stdout, and exits `0` (shown formatted here).

```json
{
  "execution_id": "execution_01JZ8R2B3C4D5E6F7G8H9J0K1M",
  "ended_at": 1791448200000,
  "idempotency_key": "idempotency_key_01M34JC4BJ66JHP41M4MYY6PST"
}
```

| Property          | Type                            | Surface     | Purpose                    |
| ----------------- | ------------------------------- | ----------- | -------------------------- |
| `execution_id`    | `execution_<ulid>`              | API and CLI | The released execution.    |
| `ended_at`        | timestamp                       | API and CLI | Time of the release.       |
| `idempotency_key` | `idempotency_key_<ulid>` string | CLI only    | Key used for this request. |

### `ExecutionRecord`

Every timestamp is a safe integer of Unix epoch milliseconds in UTC.

| Property                     | Type                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_id`               | `execution_<ulid>`                                 | Identity of the execution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `project_id`                 | `project_<ulid>`                                   | Project of the claimed node.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `node_id`                    | `node_<ulid>`                                      | Claimed Mission node.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `claimant.worker_binding_id` | `binding_<ulid>`                                   | Worker binding of the claimant at the claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `claimant.resource_identity` | nonempty string                                    | Resource identity of the claimant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `claimant.runtime_identity`  | `worker_registration_<ulid>`                       | Runtime identity of the claimant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `claimant.client_id`         | `client_identity_<ulid>`, optional                 | Client identity of the registration. Absent when the runtime identity has no registered client.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `claimant.name`              | string of 1 to 64 characters, optional             | Display name of the registration. Present together with `client_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `attempt`                    | positive safe integer                              | Attempt of the node that this execution serves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pinned_revision`            | positive safe integer                              | Node revision that the attempt pins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `node_branch`                | string                                             | Node branch of the attempt, which the server derives from the attempts of the node: `kanthord/<node id>`, or `kanthord/<node id>-a<k>` after an unblock with `start_point: "base_branch"` at attempt k. The execution reads and pushes only this branch.                                                                                                                                                                                                                                                                                                |
| `credentials`                | array of `credential_<ulid>`                       | Credentials that the execution pins; `[]` at the claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `agent_selections`           | array of objects                                   | Agent selections of the execution, one for each native agent of the worker. The claim health check refuses a claim when any agent configuration is invalid, so every native agent of a claimed execution holds a pin. The claim pins only the chain position and the enablement revision, and the server rebuilds each item from the pin. Each item holds `agent_name`, `position`, `level` (`enablement` or `binding`), `agent_provider`, `provider`, `credential`, `model_identifier` and `reasoning_effort`. `[]` for a worker with no native agent. |
| `claim_state`                | `running`, `lost` or `finished`                    | `running`: not ended and before `expired_at`. `finished`: ended before `expired_at`. `lost`: ended at or after `expired_at`, or not ended and `expired_at` has passed.                                                                                                                                                                                                                                                                                                                                                                                  |
| `expired_at`                 | timestamp                                          | Fixed deadline that the claim sets once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `created_at`                 | timestamp                                          | Time of the claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `ended_at`                   | timestamp or `null`                                | Time of the end; `null` while the execution has not ended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `trace_id`                   | 32 lower-case hexadecimal characters, not all zero | Trace identity that the Scheduler mints at the claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `root_span_id`               | 16 lower-case hexadecimal characters, not all zero | Root span identity that the Scheduler mints at the claim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `stop`                       | `{ reason, code, detail? }` or `null`              | Stop of the release; `null` while the execution runs and after a release with no stop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Identity formats follow the [identity reference](../identities.md).

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Commands      | Meaning                                                                                                                                                        |
| ----------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | All           | Missing, invalid or expired token. `get` and `list` reject a machine token; `release` rejects a human token or a machine token whose binding does not resolve. |
| `400 gateway.request.validation_failed`         | All           | Invalid path parameter, query field or body, a `stop` with no valid `cause` included; also `attempt` without `node_id`, or `limit` outside 1 to 1000.          |
| `400 system.pagination.cursor_invalid`          | `list`        | The `cursor` value is not a cursor that this operation issued.                                                                                                 |
| `400 gateway.request.unexpected_body`           | `get`, `list` | The request carries a body.                                                                                                                                    |
| `404 scheduler.execution.not_found`             | `get`         | No execution has this identity.                                                                                                                                |
| `403 gateway.registration.required`             | `release`     | The machine identity holds no live worker registration.                                                                                                        |
| `415 gateway.request.unsupported_media_type`    | `release`     | The `Content-Type` is not `application/json`.                                                                                                                  |
| `400 gateway.request.invalid_json`              | `release`     | The body is not valid JSON, or an object repeats a member name.                                                                                                |
| `403 gateway.invocation.execution_proof_failed` | `release`     | The execution does not exist, has ended, has passed `expired_at`, or belongs to another runtime identity.                                                      |
| `400 gateway.idempotency.invalid_key`           | `release`     | Missing or malformed `Idempotency-Key`.                                                                                                                        |
| `409 gateway.idempotency.conflict`              | `release`     | The key is in use by a request that has not completed, or by a different request.                                                                              |
| `409 scheduler.execution.not_running`           | `release`     | The execution is no longer a running claim of the caller when the release transaction checks it.                                                               |
| `409 mission.release.obligation_unmet`          | `release`     | The release rule of the node fails. `details.obligation` is `evidence`, `assessment` or `request`.                                                             |
| `413 gateway.request.body_too_large`            | `release`     | The body exceeds 10 MiB.                                                                                                                                       |
| `504 gateway.invocation.timeout`                | All           | The operation did not complete in 30 seconds.                                                                                                                  |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                               | Commands  | Meaning                                                                                |
| ------------------------------------------------------ | --------- | -------------------------------------------------------------------------------------- |
| `cli.scheduler.execution.get.invalid_execution_id`     | `get`     | `<execution-id>` is not a canonical `execution_<ulid>` identity.                       |
| `cli.scheduler.execution.release.invalid_execution_id` | `release` | `<execution-id>` is not a canonical `execution_<ulid>` identity.                       |
| `cli.scheduler.execution.list.invalid_project_id`      | `list`    | `<project-id>` is not a canonical `project_<ulid>` identity.                           |
| `cli.scheduler.execution.list.invalid_node_id`         | `list`    | `--node` is not a canonical `node_<ulid>` identity.                                    |
| `cli.scheduler.execution.list.invalid_attempt`         | `list`    | `--attempt` is not a positive decimal integer.                                         |
| `cli.pagination.limit_invalid`                         | `list`    | `--limit` is not a positive decimal integer.                                           |
| `cli.pagination.limit_out_of_range`                    | `list`    | `--limit` is outside 1 to 1000.                                                        |
| `cli.scheduler.execution.get.token_required`           | `get`     | No nonblank token resolves.                                                            |
| `cli.scheduler.execution.list.token_required`          | `list`    | No nonblank token resolves.                                                            |
| `cli.scheduler.execution.release.token_required`       | `release` | No nonblank token resolves.                                                            |
| `cli.file.*`                                           | `release` | The `--file` value fails a file check; the codes are in [pull work](work.md#failures). |
| `cli.idempotency_key.invalid`                          | `release` | `--idempotency-key` is not an `idempotency_key_<ulid>` value.                          |
| `cli.option.duplicate`                                 | All       | An option occurs more than once.                                                       |

The CLI does not check `--attempt` without `--node`; the API rejects it with `400 gateway.request.validation_failed`.

A declared API failure makes the CLI exit `1`. The diagnostic starts with the error code of the API and holds the row `status`; for `release` it also holds the row `idempotency_key`. A transport failure, timeout or malformed response exits `1` with `cli.scheduler.execution.get.indeterminate`, `cli.scheduler.execution.list.indeterminate` or `cli.scheduler.execution.release.indeterminate`. For a read, run the command again. For a release, the diagnostic is `<code>: the result is unknown; read the execution before any retry`. Its row `command: kanthord scheduler execution get <execution-id>` names the command to run before any retry. A retry after a committed release fails the execution proof, so read the execution first.

## API shape

### `execution get`

| Item                  | Value                                            |
| --------------------- | ------------------------------------------------ |
| Method and path       | `GET /api/scheduler/execution/:execution_id`     |
| Operation ID          | `scheduler.execution.get`                        |
| Access                | `human` (human bearer JWT)                       |
| Timeout               | 30 seconds                                       |
| Mutation              | No                                               |
| Path/query parameters | `execution_id` (path, required); no query fields |
| Request body          | None                                             |

### `execution list`

| Item                  | Value                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method and path       | `GET /api/scheduler/project/:project_id/execution`                                                                                                                                         |
| Operation ID          | `scheduler.execution.list`                                                                                                                                                                 |
| Access                | `human` (human bearer JWT)                                                                                                                                                                 |
| Timeout               | 30 seconds                                                                                                                                                                                 |
| Mutation              | No                                                                                                                                                                                         |
| Path/query parameters | `project_id` (path, required); `node_id` (query, optional); `attempt` (query, positive integer, requires `node_id`); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |
| Request body          | None                                                                                                                                                                                       |

`execution get` and `execution list` use one header:

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i http://127.0.0.1:31415/api/scheduler/execution/execution_01JZ8R2B3C4D5E6F7G8H9J0K1M \
  -H 'Authorization: Bearer <human-jwt>'

curl -i 'http://127.0.0.1:31415/api/scheduler/project/project_01JZ8PZ0A1B2C3D4E5F6G7H8J9/execution?node_id=node_01JZ8Q0K4M6N8P0R2S4T6V8W0X&attempt=1' \
  -H 'Authorization: Bearer <human-jwt>'
```

### `execution release`

| Item                  | Value                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and path       | `POST /api/scheduler/execution/:execution_id/release`                                                                                                               |
| Operation ID          | `scheduler.execution.release`                                                                                                                                       |
| Access                | `client` (machine bearer JWT) with a live worker registration and a live execution of that registration                                                             |
| Timeout               | 30 seconds                                                                                                                                                          |
| Mutation              | Yes                                                                                                                                                                 |
| Path/query parameters | `execution_id` (path, required); no query fields                                                                                                                    |
| Request body          | Closed JSON object `{ "further_work": <boolean>, "stop": { "reason", "code", "detail"?, "cause" } \| null }`; `further_work` is required, `stop` defaults to `null` |

| Header            | Required | Purpose                                                      |
| ----------------- | -------- | ------------------------------------------------------------ |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the instance that holds the claim. |
| `Content-Type`    | Yes      | `application/json`.                                          |
| `Idempotency-Key` | Yes      | `idempotency_key_<ulid>` for the release request.            |

```sh
curl -i -X POST http://127.0.0.1:31415/api/scheduler/execution/execution_01JZ8R2B3C4D5E6F7G8H9J0K1M/release \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idempotency_key_01M34JC4BJ66JHP41M4MYY6PST' \
  -d '{"further_work":false}'
```

## CLI shape

### `execution get`

```text
kanthord scheduler execution get <execution-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler execution get execution_01JZ8R2B3C4D5E6F7G8H9J0K1M
```

| Positional argument | Purpose                              |
| ------------------- | ------------------------------------ |
| `<execution-id>`    | Required `execution_<ulid>` to read. |

### `execution list`

```text
kanthord scheduler execution list <project-id> [--node <node-id>] [--attempt <n>] [--limit <count>] [--cursor <opaque>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord scheduler execution list project_01JZ8PZ0A1B2C3D4E5F6G7H8J9 \
  --node node_01JZ8Q0K4M6N8P0R2S4T6V8W0X --attempt 1
```

| Positional argument | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `<project-id>`      | Required `project_<ulid>` of the executions. |

| Option              | Default / resolution | Purpose                                                           |
| ------------------- | -------------------- | ----------------------------------------------------------------- |
| `--node <node-id>`  | None; all nodes      | Sets the `node_id` filter.                                        |
| `--attempt <n>`     | None; all attempts   | Sets the `attempt` filter, a positive integer. Requires `--node`. |
| `--limit <count>`   | `100`                | Maximum records on the page, from 1 to 1000.                      |
| `--cursor <opaque>` | None; the first page | `next_cursor` value of the previous page.                         |

### `execution release`

```text
kanthord scheduler execution release <execution-id> --file <path> [--idempotency-key <key>] [--token <jwt>] [--endpoint <url>]
```

```sh
printf '{ "further_work": false }\n' > release.json
kanthord scheduler execution release execution_01JZ8R2B3C4D5E6F7G8H9J0K1M \
  --file release.json --token '<machine-jwt>'
```

| Positional argument | Purpose                                 |
| ------------------- | --------------------------------------- |
| `<execution-id>`    | Required `execution_<ulid>` to release. |

| Option                    | Default / resolution                 | Purpose                                                                       |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `--file <path>`           | Required; no default                 | JSON file that holds the request body. The file must be a regular UTF-8 file. |
| `--idempotency-key <key>` | A generated `idempotency_key_<ulid>` | Sets the `Idempotency-Key` header.                                            |

### Shared options

Every command on this page accepts these options:

| Option             | Default / resolution                                                        | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Bearer credential: a human JWT for `get` and `list`, a machine JWT for `release`. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                                                  |

`--token` and `--endpoint` belong to the `scheduler` group, and each leaf command accepts them. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.
