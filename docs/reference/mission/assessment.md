# Read and submit assessments

[Reference index](../README.md)

## Function description

An assessment records a conclusion about the criterion of a runnable node for one attempt. A runnable node is an initiative or an objective.

- `assessment list` returns one page of the assessments of a node. A human JWT is required.
- `assessment get` returns one assessment. A human JWT is required.
- `assessment submit` records an execution assessment for the claimed node. A machine JWT is required, and the execution must hold a live evaluation claim on that node.

An execution writes an assessment through `assessment submit`. A human control, such as an override, block or discard, writes a human assessment. A human assessment has no execution, tested input, currency or worker version.

Each read of an execution assessment computes its currency at read time. An assessment is current when three conditions hold:

1. Its context matches: the pinned revision, the named evidence and, for an initiative, the child outcomes are still current.
2. No later human assessment in the same attempt supersedes it.
3. It is the latest execution assessment in the attempt that meets conditions 1 and 2.

A submit can close the attempt. When the new assessment is current, two cases close it:

- The result is not `success`. The node moves to `Blocked`.
- The result is `success`, and the pinned revision has no required external action. The node moves to `Completed`.

A closure ends the live claim, closes the attempt and writes an outcome. The outcome names the landed-commit evidence of the attempt. A `success` result with required external actions writes no outcome. The attempt stays open for those actions. After each accepted submit, the server wakes the scheduler of the project.

The read operations change nothing. Each list call reads one page. The CLI does not follow `next_cursor`.

## Expected response

### `assessment list`

The API returns HTTP `200`. The CLI writes the same object as one JSON line to stdout and exits `0` (shown formatted here).

```json
{
  "items": [
    {
      "id": "assessment_01M4C5G6BPZCGBK0EFKVT5AXH2",
      "node_id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4",
      "execution_id": "execution_01M4C5G6BP0355Z52M6JCYZCSK",
      "attempt": 1,
      "node_revision": 3,
      "evidence_ids": ["evidence_01M4C5G6BN71J38HW3MFCKMAT6"],
      "child_outcome_ids": [],
      "child_node_ids": [],
      "result": "success",
      "rationale": "All verification commands passed on the tested commit.",
      "tested_input": {
        "kind": "repository",
        "binding_id": "binding_01M4C5G6BP5EWTVTTXFH1R25MC",
        "commit": "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
      },
      "actor": {
        "kind": "execution",
        "execution_id": "execution_01M4C5G6BP0355Z52M6JCYZCSK",
        "client_id": "client_identity_01M4C5G6BPC5C40S9NFE96N5FB",
        "name": "worker-a"
      },
      "created_at": 1791398400000,
      "currency": {
        "current": true,
        "context_matches": true,
        "authority_admits": true,
        "order_selected": true,
        "reasons": []
      },
      "worker_version": "reviewer"
    }
  ],
  "next_cursor": null
}
```

| Property      | Type                  | Purpose                                                     |
| ------------- | --------------------- | ----------------------------------------------------------- |
| `items`       | array of `Assessment` | At most `limit` assessments, in reverse identity order.     |
| `next_cursor` | string or `null`      | Opaque cursor for the next page. `null` ends the traversal. |

Without `attempt`, the list covers every attempt of the node.

### `assessment get`

The API returns HTTP `200` with one `Assessment`. The CLI writes it as one JSON line to stdout and exits `0`.

### `Assessment`

| Property            | Type                         | Purpose                                                                                         |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                | `assessment_<ulid>`          | Identity of the assessment.                                                                     |
| `node_id`           | `node_<ulid>`                | Assessed node.                                                                                  |
| `execution_id`      | `execution_<ulid>` or `null` | Execution that submitted the assessment; `null` for a human assessment.                         |
| `attempt`           | nonnegative safe integer     | Attempt of the assessment.                                                                      |
| `node_revision`     | positive safe integer        | Node revision that the assessment judges.                                                       |
| `evidence_ids`      | array of `evidence_<ulid>`   | Evidence that the assessment weighs. A delete of an evidence removes its identity here.         |
| `child_outcome_ids` | array of `outcome_<ulid>`    | Child objective outcomes that an initiative assessment weighs.                                  |
| `child_node_ids`    | array of `node_<ulid>`       | Nodes of those child outcomes, sorted.                                                          |
| `result`            | string                       | `success`, `criterion-not-met` or `undetermined`.                                               |
| `rationale`         | string                       | Reason for the result.                                                                          |
| `tested_input`      | `TestedInput` or `null`      | Input that the verification tested; `null` for a human assessment.                              |
| `actor`             | `Actor`                      | `execution` actor, or `human` actor for a human assessment. See [attempts](attempt.md#attempt). |
| `created_at`        | Unix milliseconds            | Time of the assessment.                                                                         |
| `currency`          | `Currency` or `null`         | Read-time currency; `null` for a human assessment.                                              |
| `worker_version`    | string or `null`             | Worker name of the execution; `null` for a human assessment.                                    |

`Currency` holds these properties:

| Property           | Type             | Purpose                                                                   |
| ------------------ | ---------------- | ------------------------------------------------------------------------- |
| `current`          | boolean          | `true` when the other three checks are all `true`.                        |
| `context_matches`  | boolean          | The pinned revision, evidence and child outcomes still match.             |
| `authority_admits` | boolean          | No later human assessment in the attempt supersedes this assessment.      |
| `order_selected`   | boolean          | This assessment is the latest admitted execution assessment.              |
| `reasons`          | array of strings | One fixed sentence for each failed check; empty when `current` is `true`. |

`TestedInput` is one `Address`, or a nonempty array of repository addresses. `Address` has one of three forms, selected by `kind`:

| `kind`       | Other properties                                                                   |
| ------------ | ---------------------------------------------------------------------------------- |
| `repository` | `binding_id` (`binding_<ulid>`) and `commit` (40 or 64 lower-case hex characters). |
| `produced`   | `sha256` (64 lower-case hex characters).                                           |
| `object`     | `location` (`s3://` URI), optional `version`, optional `sha256`.                   |

### `assessment submit`

The API returns HTTP `200`:

```json
{
  "assessment": {
    "id": "assessment_01M4C5G6BPZCGBK0EFKVT5AXH2",
    "result": "success"
  },
  "node": { "id": "node_01M4C5G6BNQQPFNM7M8W0GW1W4", "state": "Completed" },
  "outcome": {
    "id": "outcome_01M4C5G6BPV831HTV1HKEXK8MT",
    "closing_event": "assessment-passed"
  }
}
```

The example abbreviates each record.

| Property     | Type                                      | Purpose                                                                  |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------ |
| `assessment` | `Assessment`                              | The new assessment with its currency.                                    |
| `node`       | node record                               | The node after the submit, in the schema of `kanthord mission node get`. |
| `outcome`    | [`Outcome`](outcome.md#outcome) or `null` | The outcome that the submit wrote; `null` when the attempt stays open.   |

The CLI adds the retry key and writes one JSON line to stdout, then exits `0`:

| Property                        | Type                  | Surface     | Purpose                                                                       |
| ------------------------------- | --------------------- | ----------- | ----------------------------------------------------------------------------- |
| `assessment`, `node`, `outcome` | as above              | API and CLI | As above.                                                                     |
| `idempotency_key`               | canonical ULID string | CLI only    | Key used for this request; retain it with the same machine token for retries. |

Identity formats follow the [identity reference](../identities.md). Timestamps are integer Unix milliseconds in UTC.

### Failures

API failures use the shared [error envelope](../errors.md#api-failures).

| HTTP status / code                              | Commands      | Meaning                                                                                                                                                       |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 gateway.authentication.unauthorized`       | All           | Absent, invalid or expired token. A machine token on `list` or `get`, or a human token on `submit`.                                                           |
| `400 gateway.request.validation_failed`         | All           | Invalid path, query or body. On `submit`, details name `rationale`, `evidence_ids`, `child_outcome_ids`, `tested_input` or `result` when a submit rule fails. |
| `400 gateway.request.unexpected_body`           | `list`, `get` | The request carries a body.                                                                                                                                   |
| `400 system.pagination.cursor_invalid`          | `list`        | The `cursor` value is not a cursor that this operation issued.                                                                                                |
| `404 mission.node.not_found`                    | `list`        | The node does not exist.                                                                                                                                      |
| `400 mission.node.control_task`                 | `list`        | The node is a task.                                                                                                                                           |
| `404 mission.record.not_found`                  | `get`         | The assessment does not exist.                                                                                                                                |
| `403 gateway.registration.required`             | `submit`      | The machine identity holds no live worker registration.                                                                                                       |
| `403 gateway.invocation.execution_proof_failed` | `submit`      | `execution_id` is not a live claim of this registration.                                                                                                      |
| `415 gateway.request.unsupported_media_type`    | `submit`      | The body is not `application/json`.                                                                                                                           |
| `413 gateway.request.body_too_large`            | `submit`      | The body exceeds 10 MiB.                                                                                                                                      |
| `400 gateway.idempotency.invalid_key`           | `submit`      | Absent or malformed idempotency key.                                                                                                                          |
| `409 gateway.idempotency.conflict`              | `submit`      | Conflict on the reuse of an idempotency key.                                                                                                                  |
| `409 scheduler.execution.not_running`           | `submit`      | The claim of the execution is no longer live.                                                                                                                 |
| `409 mission.execution.context_mismatch`        | `submit`      | The route node, `execution_id`, `attempt` or `node_revision` differs from the claim. Details name the `field`.                                                |
| `409 mission.execution.claim_not_evaluation`    | `submit`      | The node is not in `Evaluating`.                                                                                                                              |
| `409 mission.assessment.evidence_unpublished`   | `submit`      | A named evidence holds an unpublished asset.                                                                                                                  |
| `409 mission.assessment.verification_failed`    | `submit`      | A `success` result does not name exactly one verification that covers and passes the required commands.                                                       |
| `400 mission.evidence.binding_mismatch`         | `submit`      | A repository address in `tested_input` names a binding that does not match the node. Details hold `binding_id`.                                               |
| `409 mission.node.action_unresolved`            | `submit`      | A `success` result that closes the attempt meets an unresolved external request. Details hold `requirement_keys`.                                             |
| `504 gateway.invocation.timeout`                | All           | The operation did not complete in 30 seconds.                                                                                                                 |

The CLI checks some input before it sends a request. Each local failure exits `1` and sends no request.

| CLI code                                                                                                                                                                 | Commands         | Meaning                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `cli.mission.assessment.list.invalid_node_id`                                                                                                                            | `list`           | `<node-id>` is not a canonical `node_<ulid>` identity.                                                            |
| `cli.mission.assessment.list.invalid_attempt`                                                                                                                            | `list`           | `--attempt` is not a nonnegative safe integer in canonical form.                                                  |
| `cli.mission.assessment.get.invalid_assessment_id`                                                                                                                       | `get`            | `<assessment-id>` is not a canonical `assessment_<ulid>` identity.                                                |
| `cli.mission.assessment.submit.invalid_node_id`                                                                                                                          | `submit`         | `<node-id>` is not a canonical `node_<ulid>` identity.                                                            |
| `cli.mission.assessment.list.token_required`, `cli.mission.assessment.get.token_required`, `cli.mission.assessment.submit.token_required`                                | Same command     | No nonblank token resolves.                                                                                       |
| `cli.idempotency_key.invalid`                                                                                                                                            | `submit`         | `--idempotency-key` is not a canonical ULID.                                                                      |
| `cli.file.invalid_path`, `cli.file.not_found`, `cli.file.not_regular`, `cli.file.encoding_invalid`, `cli.file.not_json`, `cli.file.duplicate_key`, `cli.file.not_object` | `submit`         | `--file` is `-`, absent, not a regular file, not UTF-8, not JSON, holds a duplicate key, or is not a JSON object. |
| `cli.file.schema_invalid`                                                                                                                                                | `submit`         | The file does not match the `AssessmentSubmit` schema.                                                            |
| `gateway.request.validation_failed`                                                                                                                                      | All              | The local copy of the operation schema rejects the input.                                                         |
| `cli.pagination.limit_invalid`                                                                                                                                           | `list`           | `--limit` is not a positive decimal integer.                                                                      |
| `cli.pagination.limit_out_of_range`                                                                                                                                      | `list`           | `--limit` is greater than 1000.                                                                                   |
| `cli.option.duplicate`                                                                                                                                                   | All with options | An option occurs more than once.                                                                                  |

A declared failure makes the CLI exit `1` and print `<code>: request failed (HTTP <status>).` to stderr. For `submit`, the CLI prints `<code>: request failed (HTTP <status>); idempotency key <key>.` instead. A transport failure, timeout or malformed response exits `1`:

- `list` and `get` report `cli.mission.assessment.list.indeterminate` or `cli.mission.assessment.get.indeterminate`. Run the command again.
- `submit` reports `cli.mission.assessment.submit.indeterminate` with the retry key. Reuse the same key and machine token. There is no automatic retry.

## API shape

### `assessment list`

| Item                  | Value                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method and path       | `GET /api/mission/node/:node_id/assessment`                                                                                                             |
| Operation ID          | `mission.assessment.list`                                                                                                                               |
| Access                | `human` (human bearer JWT)                                                                                                                              |
| Timeout               | 30 seconds                                                                                                                                              |
| Mutation              | No                                                                                                                                                      |
| Path/query parameters | `node_id` (path, required); `attempt` (query, optional nonnegative safe integer); `limit` (query, 1 to 1000, default `100`); `cursor` (query, optional) |
| Request body          | None                                                                                                                                                    |

### `assessment get`

| Item                  | Value                                             |
| --------------------- | ------------------------------------------------- |
| Method and path       | `GET /api/mission/assessment/:assessment_id`      |
| Operation ID          | `mission.assessment.get`                          |
| Access                | `human` (human bearer JWT)                        |
| Timeout               | 30 seconds                                        |
| Mutation              | No                                                |
| Path/query parameters | `assessment_id` (path, required); no query fields |
| Request body          | None                                              |

Both reads use one header:

| Header          | Required | Purpose               |
| --------------- | -------- | --------------------- |
| `Authorization` | Yes      | `Bearer <human-jwt>`. |

```sh
curl -i 'http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/assessment?attempt=1' \
  -H 'Authorization: Bearer <human-jwt>'

curl -i http://127.0.0.1:31415/api/mission/assessment/assessment_01M4C5G6BPZCGBK0EFKVT5AXH2 \
  -H 'Authorization: Bearer <human-jwt>'
```

To read the next page, send the `next_cursor` value as the `cursor` query parameter with the same `limit` and `attempt`.

### `assessment submit`

| Item                  | Value                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Method and path       | `POST /api/mission/node/:node_id/assessment`                                              |
| Operation ID          | `mission.assessment.submit`                                                               |
| Access                | `client` (machine bearer JWT) with a live registration and a live claim on `execution_id` |
| Timeout               | 30 seconds                                                                                |
| Mutation              | Yes                                                                                       |
| Path/query parameters | `node_id` (path, required); no query fields                                               |
| Request body          | `AssessmentSubmit` JSON object; unknown fields are rejected                               |

| Header            | Required | Purpose                                                               |
| ----------------- | -------- | --------------------------------------------------------------------- |
| `Authorization`   | Yes      | `Bearer <machine-jwt>` of the registered worker that holds the claim. |
| `Idempotency-Key` | Yes      | Canonical ULID; retain it for retries of that request.                |
| `Content-Type`    | Yes      | `application/json`.                                                   |

| Body field          | Type                                             | Rule                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execution_id`      | `execution_<ulid>`                               | Required. The live execution; the Gateway proves it against the caller registration.                                                                                                                                                                             |
| `attempt`           | positive safe integer                            | Required. Equal to the claimed attempt.                                                                                                                                                                                                                          |
| `node_revision`     | positive safe integer                            | Required. Equal to the pinned revision of the claim.                                                                                                                                                                                                             |
| `evidence_ids`      | array of unique `evidence_<ulid>`                | Required. Each evidence belongs to this node and attempt, with every asset published.                                                                                                                                                                            |
| `child_outcome_ids` | array of unique `outcome_<ulid>`                 | Required. Empty for an objective. For an initiative, exactly the current outcomes of its current child objectives.                                                                                                                                               |
| `result`            | `success`, `criterion-not-met` or `undetermined` | Required.                                                                                                                                                                                                                                                        |
| `rationale`         | nonblank string                                  | Required. At most `mission.text_max_bytes` UTF-8 bytes, 32768 by default.                                                                                                                                                                                        |
| `tested_input`      | `TestedInput`                                    | Required. An objective takes one address; a repository address names the repository binding of the pinned revision. An initiative with child repository bindings takes one repository address for each repository; otherwise it takes one nonrepository address. |

The required verification commands are the verifications of the pinned revision. For an objective, they also include the verifications of each task in that revision. A verification covers them when its results name exactly those commands. It passes when every exit code is `0`.

| `result`            | Verification rule                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `success`           | Exactly one named verification covers the required commands, and it passes. Its `tested_input` equals the body value.   |
| `undetermined`      | At least one named verification exists, and every named verification passes. Each `tested_input` equals the body value. |
| `criterion-not-met` | Each named verification has a `tested_input` equal to the body value.                                                   |

```sh
curl -i -X POST http://127.0.0.1:31415/api/mission/node/node_01M4C5G6BNQQPFNM7M8W0GW1W4/assessment \
  -H 'Authorization: Bearer <machine-jwt>' \
  -H 'Idempotency-Key: 01M4C5G6DGWEVZYSPETSQR65JH' \
  -H 'Content-Type: application/json' \
  -d '{"execution_id":"execution_01M4C5G6BP0355Z52M6JCYZCSK","attempt":1,"node_revision":3,"evidence_ids":["evidence_01M4C5G6BN71J38HW3MFCKMAT6"],"child_outcome_ids":[],"result":"success","rationale":"All verification commands passed on the tested commit.","tested_input":{"kind":"repository","binding_id":"binding_01M4C5G6BP5EWTVTTXFH1R25MC","commit":"4b825dc642cb6eb9a060e54bf8d69288fbee4904"}}'
```

The Gateway keeps idempotency records in process memory for `gateway.idempotency_ttl` seconds, 86400 by default. A repeat of the same key, caller and body replays the recorded answer, failures included.

## CLI shape

`--token` and `--endpoint` belong to the `mission` group, and each leaf command accepts them. Explicit options take precedence; see [client configuration](../README.md#client-configuration). The commands read no server configuration. The HTTP client has a 31-second deadline for these 30-second operations.

| Option             | Default / resolution                                                        | Purpose                                                   |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------- |
| `--token <jwt>`    | `KANTHORD_TOKEN` → client-file token; a nonblank resolved token is required | Human JWT for `list` and `get`; machine JWT for `submit`. |
| `--endpoint <url>` | `KANTHORD_ENDPOINT` → client-file endpoint → `http://127.0.0.1:31415`       | Server base URL.                                          |

### `assessment list`

```text
kanthord mission assessment list <node-id> [--attempt <attempt>] [--limit <count>] [--cursor <cursor>] [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission assessment list node_01M4C5G6BNQQPFNM7M8W0GW1W4 --attempt 1
```

| Positional argument | Purpose                                    |
| ------------------- | ------------------------------------------ |
| `<node-id>`         | Required `node_<ulid>` of a runnable node. |

| Option                | Default / resolution | Purpose                                              |
| --------------------- | -------------------- | ---------------------------------------------------- |
| `--attempt <attempt>` | None; every attempt  | Nonnegative attempt number that selects one attempt. |
| `--limit <count>`     | `100`                | Maximum assessments on the page, 1 to 1000.          |
| `--cursor <cursor>`   | None; the first page | `next_cursor` value of the previous page.            |

### `assessment get`

```text
kanthord mission assessment get <assessment-id> [--token <jwt>] [--endpoint <url>]
```

```sh
kanthord mission assessment get assessment_01M4C5G6BPZCGBK0EFKVT5AXH2
```

| Positional argument | Purpose                               |
| ------------------- | ------------------------------------- |
| `<assessment-id>`   | Required `assessment_<ulid>` to read. |

### `assessment submit`

```text
kanthord mission assessment submit <node-id> --file <path> [--idempotency-key <ulid>] [--token <jwt>] [--endpoint <url>]
```

```sh
KANTHORD_TOKEN='<machine-jwt>' kanthord mission assessment submit node_01M4C5G6BNQQPFNM7M8W0GW1W4 \
  --file assessment.json \
  --idempotency-key 01M4C5G6DGWEVZYSPETSQR65JH
```

| Positional argument | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `<node-id>`         | Required `node_<ulid>` of the claimed node. |

| Option                     | Default / resolution       | Purpose                                                                                        |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `--file <path>`            | Required                   | Regular UTF-8 file that holds the `AssessmentSubmit` JSON object. Stdin (`-`) is not accepted. |
| `--idempotency-key <ulid>` | A generated canonical ULID | Sets the `Idempotency-Key` header; supply the same key when you retry.                         |

The CLI sends the file content as the request body. The CLI help labels `--file` as "Node JSON file"; the file holds an `AssessmentSubmit` object.
