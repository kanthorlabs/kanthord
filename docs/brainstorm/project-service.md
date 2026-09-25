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

A project binds each resource that it uses directly: a repository, a worker, a delivery source and an evidence storage.
A binding that needs a credential references a [credential store record](custody.vocabulary.md#credential-store-record), and the project names no credential.
A binding has an identity that is unique inside its project.
A binding has a [binding name](project-service.vocabulary.md#binding-name) that is unique inside its project. A human chooses it.
A change of the binding name removes the binding and adds another one.
A binding has a kind.
The kind determines the configuration that the binding holds, the cardinality that a project permits, and the validation that the configuration satisfies.
A project holds one binding for each repository and each delivery source that it uses.
It holds any number of bindings of one worker and at most one [storage binding](project-service.vocabulary.md#storage-binding).
The storage binding names one S3-compatible bucket for the object evidence of the project.
Without a storage binding, the project accepts only inline evidence content.
A binding references another binding by identity.
A reference never names a revision.
A project shares a resource with another project.
A binding belongs to one project, and no project shares a binding.
The Project Service [owns the resource healthcheck](architecture.md#resource-healthcheck) of a repository binding.

## Repository configuration and policy

A project binds each repository that it uses.
A binding that reaches an external platform names its [platform](custody.vocabulary.md#platform).
The platform of a binding is a value that the binding holds.
No service infers it from the repository address.
The repository strategy states an explicit rule for each repository that requires one.
The repository strategy names the base branch of the repository: the branch from which an execution creates a [node branch](worker-service.md#executions), and into which the configured repository action merges or pushes.
A [policy](project-service.vocabulary.md#policy) on a binding configures an external action for the nodes of the project.
A policy states what its action follows: the passing assessment of the node, or the expected end state of another configured action of the same node.
The repository strategy is the policy of the repository binding.
A node requires the action of a policy when the node names the binding that holds the policy.
An external action states its expected end state on its platform.
The repository [capabilities](project-service.vocabulary.md#capability) distinguish authenticated operations from local work.
A repository address is an SSH address.
A network git read and a network git write use the SSH configuration of the hosting application, so neither operation requires a credential reference.
A platform action requires an API key of the platform.
Every repository binding holds one credential reference, and that reference serves every platform action of the binding, including the read of an external object by the observer.
At the write of a repository binding, the Project Service performs one network git read of that repository.
A failed read refuses the write.
A repository binding holds an optional [project prompt](worker-service.md#prompt-composition).
The Project Service validates the length of the project prompt against a fixed bound.

## Execution configuration and instance count

The [Worker Service](worker-service.md#workers-and-templates) owns worker declarations and agent configuration.
A worker binding names one worker.
The worker that a worker binding names never changes. A project removes the binding and adds another one instead.

- A worker binding holds its instance count.
- An instance count of 0 makes the binding unavailable.
- A worker binding of a native worker can hold an optional [resource budget](worker-service.vocabulary.md#resource-budget).
- A worker binding can hold an [entry](worker-service.vocabulary.md#entry) for each agent of its worker.
- The Project Service holds that entry in the binding and resolves no [effective configuration](worker-service.vocabulary.md#effective-configuration).
- It asks the Worker Service when it needs the current effective configuration.
- The Worker Service validates an entry during the binding write through the [collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters).
- The [agent enablement rules](worker-service.md#agent-configuration) govern that validation.
- A project reaches an agent only through its worker binding and worker.

Each worker binding of one worker holds its own configuration, and two bindings of one worker with equal values are valid.
A binding identity is separate from a worker name.
Two worker bindings of one worker do not share an instance count.

A worker binding of a worker whose instances register groups those instances for its instance count.
Each such instance presents the credential of its own [client identity](project-service.vocabulary.md#client-identity), and that credential names the worker binding.
The [Gateway Service](gateway-service.md#machine-identities) authenticates that credential, and the Project Service holds no secret of a client identity and no list of the client identities of a binding.
A client identity authenticates nothing while its worker binding is removed or unavailable.
A worker binding of an externally hosted worker holds no agent configuration.
The external harness selects and authenticates its own inference.
The credential of a client identity authenticates the instance and authorizes no operation, so it is no credential of a resource.

## Authorization and credential custody

The entity that performs an operation holds the credential reference that permits it.
The Project Service enforces [system authorization](project-service.vocabulary.md#system-authorization).
[Custody](custody.md) owns credentials, secret protection and [suitability](custody.vocabulary.md#suitability).
A credential reaches an operation through its responsible entity, never through a direct relationship with a project.
Every operation names the identity that requests it.
An execution presents its execution identity.
An instance of an external harness presents its client identity and, for an execution operation, the execution identity of its claim.
The observer of the Scheduler Service presents its service identity.
The protected facility resolves that identity to the project and to the node of the request.
An execution identity resolves to the node of its claim, and the facility refuses an operation that names another node.
The facility resolves the service identity of the observer through the external object of the request.
That resolution reaches the repository binding, the project and the node.
The facility permits a service identity one operation class, the read of an external object.
It permits the service identity of the Intake Service the acquisition classes on a source binding through an [acquisition grant](project-service.vocabulary.md#acquisition-grant).
The facility resolves that acquisition request through the source binding to its project.

An acquisition grant serves one session of one [subscription](intake-service.vocabulary.md#subscription).
It ends with the session.
It ends with a disablement of the source binding.
It ends with a rotation of its credential record.
It ends at its maximum lifetime.
The Project Service revokes an open grant into the [Intake Service](intake-service.md#subscriptions).
The Project Service records every grant with the service identity, the source binding, the kind and the time.

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
The operation record names the execution identity, service identity or source binding appropriate to its requester.
[Custody](custody.md#secret-use-and-handover) governs secret use and handover.

A project binds each delivery source that it accepts.
A source binding holds the verification secret behind custody.
A source binding holds the [subscriptions](intake-service.vocabulary.md#subscription) of the [Intake Service](intake-service.md#subscriptions) that acquire its deliveries.
The Project Service verifies a delivery against the source binding of its project as its own operation.
That operation names no requester identity, because it acts on nothing external.

The diagram shows the order of one authorization.
It shows that a refusal never reaches custody.

## Configuration lifecycle and consistency

A binding set changes when the resource requirements of a project change.
A change to the resource that a binding names creates a replacement binding.
A change to the configuration of a binding preserves the identity of the binding and creates a revision.
A change to the credential reference of a binding is a configuration change, so it creates a revision.
A change to the secret material behind an unchanged reference changes no binding.
The [credential record rules](custody.md#credential-records) govern rotation and remote identity.
A revision never invalidates a reference to its binding.
A replacement invalidates every reference to the binding that it replaces.
An edit that replaces a binding repoints every dependent binding in that same edit.
The Project Service rejects a binding set that references a binding which does not exist.
The Project Service validates a binding set when a project writes it, and it validates a binding again when an execution resolves it.
The [claim](scheduler-service.md#claims-and-counts) is no resolution, so the first resolution of an execution is the first validation of its bindings after write time.
Local disablement, upstream revocation, rotation, expiry and OAuth refresh are five different changes.
An execution resolves a binding at the moment that it needs the resource.
A resolution authorizes one operation, and the next operation resolves the binding again.
An execution records the binding revision that it resolves.
A recorded revision states what an execution selected.
Current authorization states what an execution performs.
A recorded revision never authorizes an operation after a disablement.
A disablement takes effect at the next resolution.
An operation that is in progress ends against the remote, because the remote holds the credential authority.

The diagram shows the binding graph that these rules act on.
It shows every reference that a replacement invalidates.
