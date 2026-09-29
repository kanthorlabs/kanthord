---
title: Intake Service Implementation
---

# Intake Service Implementation

This file holds the implementation rulings for the mechanisms that realize [intake-service.md](intake-service.md).
This file is not a design document, and `intake-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
This sibling holds the acquisition, outbound operation, check and resource healthcheck mechanisms.
The subscription store, the delivery store and the handoff follow with the Intake Service item of [HANDOFF.md](HANDOFF.md).

## The service identity

- The composition root mints the service identity of the Intake Service, which [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules. The reconciler and every acquisition call a peer through the direct adapter with that identity in `ClientOptions.identity`.

## The acquisition grant

- The reconciler obtains a grant through `project.acquisition_grant` of the Project Service when it moves a subscription toward `active`. [project-service.impl.md](project-service.impl.md#the-acquisition-grant) holds that mechanism.
- The reconciler holds the grant identity and the acquisition material in a module-private `Map` keyed by the subscription identity. It writes neither to any store. It calls `project.acquisition_grant_end` when the session ends.
- `intake.grant_revoked` is a `unary` mutation under the `service` policy that the Project Service alone calls. Its handler closes the acquisition of the subscription at once and drops the material. It sets the observed state `failed` with the reason of the revocation and answers 204.
- The reconciler obtains a new grant on the next reconciliation when the desired state is still `active` and the source binding is available.

## The webhook acquisition

- The registration, the read of the registrations and the deregistration of a GitHub webhook use the [GitHub platform implementation of the Repository component](repository.impl.md#platform-connector-and-platform-implementations). The calls use the material of the grant, and each call carries a deadline.
- The registration names the webhook address `/hooks/<binding id>` that [project-service.impl.md](project-service.impl.md#the-verification-of-a-delivery) rules and the current verification secret that the Project Service returns.
- An indeterminate registration result makes the reconciler read the registrations before any retry. It adopts an existing registration that names the same address.
- A passive webhook subscription obtains no grant and registers nothing.

## The poll acquisition

- The poll runs on an interval of 60 seconds per subscription with the material of the grant. Each request carries a deadline, and the checkpoint advances in the transaction that stores every delivery of the batch.
- The poll pauses beyond the capacity bound that [intake-service.md](intake-service.md#capacity-and-retention) states. It resumes when the count of unresolved deliveries falls below that bound.

## The stream acquisition

- The stream opens with the material of the grant and holds the connection for the session. The Intake Service writes the resume position with each stored message.
- A close by the platform reconnects with backoff under the same grant until the grant ends. A close by revocation or by capacity ends the session.

## Outbound operations and checks

- Each operation forwards the identity of its caller in `ClientOptions.identity`. The protected facility of the Project Service authorizes that caller, custody releases the material under [custody.impl.md](custody.impl.md#the-release-of-a-secret), and the handler performs the call through the Repository component and drops the material in `finally`.
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

- The [health report](gateway-service.impl.md#the-resource-healthcheck-report) supplies the deadline, concurrency bound and cancellation. The subscription check follows them like every other check.
- The acquisition window is 180 s, three poll intervals of 60 s.
- The poll capability is `poll acquisition`. The stream capability is `open stream`.
- The registered and passive webhook capability is `verified receipt since enabling`.
- Poll and stream evidence stays in memory, keyed by the acquisition grant identity of the session. Evidence from an earlier grant never counts.
- After a restart, the check reports `unknown` until the first answer of the new session.
- The webhook evidence is `last_verified_receipt_at` on the subscription row. Each change of the desired state to `enabled` resets it.
- That evidence survives the retention of resolved deliveries.
- The evidence is acquisition state, not a check result. No store holds a check result.

## Tests

- Tests cover both sides of the poll acquisition window and a failed poll request.
- Tests cover an open stream and a failed connect attempt.
- A test asserts that a forged post fails verification and leaves the webhook resource status unchanged.
- A test asserts that a restart reports `unknown` until the first answer of the new session.
- A test asserts that evidence from a replaced acquisition grant session does not count.
- A test asserts that the check requests no acquisition grant, makes no remote call and changes no subscription state.
- A test covers a grant revocation that arrives during an open stream. It asserts the close, the dropped material and the observed state `failed` with the reason.
- A test covers an indeterminate webhook registration followed by a read that finds the registration, and it asserts no second registration.
- A test covers a poll batch whose store fails, and it asserts an unchanged checkpoint.
- A test asserts that no store row and no log record of the Intake Service holds acquisition material.
- Tests assert that every outbound operation and check forwards the caller identity, refuses another node before custody releases a secret, drops the material after a success and after a failure, and leaves no clone after a `merge_push`.
