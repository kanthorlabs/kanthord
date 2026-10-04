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

A webhook inbound names no credential, and kanthord does not register it at its platform.
A human pastes the address `/hooks/inbound_01J9Y3PL` and its secret into the webhook settings of `kanthorlabs/kanthord` on GitHub.

## consumer

A consumer is the admission operation that an inbound names for the handoff of its events.
The closed set holds `mission.delivery.admit`.

## inbound event

An inbound event is one unit that an inbound receives from its platform.
GitHub delivers the merge of pull request 42 for "Add password reset" to the webhook inbound `inbound_01J9QK3T`.
That inbound belongs to `kanthord-web`.

## handshake

A handshake is a verified request through which a platform tests a webhook address.
GitHub sends a `ping` to `/hooks/inbound_01J9QK3T` when the hook is created, and the Intake Service answers it without a stored event.

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

## outbound operation

An outbound operation names one operation of a platform that the Intake Service performs for a caller, as `<platform>.<operation>`.
The action `pull_request` of the GitHub binding `kanthord-repo` maps to `github.pull_request`, and the action `merge_push` maps to `git.merge_push`.

## outbound request

An outbound request records one write that the Intake Service performs on a platform for a caller.
The action performer of attempt 2 of "Add password reset" asks for `github.pull_request`, and the Intake Service records the outbound request `outbound_request_01JA4M2QX7` before it opens pull request 42.

## request key

A request key is the identity that a caller derives from the durable intent of an outbound write.
The action performer derives `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/2/kanthord-repo.pull_request` for attempt 2.
It derives `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/2/kanthord-repo.merge_push/d4e5f6` for the merge of snapshot commit `d4e5f6`.
It derives `node_01ARZ3NDEKTSV4RRFFQ69G5FAV/3/kanthord-repo.pull_request/42/e7f8a9` when attempt 3 reuses pull request 42 with snapshot commit `e7f8a9`.

## outbound request state

An outbound request state records the outcome of an outbound write.
The closed set holds `pending`, `succeeded`, `failed` and `discarded`.
A 2xx answer or a CLI exit code 0 sets `succeeded`, and every other result sets `failed`.
GitHub creates pull request 42 and its answer times out, so the request stays `failed` until a read-back finds pull request 42.

## read-back

A read-back is one read call that checks whether the write of an outbound request took effect.
A repeat of the `failed` request of pull request 42 lists the open pull requests from the node branch into `main` and finds pull request 42.
