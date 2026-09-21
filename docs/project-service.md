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
A resource exists independently of the project that binds it.
The mission of a project is intrinsic to that project, so no binding allocates it.

## Resource and binding model

Every resource that a project uses arrives as a binding.
A binding has an identity that is unique inside its project.
A binding has a kind.
The kind determines the configuration that the binding holds, the cardinality that a project permits, and the validation that the configuration satisfies.
A project holds one binding for each repository, each provider account and each delivery source that it uses, and any number of bindings of one worker.
A binding references another binding by identity.
A reference never names a revision.
A project shares a resource with another project.
A binding belongs to one project, and no project shares a binding.

## Repository configuration and policy

A project binds each repository that it uses.
A binding that reaches an external platform names its [platform](project-service.vocabulary.md#platform).
The platform of a binding is a value that the binding holds.
No service infers it from the repository address.
The repository strategy states an explicit rule for each repository that requires one.
The repository strategy names the base branch of the repository: the branch from which an execution creates a [node branch](worker-service.md#executions), and into which the configured repository action merges or pushes.
A [policy](project-service.vocabulary.md#policy) on a binding configures an external action for the nodes of the project.
A policy states what its action follows: the passing assessment of the node, or the expected end state of another configured action of the same node.
The repository strategy is the policy of the repository binding.
A node requires the action of a policy when the node names the binding that holds the policy.
An external action states its expected end state on its platform.
A capability is one class of authenticated operation on a repository.
A network git read, a network git write and a platform action are the capabilities.
A commit, a branch and a merge are local, so none of them is a capability.
An unauthenticated operation is not a capability, so a public read requires no capability and no credential reference.
The repository strategy and the transport form of the repository address determine the capabilities that a repository binding requires.
A repository address has one of two transport forms, SSH and HTTPS.
Under the SSH form, a network git read and a network git write require an SSH key.
Under the HTTPS form, they require an OAuth credential or an API key of the git platform.
A platform action requires an OAuth credential or an API key under both forms.
A repository binding holds one credential reference for each capability that it requires.
One credential reference satisfies more than one capability.
A repository binding holds an optional [project prompt](worker-service.md#prompt-composition).
The Project Service validates the length of the project prompt against a fixed bound.

## Execution configuration and instance count

A worker template declares its agents.
A worker template declares the [default configuration](worker-service.md#workers-and-templates) of each of its agents, the options that a project can override and the constraint that a whole configuration satisfies.
The worker name determines that declaration.
A worker template carries no configuration version of its own.
A worker name that differs in its version declares its own configuration.
A worker binding names one worker.
A worker binding holds the worker configuration: the instance count and the availability of the binding.
A worker binding holds an entry for an agent of its worker only when the project overrides the default configuration of that agent.
An entry names the values that it overrides, and every other value of the agent comes from its default configuration.
The effective configuration of an agent is the value that its entry names where the entry names one, and the default configuration otherwise, and for a native agent it includes the provider account that resolves below.
The Project Service validates the effective configuration as a whole against the options and the constraint that the worker declares when the project writes the binding set and when an execution resolves it, and a rejected configuration prevents use.
A worker binding holds no provider account of its own.
A provider account is a binding kind.
A model inference call is the capability of a provider account.
A provider account binding holds a credential reference for that capability.
A provider account binding is the default account of its provider when the project marks it so, and a project holds at most one default account for each provider.
The provider account of a [native agent](worker-service.md#workers-and-templates) is the one that its entry names; when the entry of the agent names no account, it is the default account of the provider that the default configuration names, and an effective configuration with neither is invalid.
The provider account binding determines the effective provider, over the provider of the default configuration, so an entry that names a provider account binding of another provider also names the model identifier.
A default account serves an agent only when its entry names no account, and a disabled or revoked selected account prevents use and authorizes no other account.
Each worker binding of one worker holds its own configuration, and two bindings of one worker with equal values are valid.
A binding identity is separate from a worker name.
Two worker bindings of one worker do not share an instance count.

A worker binding of a worker that an external harness hosts holds the client identities that its instances present.
A human adds a client identity to that binding, and the Project Service issues a client secret for that identity.
The Project Service returns the client secret once and keeps its hash in custody.
An instance of an external harness authenticates a request with its client identity and that client secret, and the Project Service verifies the secret before it resolves the identity.
A rotation issues a new client secret and keeps the identity.
The removal of a client identity from the binding revokes it.
Such a binding holds no agent configuration, because the external harness selects and authenticates its own inference outside the resolution of the Project Service.
A client secret authenticates the instance and authorizes no operation, so it is no credential of a resource.

## Authorization and credential custody

A project holds the authorization binding that permits an operation on a resource.
Custody is a dedicated component of the Project Service.
Custody holds the credential of a resource that a project binds.
Secret material sits behind a protected facility.
A trusted execution consults that facility after it checks the binding.
Holding a resource does not confer custody of its secret.
A binding does not narrow upstream authority.
One SSH key reaches many repositories, and one API key authorizes a whole account.
System authorization is what kanthord permits an identity to access.
Credential authority is what the remote permits any holder.
The Project Service enforces system authorization, and it records credential authority.
The boundary is the authorization of an operation, and it is not the custody of bytes.
An agent that never reads a key still uses an authenticated tool.
Every operation names the identity that requests it.
An execution presents its execution identity.
An instance of an external harness presents its client identity and, for an execution operation, the execution identity of its claim.
The observer of the Scheduler Service presents its service identity.
The protected facility resolves that identity to the project and to the node of the request.
An execution identity resolves to the node of its claim, and the facility refuses an operation that names another node.
The facility resolves a service identity through the external object of the request.
That resolution reaches the repository binding, the project and the node.
The facility permits a service identity one operation class, the read of an external object.

A human presents a [human identity](overview.vocabulary.md#human-identity).
The facility recognizes every authenticated human identity as authorized for the operation, under the [human authority policy](gateway-service.md#human-authority) of the Gateway Service.

For a machine identity, the facility checks the binding of that project for the requested operation.
The facility consults custody after that check.
No credential leaves the daemon.
An execution holds no credential, and an external harness holds no credential.
An execution identity presented under a live claim proves that the execution is live, and it authorizes no operation.
The Project Service reads the claim state of an execution from the Scheduler Service.
A credential store holds one record for a secret, and a binding names that record.
A credential store record serves more than one project.
Each project holds its own binding that names that record.
A rotation changes one record, and every binding that names that record stays valid.
Unrestricted selection of a record is the danger, and central storage is not.
A human selects the record that satisfies a capability.
The Project Service validates a credential reference with two checks.
Coverage states that every required capability has a credential reference.
Suitability states that the type of the referenced record performs that class of operation.
An SSH key does not perform a platform action.
Suitability states no scope, because a binding does not narrow upstream authority.
A credential record names the remote identity.
The record of an execution operation names the execution identity.
The record of an observation names the service identity.
The record of a delivery verification names the source binding.
The remote identity and the execution identity stay separate.
An OAuth credential does not imply a person.
An API key does not imply an organization.

A project binds each delivery source that it accepts.
A source binding holds the verification secret behind custody.
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
A change to the remote that a credential authorizes is a change to the resource, so it creates a replacement binding.
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
