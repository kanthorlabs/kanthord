---
title: Scheduler Service Implementation
---

# Scheduler Service Implementation

This file holds the implementation rulings for the mechanisms that realize [scheduler-service.md](scheduler-service.md).
This file is not a design document, and `scheduler-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.

## The identities of the Scheduler Service

The identities follow the identity convention of [architecture.impl.md](architecture.impl.md#the-identity-and-the-time).

- An execution uses `execution_<ulid>`. The claim operation mints it.
- A job uses `job_<ulid>`. The public insert of the work queue mints it inside the transaction of the Mission Service that inserts the job, and the ULID carries the creation time that the [work queue](scheduler-service.md#topology-and-work-queue) requires.
- A claim takes no identity of its own: the execution record is the record of the claim, and it holds the fixed deadline.
- The trace identity and the root span identity of an execution are protocol-defined identities of the Tracking Service, and no entity identity of the Scheduler Service.

## Operation contracts

- Every Scheduler route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging), the [default 30 s timeout](gateway-service.impl.md#cancellation) and the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits) unless a row below says otherwise.
- `scheduler.work.pull` at `POST /api/scheduler/work/pull` is a `client` mutation of `wait` lifetime. Its route timeout is 120 s and its wait window is 90 s. Cancellation ends the wait and no accepted claim.
  - The handler runs the full claim in a [probe transaction](architecture.impl.md#the-operation-and-its-two-entry-adapters) at the start and after each wait. The probe and the commit that follows it use one `now` value.
  - A probe or a commit that reaches admission takes its own instance healthcheck.
  - The handler commits after a probe that finds a `running` execution, a new claim, a failed healthcheck or a loss settlement, and at the end of the wait window.
  - The commit runs the full claim again. After quiescence starts, the commit settles losses and claims nothing.
- `scheduler.execution.release` at `POST /api/scheduler/execution/:executionId/release` is a `client` mutation of `unary` lifetime.
- `scheduler.claim.get` at `GET /api/scheduler/claim/:executionId` is a `client` read of `unary` lifetime with no body.
- `scheduler.queue.list`, `scheduler.queue.peek`, `scheduler.execution.list` and `scheduler.execution.get` are `human` reads of `unary` lifetime with no body, at the routes that the [CLI page](../../engine/docs/cli/scheduler.md#command-inventory-and-proposed-operation-mapping) lists.
- `scheduler.execution.get` and `scheduler.claim.get` answer 404 `scheduler.execution.not_found` for an execution identity that no row holds.
- A field bound of a schema is declared with that schema, and the body limit bounds nothing at the field level.

Every timestamp composes the shared millisecond scalar, every identity composes its prefix schema, every object is closed, and `null` is valid only where a field says so.

- `Job` holds `jobId`, `projectId`, `nodeId` and `priority`.
  - `priority` is the signed safe integer that the job copies from the Mission Service.
- `ExecutionRecord` holds `executionId`, `projectId`, `nodeId`, `claimant`, `attempt`, `pinnedRevision`, `credentials`, `claimState`, `expiredAt`, `createdAt`, `endedAt`, `traceId` and `rootSpanId`.
  - `claimant` holds `workerBindingId`, `resourceIdentity` and `runtimeIdentity`, and for a registered instance also `clientId` as `client_identity_<ulid>` and `name` as the display name of 1 to 64 nonblank characters, which the Scheduler reads from the registration of `runtimeIdentity` through the Worker Service. Both are absent for an instance that the server hosts.
  - `workerBindingId` is the latest row of the group `(projectId, resourceIdentity)` at the claim. The claim reads it through the Project Service in its transaction, and every use of the execution reads the configuration of that row.
  - `attempt` and `pinnedRevision` are positive safe integers.
  - `credentials` is the list of the credential row identities that the execution pins, `[]` at the claim.
  - The Scheduler Service offers `pinCredential(tx, executionId, credentialId)` and `liveExecutionsPinning(tx, credentialId)` to custody through its `contract.ts`. The first appends one identity to a live execution, and the second reads the live execution rows alone.
  - `claimState` is `running | lost | finished`, derived under [Liveness](scheduler-service.md#liveness).
  - `expiredAt` is the fixed deadline, stored as `expired_at` under [Configuration](#configuration).
  - `createdAt` is the claim acceptance time, and `endedAt` is the end time or `null` before a terminal write.
    A null `endedAt` alone establishes no liveness.
  - `traceId` and `rootSpanId` hold the protocol-defined values of the Tracking Service: 32 and 16 lower-case hexadecimal characters under the [trace model](tracking-service.impl.md#trace-model). Before the tracer of the Tracking Service exists, the Scheduler mints both values at the claim through the `TraceIdentity` dependency that its `contract.ts` declares, and the composition root injects that stand-in.
- `WorkPull` is the input of `scheduler.work.pull`: `resourceIdentity` and `runtimeIdentity`. The resource identity equals the resource identity of the machine identity, and the runtime identity equals the live registration of that client identity. A mismatch of either field answers 403 `scheduler.work.claimant_mismatch`.
- The answer of `scheduler.work.pull` is `{ kind: "claimed", execution: ExecutionRecord }` or `{ kind: "no-work" }`, each with HTTP 200.
- `ExecutionRelease` is the input of `scheduler.execution.release`: `furtherWork` as a boolean.
  `false` states that the execution of the attempt requires no further work.
  The Mission Service reads `furtherWork` for routing in the release transaction, and nothing stores it.
  The answer is `{ executionId, endedAt }`.
- Every list answers the shared page of [architecture.impl.md](architecture.impl.md#pagination).
- `scheduler.execution.list` accepts the optional query field `nodeId`. With it, the list holds the executions of that node only. A `nodeId` that the project does not hold answers an empty page.
- `scheduler.execution.list` accepts the optional query field `attempt`, a positive integer, only with `nodeId`. `attempt` without `nodeId` answers HTTP 400 `gateway.request.validation_failed`. With both, the list holds the executions of that attempt only. An attempt that the node does not hold answers an empty page.
- Every mode of `scheduler.execution.list` orders by `executionId` descending under the shared pagination rule.

## Durable requests

- A work pull is idempotent by the runtime identity.
  Before admission, the claim transaction applies [loss settlement](#loss-settlement), then reads the `running` execution of the pulling runtime identity.
  When one exists, the pull answers `{ kind: "claimed", execution }` with the current row and selects nothing.
  The rule that an instance holds at most one outstanding pull or one live execution refuses no such pull.
  Two concurrent pulls of one runtime identity serialize in the claim transaction, and the second answers the execution of the first.
  After the execution ends, a pull selects new work.
  A worker restart recovers its live registration, and a server restart ends no registration.
  Neither moves the deadline of an execution.
- A release carries no request identifier and stores no release receipt.
  An execution releases at most once.
  A release retry after the end meets the refusal of the proof.
  After a lost release answer and a refused retry, the worker reads `claim get`, which shows `finished`.
- `scheduler.execution.release` requires a live execution, and the invocation chain proves it before the handler, as for every other execution operation.
  The handler repeats the full proof in its write transaction under [Liveness](scheduler-service.md#liveness).
  A failed transactional check answers 409 `scheduler.execution.not_running`.
  Only the winning terminal write routes the Mission Service.
- `scheduler.claim.get` requires no live execution, because it reports an ended execution.
  Its handler checks the claimant against the worker binding of the machine identity and the runtime identity of its live registration.
  A mismatch answers 403 `scheduler.execution.not_owner`.

## Configuration

The Scheduler Service owns the section `scheduler` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.

- `scheduler.releaseReserve` holds the reserve after the effective worker wall time, in seconds.
  It is a positive safe integer and defaults to `600`.
- The claim sets `expired_at = created_at + wallTimeMs + 1000 × scheduler.releaseReserve` once.
  It reads the effective `wallTimeMs` of the worker binding row that `worker_binding_id` pins.
  Nothing moves that deadline, including a resume of a worker registration.
  A later configuration change affects only later claims.

## Loss settlement

Every 30 s, the Scheduler settles every execution row whose `ended_at` is null and whose `expired_at` is reached or passed.
This write is the loss declaration.
It sets `ended_at` to the clock reading at the start of its transaction.
The loss declaration counts the lost rows of the attempt after its latest finished row and hands the count to the Mission Service.
The Mission Service consumes the loss in that transaction.
Below `mission.consecutiveLossLimit`, it moves `Executing` to `Available` and `Evaluating` to `Waiting`.
It inserts a job only when the node is claimable.
At the limit, it moves the node to `Paused`, and no job exists.
The attempt stays open.
The operations that [Liveness](scheduler-service.md#liveness) names apply this same settlement before their own precondition checks in the same transaction.

## Retention

- The Scheduler Service exposes no delete of an execution record, so under [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) it keeps every execution record, and no sweep deletes one.
- `execution list` and `execution get` therefore return every execution of the project, live and ended.
- The work queue holds current jobs only. The Mission Service inserts and removes a job with the claimable state of its node, so `queue list` and `queue peek` read a live view and no history.

## Tests

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that a claim exposes no identity of its own.
- A test parses every input and output of the Scheduler operations through the direct adapter and the HTTP adapter and rejects an unknown field, a `null` outside its permitted fields and a bare ULID.
- A test loses an accepted pull answer and repeats the pull from the same runtime identity, once with the same key and once with a new key, and asserts the same execution and no second execution or count.
- A test pulls from another runtime identity of the same binding while an execution is live and asserts that it never receives that execution.
- A test ends the execution, repeats the pull from the same runtime identity and asserts a fresh admission.
- Tests submit two concurrent releases with equal `furtherWork` values and with different values.
  They assert one winner, one 409 `scheduler.execution.not_running` from the transactional check, and one Mission routing.
- Tests race a release against the sweep, an assessment end and a human revocation.
  They assert one terminal write and one Mission routing.
  A release that passes the invocation-chain proof but loses the transaction check answers 409 `scheduler.execution.not_running`.
- A test admits an invocation before expiry and starts its write transaction exactly at `expired_at`.
  It asserts 409 `scheduler.execution.not_running` and the `lost` claim state.
  Another test starts the write transaction before expiry and commits after expiry.
  It asserts acceptance and, for a terminal write, `ended_at` equal to the start reading and `claimState` equal to `finished`.
- Tests meet an expired unsettled row through a claim of its node and a work pull of its instance.
  They assert loss settlement before admission and no return of the lost execution.
  A registration resume meets the same row and asserts settlement before its precondition check.
  A human act also checks its precondition against the settled state.
- Tests sweep expired steps and evaluation claims below and at `mission.consecutiveLossLimit`.
  They assert one loss increment, the specified node state and a job only when claimable.
- A test computes the deadline from a binding override of `wallTimeMs` and the configured reserve, including the default `600` seconds.
  A registration resume and later configuration changes leave that deadline unchanged; a later claim uses the changed configuration.
- A test revokes a claim before expiry and asserts `finished`, no loss increment and the transaction reading as `ended_at`.
- Tests cover all three derived claim states before, at and after the deadline, with and without `ended_at`.
- Tests assert an in-process abort for a hosted execution and an abort on the first refused call for every other execution.
- A test calls `claim get` from another worker binding or runtime identity and asserts 403 `scheduler.execution.not_owner`.
  Through both adapters, it calls the release of an ended claim and asserts the 403 of the execution proof before the handler.
  After a lost release answer and a refused retry, the owner reads `finished` through `claim get`.
  No stored release receipt exists.
- A test checks the shared error envelope, the timeout, the lifetime and the body limit of every Scheduler route.
- A test asserts that no sweep deletes an execution record, and that an ended execution stays readable through `execution get` after a restart.
- A test asserts that `queue list` returns no job of a node that left the claimable state.

## Execution CLI validation

The claim and execution CLI commands refuse invalid arguments locally with the following codes.
These declarations match the error table of `engine/docs/cli/scheduler.md`.

| HTTP  | Code                                                   | Condition                                                                     |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| local | `cli.scheduler.claim.get.invalid_execution_id`         | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
| local | `cli.scheduler.execution.get.invalid_execution_id`     | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
| local | `cli.scheduler.execution.release.invalid_execution_id` | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity. |
| local | `cli.scheduler.execution.list.invalid_project_id`      | The `<project-id>` argument is not a canonical `project_<ulid>` identity.     |
| local | `cli.scheduler.execution.list.invalid_node_id`         | The `--node` value is not a canonical `node_<ulid>` identity.                 |
| local | `cli.scheduler.execution.list.invalid_attempt`         | The `--attempt` value is not a positive safe integer.                         |
