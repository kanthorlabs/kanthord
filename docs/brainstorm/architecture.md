---
title: Architecture
---

# Architecture

## Scope

This document describes the top level of kanthord.
It names the services, their responsibilities and their relations.
It describes no mechanism inside a service.

## Container diagram

The container view shows the three [applications](architecture.vocabulary.md#app) of kanthord, with the actors and external systems around them.
The `server` application runs the eight services.
The `cli` application operates the system on a terminal.
The `worker` application runs worker instances.
The eight services are logical boundaries inside the server, not separate containers.
The design targets one server on one host.
A `worker` application runs on the host of the server or on another host.

## Services

A service is a logical part of one process.
A service boundary separates authority.
A service boundary does not describe a deployment.

### Project Service

The Project Service holds the resources of a project.
The [Project Service](project-service.md#resource-and-binding-model) defines direct resource bindings.
A project holds the repository strategy and configures its worker instances.
Every authenticated human holds the authority, and each service enforces system authorization for its own operations and entities.
The Project Service owns no resource credential.

### Mission Service

The Mission Service holds the mission of one project.
Every project holds exactly one mission. The creation of a project creates its mission in the same commit.
It maps one to one with a project.
It represents a mission as a graph.
It holds the criterion of every node.
It holds the evidence record, the assessment record and the outcome record of every node.
It stores the content of evidence that no other system holds.
It stores the address of evidence that a repository holds.
No credential enters evidence.
It records the block and the unblock of every node.
It admits the inbound events that the [Intake Service](intake-service.md#handoff) hands over, and it sets the end state of a request evidence through the check of the Intake Service.
Every write of a criterion, of an assessment and of an outcome passes through the Mission Service.
It owns the separation between the claimant that executes a node's steps and the claimant that evaluates the node.

### Scheduler Service

The Scheduler Service manages executions.
It determines which nodes a claimant can claim, and in which order.
It does not make a blocked node available.
It records an execution when a claimant claims a node.

### Intake Service

The [Intake Service](intake-service.md) performs every operation of kanthord on an external platform: it receives the inbound events through a webhook or a poll, and it performs every outbound operation and check.
It owns the [inbound](intake-service.vocabulary.md#inbound) and the [inbound event](intake-service.vocabulary.md#inbound-event).
Its [handoff](intake-service.md#handoff) sends every inbound event to the Mission Service.
Its [boundary](intake-service.md#boundary) decides no business meaning.
It holds no credential, and it receives the material of a credential release for one call.

### Worker Service

The Worker Service supplies the workers.
It hosts the worker instances that execute a node's steps, and the worker instances that evaluate a node.
It uses a large language model provider.
It calls the Intake Service for platform actions and platform reads.
The [Intake Service](intake-service.md#boundary) owns acquisition transport.
It supplies the MCP server through which a native agent and an external harness reach the server tools.
It decides the configured repository action for both harnesses, and the Intake Service performs it.

### Workbench Service

The Workbench Service holds the workbench sessions that a human drives.
A human drives a workbench session through the chat of the dashboard or through the API.
It consumes the [Agent component](agent.md) and runs the agent session in the server process.
It owns no worker, no registration and no claim.

### Tracking Service

The Tracking Service holds telemetry.
It holds no other kind of record.
Telemetry retention differs from evidence retention.
No outcome depends on telemetry.
Each service that writes telemetry takes responsibility to secure its own sensitive information.

### Gateway Service

The Gateway Service holds the RESTful API of the server.
Every request enters the server through it, from a human and from a machine.
It authenticates a human and produces a [human identity](overview.vocabulary.md#human-identity).
It authenticates a machine and produces a [machine identity](gateway-service.vocabulary.md#machine-identity).
It routes each request to the service or shared component that owns the requested operation.

## Shared components

[Custody](custody.md) is a shared component used by every service, not a service.
Its [design](custody.md#scope) defines credential protection.
The [LLM component](llm.md) is a shared component for model credentials and the model runtime.
The [Repository component](repository.md) is a shared component for repository transport, git platform operations and payload decoders.
The [Storage component](storage.md) is a shared component for object storage operations.
The [Agent component](agent.md) is a shared component for the agent catalog, the agent configuration, the runtime of a native agent and the agent session.
Each [platform](architecture.vocabulary.md#platform) belongs to exactly one of the LLM, Repository and Storage components.
That component owns the credential records of the platform and stores them through custody.

## Service diagram

The service view shows the eight services inside the server.
It shows the relations that the sections below name.

## Invocation

An application other than the server reaches a service through the public RESTful API of the server.
A caller inside the server reaches a service through an operation, which the public API exposes only when it accepts a caller outside the server.
An operation names the authority that establishes its caller's identity.
The owning service or shared component authorizes that caller.
The Gateway Service establishes the identity of a human and of a machine.
The server establishes the [service identity](project-service.vocabulary.md#service-identity) of each of its services at its start.
A service acts under its service identity for the work that no human and no machine requests.
No caller outside the server presents a service identity.
An internal collaboration between two services is no operation, and no caller outside the server reaches it.
One operation commits its own work, and a caller composes no atomic unit across two operations.
An operation states its result when its answer is lost, so a caller distinguishes a completed result, a declared failure and an indeterminate result.
A waiting operation states what a cancellation of its caller stops.

## Resource healthcheck

Every external resource that a service or shared component registers has a [resource healthcheck](architecture.vocabulary.md#resource-healthcheck).
The service or shared component that owns the resource owns its check.
The inventory has these owners.

- [Project Service](project-service.md#resource-and-binding-model): a repository binding.
- The [LLM](llm.md#resource-healthcheck), [Repository](repository.md#resource-healthcheck) and [Storage](storage.md#resource-healthcheck) components: a credential store record of their platforms.
- [Intake Service](intake-service.md#inbounds): an inbound.
- [Worker Service](worker-service.md#instances-and-hosting): a registered instance.
- [Agent component](agent.md#agent-configuration): an agent provider.

The store, the log and the host toolchain are internal components, not external resources.

- A check runs on demand when a human requests the [health report](gateway-service.vocabulary.md#health-report) of the Gateway Service.
- No service stores the result of a check.
- A check reports. A disablement is an operation, and no check disables a resource.
- A failed check changes no [instance healthcheck](scheduler-service.vocabulary.md#instance-healthcheck), no worker binding and no execution in flight.
- The check runs under the [human identity](overview.vocabulary.md#human-identity) of the caller.
- One request checks each target once.
- A credential store record and a repository address are each one target.
- [Agent provider checks](agent.impl.md#agent-provider-healthcheck) define agent provider targets.
- Every entry that shares a target reports its one result.
- The checks run with bounded concurrency, and each check has a deadline.
- The inventory comes from the owning service, not from the checks.
- A resource whose check exceeds its deadline reports the [resource status](architecture.vocabulary.md#resource-status) for an incomplete check.
- Each entry names the capability that its check tests.

## Revision and pin

A [revision](architecture.vocabulary.md#revision) is one immutable, committed snapshot of the configuration or content of one resource.
A [pin](architecture.vocabulary.md#pin) is a reference from a record to one exact revision.
Every service that versions a resource follows these rules.

- A change never edits a revision. A change inserts the next revision of that resource in the same transaction.
- The revision value orders the revisions of one resource only. It gives no order across resources.
- The current revision of a resource is its revision with the greatest value. The owning service states whether the current revision is usable, for example a tombstone, `ended_at` or retirement.
- A pin never follows a later revision.
- A pin fixes the configuration, not the runtime values. An OAuth refresh changes the token behind a pinned credential reference. A local disablement refuses a use through a pin.
- The owning service declares whether a pin can move. An attempt pin never moves. A rebind writes a new node revision that pins the new binding revision.
- When a pinned revision ends through a tombstone or a revocation, the next use through the pin is refused. The use never goes to the current revision instead.
- A pin keeps old content, but it does not prevent a lost update. A write that replaces the current revision names the revision that it expects. A stale value answers 409.

[architecture.impl.md](architecture.impl.md#the-revision-value) declares the representation of the revision value.

## Actors

- A human configures a project, carries out steps, reviews results and overrides an outcome. A human reaches the server through the Gateway Service, which authenticates the human and passes the [human identity](overview.vocabulary.md#human-identity) with the request.
- An external harness executes work, and it reaches kanthord as a client through the API or the CLI.
  It performs no authenticated operation on a resource that a project binds, and it invokes that operation through kanthord.

## External systems

- A git platform holds the repository that a project uses and accepts the configured repository action.
  It delivers events about that repository to the Intake Service through the Gateway Service.
  The Intake Service [hands each inbound event to the Mission Service](intake-service.md#handoff).
- A messaging platform delivers updates to the [Intake Service](intake-service.md#boundary).
- A large language model provider serves the models that the Worker Service uses.

## Relations

- An external harness reaches the Gateway Service through the API or the CLI.
- An instance that an external harness hosts registers itself with the Worker Service and pulls work from the Scheduler Service through the Gateway Service.
- An instance that a `worker` application runs registers itself with the Worker Service and pulls work from the Scheduler Service through the Gateway Service.
- An external harness reaches the MCP server of the Worker Service through the Gateway Service, and it invokes a configured repository action there.
- The Worker Service performs that action.
- A human reaches the Gateway Service through the API or the CLI.
- The Gateway Service passes the [human identity](overview.vocabulary.md#human-identity) to the target service when a human makes a request.
- The Scheduler Service reads the graph and the outcome record from the Mission Service.
- The Mission Service notifies the Scheduler Service of an accepted change that can affect scheduling.
- The Mission Service reads the policies of the bindings that a node names from the Project Service at the attempt opening.
- The Scheduler Service reads the worker bindings and their instance counts from the Project Service.
- The Project Service reads the claim state of an execution from the Scheduler Service.
- The Mission Service checks the external object of a request evidence through the Intake Service.
- The Intake Service uses a repository credential through custody after the authorization of the service that owns the entity of the operation.
- The Intake Service uses the credential of an inbound through custody under the human configuration of that inbound.
- The Intake Service verifies a webhook event with a secret that it derives.
- The Intake Service [hands an inbound event to the Mission Service](intake-service.md#handoff).
- A worker instance claims a node from the Scheduler Service through a work pull.
- An execution reads the repository strategy and the permitted resources from the Project Service.
- An execution reaches a platform through the Intake Service, and its git transport uses the SSH configuration of its host.
- An execution writes evidence to the Mission Service.
- A reviewer execution reads the criterion and the evidence from the Mission Service.
- The action performer reads the required external actions of the attempt and the request evidence of the node from the Mission Service.
- A reviewer execution writes the assessment to the Mission Service.
- An execution acts on the repository through the git platform.
- The Worker Service reads the permitted workers and the instance counts from the Project Service.
- The Worker Service resolves agent configuration through the Agent component and uses the selected credential through custody.
- The Worker Service reaches a large language model provider.
- Every service writes telemetry to the Tracking Service.
- An instance that an external harness hosts ingests its captured telemetry into the Tracking Service through the Gateway Service.
- A human reads a trace from the Tracking Service through the Gateway Service.
