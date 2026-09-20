---
title: Architecture
---

# Architecture

## Scope

This document describes the top level of kanthord.
It names the services, their responsibilities and their relations.
It describes no mechanism inside a service.

## Container diagram

The container view shows the daemon and its CLI client, with the actors and external systems around them.
The five services are logical boundaries inside the daemon, not separate containers.
The design targets one daemon on one host.

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
It maps one to one with a project.
It represents a mission as a graph.
It holds the validation criteria of every node.
It holds the evidence record, the assessment record and the outcome record of every node.
It stores the content of evidence that no other system holds.
It stores the address of evidence that a repository holds.
No credential enters evidence.
It records the block and the unblock of every node.
Every write of a validation criterion, of an assessment and of an outcome passes through the Mission Service.
It owns the separation between the claimant that executes a node's steps and the claimant that evaluates the node.

### Scheduler Service

The Scheduler Service manages executions.
It determines which nodes a claimant can claim, and in which order.
It does not make a blocked node available.
It records an execution when a claimant claims a node.
It accepts the deliveries of a git platform.
It observes an external object on the git platform.

### Worker Service

The Worker Service supplies the workers and the agents.
It hosts the worker instances that execute a node's steps, and the worker instances that evaluate a node.
It uses a large language model provider.
It supplies the platform gateway through which every service performs an operation on the API of an external platform.
It supplies the MCP server through which a native agent and an external harness reach the daemon tools.
It performs the configured repository action for both harnesses.

### Tracking Service

The Tracking Service holds telemetry.
It holds no other kind of record.
Telemetry retention differs from evidence retention.
No outcome depends on telemetry.
Each service that writes telemetry takes responsibility to secure its own sensitive information.

## Service diagram

The service view shows the five services inside the daemon.
It shows the relations that the sections below name.

## Actors

- A human configures a project, carries out steps, reviews results and overrides an outcome.
- An external harness executes work, and it reaches kanthord as a client through the API or the CLI.
  It performs no authenticated operation on a resource that a project binds, and it invokes that operation through kanthord.

## External systems

- A git platform holds the repository that a project uses and accepts the configured repository action.
  It delivers events about that repository to the daemon.
- A large language model provider serves the models that the Worker Service uses.

## Relations

- An external harness reaches the Mission Service, the Project Service, the Scheduler Service and the Tracking Service through the API or the CLI.
- An instance that an external harness hosts registers itself with the Worker Service and pulls work from the Scheduler Service through the API or the CLI.
- An external harness invokes a configured repository action through the MCP server of the Worker Service.
- The Worker Service performs that action.
- A human reaches the Project Service and the Mission Service through the API or the CLI.
- The Scheduler Service reads the graph and the outcome record from the Mission Service.
- The Mission Service notifies the Scheduler Service of an accepted change that can affect scheduling.
- The Mission Service reads the policies of the bindings that a node names from the Project Service at the attempt opening.
- The Scheduler Service reads the worker bindings, the permitted client identities and their counts from the Project Service.
- The Project Service reads the claim state of an execution from the Scheduler Service.
- The Scheduler Service observes an external object through the platform gateway of the Worker Service.
- The Scheduler Service uses a repository credential that the Project Service holds.
- A worker instance claims a node from the Scheduler Service through a work pull.
- An execution reads the repository strategy and the permitted resources from the Project Service.
- An execution uses a repository credential that the Project Service holds.
- An execution writes evidence to the Mission Service.
- A reviewer execution reads the validation criteria and the evidence from the Mission Service.
- The action performer reads the required external actions of the attempt and the external objects of the node from the Mission Service.
- A reviewer execution writes the assessment to the Mission Service.
- An execution acts on the repository through the git platform.
- The Worker Service reads the permitted workers and the instance counts from the Project Service.
- The Worker Service uses a provider credential that the Project Service holds.
- The Worker Service reaches a large language model provider.
- Every service writes telemetry to the Tracking Service.
- An instance that an external harness hosts ingests its captured telemetry into the Tracking Service through the API.
- A human reads a trace from the Tracking Service through the API or the CLI.
