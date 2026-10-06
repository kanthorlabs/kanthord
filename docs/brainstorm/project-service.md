---
title: Project Service
---

# Project Service

## Scope

This document describes the Project Service.
It describes how a project allocates a resource, and how the system authorizes an operation on that resource, including an operation that a human performs.
It describes no mechanism of another service.

## Project identity and ownership

The [overview](overview.vocabulary.md) defines a project, its identity and a binding.
A project has a name that is unique on the server. A human chooses it.
A resource exists independently of the project that binds it.
The mission of a project is intrinsic to that project, so no binding allocates it.

## Resource and binding model

A project binds each resource that it uses directly: a repository, a worker and an evidence storage.
A delivery source is no binding of the Project Service.
A binding that needs a credential references a [credential store record](custody.vocabulary.md#credential-store-record), and the project names no credential.
The Project Service answers the bindings that name a credential, for the component that owns the platform of that credential.
A binding is the group of its revisions.
Each revision has an identity that is unique across the server, and a record pins one revision by that identity.
A binding has a [binding name](project-service.vocabulary.md#binding-name) that is unique inside its project. A human chooses it.
A change of the binding name removes the binding and adds another one.
A binding has a kind.
The kind determines the configuration that the binding holds, the cardinality that a project permits, and the validation that the configuration satisfies.
A project holds one binding for each repository that it uses.
It holds any number of bindings of one worker and any number of [storage bindings](project-service.vocabulary.md#storage-binding).
A storage binding names one S3-compatible bucket for object evidence.
An initiative or an objective names at most one storage binding for its uploads, and a node without one accepts only inline evidence content.
A binding references no other binding.
A project shares a resource with another project.
A binding belongs to one project, and no project shares a binding.
The Project Service [owns the resource healthcheck](architecture.md#resource-healthcheck) of a repository binding.

## Repository configuration and policy

A project binds each repository that it uses.
A binding that reaches an external platform names its [platform](architecture.vocabulary.md#platform).
The platform of a binding is a value that the binding holds.
No service infers it from the repository address.
The repository strategy states an explicit rule for each repository that requires one.
The repository strategy names the base branch of the repository: the branch from which an execution creates a [node branch](worker-service.md#executions), and into which the configured repository action merges or pushes.
A [policy](project-service.vocabulary.md#policy) on a binding configures an external action for the nodes of the project.
A policy states what its action follows: the passing assessment of the node, or the expected end state of another configured action of the same node.
The repository strategy is the policy of the repository binding.
A repository binding holds its connection, which is the address, the platform, the SSH credential reference and the credential reference, and its repository policy, which is the repository strategy and the project prompt.
A node requires the action of a policy when the node names the binding that holds the policy.
An external action states its expected end state on its platform.
The repository [capabilities](project-service.vocabulary.md#capability) distinguish authenticated operations from local work.
A repository address is an SSH address.
The SSH configuration of the hosting application resolves the host of the address to an SSH host of the binding platform.
An SSH alias host, for example `kanthorlabs.github.com`, is a valid host of the address.
A network git read and a network git write use the SSH configuration of the hosting application.
Every repository binding holds one SSH credential reference. That record pins the SSH host of the address and the one identity that git uses.
A platform action requires an API key of the platform.
A repository binding holds at most one credential reference. That reference serves every platform action of the binding, including the check of an external object for the Mission Service.
A binding without a credential reference permits no platform action.
At the write of a repository binding, the Project Service performs one network git read through the [Repository component](repository.md#repository-connector).
A failed read refuses the write.
A repository binding holds an optional [project prompt](worker-service.md#prompt-composition).
The Project Service validates the length of the project prompt against a fixed bound.

## Execution configuration and instance count

The [Worker Service](worker-service.md#workers-and-templates) owns worker declarations, and the [Agent component](agent.md#agent-configuration) owns agent configuration.
A worker binding names one worker.
The worker that a worker binding names never changes. A project removes the binding and adds another one instead.

- A worker binding holds its instance count.
- An instance count of 0 makes the binding unavailable.
- A worker binding of a native worker can hold an optional [resource budget](worker-service.vocabulary.md#resource-budget).
- A worker binding can hold an [entry](worker-service.vocabulary.md#entry) for each agent of its worker.
- The Project Service holds that entry in the binding and resolves no [effective configuration](agent.vocabulary.md#effective-configuration).
- It asks the Worker Service when it needs the current effective configuration.
- The Worker Service validates an entry during the binding write through the [collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters).
- The [agent enablement rules](agent.md#agent-configuration) govern that validation.
- A project reaches an agent only through its worker binding and worker.

Each worker binding of one worker holds its own configuration, and two bindings of one worker with equal values are valid.
A binding identity is separate from a worker name.
Two worker bindings of one worker do not share an instance count.

A worker binding of a worker whose instances register groups those instances for its instance count.
Each such instance presents the credential of its own [client identity](project-service.vocabulary.md#client-identity), and that credential names the worker binding by its project and its resource identity.
The [Gateway Service](gateway-service.md#machine-identities) authenticates that credential, and the Project Service holds no secret of a client identity and no list of the client identities of a binding.
A client identity authenticates nothing while its worker binding is removed or unavailable.
A worker binding of an externally hosted worker holds no agent configuration.
The external harness selects and authenticates its own inference.
The credential of a client identity authenticates the instance and authorizes no operation, so it is no credential of a resource.

## Authorization and credential custody

The entity that performs an operation holds the credential reference that permits it.
The Project Service enforces [system authorization](project-service.vocabulary.md#system-authorization) for its own operations and for a machine identity against its binding.
The service that owns the entity of every other operation enforces its system authorization, under [architecture.md](architecture.md#invocation).
[Custody](custody.md) owns credentials, secret protection and [suitability](custody.vocabulary.md#suitability).
A credential reaches an operation through its responsible entity, never through a direct relationship with a project.
Every operation names the identity that requests it.
An execution presents its execution identity.
An instance of an external harness presents its client identity and, for an execution operation, the execution identity of its claim.
The Mission Service presents its service identity for the check of a request evidence.
The protected facility resolves that identity to the project and to the node of the request.
An execution identity resolves to the node of its claim, and the facility refuses an operation that names another node.
The facility resolves that service identity through the request evidence of the check.
That resolution reaches the repository binding, the project and the node.
The facility permits the service identity of the Mission Service one operation class, the check of a request evidence.
The human configuration of an inbound authorizes the release of its credential to the service identity of the Intake Service, under [custody](custody.md#scope).

A human presents a [human identity](overview.vocabulary.md#human-identity).
The facility recognizes every authenticated human identity as authorized for the operation, under the [human authority policy](gateway-service.md#human-authority) of the Gateway Service.

For a machine identity, the facility checks the binding of that project for the requested operation.
The facility consults custody after that check.

A presigned grant of a storage binding is no credential.
It authorizes one operation on one object for a bounded time.
It reaches a kanthord component and never the context of an agent.

The Project Service reads the claim state of an execution from the Scheduler Service.
[Coverage](project-service.vocabulary.md#coverage) requires a credential reference for each repository capability that needs one.
The Project Service consumes custody's suitability result after coverage passes.
The operation record names the execution identity or the service identity of its requester.
[Custody](custody.md#secret-use-and-handover) governs secret use and handover.

The diagram shows the order of one authorization.
It shows that a refusal never reaches custody.

## Configuration lifecycle and consistency

A binding set changes when the resource requirements of a project change.
A change to the configuration of a binding creates the next revision of that binding.
A change to the credential reference of a binding is a configuration change, so it creates a revision.
A change to the resource that a binding names creates a [replacement binding](project-service.vocabulary.md#replacement-binding) and removes the old binding.
A change to the secret material behind an unchanged reference changes no binding.
The [credential record rules](custody.md#credential-records) govern rotation.
A record pins one revision, and every use of that record reads the configuration of the pinned revision.
No use reads a later revision implicitly.
A later revision reaches a record only when a human moves that record to it.
A disablement and a removal refuse every use of the binding, whatever revision a record pins.
A pinned revision never enables a disabled or removed binding.
The Project Service validates a binding set when a project writes it, and it validates the pinned revision again at each resolution.
The [claim](scheduler-service.md#claims-and-counts) is no resolution, so the first resolution of an execution is the first validation of its bindings after write time.
Local disablement, upstream revocation, rotation, expiry and OAuth refresh are five different changes.
An execution resolves its pinned revision at the moment that it needs the resource.
A resolution authorizes one operation, and the next operation resolves the pinned revision again.
A disablement takes effect at the next resolution.
An operation that is in progress ends against the remote, because the remote holds the credential authority.

The diagram shows the binding graph that these rules act on.
It shows every reference that a replacement invalidates.
