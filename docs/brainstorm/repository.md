---
title: Repository
---

# Repository

## Scope

The [Repository component](repository.vocabulary.md#repository-component) is a [shared component](architecture.md#shared-components), like custody.
It is no service, and no service owns it.
It holds the repository connector, the platform connector, its platform implementations, the pure payload decoders of a platform and the credential records of its platforms.
The [connector vocabulary](architecture.vocabulary.md#connector) defines the connector set.

## Boundary

- The component holds no authority.
- Every service calls it for its own purpose after the service that owns the entity of the operation authorizes it, under [architecture.md](architecture.md#invocation).
- The repository connector resolves the binding through the Project Service for each operation, under the requester's identity.
- [Custody](custody.md#secret-use-and-handover) owns the credential boundary and follows the authorization check.
- The Project Service calls the repository connector for a network git read at a repository binding write.
- The Project Service calls the repository connector for a network git read of the instruction files of a repository binding.
- The [Intake Service](intake-service.md#boundary) calls every platform implementation method, with the material of a credential release.
- The Intake Service calls the platform connector to check the external object of a request evidence for the [Mission Service](mission-service.md#delivery-admission-and-check), and the platform implementation folds the platform state into an end state.
- The Mission Service calls the payload decoders, and the GitHub decoding of a delivery answers the `PlatformAddress` of its pull request or of its push.
- The [Worker execution](worker-service.md#executions) calls the repository connector for node-branch transport.
- The Intake Service calls the configured-action write for the [action performer](worker-service.md#action-performer-and-mcp-server).
- The Intake Service calls the read methods of a platform implementation for the [Worker MCP server](worker-service.md#action-performer-and-mcp-server).

## Repository connector

- The repository connector performs a network git read and a network git write.
- A credential record of platform `ssh` pins the SSH identity of each network git operation.
- It performs no platform action.
- Its writes follow the [write operations](#write-operations) below.

## Platform connector and platform implementations

- The platform connector performs every operation on the API of an external git platform.
- It holds one [platform implementation](repository.vocabulary.md#platform-implementation) for each platform.
- A platform implementation exposes its platform's operations under that platform's names and parameters.
- No common operation interface exists across platform implementations.
- The set of platform implementations is open.
- A binding that reaches an external platform names its [platform](architecture.vocabulary.md#platform).
- The platform connector selects the platform implementation by that field.
- A platform implementation derives the resource of a call from the binding or from the inbound.
- A caller supplies no resource selector.
- Every platform API call names the requester's identity and the binding or the inbound that it acts on.
- For a call on a binding, the platform implementation resolves the binding through the Project Service.
- For a call of an inbound, it takes the facts that the Intake Service supplies: the validated input at a create, and the row of the inbound otherwise. It requires no Project decision.
- A platform implementation fills the platform event identity and the metadata of an inbound event at its receipt and at its poll.
- A platform implementation declares its handshakes and their answers.
- A platform implementation declares the read-back of each write operation, its correlation and the result of a match, or it declares none.
- A platform implementation decodes an inbound event into the event types of its platform.
- A payload decoder is pure and performs no API operation.
- Another git platform requires one platform implementation, its permitted read methods, a platform value and the required action performer behaviour.
- It changes no other rule.
- A platform with a different resource model requires its binding kind, its authorization and its action semantics.
- The [Storage component](storage.md) owns object storage. No page defines those rules for another platform.

## Credential records

- The component owns the credential records of its platforms.
- It stores each record through [custody](custody.md#credential-records), which holds the revisions, the pin, the drain, the revoke and the archive.
- Each [platform validator](architecture.vocabulary.md#platform-validator) of the component declares the secret shape, the metadata schema and the validation of its platform.
- The component refuses a record of a platform that it does not own.
- A credential answer of the component lists the bindings that name the credential. The [Project Service](project-service.md#resource-and-binding-model) answers that read.

## Write operations

- The component exposes two [write operations](repository.vocabulary.md#write-operation).
- A node-branch push requires a live steps claim.
- A configured-action write requires a live evaluation claim.
- The attempt of that claim holds a current assessment that passes.
- Every operand comes from the records.
- No generic push exists.
- A push of the steps execution targets the node branch of its objective only.
- A merge or a push into the base branch is a configured repository action.
- The [action performer](worker-service.md#evaluation-and-required-external-actions) owns eligibility, operand derivation, serialization and the request key for a configured action.
- The [Intake Service](intake-service.md#outbound-requests) holds one outbound request for each request key.

## Placement

- The component runs in the process of its caller.
- The caller keeps its runtime duties.
- The [Worker Service](worker-service.md#executions) keeps workspace protection, process cancellation and the resource budget of an execution.
- The component owns the transport, not those duties.

## Result classes

- A platform call that succeeds returns the result of the operation.
- A platform call that does not succeed reports a [result class](repository.vocabulary.md#result-class).
- A platform implementation retries a read on a transport error within the caller's deadline.
- It retries no write.

## Resource healthcheck

The [Project Service](project-service.md#resource-and-binding-model) owns the check of a repository binding.
It calls the repository connector for the network git read of that check.
The Repository component owns the [resource healthcheck](architecture.vocabulary.md#resource-healthcheck) of the credential records of its platforms.
Its platform validator validates a record on demand.
A healthcheck changes no credential and authorizes no operation.
