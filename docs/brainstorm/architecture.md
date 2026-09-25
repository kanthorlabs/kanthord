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
The `server` application runs the seven services.
The `cli` application operates the system on a terminal.
The `worker` application runs worker instances.
The seven services are logical boundaries inside the server, not separate containers.
The design targets one server on one host.
A `worker` application runs on the host of the server or on another host.

## Services

A service is a logical part of one process.
A service boundary separates authority.
A service boundary does not describe a deployment.

### Project Service

The Project Service holds the resources of a project.
A project names the mission that it ships, the repositories that it uses, and the workers, agents and providers that it permits.
A project holds the repository strategy.
A project configures the instances that are available for work.
It holds the credentials that the resources of a project require, and it authorizes their use.

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
Every write of a criterion, of an assessment and of an outcome passes through the Mission Service.
It owns the separation between the claimant that executes a node's steps and the claimant that evaluates the node.

### Scheduler Service

The Scheduler Service manages executions.
It determines which nodes a claimant can claim, and in which order.
It does not make a blocked node available.
It records an execution when a claimant claims a node.
It admits the deliveries that the [Intake Service](intake-service.md#handoff) hands over and creates the [observation obligation](scheduler-service.vocabulary.md#observation-obligation).
It observes an external object on the git platform.

### Intake Service

The [Intake Service](intake-service.md) receives the deliveries of an external platform through a webhook, a poll or a stream.
It owns the [subscription](intake-service.vocabulary.md#subscription) and the [delivery](intake-service.vocabulary.md#delivery).
Its [handoff](intake-service.md#handoff) sends every delivery to the Scheduler Service.
Its [boundary](intake-service.md#boundary) excludes every business effect.
It holds no credential and obtains an [acquisition grant](project-service.vocabulary.md#acquisition-grant) from the Project Service.

### Worker Service

The Worker Service supplies the workers and the agents.
It hosts the worker instances that execute a node's steps, and the worker instances that evaluate a node.
It uses a large language model provider.
It supplies the [platform connector](worker-service.vocabulary.md#connector) for platform actions and external object reads.
The [Intake Service](intake-service.md#boundary) owns acquisition transport.
It supplies the MCP server through which a native agent and an external harness reach the server tools.
It performs the configured repository action for both harnesses.

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
It routes each request to the service that owns the requested operation.

## Service diagram

The service view shows the seven services inside the server.
It shows the relations that the sections below name.

## Invocation

An application other than the server reaches a service through the public RESTful API of the server.
A caller inside the server reaches a service through an operation, which the public API exposes only when it accepts a caller outside the server.
An operation names the authority that establishes the identity of its caller, and the service that owns the operation authorizes that caller.
The Gateway Service establishes the identity of a human and of a machine.
The server establishes the [service identity](project-service.vocabulary.md#service-identity) of each of its services at its start.
A service acts under its service identity for the work that no human and no machine requests.
No caller outside the server presents a service identity.
An internal collaboration between two services is no operation, and no caller outside the server reaches it.
One operation commits its own work, and a caller composes no atomic unit across two operations.
An operation states its result when its answer is lost, so a caller distinguishes a completed result, a declared failure and an indeterminate result.
A waiting operation states what a cancellation of its caller stops.

## Resource healthcheck

Every external resource that a service registers has a [resource healthcheck](architecture.vocabulary.md#resource-healthcheck).
The service that owns the resource owns its check.
The inventory has these owners.

- [Project Service](project-service.md#resource-and-binding-model): a credential store record, a repository binding and a provider account binding.
- [Intake Service](intake-service.md#subscriptions): a subscription.
- [Worker Service](worker-service.md#instances-and-hosting): a registered instance.

The store, the log and the host toolchain are internal components, not external resources.

- A check runs on demand when a human requests the [health report](gateway-service.vocabulary.md#health-report) of the Gateway Service.
- No service stores the result of a check.
- A check reports. A disablement is an operation, and no check disables a resource.
- A failed check changes no [instance healthcheck](scheduler-service.vocabulary.md#instance-healthcheck), no worker binding and no execution in flight.
- The check runs under the [human identity](overview.vocabulary.md#human-identity) of the caller.
- One request checks each target once.
- A credential store record, a repository address and a provider account are each one target.
- Every entry that shares a target reports its one result.
- The checks run with bounded concurrency, and each check has a deadline.
- The inventory comes from the owning service, not from the checks.
- A resource whose check exceeds its deadline reports the [resource status](architecture.vocabulary.md#resource-status) for an incomplete check.
- Each entry names the capability that its check tests.

## Actors

- A human configures a project, carries out steps, reviews results and overrides an outcome. A human reaches the server through the Gateway Service, which authenticates the human and passes the [human identity](overview.vocabulary.md#human-identity) with the request.
- An external harness executes work, and it reaches kanthord as a client through the API or the CLI.
  It performs no authenticated operation on a resource that a project binds, and it invokes that operation through kanthord.

## External systems

- A git platform holds the repository that a project uses and accepts the configured repository action.
  It delivers events about that repository to the Intake Service through the Gateway Service.
  The Intake Service [hands each delivery to the Scheduler Service](intake-service.md#handoff).
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
- The Scheduler Service observes an external object through the platform connector of the Worker Service.
- The Scheduler Service uses a repository credential that the Project Service holds.
- The Intake Service obtains an [acquisition grant](project-service.vocabulary.md#acquisition-grant) from the Project Service.
- The Intake Service submits a delivery to the [verification operation](project-service.md#authorization-and-credential-custody) of the Project Service.
- The Intake Service [hands a delivery to the Scheduler Service](intake-service.md#handoff).
- A worker instance claims a node from the Scheduler Service through a work pull.
- An execution reads the repository strategy and the permitted resources from the Project Service.
- An execution uses a repository credential that the Project Service holds.
- An execution writes evidence to the Mission Service.
- A reviewer execution reads the criterion and the evidence from the Mission Service.
- The action performer reads the required external actions of the attempt and the external objects of the node from the Mission Service.
- A reviewer execution writes the assessment to the Mission Service.
- An execution acts on the repository through the git platform.
- The Worker Service reads the permitted workers and the instance counts from the Project Service.
- The Worker Service uses a provider credential that the Project Service holds.
- The Worker Service reaches a large language model provider.
- Every service writes telemetry to the Tracking Service.
- An instance that an external harness hosts ingests its captured telemetry into the Tracking Service through the Gateway Service.
- A human reads a trace from the Tracking Service through the Gateway Service.
