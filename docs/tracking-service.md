---
title: Tracking Service
---

# Tracking Service

## Scope

The Tracking Service holds the telemetry of the server.
It holds no evidence, assessment, outcome, validation criterion, configuration or claim.
It decides nothing, and no record it holds has current effect.
No service reads telemetry to make a decision.
The Tracking Service does one thing: tracking.
It enforces no rule on the content of a record.
It refuses no record for its content.
The [architecture](architecture.md#tracking-service) states the obligation of a service that writes telemetry.

## The trace model

Telemetry of one operation is a span.
A span names one operation.
It holds a start time, an end time, or both.
It holds attributes, events, a status and a parent.
It holds the identity of its parent or it is a root span.
A [trace](tracking-service.vocabulary.md#trace) groups the spans of one operation of the server.
A span holds a [span link](tracking-service.vocabulary.md#span-link).
The [span status](tracking-service.vocabulary.md#span-status) and its values live in the vocabulary sibling.
The [attribute value kinds](tracking-service.vocabulary.md#span-attribute) live in the vocabulary sibling.

## The trace and the project

A trace belongs to exactly one project or to no project.
A server operation that concerns several projects opens one root span per project.
Those root spans link to each other.
A link identity names no project.
Access does not distinguish the two kinds of trace.

## The store and the two paths

The Tracking Service holds every record in one primary store.
A record of the harness that kanthord hosts and an imported record follow the same rules of this page.
An execution that kanthord hosts writes to the primary store.
No local store and no import stand between that execution and the Tracking Service.
An external harness holds its capture on its own host until an import.
The Tracking Service holds its records apart from the records of every other service.
A retention sweep of telemetry touches no record of another service.
An observation of the server never waits for an import.
The late admission of an externally captured record is the whole difference between the two paths.

## The root of a trace

A trace has exactly one root span.
The [Scheduler Service](scheduler-service.md#claims-and-counts) opens the root span of an execution after the operation that records that execution.
It writes the root span as telemetry, so that write follows every rule of this page.
The trace exists before any ingestion.
An execution that ends before an import of its records stays readable through the spans of the server.
A lost write of a root span leaves an unresolved parent, and the absence rule governs it.

## Identity attributes

A span carries the identity of every kanthord object that its operation concerns.
One object has one attribute name across every span of every service.
An identity attribute holds an identity and never the content that the identity names.
The [identity attribute](tracking-service.vocabulary.md#identity-attribute) vocabulary lists the objects.

## Producer and ownership

Every span carries its producer.
The Tracking Service derives the producer of a record, and it reads no producer from a record.
The producer of a record that a component of the server writes is that component.
The producer of an imported record is the claimant of the execution that the trace resolves to.
A human who issues an import produces no record.
An authorization states that an import proceeds, and a producer states who made a span.
A producer owns the spans that it creates.
The first record that creates a span binds that span to its producer.
The Tracking Service refuses a record that names that span identity from another producer.
It counts the refusal.
A record names any parent, because naming a parent changes nothing.
A span of an execution names the root span of that execution, or a span that descends from that root.
The Tracking Service refuses a record that names its own span identity as its parent.
The Tracking Service verifies no further ancestry, so a reader meets an unresolved parent.
No record replaces a value that an earlier record set.
The Tracking Service refuses a second end for one span.
An unresolved parent is a fact that a reader sees and never an error.
A record can arrive before its parent.
A start with no end is an unfinished span.
An end with no start creates the span with no start time.
A reader distinguishes a span that the server observed from a span that an external harness asserted.

## The telemetry text

A telemetry text carries prose that a human, a repository or a model authored.
An agent transcript is a telemetry text.
A telemetry text holds its own identity.
A span references it by that identity and never embeds it.
A span attribute holds no authored prose.
A telemetry text belongs to exactly one trace.
Any number of spans of that trace reference it.
The [Worker Service boundary](worker-service.md#boundary) owns the rule for transcripts submitted as evidence.
The record that the prompt composer of the [Worker Service](worker-service.md#prompt-composition) writes holds span attributes.
That record follows the retention and the access of a span.
The text of a prompt reaches telemetry through an agent transcript alone.

## Writing telemetry

The [architecture](architecture.md#relations) owns the relation of every service to the Tracking Service.
A write is no part of the operation that writes it.
A failed write never fails the operation.
It never changes its result or delays it beyond a bound.
No service waits for a telemetry write before it returns its result.
The Tracking Service holds measurements that other services produce.
It derives no measurement.
The [Scheduler Service](scheduler-service.md#topology-and-work-queue) owns the measurements that it produces.

## The external harness

The kanthord extension of an external harness program captures what that program exposes.
It captures all exposed content, including authored prose.
The capture is best effort.
A harness that exposes less produces less telemetry.
That changes no rule of the system.
The extension stores its capture on its own host.
The extension records the trace identity and the root span identity of its execution with its captures.
Those identities are references that the server minted, and they assert nothing.
The local store is no kanthord record.
Only an ingested record is a kanthord record.
The local store is bounded.
The bound discards the oldest records.
The extension counts a discard and ingests that count.
That count is telemetry, so it can be lost.

## Ingestion

A human issues an ingestion through the API, and no ingestion runs without a human.
An ingestion is a finite import.
It imports the records that the local store holds when it starts.
It ends when every one of those records holds a disposition, or when it cannot continue.
It reports its result, and the count of the records that stay retained tells the human whether to issue another ingestion.
A record that the extension appends after an ingestion starts waits for the next ingestion.
The Tracking Service runs no uploader, and the extension holds no scheduler.
An ingestion carries no project.
The Tracking Service resolves the trace identity of a record through its own records, and that resolution gives the project.
A record states its execution identity and its trace identity, and the two agree.
An ingestion assigns no trace and reassigns no trace.
Every record carries an identity that its producer mints.
The Tracking Service deduplicates by that identity within the retention of the trace.
It refuses a record that arrives after its trace expires.
The Tracking Service holds no state of the progress of an ingestion between two ingestions.
The Tracking Service accepts records in any order.
The delivery promise holds after a human issues an ingestion.
It has three parts: capture is best effort, a retained record is delivered at least once, and a bounded local store permits loss.
A bound exists on the records of one execution.
A record beyond that bound is `Refused`.

## The acknowledgement

The Tracking Service answers one ingestion call with an [acknowledgement](tracking-service.vocabulary.md#acknowledgement).
It carries one [record disposition](tracking-service.vocabulary.md#record-disposition) for every record in the batch.
`Stored` follows durable storage and never receipt.
A duplicate is `Stored`.
`Refused` states that the record is never acceptable.
The refusal covers a structural condition only.
A record that names a trace other than the trace of its execution is `Refused`.
The extension deletes its local copy on the disposition of the record.

## Ingestion authority

An ingestion takes its authority from the current authorization of its requester for the project.
It never takes authority from a claim.
A revoked, lost or ended claim still ingests its remaining records.
An ingestion is no resource operation.
An execution identity inside a record is a correlation and authorizes nothing.
The [Project Service](project-service.md#authorization-and-credential-custody) owns this authorization.

## Retention and deletion

A span and a telemetry text expire on separate retentions.
The retention of a telemetry text is never longer than the retention of a span.
A reference to an expired telemetry text resolves to expired and never to missing.
The trace is the unit of deletion.
A deletion of a trace deletes every span and every telemetry text of that trace.
A deletion of a span deletes no telemetry text.
The operator configures retention once for the server, and never per project.
The [architecture](architecture.md#tracking-service) owns the difference between telemetry retention and evidence retention.
A deletion of a telemetry record changes no outcome, removes no evidence and changes no state of a node.

## Loss and absence

Telemetry is lossy.
The Tracking Service drops a record under pressure and counts the drop.
The absence of a span proves nothing.
It never establishes that an operation did not happen, that an execution made no progress or that a node failed.
A reader assembles a trace from the records that the Tracking Service holds.
The Tracking Service promises no reader a complete trace.
An expiry is different from an absence because the server knows that the expiry happened.

## Reading

The Tracking Service provides an API that reads a trace.
It uses the authentication and authorization of the system.
It defines no authorization model of its own.
The [Project Service](project-service.md#authorization-and-credential-custody) owns that authorization.

## Boundary

The [Project Service](project-service.md#authorization-and-credential-custody) owns the authorization of an operation.
The [Mission Service](mission-service.md#outcome-and-completion) owns evidence, assessment and outcome.
The [Scheduler Service](scheduler-service.md#claims-and-counts) owns the execution record, the claim and the lease.
The [Worker Service](worker-service.md#boundary) owns the hosting and lifecycle of an execution.
The Tracking Service owns the trace, span, telemetry text, record disposition, retention of both record forms and the drop.
