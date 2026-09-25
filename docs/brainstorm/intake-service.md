---
title: Intake Service
---

# Intake Service

## Scope

This document describes the Intake Service.
It describes the subscription and the delivery.
It describes acquisition through a webhook, a poll or a stream.
It describes the handoff of a delivery to its consumer and the capacity of the service.
It describes no business effect of a delivery and no mechanism of another service.

## Boundary

The Intake Service receives from an external platform.
It delegates every business effect to the service that owns it.
It decides nothing about the meaning of a delivery.
It interprets no payload field for a business meaning.
It reads a payload only to identify a delivery and to acknowledge it.

The Intake Service owns the connection lifetime of every acquisition.
It receives a webhook, runs a poll and opens and closes a stream.
It holds the transport knowledge of a platform.
That knowledge identifies the signature header and the field that carries the platform delivery identity.
It defines the meaning of a poll checkpoint and the protocol and acknowledgement of a stream.
The [Worker Service](worker-service.md#platform-connector-action-performer-and-mcp-server) owns platform actions and payload decoding through its [platform implementation](worker-service.vocabulary.md#platform-implementation).

The Intake Service reaches a peer through an [operation](architecture.md#invocation) only.
It declares no collaboration.
No atomic invariant spans the Intake Service and another service.
It acts under its own [service identity](project-service.vocabulary.md#service-identity).
It obtains acquisition material only through an [acquisition grant](project-service.vocabulary.md#acquisition-grant) of the [Project Service](project-service.md#authorization-and-credential-custody).
It obtains no acquisition material from a store.
It holds acquisition material in memory for the session and persists none.
A passive webhook needs no grant.
The Intake Service never verifies a delivery.
It submits the body, the headers and the candidate source binding to the verification operation of the Project Service.
One server holds one Intake Service that serves every project.

## Subscriptions

The Intake Service [owns the resource healthcheck](architecture.md#resource-healthcheck) of a subscription.
A [subscription](intake-service.vocabulary.md#subscription) belongs to one [source binding](project-service.vocabulary.md#source-binding).
It has one [subscription kind](intake-service.vocabulary.md#subscription-kind).
A source binding holds at most one subscription per kind.
A subscription holds a [desired state](intake-service.vocabulary.md#desired-state) that a human sets.
It holds an [observed state](intake-service.vocabulary.md#observed-state) that the Intake Service writes.
A [reconciler](intake-service.vocabulary.md#reconciler) of the Intake Service moves the observed state toward the desired state.
It never moves the desired state toward the observed state.

A subscription holds the kind-specific state of its acquisition.
A webhook subscription holds the registration identity that the platform returns.
A poll subscription holds its [checkpoint](intake-service.vocabulary.md#checkpoint).
A stream subscription holds its [resume position](intake-service.vocabulary.md#resume-position).
That state survives a disable.
Enabling a subscription obtains any required grant and registers or opens the acquisition.
Successful enabling sets the observed state active.
Disabling a webhook subscription deregisters it at the platform and keeps the registration identity.
Disabling a poll keeps its checkpoint.
Disabling a stream closes it.

The [Project Service](project-service.md#authorization-and-credential-custody) owns the session scope, lifetime and revocation of an acquisition grant.
When that service revokes a grant, the Intake Service closes the acquisition at once.
It sets the observed state failed with the reason.
Revocation for a source binding disablement disables every subscription under that binding.
An uncertain registration result requires the Intake Service to read the registrations at the platform before any retry.
A lost answer creates no second registration.
A poll checkpoint advances only with the commit that stores every delivery of the batch.

## Deliveries

A [delivery](intake-service.vocabulary.md#delivery) is one unit received from a platform.
It names its subscription, its [platform delivery identity](intake-service.vocabulary.md#platform-delivery-identity), its received time and its verification result.
It holds a bounded payload.
Through its subscription it names one source binding and therefore one project.
Every delivery belongs to exactly one project when the Intake Service stores it.
The webhook address carries the source binding identity.
That identity selects the verification secret that the Project Service uses.

For a webhook delivery, verification precedes durable storage.
Durable storage precedes acknowledgement to the platform.
A stream message follows the same order.
The Intake Service acknowledges only a delivery that it stores durably.
It deduplicates within one subscription by platform delivery identity.
The [Scheduler Service](scheduler-service.md#delivery-admission-and-observation) owns effect deduplication across kinds and redeliveries.
A delivery holds no credential.

## Handoff

The consumer of every delivery is the [delivery admission](scheduler-service.vocabulary.md#delivery-admission) operation of the [Scheduler Service](scheduler-service.md#delivery-admission-and-observation).
The Intake Service hands a delivery over at least once.
It retries a declared failure and an indeterminate result with backoff.
A repeat carries the same delivery identity and the same content.
The Intake Service records the [disposition](intake-service.vocabulary.md#disposition) that the consumer answers.
Acceptance and duplication end the handoff.
A refusal ends the handoff and remains visible to a human.
After a bounded count of failed handoff attempts, the Intake Service parks the delivery.
A parked delivery remains visible to a human and never expires.
The [delivery status](intake-service.vocabulary.md#delivery-status) records handoff progress.
After acceptance, the Intake Service asks nothing further about that delivery.
The [admission contract](scheduler-service.md#delivery-admission-and-observation) assigns every effect to the consumer.

## Capacity and retention

The Intake Service bounds the count of unresolved deliveries.
Beyond the bound, a webhook receives a retryable refusal.
A poll pauses beyond the bound.
A stream closes beyond the bound with the observed state failed and the reason capacity.
The Intake Service never acknowledges a delivery and drops it.
It bounds the retention of a resolved delivery.
It never removes an unresolved delivery.
It promises the durability of every accepted delivery.
It promises no receipt of every update that a platform produces.

## Authority

Every authenticated human holds authority to create, enable, disable and retire a subscription of any source binding.
The [Gateway Service](gateway-service.md#human-authority) owns that human authority rule.
A subscription names its consumer from the closed set of [admission operations](scheduler-service.vocabulary.md#delivery-admission).
It names no arbitrary operation.
