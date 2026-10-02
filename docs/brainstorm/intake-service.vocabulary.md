---
title: Intake Service Vocabulary
---

# Intake Service Vocabulary

This file holds the values and examples of the terms that [Intake Service](intake-service.md) owns.

## inbound

An inbound is the configuration through which the events of one remote resource of one platform reach one consumer of one project.
The GitHub webhook inbound `inbound_01J9QK3T` of `kanthord-web` receives the events of `kanthorlabs/kanthord`.

## inbound kind

An inbound kind names the way an inbound acquires its events.
The closed set holds `webhook` and `poll`.

## passive webhook

A passive webhook is a webhook inbound that names no credential and that kanthord does not register at its platform.
A human pastes the address `/hooks/inbound_01J9Y3PL` and its secret into the webhook settings of `kanthorlabs/kanthord` on GitHub.

## consumer

A consumer is the admission operation that an inbound names for the handoff of its events.
The closed set holds `mission.delivery.admit`.

## inbound event

An inbound event is one unit that an inbound receives from its platform.
GitHub delivers the merge of pull request 42 for "Add password reset" to the webhook inbound `inbound_01J9QK3T`.
That inbound belongs to `kanthord-web`.

## platform event identity

A platform event identity is the identity that a platform assigns to an event.
GitHub assigns `a438bd70-72ed-4d5e-96b2-9c9bf5c3807f` to the webhook delivery about the merge of pull request 42.

## checkpoint

A checkpoint is the cursor from which the next request of a poll continues acquisition.
The poll inbound `inbound_01J9R2MX` of `kanthord-docs` keeps the newest event identity and the ETag of the last answer for `kanthorlabs/kanthord` as its checkpoint.

## inbound event state

An inbound event state records the outcome of the handoff of an inbound event.
The closed set holds `pending`, `succeeded`, `failed` and `discarded`.
The event of the merge of pull request 42 is `succeeded` when the Mission Service answers, whatever its disposition.
A human sets `discarded` on the `failed` event of pull request 42 after a check of the node replaces its handoff.
