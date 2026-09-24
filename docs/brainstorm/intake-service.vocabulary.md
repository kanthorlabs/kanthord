---
title: Intake Service Vocabulary
---

# Intake Service Vocabulary

This file holds the values and examples of the terms that [Intake Service](intake-service.md) owns.

## subscription

A subscription is the registered way that deliveries of one [source binding](project-service.vocabulary.md#source-binding) arrive.
The GitHub source binding of `kanthord-web` holds a webhook subscription for `kanthorlabs/kanthord`.

## subscription kind

A subscription kind names the way a subscription acquires deliveries.
The closed set holds `webhook`, `poll` and `stream`.

## desired state

The desired state records whether a human enables the subscription.
The closed set holds `enabled` and `disabled`.

## observed state

The observed state records the acquisition condition that the Intake Service observes for a subscription.
The closed set holds `inactive`, `registering`, `active`, `failed` and `retiring`.

## delivery

A delivery is one unit received from a platform.
GitHub delivers the merge of pull request 42 for "Add password reset" to a webhook subscription.
That subscription belongs to the source binding of `kanthord-web`.

## platform delivery identity

A platform delivery identity is the identity that a platform assigns to a delivery.
GitHub assigns `a438bd70-72ed-4d5e-96b2-9c9bf5c3807f` to the delivery about the merge of pull request 42.

## checkpoint

A checkpoint is the durable position from which a poll continues acquisition.
The poll subscription of `kanthord-docs` keeps the last accepted event identity for `kanthorlabs/kanthord` as its checkpoint.

## resume position

A resume position is the platform position from which a stream resumes acquisition.
The stream subscription of `kanthord-web` keeps the last accepted stream cursor for the Slack workspace `kanthorlabs` as its resume position.

## disposition

A disposition is the answer that the Scheduler Service records for delivery admission.
The closed set holds `accepted as an observation`, `accepted as a human act`, `refused` and `duplicate`.
The [Scheduler Service](scheduler-service.md#delivery-admission-and-observation) owns their meaning.

## delivery status

A delivery status records the progress of a delivery through handoff.
The closed set holds `pending`, `dispatched`, `accepted`, `refused` and `parked`.

## reconciler

A reconciler is the Intake Service component that moves the observed state of a subscription toward its desired state.
The reconciler registers the enabled webhook subscription of `kanthord-web` at GitHub and records its observed state as active.
