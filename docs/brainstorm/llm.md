---
title: LLM
---

# LLM

## Scope

The [LLM component](llm.vocabulary.md#llm-component) is a [shared component](architecture.md#shared-components), like custody, the [Repository component](repository.md) and the [Storage component](storage.md).
It is no service, and no service owns it.
It holds the [LLM platforms](llm.vocabulary.md#llm-platform), the credential records of those platforms and the model connector.
The [connector vocabulary](architecture.vocabulary.md#connector) defines the connector set.

## Boundary

- The component holds no authority.
- Every service calls it for its own purpose after the service that owns the entity of the operation authorizes it, under [architecture.md](architecture.md#invocation).
- [Custody](custody.md#secret-use-and-handover) owns the credential boundary and follows the authorization check.
- The [Worker Service](worker-service.md#agent-configuration) owns agent enablement, agent providers and the default configuration.
- The Worker Service selects the agent provider of an execution and reads no metadata key of a credential.
- The [Worker execution](worker-service.md#executions) obtains the model runtime of its agent provider from the model connector.

## Credential records

- The component owns the credential records of its platforms.
- It stores each record through [custody](custody.md#credential-records), which holds the revisions, the pin, the drain, the revoke and the archive.
- Each [platform validator](architecture.vocabulary.md#platform-validator) of the component declares the secret shape, the metadata schema and the validation of its platform.
- The component refuses a record of a platform that it does not own.
- An OAuth credential enters only through a [login session](llm.vocabulary.md#login-session) on the server.
- A login session offers the interaction modes that its platform supports.
- It states the address and the code that the human needs.
- The human completes the interaction and returns a provider code when necessary.
- A failed or expired session stores nothing.
- A credential answer of the component lists the agent providers that name the credential. The Worker Service answers that read.

## Model connector

- The model connector builds the model runtime of one agent provider from a released credential, a model identifier and a reasoning effort.
- It maps the metadata of the credential to the options of the model runtime.
- It performs the model inference calls of that runtime.
- It holds every fact about an LLM platform, so the Worker Service holds none.

## Placement

- The component runs in the process of its caller.
- The model connector runs in the worker application for an execution at `worker` placement, with the material of a [credential handover](custody.vocabulary.md#credential-handover).
- The caller keeps its runtime duties.

## Resource healthcheck

The component owns the [resource healthcheck](architecture.vocabulary.md#resource-healthcheck) of the credential records of its platforms.
Its platform validator validates a record on demand.
The [implementation](llm.impl.md#the-resource-healthcheck) defines each remote probe and its limits.
A healthcheck changes no credential and authorizes no operation.
