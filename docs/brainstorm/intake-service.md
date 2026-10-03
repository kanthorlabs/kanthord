---
title: Intake Service
---

# Intake Service

## Scope

This document describes the Intake Service.
It describes the inbound and the inbound event.
It describes acquisition through a webhook or a poll, the outbound operation, the outbound request and the check.
It describes the handoff of an inbound event to its consumer and the capacity of the service.
It describes no business effect of an inbound event and no mechanism of another service.

## Boundary

The Intake Service performs every operation of kanthord on an external platform, inbound and outbound.
It performs an outbound operation or a check on the request of the service that owns its effect, and it decides no business meaning.
It decides nothing about the meaning of an inbound event.
It interprets no payload field for a business meaning.
It reads a payload only to identify an inbound event and to acknowledge it.
A platform operation establishes no Mission outcome by itself.

The Intake Service owns the connection lifetime of every acquisition.
It receives a webhook and runs a poll.
It holds the transport knowledge of a platform.
That knowledge identifies the signature header, the field that carries the platform event identity and the metadata of an event.
It defines the meaning of a poll checkpoint.
The [Repository component](repository.md#platform-connector-and-platform-implementations) owns platform implementations and payload decoders.
The Intake Service calls a platform implementation of that component for every platform operation, with the material of a credential release.

The Intake Service reaches a peer through an [operation](architecture.md#invocation) only.
It declares one collaboration, `inboundsNaming`, which [custody](custody.md#credential-records) calls in the transaction of a credential removal.
No atomic invariant spans the Intake Service and another service.
It acts under its own [service identity](project-service.vocabulary.md#service-identity).
It obtains the material of an inbound call through a custody release for that call.
The human configuration of an inbound authorizes that release.
It obtains no credential material from a store, and it holds that material for the call only.
An outbound operation or a check forwards the identity of its caller.
The service that owns the entity of the operation authorizes that caller, custody releases the material, and the Intake Service performs the call.
The Intake Service performs the control operations of a platform.
The bytes of an object and the git transport of an execution travel directly, through a presigned URL or the SSH configuration of the host.
The Intake Service performs the operations on a platform that an inbound or a project binding names.
A model inference call and the provider check belong to the model connector of the Worker Service.
The Intake Service verifies the signature of a webhook event with a secret that it derives, and it stores no secret.
One server holds one Intake Service that serves every project.

## Inbounds

An [inbound](intake-service.vocabulary.md#inbound) belongs to one project.
It has one [inbound kind](intake-service.vocabulary.md#inbound-kind).
It names its platform and its [consumer](intake-service.vocabulary.md#consumer).
It names its credential by its name, except a [passive webhook](intake-service.vocabulary.md#passive-webhook).
Its configuration holds the remote resource and the options of its kind and platform.
No field of its configuration changes after its insert, and a change is a new inbound.
A human creates an inbound to start its acquisition and deletes it to stop the acquisition.
A project holds any number of inbounds, and two inbounds can name the same resource, so a duplicate serves a rotation.

The store is the single source of truth, and a row exists only for a validated inbound.
The create validates the inbound before its insert.
The create of a registered webhook registers the address of the inbound at the platform, then inserts the row with the registration identity.
An uncertain registration result makes the create read the registrations at the platform.
The create adopts the registration that names the same address, or it inserts nothing.
A lost answer inside the create creates no second registration.
A crash between the registration and the insert leaves a registration without a row, and a human removes it at the platform.
The create of a poll performs one request with the credential before the insert.
A passive webhook names no credential, and kanthord registers nothing for it.
A human sets its address and its secret at the platform.
A passive webhook is the one exception to the validation before the insert, and its create validates the project, the platform and the configuration only.

A delete of a registered webhook deregisters at the platform before the row goes.
A refused deregistration keeps the row.
A delete of a passive webhook or of a poll calls no platform.
An error after the insert produces a span of the [Tracking Service](tracking-service.md), and a human traces the error there.
An inbound row holds no state of its acquisition health.

A webhook inbound holds the registration identity that the platform returns.
A poll inbound holds its [checkpoint](intake-service.vocabulary.md#checkpoint).
A poll runs on a fixed interval while its inbound exists, and every poll is permanent.
A poll checkpoint advances only with the commit that stores every event of the batch.
A poll discards its batch when its inbound no longer exists at the commit.

The Intake Service [owns the resource healthcheck](architecture.md#resource-healthcheck) of an inbound.

- The check runs only when a human calls the healthcheck.
- The check of a registered webhook reads the registration at the platform.
- A missing or inactive registration, or a failed last delivery of the platform, reports unhealthy.
- A registration that delivered nothing reports unknown, and every other registration reports healthy.
- The check of a poll performs one fetch at the platform. A success reports healthy, and a failure reports unhealthy.
- A passive webhook reports [unknown](architecture.vocabulary.md#resource-status).
- The check changes no inbound and stores no result.
- The [implementation](intake-service.impl.md#the-resource-healthcheck) defines the values of the check.

## Inbound events

An [inbound event](intake-service.vocabulary.md#inbound-event) is one unit that an inbound receives from its platform.
It names its inbound, its [platform event identity](intake-service.vocabulary.md#platform-event-identity) and its creation time.
It holds the bounded content of the event and the metadata that the platform implementation fills.
Through its inbound it belongs to exactly one project.
The webhook address carries the inbound identity, and that identity selects the verification secret.

For a webhook event, verification precedes durable storage.
Durable storage precedes acknowledgement to the platform.
A webhook post that fails verification is refused, and no row records it.
A platform implementation classifies a verified request as a [handshake](intake-service.vocabulary.md#handshake).
The Intake Service answers a handshake from the request alone.
A handshake stores no event, takes no place in the capacity bound and reaches no consumer.
The Intake Service acknowledges only an event that it stores durably.
It deduplicates within one inbound by the platform event identity.
The [Mission Service](mission-service.md#delivery-admission-and-check) owns effect deduplication across inbounds and redeliveries.
An inbound event holds no credential.

## Handoff

The consumer of an inbound event is the [delivery admission](mission-service.vocabulary.md#delivery-admission) operation that its inbound names.
The [inbound event state](intake-service.vocabulary.md#inbound-event-state) records the outcome of the handoff.

- A stored event starts as pending.
- The Intake Service hands a pending event over once, and it retries nothing by itself.
- An answer of the consumer sets succeeded. The [disposition](mission-service.vocabulary.md#disposition) stays in the span of the consumer.
- A declared failure or an indeterminate result sets failed and appends the error to the event.
- A restart hands every pending event over, because its handoff received no answer.
- A repeat carries the same event identity and the same content, and the consumer is idempotent by that identity.
- A human retry turns a failed event back to pending.
- A human discard turns a pending or a failed event to discarded, when no human needs that event.
- Discarded is terminal.
- A discard of a pending event is refused while its handoff runs.
- Every write of the state is conditional on the state that the write expects.

After success, the Intake Service asks nothing further about that event.
The [admission contract](mission-service.md#delivery-admission-and-check) assigns every effect to the consumer.

## Outbound operations and checks

The Intake Service performs a configured action for the action performer of the Worker Service: it opens a pull request, or it merges the node branch into the base branch and pushes.
For a network git write, it creates a fresh clone through the repository connector with the SSH configuration of the server host, performs the write and removes the clone after the call.
It checks the state of the external object of a request evidence for the Mission Service, and it answers the end state that the platform implementation folds.
It reads a pull request and its review comments for an execution.
It signs a presigned PUT or GET, checks an uploaded object and deletes an object of a storage binding for the Mission Service.
Each operation serves one caller kind, and [intake-service.impl.md](intake-service.impl.md) declares the operations.
An [outbound operation](intake-service.vocabulary.md#outbound-operation) is named `<platform>.<operation>` with the full name of the operation, for example `github.pull_request` and `git.merge_push`.
The Intake Service maps a catalog action of the Project Service and the platform of its binding to one outbound operation through a declared table.
It refuses an action without a row in that table.

## Outbound requests

An [outbound request](intake-service.vocabulary.md#outbound-request) records one outbound write, a call with a remote effect.
A read, a check, a presign and an inbound control call record no outbound request.
An outbound write runs inside the operation of its caller, and no dispatcher sends an outbound request.
The Intake Service authorizes a write and obtains its credential release before the insert, and a refusal records no request.

The caller derives the [request key](intake-service.vocabulary.md#request-key) of an outbound write from its durable intent.
A request key holds every operand that can change under its intent, so the Intake Service holds no digest of the operands.
The Intake Service treats the key as opaque.
One request exists for each operation and request key, so a repeat finds the first request and makes no second call.

The [outbound request state](intake-service.vocabulary.md#outbound-request-state) records the outcome of the write.

- The insert commits the request as pending before the call.
- A 2xx answer or a CLI exit code 0 sets succeeded with the bounded result.
- Every other result sets failed and appends its error. A failed request proves no absence of the effect.
- A deadline aborts the call, so a late answer writes nothing.
- A call that ends without a write of its state, for example at a crash, leaves pending.
- Only a [read-back](intake-service.vocabulary.md#read-back) moves pending or failed to succeeded.
- A human discard turns a pending request to discarded, and it is refused while the call runs.
- Succeeded and discarded are terminal.
- Every write of the state is conditional on the state that the write expects.

A repeat with the same key never calls the write again.

- A repeat of a succeeded request answers its result.
- A repeat of a pending request with no running call, or of a failed request, runs the read-back once.
- A repeat of a running request or of a discarded request is refused.

A read-back is one read call to the platform that checks whether the write of a request took effect.
It runs only inside a repeat, under the authorization and the release path of the write.
No timer, no restart and no background process starts a read-back.
A read-back that finds the effect sets succeeded with its result, and a read-back that finds nothing changes no state.
The [Repository component](repository.md#platform-connector-and-platform-implementations) declares the read-back of each write operation, or declares none.
An operation without a read-back leaves pending or failed only through a human discard.

A caller tracks its request by a repeat with the same key, and no caller operation reads a request.

## Capacity and retention

The Intake Service bounds the count of pending events.
Beyond the bound, a webhook receives a retryable refusal, and a poll pauses.
The Intake Service never acknowledges an event and drops it.
It removes no event by itself.
A human deletes events with a filter: a state with a range of event identities, or a list of exact event identities.
A delete without a filter is refused.
A delete removes succeeded, failed and discarded events, and no delete removes a pending event.
A delete of an inbound removes its events, and the delete is refused while the inbound holds a pending event.
The Intake Service promises the durability of every acknowledged event.
It promises no receipt of every update that a platform produces.

No process deletes an outbound request.
A human deletes outbound requests with a filter and with force, and the human accepts that a repeat of a deleted key calls the write again.
A delete removes succeeded, failed and discarded requests, and no delete removes a pending request.

## Authority

Every authenticated human holds authority to create and delete an inbound, to retry, discard and delete an inbound event, and to list, read, discard and delete an outbound request.
The [Gateway Service](gateway-service.md#human-authority) owns that human authority rule.
An inbound names its consumer from the closed set of [admission operations](mission-service.vocabulary.md#delivery-admission).
It names no arbitrary operation.
