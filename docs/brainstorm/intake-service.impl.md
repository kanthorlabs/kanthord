---
title: Intake Service Implementation
---

# Intake Service Implementation

This file holds the implementation rulings for the mechanisms that realize [intake-service.md](intake-service.md).
This file is not a design document, and `intake-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
This sibling holds the inbound store, the event store, the acquisition, the handoff, the outbound operation, the check and the resource healthcheck mechanisms.

## The service identity

- The composition root mints the service identity of the Intake Service, which [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules. Every acquisition and the dispatcher call a peer through the direct adapter with that identity in `ClientOptions.identity`.

## The credential release of an inbound

- Each remote call of an inbound takes one single-use operation grant from the [protected facility](custody.impl.md#the-protected-facility) under the service identity of the Intake Service.
- The inbound operations are `webhook-register`, `webhook-read`, `webhook-deregister` and `poll`.
- The facility checks that the requester is the Intake service identity and that the operation is an inbound operation. It needs no Project decision, because the human configuration of the inbound authorizes the release.
- The Intake Service supplies the inbound facts from its own row: the inbound identity, the credential name, the platform and the resource. At a create, the facts come from the validated input before the insert.
- Custody resolves the newest live revision of the credential name, checks the platform suitability and releases the material under [custody.impl.md](custody.impl.md#the-release-of-a-secret).
- The handler builds its platform client for one call, caches no client and no token, and drops the material in `finally`.

## The inbound store

- `intake_inbound` of [ERD 3](../reference/erd/03-integration.md) holds the inbounds. `id` is `inbound_` and a ULID.
- `configuration` is JSON text. The Intake Service validates it per `(kind, platform)` with a `zod` schema in code before the write. It holds `resource` and the options of the kind and the platform. Every property name is snake_case.
- `checkpoint` is JSON text whose shape the platform implementation validates.
- The table holds no unique index other than its key.
- The create validates the input, then performs the remote validation of its kind: a registration for a registered webhook, one request for a poll, nothing for a passive webhook.
- The insert transaction checks that the credential name has a live revision and that its platform suits the inbound. When the insert refuses after a registration, the create deregisters with the material that it still holds, then answers the refusal. A credential removal calls `inboundsNaming(tx, credentialName)` in its own transaction, and the collaboration answers every inbound that names the credential. SQLite runs one write transaction at a time, so a create and a removal never interleave.
- A delete of a registered webhook first refuses with 409 `intake.inbound.events_pending` when a pending event exists. Then it deregisters at the platform, and a not-found answer counts as done. Then one transaction checks the pending events again, deletes the events of the inbound and deletes the row. A pending event that arrives during the deregistration refuses that transaction. The inbound then stays without its registration, and a later delete completes it.
- A create or a delete answers its platform refusal and changes no row. Each failure writes a span of the Tracking Service with its reason.

## The webhook acquisition

- The registration, the read and the deregistration of a GitHub webhook use the [GitHub platform implementation of the Repository component](repository.impl.md#platform-connector-and-platform-implementations). Each call carries a deadline.
- The registration names the address `/hooks/<inbound id>` inside the path group that [gateway-service.impl.md](gateway-service.impl.md#ingress) reserves, the verification secret and the events that `configuration` names.
- An indeterminate registration answer makes the create read the registrations before it answers. It adopts the registration that names the same address and inserts the row with its identity.

### The verification secret

- The Intake Service derives its keys with `crypto.hkdfSync`, SHA-256 and an empty salt from `masterKey`, which [architecture.impl.md](architecture.impl.md) holds.
- `HKDF(masterKey, info = "webhook/<inbound id>")` is the verification secret of one webhook inbound. The Intake Service derives it when it needs it, so no store holds a webhook secret.
- A new secret is a new inbound, because the identity enters the derivation.
- A manual replacement of `masterKey` invalidates every derived webhook secret, and a human creates a new inbound for every webhook.
- `intake.inbound.get` returns the address and the secret of a webhook inbound to a human. A `GET` is no mutation, so the idempotency middleware of the Gateway Service records no secret.

### The receipt

- The `/hooks/<inbound id>` handler passes the exact bytes and headers to the Intake Service, under [gateway-service.impl.md](gateway-service.impl.md#delivery-bytes-and-body-limits).
- An unknown inbound identity answers 404, and a poll inbound answers 404.
- For a GitHub event, the verification requires exactly one `X-Hub-Signature-256` header. It rejects a missing header, a duplicate header, a value without the `sha256=` prefix, a value that is not hexadecimal and a value of another length, before any comparison.
- It computes the HMAC with `crypto.createHmac` and SHA-256 over the exact bytes, and it compares two 32-byte digests with `timingSafeEqual`.
- A failed verification answers 401 and stores nothing.
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
- A declared failure or an indeterminate result sets `failed` with an update conditional on `pending`. The same update appends `{ code, message, created_at }` to the JSON array `error`. The array is bounded in bytes and holds no credential material. When an append exceeds the bound, the update drops the oldest items until the array fits. A message beyond its own bound is cut at that bound.
- The dispatcher retries nothing and holds no backoff. At a start, it hands every pending event over.
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
| 401 | `intake.inbound.event.signature_invalid` | A webhook post fails verification. |
| 404 | `intake.inbound.not_found` | No inbound has that identity, or a webhook post names a poll inbound. |
| 404 | `intake.inbound.project_not_found` | The project of a create does not exist. |
| 404 | `intake.inbound.event.not_found` | No inbound event has that identity. |
| 409 | `intake.inbound.events_pending` | A delete names an inbound that holds a pending event. |
| 409 | `intake.inbound.event.in_flight` | A discard names a pending event whose handoff runs. |
| 409 | `intake.inbound.event.state_conflict` | The state of the event permits no such transition, or a delete list names a pending event. |
| 422 | `intake.inbound.credential_invalid` | The credential name does not exist, or its platform does not suit the inbound. |
| 422 | `intake.inbound.platform_refused` | The platform refuses a registration, a poll request or a deregistration. |
| 503 | `intake.inbound.event.capacity_exceeded` | The count of pending events is at its bound. |

## Outbound operations and checks

- Each operation forwards the identity of its caller in `ClientOptions.identity`. The protected facility consumes the authorization result of the service that owns the entity of the operation, custody releases the material under [custody.impl.md](custody.impl.md#the-release-of-a-secret), and the handler performs the call through the Repository component and drops the material in `finally`.
- The handler builds its platform client for one call and caches no client and no token.
- `intake.action.perform` is a `client` operation under the forwarded execution identity. It serves `pull_request` and `merge_push`, and it answers the `PlatformAddress` or the result class of the Repository component.
- For `merge_push` and for the reuse of a pull request, the handler creates a fresh clone through the repository connector with the SSH configuration of the server host, performs the network git write and removes the clone after the call. A `merge_push` answers the pushed commit in its `PlatformAddress`.
- `intake.action.check` is a `service` operation under the service identity of the Mission Service. It takes the request evidence, reads the binding and its credential from the pinned `FrozenAction`, and answers `{ endState, landedCommits }` that the platform implementation folds.
- `intake.action.read` is a `client` operation under the forwarded execution identity. It serves the MCP read tools `github-pull-request-get` and `github-pull-request-review-comment-list`, and it returns the platform body unchanged.
- `intake.storage.put` and `intake.storage.check` are `client` operations. The Mission Service calls them in `mission.evidence.submit` and `mission.evidence.asset.complete` with the identity of the execution.
- `intake.storage.get` is a `human` operation and `intake.execution.storage.get` is a `client` operation. Each signs a presigned GET at the recorded object version.
- `intake.storage.delete` is a `human` operation. The Mission Service calls it in `mission.evidence.asset.delete` and `mission.evidence.delete` with the identity of the human.
- The operations make no Mission record and decide no end state beyond the fold of the platform implementation.

## The resource healthcheck

- The [health report](gateway-service.impl.md#the-resource-healthcheck-report) supplies the deadline, concurrency bound and cancellation. The inbound check follows them like every other check.
- The check runs only inside a health report that a human calls.
- A registered GitHub webhook reads the hook `registration_id` with a release for `webhook-read`. A missing hook, `active` false or a `last_response.code` outside 2xx reports `unhealthy`. A hook with no delivery reports `unknown`. Every other hook reports `healthy`. The capability is `registered webhook`.
- A poll performs one request with a release for `poll` and with the ETag of `checkpoint`. A 200 or a 304 answer reports `healthy`, and any other result reports `unhealthy`. The capability is `poll acquisition`. The check stores no event and writes no `checkpoint`.
- A passive webhook reports `unknown` with the capability `passive webhook`.
- No store holds a check result.

## Tests

- A test covers a create of a registered webhook whose registration answer is lost, followed by a read that finds the registration, and it asserts one registration and one row.
- A test covers a create whose registration the platform refuses, and it asserts no row.
- A test covers a create of a poll whose first request fails, and it asserts no row.
- A test covers a credential removal between the registration and the insert of a create that names it, and it asserts that the insert refuses and that no row and no registration remain.
- A test covers a pending event that arrives during the deregistration of a delete, and it asserts the refusal, the kept row and the completion by a later delete.
- A test covers a discard after the dispatcher selects an event and before it starts the handoff, and it asserts that no handoff starts.
- A test covers an append to a full `error` array, and it asserts that the oldest item goes and the state becomes `failed`.
- A test covers a slow poll request, and it asserts that no second request of that inbound starts before it ends.
- A test covers a delete of a registered webhook with a pending event, and it asserts the 409 and the registration at the platform unchanged.
- A test covers a deregistration that answers not-found, and it asserts the delete of the row.
- Tests cover a missing, a duplicate, a malformed and a wrong-length signature, and a valid signature over the exact bytes.
- A test asserts that a post with a failed verification stores nothing and answers 401.
- A test covers a repeated `X-GitHub-Delivery` inside one inbound, and it asserts one row.
- A test covers a poll batch whose store fails, and it asserts an unchanged checkpoint.
- A test covers a poll batch whose inbound is deleted before the commit, and it asserts that no event is stored.
- A test covers a handoff whose answer is lost at a restart, and it asserts one more handoff with the same identity and content.
- A test covers a discard during a handoff, and it asserts the 409 and the state that the handoff writes.
- A test covers two failures and one retry, and it asserts two items in `error`.
- Tests cover an event delete without a filter, with the state `pending` and with an exact list that names a pending event.
- A test asserts that the healthcheck runs no request outside a health report and changes no inbound.
- A test asserts that no store row and no log record of the Intake Service holds credential material.
- Tests assert that every outbound operation and check forwards the caller identity, refuses another node before custody releases a secret, drops the material after a success and after a failure, and leaves no clone after a `merge_push`.
