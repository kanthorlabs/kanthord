---
title: Architecture Vocabulary
---

# Architecture Vocabulary

This file holds the values and the examples of the terms that [architecture.md](architecture.md) owns.
This file is not a design document, and `architecture.md` stays the single source of truth.

## service

A logical part of one process with a boundary that separates authority.
The set is closed and it holds seven values.

- **Project Service**
- **Mission Service**
- **Scheduler Service**
- **Intake Service**
- **Worker Service**
- **Tracking Service**
- **Gateway Service**

The server holds no other service.
The seven services are logical boundaries inside one server.

## resource healthcheck

The report on a resource under the [resource healthcheck rule](architecture.md#resource-healthcheck).

The Project Service checks the provider account binding `openai-main` of the project `atlas`.

## resource status

The result that a resource healthcheck reports. The set is closed and holds three values.

- **healthy**: the check confirms the capability.
- **unhealthy**: the check confirms a failure of the capability.
- **unknown**: the check is incomplete or cannot establish the capability.

## health scope

The grouping of a resource inside its owning service in the health report. The set is closed and holds two values.

- **global**: a server-wide resource; a credential store record is the only kind.
- **project**: a binding, or its subscription or registered instance, under its project.

## actor

The container view shows the actors around the server. The set is closed and it holds two values.

- **a human**
- **an external harness**

[overview.md](overview.md) owns the external harness vocabulary, and it names the harnesses.

## external system

The container view shows the external systems around the server.
The set is closed and it holds three values.

- **a git platform**, which holds the repository that a project uses, and it delivers events about that repository to the server
- **a large language model provider**, which serves the models that the Worker Service uses
- **a messaging platform**, which delivers updates to the Intake Service

The Slack workspace `kanthorlabs` is a source on a messaging platform.

[overview.md](overview.md) owns `provider`, and the overview vocabulary holds its example.

## app

An application of kanthord that a user runs. The set is closed and it holds three values.

- **`cli`**, which operates the system on a terminal
- **`server`**, which holds every service in one running process and serves the RESTful API
- **`worker`**, which runs worker instances and holds no service

`app` is the short form of `application`, and the two words name one term.

## server

The server is one process, and it holds the seven services.
A client reaches it through the API or the CLI.
The server runs on one host.

- An external harness invokes a configured repository action through the MCP server of the Worker Service.
- The MCP server is one form of the API.
- The Worker Service performs that action.
- The external harness performs no authenticated operation of its own on a resource that a project binds.

## relation

A relation names what one part of the architecture does with another part.
The Relations section of [architecture.md](architecture.md) holds the relations of this design.
One relation reads as follows.

- An execution writes evidence to the Mission Service.

## reviewer execution

An execution under an evaluation claim.
Under the workers that kanthord hosts, the worker instance that executes a node's steps never writes the assessment of that node.

- A project binds `reviewer@1`, a worker whose method is evaluation and that declares `Waiting` and `External.Requested`.
- A `reviewer@1` instance claims a `Waiting` objective through the Scheduler Service.
- The instance produces an execution, and that execution is the reviewer execution.
- The reviewer execution reads the criterion and the evidence from the Mission Service.
- The reviewer execution writes the assessment to the Mission Service.

## telemetry

An operational record of what the system did.

- The Worker Service reaches a large language model provider.
- The Worker Service writes telemetry about that call to the Tracking Service.
- No outcome depends on that record, and no credential enters it.

## credential

What authenticates an operation on a resource that a project uses.
`architecture.md` names two credentials in its relations.

- **a repository credential**, which an execution and the observer of the Scheduler Service use
- **a provider credential**, which the Worker Service uses

The type of a credential is a separate matter, and no approved page closes that set.
[project-service.md](project-service.md) names two types.

- an OAuth credential, which does not imply a person
- an API key, which authorizes a whole account

## container

What the container view shows. A service is not a container.

- The `server` application is a container, and it holds the seven services.
- The `cli` application is a container.
- The `worker` application is a container, and it holds worker instances.
- A service boundary separates authority inside the server, so it describes no container.
