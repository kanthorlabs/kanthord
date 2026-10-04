---
title: Intake Service Implementation
---

# Intake Service Implementation

This file holds the implementation rulings for the mechanisms that realize [intake-service.md](intake-service.md).
This file is not a design document, and `intake-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
This sibling holds the inbound store, the event store, the acquisition, the handoff, the outbound operation, the outbound record, the CLI transport, the check and the resource healthcheck mechanisms.

## The service identity

- The composition root mints the service identity of the Intake Service, which [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules. Every acquisition and the dispatcher call a peer through the direct adapter with that identity in `ClientOptions.identity`.

## The credential release of an inbound

- Each remote call of an inbound takes one single-use operation grant from the [protected facility](custody.impl.md#the-protected-facility) under the service identity of the Intake Service.
- The one inbound operation is `poll`.
- The facility checks that the requester is the Intake service identity and that the operation is `poll`. It needs no Project decision, because the human configuration of the inbound authorizes the release.
- The Intake Service supplies the inbound facts from its own row: the inbound identity, the credential name, the platform and the resource. At a create, the facts come from the validated input before the insert.
- Custody resolves the newest live revision of the credential name, checks the platform suitability and releases the material under [custody.impl.md](custody.impl.md#the-release-of-a-secret).
- The handler builds its platform client for one call, caches no client and no token, and drops the material in `finally`.

## The inbound store

- `intake_inbound` of [ERD 3](../reference/erd/03-integration.md) holds the inbounds. `id` is `inbound_` and a ULID.
- `configuration` is JSON text. The Intake Service validates it per `(kind, platform)` with a `zod` schema in code before the write. It holds `resource` and the options of the kind and the platform. Every property name is snake_case.
- `checkpoint` is JSON text whose shape the platform implementation validates.
- The table holds no unique index other than its key.
- The create validates the input, then performs the remote validation of its kind: one request for a poll, nothing for a webhook.
- The insert transaction checks that the credential name has a live revision and that its platform suits the inbound. A credential archive calls `inboundsNaming(tx, credentialName)` in its own transaction, and the collaboration answers every inbound that names the credential. SQLite runs one write transaction at a time, so a create and an archive never interleave.
- A delete refuses with 409 `intake.inbound.events_pending` when a pending event exists. Otherwise one transaction deletes the events of the inbound and deletes the row. A delete calls no platform.
- A create or a delete answers its platform refusal and changes no row. Each failure writes a span of the Tracking Service with its reason.

## The webhook acquisition

- The address of a webhook inbound is `/hooks/<inbound id>` inside the path group that [gateway-service.impl.md](gateway-service.impl.md#ingress) reserves.
- A human sets the address under the public origin of the ingress, the verification secret and the events at the platform. kanthord calls no platform for a webhook inbound.

### The verification secret

- The Intake Service derives its keys with `crypto.hkdfSync`, SHA-256 and an empty salt from `masterKey`, which [architecture.impl.md](architecture.impl.md) holds.
- `HKDF(masterKey, info = "webhook/<inbound id>")` is the verification secret of one webhook inbound. The Intake Service derives it when it needs it, so no store holds a webhook secret.
- A new secret is a new inbound, because the identity enters the derivation.
- A manual replacement of `masterKey` invalidates every derived webhook secret, and a human creates a new inbound for every webhook.
- `intake.inbound.get` returns the address and the secret of a webhook inbound to a human. A `GET` is no mutation, so the idempotency middleware of the Gateway Service records no secret.

### The receipt

- The receipt is the `delivery` operation `intake.inbound.event.receive` at `POST /hooks/:inboundId`. Its handler passes the exact bytes and headers to the Intake Service, under [gateway-service.impl.md](gateway-service.impl.md#delivery-bytes-and-body-limits).
- An unknown inbound identity answers 404, and a poll inbound answers 404.
- For a GitHub event, the verification requires exactly one `X-Hub-Signature-256` header. It rejects a missing header, a duplicate header, a value without the `sha256=` prefix, a value that is not hexadecimal and a value of another length, before any comparison.
- It computes the HMAC with `crypto.createHmac` and SHA-256 over the exact bytes, and it compares two 32-byte digests with `timingSafeEqual`.
- A failed verification answers 401 and stores nothing.
- After the verification, the platform implementation classifies the request. A GitHub request with `X-GitHub-Event: ping` is a handshake and answers 204. A Slack `url_verification` follows the same rule with the answer `{ "challenge": <challenge> }` when the Slack platform lands.
- A handshake stores no event, skips the capacity bound, reaches no consumer and writes one span of the Tracking Service. A repeat gets the same answer, so no record enforces a single handshake.
- A valid HMAC proves the possession of the secret alone. It authenticates no other header, it establishes no repository, and it detects no replay.
- The insert stores `event_id` from `X-GitHub-Delivery`, the exact body in `event` and `{ "event": <X-GitHub-Event> }` in `metadata`. A repeated `event_id` inside the inbound inserts nothing and answers 2xx.
- The handler answers 2xx after the commit. Beyond the capacity bound, it answers 503 and stores nothing.

## The poll acquisition

- The poll runs on an interval of 60 seconds per inbound with a release per request. Each request carries a deadline.
- One poll request per inbound runs at a time. The next interval starts after the previous request ends, so no older answer commits its checkpoint after a newer one.
- The GitHub poll reads the events of the resource with `If-None-Match` set to the ETag of `checkpoint`. A 304 answer stores nothing.
- Each event inserts `event_id` from the event `id`, the event JSON in `event` and `{ "event": <type> }` in `metadata`.
- The transaction that stores the batch also writes `checkpoint`. It discards the batch when the inbound row no longer exists.
- The poll pauses beyond the capacity bound that [intake-service.md](intake-service.md#capacity-and-retention) states. It resumes when the count of pending events falls below that bound.
- A failed request writes a span with its reason and leaves `checkpoint` unchanged.

## The handoff

- The dispatcher reads pending events in the order of `id` and hands each one to the `consumer` of its inbound through the direct adapter under the service identity of the Intake Service.
- A module-private `Set` holds the identity of every event whose handoff runs. The dispatcher adds the identity before the consumer call and removes it after the write of the answer, so one event never has two handoffs at once.
- The dispatcher re-reads the state of one event and adds its identity to the set in one synchronous step, with no await between them. It starts the handoff only for an event that is still `pending`. A discard reads the set and writes its conditional update in one synchronous step. `node:sqlite` `DatabaseSync` and the single event loop serialize the two steps.
- An answer of the consumer sets `succeeded` with an update conditional on `pending`.
- A declared failure or an indeterminate result sets `failed` with an update conditional on `pending`. The same update appends `{ code, message, created_at }` to the JSON array `error`. A declared failure appends its error code, and an indeterminate result appends the code `indeterminate`. The array is bounded in bytes and holds no credential material. When an append exceeds the bound, the update drops the oldest items until the array fits. A message beyond its own bound is cut at that bound.
- The dispatcher retries nothing and holds no backoff. At a start, it hands every pending event over.
- Each handoff calls the consumer with a fresh ULID idempotency key. A human retry starts a new handoff with the same event identity and content.
- `intake.inbound.event.retry` is a `human` operation. It turns a failed event to `pending`. A pending event answers its current state, and a succeeded or a discarded event answers 409 `intake.inbound.event.state_conflict`.
- `intake.inbound.event.discard` is a `human` operation. It turns a pending or a failed event to `discarded`. A pending event whose identity is in the in-flight set answers 409 `intake.inbound.event.in_flight`. A succeeded or a discarded event answers 409 `intake.inbound.event.state_conflict`.

## The event delete

- `intake.inbound.event.delete` is a `human` operation. Its input holds a state with a ULID range of `id`, or a list of exact event identities.
- An input without a filter answers 400. A state filter of `pending` answers 400.
- An exact list that names a pending event answers 409 `intake.inbound.event.state_conflict` and deletes nothing.
- The delete removes the matching events in one transaction and answers their count.

## Error codes

| HTTP | Code | Condition |
| --- | --- | --- |
| 400 | `intake.inbound.event.filter_invalid` | An event delete names no filter, both filters or the state `pending`. |
| 400 | `intake.outbound.request.filter_invalid` | An outbound request delete names no filter, both filters or the state `pending`. |
| 400 | `intake.outbound.request.force_required` | An outbound request delete omits `force: true`. |
| 401 | `intake.inbound.event.signature_invalid` | A webhook post fails verification. |
| 404 | `intake.inbound.not_found` | No inbound has that identity, or a webhook post names a poll inbound. |
| 404 | `intake.inbound.project_not_found` | The project of a create does not exist. |
| 404 | `intake.inbound.event.not_found` | No inbound event has that identity. |
| 404 | `intake.outbound.request.not_found` | No outbound request has that identity. |
| 409 | `intake.inbound.events_pending` | A delete names an inbound that holds a pending event. |
| 409 | `intake.inbound.event.in_flight` | A discard names a pending event whose handoff runs. |
| 409 | `intake.inbound.event.state_conflict` | The state of the event permits no such transition, or a delete list names a pending event. |
| 409 | `intake.outbound.request.discarded` | A repeat names a discarded request. |
| 409 | `intake.outbound.request.in_flight` | A repeat or a discard names a request whose call runs. |
| 409 | `intake.outbound.request.state_conflict` | A discard names a request that is not `pending`, or a delete list names a pending request. |
| 409 | `intake.storage.object_mismatch` | The object check finds no object, or its size or SHA-256 differs from the asset. |
| 422 | `intake.inbound.credential_invalid` | The credential name does not exist, or its platform does not suit the inbound. |
| 422 | `intake.inbound.platform_refused` | The platform refuses the first request of a poll create. |
| 422 | `intake.outbound.request.action_unmapped` | A configured action has no row in the action table. |
| 503 | `intake.inbound.event.capacity_exceeded` | The count of pending events is at its bound. |
| 503 | `intake.outbound.request.cli_unavailable` | The binary of a CLI operation is missing or below its minimum version. |

## Outbound operations and checks

- Each operation forwards the identity of its caller in `ClientOptions.identity`. The protected facility consumes the authorization result of the service that owns the entity of the operation, custody releases the material under [custody.impl.md](custody.impl.md#the-release-of-a-secret), and the handler performs the call through the Repository component or the [Storage component](storage.md) and drops the material in `finally`.
- The handler builds its platform client for one call and caches no client and no token.
- `intake.action.perform` is a `client` operation under the forwarded execution identity. It takes the configured action and its request key, maps the action to its outbound operation, and answers the `PlatformAddress` or the result class of the Repository component.
- The action table maps `pull_request` on a `github` binding to `github.pull_request`, and `merge_push` on a git binding to `git.merge_push`. An action without a row answers 422 `intake.outbound.request.action_unmapped` and records no request.
- For `git.merge_push` and for the reuse of a pull request, the handler creates a fresh clone through the repository connector with the SSH configuration of the server host, performs the network git write and removes the clone after the call. A `git.merge_push` answers the pushed commit in its `PlatformAddress`.
- `intake.action.check` is a `service` operation under the service identity of the Mission Service. It takes the request evidence, reads the binding and its credential from the pinned `FrozenAction`, and answers `{ endState, landedCommits }` that the platform implementation folds.
- `intake.action.read` is a `client` operation under the forwarded execution identity. It serves the MCP read tools `github-pull-request-get` and `github-pull-request-review-comment-list`, and it returns the platform body unchanged.
- `intake.storage.put` and `intake.storage.check` are `client` operations. The Mission Service calls them in `mission.evidence.submit` and `mission.evidence.asset.complete` with the identity of the execution.
- `intake.storage.get` is a `human` operation and `intake.execution.storage.get` is a `client` operation. Each signs a presigned GET at the recorded object version.
- `intake.storage.delete` is a `human` operation. The Mission Service calls it in `mission.evidence.asset.delete` and `mission.evidence.delete` with the identity of the human and the evidence asset identity as the request key. Its outbound operation is `s3.delete_object`.
- The operations make no Mission record and decide no end state beyond the fold of the platform implementation.
- `intake.action.perform`, `intake.action.read`, `intake.storage.put`, `intake.storage.check`, `intake.storage.get`, `intake.execution.storage.get` and `intake.storage.delete` declare `direct: true`. The action performer, the MCP server and the Mission Service call them through the direct adapter, and no HTTP route reaches them.

### The authorization of each operation

- `github.pull_request` and `git.merge_push`: the Mission Service authorizes the forwarded execution identity through its live evaluation claim, the node, the open attempt, the `FrozenAction` and the pinned binding revision. The Project resolution checks that revision for disablement and removal.
- `github.pull_request` takes a custody release of the credential of the pinned repository binding revision, and custody pins that revision to the execution at its first use. `git.merge_push` takes no release and uses the SSH configuration of the server host.
- `s3.delete_object`: the Mission Service authorizes the forwarded human identity through the evidence asset and its storage binding revision, and custody releases the storage binding credential.
- `intake.action.check`, `intake.action.read`, the presigned PUT and GET and the object check: the Mission Service authorizes the caller through the request evidence or the evidence asset. These operations record no outbound request.
- A native push send and a CLI write declare their authorization with their designs.

### Presigned storage grants

The Intake Service signs a presigned storage grant through the [Storage component](storage.impl.md#the-s3-implementation) with the material that custody releases, after the Mission Service authorizes the operation through the protected facility.
The Intake Service derives the endpoint and the bucket from the storage binding, and custody releases its credential.
The Mission Service supplies the server-generated object key, never an agent-selected destination.
A PUT grant authorizes one object upload and expires after 1 hour.
It requires the checksum header only when the submission supplies a SHA-256.
The Intake Service also performs the object metadata check for complete and signs a presigned GET for an authorized reader's kanthord component.
The GET addresses the recorded version when one exists.
Each grant authorizes one operation on one object for a bounded time.
The API answer carries the URL directly to the component, never through the credential handover.
The storage credential stays inside the server process at every placement and every co-location.
The component keeps the grant outside the context of an agent.
kanthord cannot prove that a harness keeps it out of the model context; the single-object scope bounds that risk.

Tests assert authorization before the release of the credential and derive the destination only from the checked binding and server-generated key.
Tests assert the 1 hour PUT expiry, optional checksum header and authorized GET for the recorded object version.
Tests assert that no storage credential or presigned URL enters the handover, logs or agent context.
Tests refuse grants for unauthorized readers or executions without a live claim.

## The outbound record

- `intake_outbound_request` of [ERD 3](../reference/erd/03-integration.md) holds the outbound requests. `id` is `outbound_request_` and a ULID.
- `project_id` names the project of the binding that the caller resolved. `operation` holds a value of the closed set of outbound operations in code. `request_key` holds the key that the caller derives. `credential` holds the name of the credential that custody released for the write, and `git.merge_push` holds null. A credential removal is not refused by an outbound request that names it.
- A unique index covers `(operation, request_key)`.
- `result` is JSON text that holds the bounded body of the 2xx answer, for example the `PlatformAddress`, or null. `error` holds the shape and the byte bound of `error` of an inbound event. Every property name is snake_case.
- In one invocation, the handler authorizes, obtains the release, inserts the request as `pending`, commits, and only then performs the call.
- An insert that meets the unique index reads the existing request and answers the repeat rule of [intake-service.md](intake-service.md#outbound-requests).
- A module-private `Set` holds the identity of every request whose call runs. The handler adds the identity in the synchronous step of its insert, and it removes the identity after the write of the answer. A repeat and a discard read the set and write their conditional update in one synchronous step.
- The deadline of the operation aborts the call through an `AbortController`. The handler then sets `failed` with `timeout`, and a late answer writes nothing.
- The call sets `succeeded` with `result`, or `failed` with an appended `{ code, message, created_at }`, through an update conditional on `pending`. `code` holds the result class of the Repository component, the HTTP status, `timeout` or `cli.exit_<n>`. A `failed` write commits in its own transaction before the handler answers the error, and a later failure of the handler keeps it.
- A read-back match sets `succeeded` with `result` through an update conditional on `pending` or `failed`.
- A repeat of `succeeded` answers `result`. A repeat of a running request answers 409 `intake.outbound.request.in_flight`, and a repeat of `discarded` answers 409 `intake.outbound.request.discarded`.
- A repeat of a `pending` request with no running call, or of a `failed` request, runs the read-back once. A match answers the result. Otherwise a `pending` request answers the result class `unknown_outcome`, and a `failed` request answers its newest error.
- A start runs nothing for an outbound request, and a `pending` request that a crash leaves keeps its state.

### The read-backs

- The create of a `github.pull_request` lists the open pull requests with the node branch as `head` and the base branch as `base`. GitHub keeps at most one. A match answers its `PlatformAddress`.
- The reuse of a `github.pull_request` fetches the node branch and checks that the snapshot commit of the call is an ancestor of it. A match answers the `PlatformAddress` of the reused pull request. The open state of the pull request is no condition of the match. This rule serves a repeat that carries the reuse operands, and it defines no reconciliation after a merge.
- `git.merge_push` fetches the base branch and checks that the snapshot commit of the key is an ancestor of it. A match answers the oldest first-parent commit of the base branch that contains the snapshot commit.
- `s3.delete_object` reads the recorded object version, and a not-found answer is a match.
- A pull request that a human merges before the repeat of its create leaves the request `failed`. The merge reaches the Mission Service through its inbound event.

### The human operations

- `intake.outbound.request.list` is a `human` operation. It answers a bounded page in the order of `id`, optionally filtered by project, state and operation.
- `intake.outbound.request.get` is a `human` operation. It answers one request with its state, `result` and `error`.
- `intake.outbound.request.discard` is a `human` operation. It turns a `pending` request with no running call to `discarded`. A running request answers 409 `intake.outbound.request.in_flight`, and every other state answers 409 `intake.outbound.request.state_conflict`.
- `intake.outbound.request.delete` is a `human` operation. Its input holds `force` and either a state with a ULID range of `id` or a list of exact request identities.
- A delete without `force: true` answers 400 `intake.outbound.request.force_required` and deletes nothing. A delete without a filter, with both filters or with the state `pending` answers 400 `intake.outbound.request.filter_invalid`.
- An exact list that names a pending request answers 409 `intake.outbound.request.state_conflict` and deletes nothing. The delete removes the matching requests in one transaction and answers their count.
- No `client` or `service` operation reads a request.

## The CLI transport

- The binary of a CLI operation is a host prerequisite with a configured absolute path and a pinned minimum version, and kanthord installs nothing. A missing binary or an older version answers 503 `intake.outbound.request.cli_unavailable` before the insert.
- The platform implementation builds the argument list from a closed table for each operation. The child runs with no shell, and no caller supplies an argument string.
- The child environment holds only an allowlist and the one credential variable of the operation, for example `CLOUDFLARE_API_TOKEN`. It inherits no other server variable, `SSH_AUTH_SOCK` included.
- A CLI login flow is forbidden, and custody supplies an API token only.
- The child runs in a fresh 0700 directory `<state dir>/intake/cli/<outbound request id>/`, which also holds its `HOME`, `XDG_CONFIG_HOME` and `XDG_CACHE_HOME`. The handler removes the directory in `finally`, and a start-up sweep removes the directories that a crash left.
- The deadline kills the process group and sets `failed` with `timeout`.
- stdout and stderr are bounded in bytes, and the handler replaces every occurrence of the credential value before any store or log.
- Exit code 0 stores the bounded JSON output in `result`. Another exit code appends `cli.exit_<n>` with the bounded tail of stderr to `error`.
- Where the CLI separates the build from the deploy, only the deploy receives the credential.
- A platform implementation prefers the HTTP API when the platform offers the operation.
- These measures reduce exposure, and they prove no containment.

## The resource healthcheck

- The [health report](gateway-service.impl.md#the-resource-healthcheck-report) supplies the deadline, concurrency bound and cancellation. The inbound check follows them like every other check.
- The check runs only inside a health report that a human calls.
- The inventory answers one entry per inbound with its `projectId` in place of a project name. The composition root resolves the name under the [health report](gateway-service.impl.md#the-resource-healthcheck-report). The Intake Service reads no Project table and calls no Project collaboration.
- A poll performs one request with a release for `poll` and with the ETag of `checkpoint`. A 200 or a 304 answer reports `healthy`, and any other result reports `unhealthy`. The capability is `poll acquisition`. The check stores no event and writes no `checkpoint`.
- A webhook inbound reports `unknown` with the capability `webhook`.
- No store holds a check result.

## Tests

- A test covers a create of a poll whose first request fails, and it asserts no row.
- A test covers a credential archive between the first request and the insert of a poll create that names it, and it asserts that the insert refuses and that no row remains.
- A test covers a discard after the dispatcher selects an event and before it starts the handoff, and it asserts that no handoff starts.
- A test covers an append to a full `error` array, and it asserts that the oldest item goes and the state becomes `failed`.
- A test covers a slow poll request, and it asserts that no second request of that inbound starts before it ends.
- A test covers a delete of an inbound with a pending event, and it asserts the 409 and the kept row.
- Tests cover a missing, a duplicate, a malformed and a wrong-length signature, and a valid signature over the exact bytes.
- A test asserts that a post with a failed verification stores nothing and answers 401.
- A test covers a repeated `X-GitHub-Delivery` inside one inbound, and it asserts one row.
- A test covers a signed GitHub `ping`, at the capacity bound and below it, and it asserts the 204, no row and no handoff. A test covers an unsigned `ping`, and it asserts the 401.
- A test covers a poll batch whose store fails, and it asserts an unchanged checkpoint.
- A test covers a poll batch whose inbound is deleted before the commit, and it asserts that no event is stored.
- A test covers a handoff whose answer is lost at a restart, and it asserts one more handoff with the same identity and content.
- A test covers a discard during a handoff, and it asserts the 409 and the state that the handoff writes.
- A test covers two failures and one retry, and it asserts two items in `error`.
- Tests cover an event delete without a filter, with the state `pending` and with an exact list that names a pending event.
- A test asserts that the healthcheck runs no request outside a health report and changes no inbound.
- A test asserts that no store row and no log record of the Intake Service holds credential material.
- Tests assert that every outbound operation and check forwards the caller identity, refuses another node before custody releases a secret, drops the material after a success and after a failure, and leaves no clone after a `git.merge_push`.
- A test covers a write whose answer times out after the platform applies it, and it asserts `failed`, then a repeat whose read-back sets `succeeded` with one platform write.
- A test covers a crash after the insert of a request, and it asserts `pending` after the restart and no call at the start.
- A test covers two concurrent calls with one key, and it asserts one platform write and one 409 `intake.outbound.request.in_flight`.
- A test covers a repeat of a `failed` request whose read-back finds nothing, and it asserts no second write and the recorded error.
- A test covers an unmapped action, and it asserts the 422 and no request.
- Tests cover a discard of a running request, a delete without `force`, and a delete list that names a pending request.
- A test covers a CLI child, and it asserts the fresh `HOME`, the environment allowlist, the removal of its directory and the kill of its process group at the deadline.
