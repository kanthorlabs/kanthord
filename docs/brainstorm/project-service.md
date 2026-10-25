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

## Workspace directory

- Every project holds one [workspace directory](project-service.vocabulary.md#workspace-directory) on the host of the server.
- The Project Service names it by the project identity.
- The workspace directory is the central location of the project data and the project operations.
- [The workspace directory](project-service.impl.md#the-workspace-directory) declares its path.

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
A node names zero or more storage bindings as an ordered list for its uploads, and a node without one accepts only inline evidence content.
A node names every binding that it uses under the [rule table of the bindings of a node](mission-service.vocabulary.md#bindings-of-a-node), and the [Mission Service](mission-service.md#mission-structure-and-nodes) takes no binding from the project.
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
A repository binding holds its connection, which is the address, the platform, the SSH credential reference and the credential reference, and its repository policy, which is the repository strategy and the Binding prompts.
A node requires the action of a policy when the node is an `implement` node and names the binding that holds the policy.
An external action states its expected end state on its platform.
The repository [capabilities](project-service.vocabulary.md#capability) distinguish authenticated operations from local work.
A repository address is an SSH address.
The host of the address is a member of the SSH host set of the binding platform.
The [Repository component](repository.md#repository-connector) holds a pinned host key for that host.
A network git read and a network git write use the SSH identity of the binding, and no SSH configuration of the hosting application.
Every repository binding holds one SSH credential reference. That record holds the one SSH identity that git uses.
A platform action requires an API key of the platform.
A repository binding holds at most one credential reference. That reference serves every platform action of the binding, including the check of an external object for the Mission Service.
A binding without a credential reference permits no platform action.
At the write of a repository binding, the Project Service performs one network git read through the [Repository component](repository.md#repository-connector).
A failed read refuses the write.
A repository binding holds an optional [Binding prompt](agent.md#prompt-composer) for each agent of the catalog, in the field `prompts`.
The Project Service validates each text against the bound of a prompt file, and it reads no instruction file of the repository.
A change of a Binding prompt creates a binding revision. A node keeps the text of its pinned binding revision until `mission node rebind`.
The new binding ID of that revision counts as a changed binding for the Onboarding component, and it clears the mark that the stored environment came from `env@1`.
The Binding prompts of the agents are separate texts, so a rule that relaxes the default standard goes into the prompts of both `swe@1` and `re@1`.

## Environment of a repository binding

A repository binding owns one [environment](project-service.vocabulary.md#environment): the toolchain that the verifications of its nodes need.
The environment uses the `devcontainer.json` format.
KanthorD never writes to the repository of the user. It reads repository files only as input.
The first [environment source](project-service.vocabulary.md#environment-source) that exists decides the environment: the environment that a human stored in the binding, the devcontainer file of the repository at the base branch, the detection from the repository files, then the universal environment.
A stored environment is the key `environment` of the repository binding configuration, so each change of it is a binding revision.
KanthorD adds no table and no column for an environment. The status, the source and the target are computed and never stored.

The [Onboarding component](project-service.vocabulary.md#onboarding-component) of the Project Service onboards each repository binding in the background, with no approval.
The human act that adds the repository binding is the consent to build and to prove its environment.
Onboarding is one-time work, so it depends on no worker. It is a server operation of the Project Service. It is no mission node, no claim and no Scheduler job.
Onboarding resolves the environment, builds its image when a slot runs in a container, and runs the [proof](project-service.vocabulary.md#proof) on the base-branch head before any node of the binding spends budget.
A node whose repository binding holds an environment that is not ready waits. It changes no state while it waits, and it continues when the environment is ready.
An environment failure of an execution stops that execution with its own reason, `environment_failed`. It never becomes a revision turn of the coder agent, and it never counts toward the failure limit of the node.
The human acts only when the proof or an execution fails. The human then stores a fixed environment or runs the onboarding again.
Only a human with the project scope and the agent `env@1` change the stored environment. `env@1` changes only an environment that it wrote or that no one stored. A push to the repository changes the environment only through the repository files that the sources read.

## Execution configuration and instance count

The [Worker Service](worker-service.md#workers-and-templates) owns worker declarations, and the [Agent component](agent.md#agent-configuration) owns agent configuration.
A worker binding names one worker.
The worker that a worker binding names never changes. A project removes the binding and adds another one instead.

- A worker binding holds its instance count.
- At the `worker` placement, a worker binding names its registered [worker instances](overview.vocabulary.md#worker-instance) in `worker_instances` in place of an instance count. The sum of the [slot counts](worker-service.vocabulary.md#instance-slot) of the listed instances is its instance count.
- Each listed instance belongs to the worker of the binding. One instance can serve worker bindings of several projects.
- An instance count of 0 makes the binding unavailable.
- A worker binding of a worker that kanthord hosts holds its [placement](worker-service.vocabulary.md#placement): `server`, `container` or `worker`. Every write of the binding states it.
- A worker binding of an external harness holds no placement.
- The placement of a worker binding never changes. A project removes the binding and adds it again instead.
- For every placement, the instance count limits the live registrations of the binding. At the `server` and the `container` placements, the server also runs one instance for each unit of the count. At the `worker` placement, each slot of a listed instance holds one registration of the binding.
- A write refuses to add a binding at the `container` placement when the server cannot run containers.
- A worker binding of a native worker can hold an optional [resource budget](worker-service.vocabulary.md#resource-budget).
- A worker binding can hold an [entry](worker-service.vocabulary.md#entry) for each agent of its worker.
- The Project Service holds that entry in the binding and resolves no [effective configuration](agent.vocabulary.md#effective-configuration).
- It asks the Worker Service when it needs the current effective configuration.
- The Worker Service validates an entry during the binding write through the [collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters).
- The [agent enablement rules](agent.md#agent-configuration) govern that validation.
- A project reaches an agent only through its worker binding and worker.
- A worker binding holds its [tags](project-service.vocabulary.md#tag), a list of unique tags. The list is empty by default.

A human writes the tags of a worker binding, and a tag states a fact of the host of its instances.
A tag matches `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` and holds at most 64 bytes.
The namespace prefix of a tag is a convention, and no rule reads it.
A tag holds no version, no range and no operator, so a version is part of the tag, for example `toolchain.xcode_16`.
A tag that violates the form, or a repeated tag, refuses the write with `project.bindings.worker.tags_invalid`.
The current worker bindings of a project state the tag vocabulary of that project.
The [Scheduler Service](scheduler-service.md#match) matches the tags of a worker binding against the tags of each node.
A binding-set write that adds an unmatched pair of a node and a claimable state refuses the write with `project.bindings.worker.node_unmatched`, and the error names the nodes.
An unmatched pair that exists before the write refuses no write.
A human configures the worker bindings of a project before the first import, because a node write also refuses an unmatched pair.

Each worker binding of one worker holds its own configuration, and two bindings of one worker with equal values are valid.
A binding identity is separate from a worker name.
Two worker bindings of one worker do not share an instance count.

A worker binding of a worker whose instances register groups those instances for its instance count.
Each such instance presents the credential of its own [client identity](project-service.vocabulary.md#client-identity) for that binding. That credential names the worker binding by its project and its resource identity.
The [Gateway Service](gateway-service.md#machine-identities) authenticates that credential, and the Project Service holds no secret of a client identity and no list of the client identities of a binding.
A client identity authenticates nothing while its worker binding is removed or unavailable.
A worker binding of an externally hosted worker holds no agent configuration.
The external harness selects and authenticates its own inference.
The credential of a client identity authenticates the instance and authorizes no operation, so it is no credential of a resource.

## Project pause

A project is [active or paused](project-service.vocabulary.md#paused-project). A human pauses a project and resumes it.
A new project is active.
A paused project admits no [claim](scheduler-service.md#claims-and-counts) on any of its nodes.
A project pause ends no live execution. Each live execution of the project runs to its release, its revocation or its loss.
A project pause changes no node state, no job, no binding and no registration.
A worker instance of a paused project stays registered, and each of its work pulls answers no work.
A project pause stops no other operation of the project: a Mission write, a human node control including a node pause, a release and an Intake event proceed.
A resume makes the project admit claims again, and it wakes the waiting work pulls of the project.
A pause of a paused project and a resume of an active project change nothing.

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
