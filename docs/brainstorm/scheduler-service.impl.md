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
- A work queue entry uses `work_queue_entry_<ulid>`. The public insert of the work queue mints it inside the transaction of the Mission Service that inserts the entry, and the ULID carries the creation time that the [work queue](scheduler-service.md#topology-and-work-queue) requires.
- An observation obligation uses `observation_obligation_<ulid>`. Delivery admission mints it.
- A claim takes no identity of its own: the execution record is the record of the claim, and it holds the lease.
- A lease takes no identity of its own: it is a group of fields of the execution record or of the observation obligation, and the loss declaration is one of those fields.
- A wait record takes no identity of its own: the work queue entry that it holds out keys it.
- The admission record of a delivery is keyed by the delivery identity that the Intake Service owns.
- The trace identity and the root span identity of an execution are protocol-defined identities of the Tracking Service, and no entity identity of the Scheduler Service.

## Operation contracts

- Every Scheduler route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging), the [default 30 s timeout](gateway-service.impl.md#cancellation) and the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits) unless a row below says otherwise.
- `scheduler.work.pull` at `POST /api/scheduler/work/pull` is a `client` mutation of `wait` lifetime. Its route timeout is 120 s and its wait window is 90 s. Cancellation ends the wait and no accepted claim.
- `scheduler.execution.renew-lease` at `POST /api/scheduler/execution/:executionId/renew-lease` and `scheduler.execution.release` at `POST /api/scheduler/execution/:executionId/release` are `client` mutations of `unary` lifetime.
- `scheduler.claim.get` at `GET /api/scheduler/claim/:executionId` is a `client` read of `unary` lifetime with no body.
- `scheduler.queue.list`, `scheduler.queue.peek`, `scheduler.execution.list`, `scheduler.execution.get`, `scheduler.observation-obligation.list` and `scheduler.observation-obligation.get` are `human` reads of `unary` lifetime with no body, at the routes that the [CLI page](../../engine/docs/cli/scheduler.md#command-inventory-and-proposed-operation-mapping) lists.
- Delivery admission is a `service` operation of `unary` lifetime with a 30 s timeout of its own. It has no route, so the body limit does not apply.
- A field bound of a schema is declared with that schema, and the body limit bounds nothing at the field level.

Every timestamp composes the shared millisecond scalar, every identity composes its prefix schema, every object is closed, and `null` is valid only where a field says so.

- `QueueEntry` holds `entryId`, `projectId`, `nodeId`, `claimKind`, `priority`, `heldOut` and `waitFor`.
  - `claimKind` is `steps` or `evaluation`, the two kinds of a [claim](scheduler-service.vocabulary.md#claim).
  - `priority` is the signed safe integer that the entry copies from the Mission Service.
  - `heldOut` is a boolean, and `waitFor` holds the `WaitFact` of the wait record or `null`.
- `ExecutionRecord` holds `executionId`, `projectId`, `nodeId`, `claimant`, `claimKind`, `attempt`, `pinnedRevision`, `claimState`, `lease`, `createdAt`, `endedAt`, `traceId` and `rootSpanId`.
  - `claimant` holds `workerBindingId` and `runtimeIdentity`, and for a registered instance also `clientId` as `client_identity_<ulid>` and `name` as the display name of 1 to 64 nonblank characters, copied at the claim. Both are absent for an instance that the server hosts.
  - `attempt` and `pinnedRevision` are positive safe integers.
  - The closed set of `claimState` remains **[blocked](HANDOFF.md#scheduler-service-and-delivery)** under the request and response schemas (claim state) question.
  - `lease` holds `expiresAt`, `renewedAt` as a timestamp or `null` before the first renewal, and `lossDeclaredAt` as a timestamp or `null` before a loss declaration.
  - `createdAt` is the claim acceptance time, and `endedAt` is the end time or `null` while the claim is live.
  - `traceId` and `rootSpanId` hold the protocol-defined values of the Tracking Service.
- `WorkPull` is the input of `scheduler.work.pull`: `workerBindingId`, `runtimeIdentity` and `requestId`. The binding equals the worker binding of the machine identity, and the runtime identity equals the live registration of that client identity.
- The answer of `scheduler.work.pull` is `{ kind: "claimed", execution: ExecutionRecord }` or `{ kind: "no-work" }`, each with HTTP 200.
- `ExecutionRelease` is the input of `scheduler.execution.release`: `furtherWork` as a boolean and optional `waitFor` as a `WaitFact`, permitted only with `furtherWork: true`. `false` states the execution-end fact of the attempt. The answer is `{ executionId, releasedAt }`.
- `WaitFact` is exactly one of two closed objects. `{ type: "external-observation", externalObjectId }` names the external object of the action that the awaited action follows. The server checks that the external object belongs to the node and to the open attempt of the execution, and it answers 400 with an issue list otherwise. An accepted observation that already establishes the end state satisfies the wait at once, as [scheduler-service.md](scheduler-service.md#claims-and-counts) requires, and it refuses nothing. The form of the child-set fact remains **[blocked](HANDOFF.md#scheduler-service-and-delivery)** under the request and response schemas (child-set wait fact) question.
- `LeaseRenewal` is the input of `scheduler.execution.renew-lease`: `requestId`. The answer is `{ executionId, lease }`.
- `ObservationObligation` holds `obligationId`, `projectId`, `externalObjectId`, `acceptedAt`, `lease` as the lease object or `null`, `completedAt` as a timestamp or `null`, and `observationId` as `observation_<ulid>` or `null` while no accepted observation exists.
- Every list answers the shared page of [architecture.impl.md](architecture.impl.md#pagination).

## Durable requests

- The table is `scheduler_request(project_id, request_id, scope_digest, payload_digest, result, created_at)`, with the primary key `(project_id, request_id)`.
- It holds the accepted work pulls only. A `no-work` answer writes no row, because a no-work result ends the request.
- `scope_digest` is the digest of the canonical JSON of the worker binding identity and the runtime identity of the claimant, and `payload_digest` is the digest of the validated input, under [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- `result` holds the `claimed` answer as accepted, so a replay returns the original result and never the current row of the execution.
- The claim operation writes the row in the transaction of the claim.
- Before admission, the claim operation reads the row of the request identifier. The same scope and the same digest return the stored result. Another scope answers 409 `scheduler.request.scope_mismatch` and transfers no execution. Another digest answers 409 `scheduler.request.payload_mismatch`.
- The request identifier is `request_<ulid>`. The CLI and the `worker` application generate one ULID for one logical invocation and use it for the `Idempotency-Key` header and for `requestId`. The server compares the two never, because the header serves the replay of the invocation chain and the body serves the durable replay.
- A renewal carries `requestId` in its body. The execution record holds `renewal_request_id`, `renewed_at` and `expires_at` of the latest accepted renewal. A repeat of the current identifier returns the current lease and extends nothing. A new identifier renews. An identifier that a later renewal superseded answers 409 `scheduler.execution.renewal_superseded`, because the holder already holds a later lease.
- A release carries no request identifier. An execution releases at most once. The execution record holds `released_at`, `further_work` and the wait fact of its release. A repeat with an equal payload returns the accepted `{ executionId, releasedAt }`. A repeat with another payload answers 409 `scheduler.execution.release_conflict`.
- `scheduler.execution.renew-lease` and `scheduler.execution.release` require a live execution, and the invocation chain proves it before the handler, as for every other execution operation. `scheduler.claim.get` requires none, because it reports an ended execution; its handler checks that the claimant of the record names the worker binding of the machine identity and the runtime identity of its live registration, and it answers 403 `scheduler.execution.not_owner` otherwise. A holder whose release answer was lost reads `claim get` after a refused retry. No handler repeats the proof.
- No sweep deletes a request row. The row shares the retention of the execution record.

## Retention

- The Scheduler Service deletes no execution record, because the Mission Service and the Tracking Service reference the execution identity and [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules that an owner deletes no record that a peer can reference. No sweep deletes one, and the durable request row of its pull shares that rule.
- `execution list` and `execution get` therefore return every execution of the project, live and ended.
- The work queue holds current entries only. The Mission Service inserts and removes an entry with the claimable state of its node, so `queue list` and `queue peek` read a live view and no history.
- The retention of a completed observation obligation remains **[blocked](HANDOFF.md#scheduler-service-and-delivery)**.

## Tests

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that a claim, a lease and a wait record expose no identity of their own.
- A test parses every input and output of the Scheduler operations through the direct adapter and the HTTP adapter and rejects an unknown field, a `null` outside its permitted fields and a bare ULID.
- A test releases with a wait fact whose observation already holds and asserts an accepted release and a satisfied wait.
- A test repeats an accepted pull with the same identifier, scope and digest after a restart and asserts the original `claimed` result and no second execution or count.
- A test repeats the identifier from another runtime identity and asserts 409 `scheduler.request.scope_mismatch` and no transfer.
- A test repeats the identifier with another payload and asserts 409 `scheduler.request.payload_mismatch`.
- A test repeats a `no-work` identifier and asserts a fresh admission.
- A test repeats the current renewal identifier and asserts an unchanged expiry, repeats a superseded one and asserts 409, and renews an ended claim and asserts a refusal.
- A handler test repeats a release with an equal payload and asserts the accepted receipt, and with another payload asserts 409 `scheduler.execution.release_conflict`. This test grants no adapter bypass of the live-execution proof.
- A test calls `claim get` from another worker binding or runtime identity and asserts 403 `scheduler.execution.not_owner`. Through both adapters, it calls the renewal and the release of an ended claim and asserts the 403 of the execution proof before the handler. After a refused release retry, the owner reads the ended claim through `claim get`.
- A test checks the shared error envelope, the timeout, the lifetime and the body limit of every Scheduler route, and the 404 of delivery admission through the HTTP adapter.
- A test asserts that no sweep deletes an execution record or its request row, and that an ended execution stays readable through `execution get` after a restart.
- A test asserts that `queue list` returns no entry of a node that left the claimable state.
