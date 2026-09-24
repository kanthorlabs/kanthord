---
title: Intake Service Implementation
---

# Intake Service Implementation

This file holds the implementation rulings for the mechanisms that realize [intake-service.md](intake-service.md).
This file is not a design document, and `intake-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
This sibling holds the acquisition mechanisms.
The subscription store, the delivery store and the handoff follow with the Intake Service item of [HANDOFF.md](HANDOFF.md).

## The service identity

- The composition root mints the service identity of the Intake Service, which [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules. The reconciler and every acquisition call a peer through the direct adapter with that identity in `ClientOptions.identity`.

## The acquisition grant

- The reconciler obtains a grant through `project.acquisition_grant` of the Project Service when it moves a subscription toward `active`. [project-service.impl.md](project-service.impl.md#the-acquisition-grant) holds that mechanism.
- The reconciler holds the grant identity and the acquisition material in a module-private `Map` keyed by the subscription identity. It writes neither to any store. It calls `project.acquisition_grant_end` when the session ends.
- `intake.grant_revoked` is a `unary` mutation under the `service` policy that the Project Service alone calls. Its handler closes the acquisition of the subscription at once and drops the material. It sets the observed state `failed` with the reason of the revocation and answers 204.
- The reconciler obtains a new grant on the next reconciliation when the desired state is still `active` and the source binding is available.

## The webhook acquisition

- The registration, the read of the registrations and the deregistration of a GitHub webhook call the GitHub REST API through `@octokit/rest`. The calls use the version that [worker-service.impl.md](worker-service.impl.md#platform-connector-and-platform-implementations) pins and the material of the grant, and each call carries a deadline.
- The registration names the webhook address `/hooks/<binding id>` that [project-service.impl.md](project-service.impl.md#the-verification-of-a-delivery) rules and the current verification secret that the Project Service returns.
- An indeterminate registration result makes the reconciler read the registrations before any retry. It adopts an existing registration that names the same address.
- A passive webhook subscription obtains no grant and registers nothing.

## The poll acquisition

- The poll runs on an interval of 60 seconds per subscription with the material of the grant. Each request carries a deadline, and the checkpoint advances in the transaction that stores every delivery of the batch.
- The poll pauses beyond the capacity bound that [intake-service.md](intake-service.md#capacity-and-retention) states. It resumes when the count of unresolved deliveries falls below that bound.

## The stream acquisition

- The stream opens with the material of the grant and holds the connection for the session. The Intake Service writes the resume position with each stored message.
- A close by the platform reconnects with backoff under the same grant until the grant ends. A close by revocation or by capacity ends the session.

## Tests

- A test covers a grant revocation that arrives during an open stream. It asserts the close, the dropped material and the observed state `failed` with the reason.
- A test covers an indeterminate webhook registration followed by a read that finds the registration, and it asserts no second registration.
- A test covers a poll batch whose store fails, and it asserts an unchanged checkpoint.
- A test asserts that no store row and no log record of the Intake Service holds acquisition material.
