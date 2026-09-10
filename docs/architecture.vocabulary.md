---
title: Architecture Vocabulary
---

# Architecture Vocabulary

This file holds the values and the examples of the terms that [architecture.md](viewer.html?p=architecture.md) owns.
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `architecture.md` stays the single source of truth.

## service

A logical part of one process. The set is closed and it holds five values.

- **Project Service**
- **Mission Service**
- **Scheduler Service**
- **Worker Service**
- **Tracking Service**

The daemon holds no other service. The five services are logical boundaries inside one daemon.

## actor

The container view shows the actors around the daemon. The set is closed and it holds two values.

- **a human**
- **an external harness**

[overview.md](viewer.html?p=overview.md) owns the external harness vocabulary, and it names the harnesses.

## external system

The container view shows the external systems around the daemon. The set is closed and it holds two values.

- **a git platform**, which holds the repository that a project uses
- **a large language model provider**, which serves the models that the Worker Service uses

## daemon

The daemon is one process, and it holds the five services. A client reaches it through the API or the CLI.

- An external harness invokes a configured repository action through the CLI.
- The daemon performs that action.
- The external harness performs no authenticated operation of its own.

## relation

A relation names what one part of the architecture does with another part.
The Relations section of [architecture.md](viewer.html?p=architecture.md) holds the relations of this design.
One relation reads as follows.

- A run writes evidence to the Mission Service.

## reviewer run

A run that evaluates a level. A run that executes a level never writes the assessment of that level.

- A project binds `reviewer@1`, a worker whose method is evaluation.
- A `reviewer@1` instance takes an available objective from the Scheduler Service.
- The instance creates a run, and that run is the reviewer run.
- The reviewer run reads the validation criteria and the evidence from the Mission Service.
- The reviewer run writes the assessment to the Mission Service.

## telemetry

An operational record of what the system did.

- The Worker Service reaches a large language model provider.
- The Worker Service writes telemetry about that call to the Tracking Service.
- No outcome depends on that record, and no credential enters it.

## credential

`architecture.md` names two credentials in its relations.

- **a repository credential**, which a run uses
- **a provider credential**, which the Worker Service uses

The type of a credential is a separate matter, and no approved page closes that set.
[project-service.md](viewer.html?p=project-service.md) names three types.

- an SSH key, which reaches many repositories
- an OAuth credential, which does not imply a person
- an API key, which authorizes a whole account

## container

What the container view shows. A service is not a container.

- The daemon is a container, and it holds the five services.
- The CLI client of the daemon is a container.
- A service boundary separates authority inside the daemon, so it describes no container.

## Terms that still need an entry

`architecture.md` uses these terms, and no approved page establishes a value or an example.

- provider. The page names the providers that a project permits, and no approved page defines the word.
