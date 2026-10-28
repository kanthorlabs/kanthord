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
- The [Agent component](agent.md#agent-configuration) owns agent enablement, agent providers and the default configuration.
- The Agent component selects the agent provider of an agent session and reads no metadata key of a credential.
- An [agent session](agent.md#agent-session) obtains the model runtime of its agent provider from the model connector.

## Credential records

- The component owns the credential records of its platforms.
- It stores each record through [custody](custody.md#credential-records), which holds the revisions, the pin, the drain, the revoke and the archive.
- Each [platform validator](architecture.vocabulary.md#platform-validator) of the component declares the secret shape, the metadata schema and the validation of its platform.
- The component refuses a record of a platform that it does not own.
- A credential of an LLM platform holds one copy for each [holder](custody.vocabulary.md#holder): `server` or one [worker instance](worker-service.md#worker-instances).
- A human enters a secret once and names its holders. The server seals each instance copy and drops the plaintext.
- A worker instance enters a copy of its own holder only, already sealed to its own key.
- An instance copy skips the pre-save check and the provider check. The human types the model ids of an `openai-compatible` instance copy.
- A rotation of one copy offers the rotation of every other copy of the name in the same act.
- An OAuth credential enters only through a [login session](llm.vocabulary.md#login-session).
- A login session of the holder `server` runs on the server.
- A login session of an instance holder runs on that instance, in copy-code mode or device mode only. The instance seals the result to its own key, and the server stores only the ciphertext.
- A login session offers the interaction modes that its platform supports.
- It states the address and the code that the human needs.
- The human completes the interaction and returns a provider code when necessary.
- A failed or expired session stores nothing.
- A credential answer of the component lists the agent providers that name the credential. The Agent component answers that read.

## Provider capability

- An [LLM provider](llm.vocabulary.md#llm-provider) declares the capability of one LLM platform. Today the capability holds one method, the check.
- A platform without a check has no LLM provider.
- The check answers the connection of a credential and, when its call reads one, the model list.
- Every LLM healthcheck and the provider check call the check of the LLM provider, so every platform reports one way.
- The model that a check calls is fixed per platform.

## Model connector

- The model connector builds the model runtime of one agent provider from a released credential, a model identifier and a reasoning effort.
- It maps the metadata of the credential to the options of the model runtime.
- It performs the model inference calls of that runtime.
- It holds every fact about an LLM platform, so the Worker Service holds none.
- The model check runs one tool round trip through that runtime for a credential, a model identifier and a reasoning effort. It answers `ok` or a provider failure code.
- The model check is a warning for the human. It stores only a refreshed OAuth value, by [the OAuth refresh of a check](llm.impl.md#the-oauth-refresh-of-a-check), and no write calls it.

## Placement

- The component runs in the process of its caller.
- The model connector runs in the worker unit for an execution at every placement, with the material of a [credential handover](custody.vocabulary.md#credential-handover).
- At the `server` and the `container` placements, the handover carries the copy of the holder `server`.
- At the `worker` placement, the worker unit opens the copy of its instance with the instance key. A worker instance calls its provider directly, and no server-side LLM proxy exists.
- The caller keeps its runtime duties.

## Resource healthcheck

The component owns the [resource healthcheck](architecture.vocabulary.md#resource-healthcheck) of the credential records of its platforms.
The check of its LLM provider validates a record on demand.
The server checks no instance copy. Each worker instance checks its own copies and reports the result to the component.
The [implementation](llm.impl.md#the-resource-healthcheck) defines each remote probe and its limits.
A healthcheck changes no credential and authorizes no operation.
