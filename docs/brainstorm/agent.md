---
title: Agent
---

# Agent

## Scope

The [Agent component](agent.vocabulary.md#agent-component) is a [shared component](architecture.md#shared-components), like custody and the [LLM component](llm.md).
It is no service, and no service owns it.
It holds the agent catalog, the agent configuration, the runtime of a native agent and the [agent session](agent.vocabulary.md#agent-session).

## Boundary

- The component holds no authority.
- A [consumer](agent.vocabulary.md#consumer) opens an agent session for its own purpose, under its own authority, under [architecture.md](architecture.md#invocation).
- The input of an agent session names no execution, no claim and no node.
- The consumer supplies every value of that input.
- The [Worker Service](worker-service.md#executions) is a consumer. A Worker execution opens an agent session for each native agent of its worker.
- The component runs in the process of its consumer.
- The agent session of a [workbench session](workbench-service.md#workbench-session) runs in the process of the server.
- The [LLM component](llm.md#model-connector) builds the model runtime of an agent session.

## Runtime reuse

- The component reuses every capability of its runtime, for example the session, the resume and the session list.
- The component builds only a capability that the runtime does not serve, or one that cannot fit kanthord.

## Agent catalog

- The component owns the agent catalog and one declaration per agent name.
- An agent name names a role, and no agent name equals a worker name.
- Each declaration holds its options, whole-configuration constraint and prompts.
- A declaration supplies no provider, model identifier or reasoning effort default.
- A human selects those values through the [agent configuration](#agent-configuration).
- A human reads the declaration and the enablement of every agent in the catalog. That read changes no configuration.

## Agent configuration

- The component owns [agent enablement](agent.vocabulary.md#agent-enablement), [agent provider](agent.vocabulary.md#agent-provider) and [default configuration](agent.vocabulary.md#default-configuration).
- An enablement is global to the server, belongs to no project and is keyed by agent name.
- A human enables an agent before use.
- An absent or disabled enablement denies use.
- An enablement holds one or more named agent providers and the default configuration that a human selects.
- Each agent provider pairs a provider with a credential store record.
- An agent session obtains the model runtime of an agent provider from the [LLM component](llm.md#model-connector).
- Its name is unique inside the enablement, and its provider never changes.
- Another provider requires another agent provider.
- A credential change creates a revision.
- The component resolves the [effective configuration](agent.vocabulary.md#effective-configuration) of an agent from its enablement and one optional [entry](worker-service.vocabulary.md#entry) that the consumer supplies.
- It validates the whole configuration at enablement write, worker binding write and resolution.
- The [validation contract](agent.impl.md#agent-configuration-validation) defines these checks.
- An enablement change is refused when it invalidates any dependent worker binding.
- The refusal lists those bindings.
- The validation of all dependent worker bindings and the enablement change are atomic.
- Every enablement change creates a revision.
- Disablement is the only stop switch.
- An agent provider has no independent disablement.
- The agent page of the dashboard adds an agent provider to an existing enablement. The human names it and picks a credential, and the provider is the platform of that credential.
- Disablement refuses every later resolution, including a complete entry, so the instance healthcheck fails and no claim follows.
- The worker binding remains, and disablement recalls no handover in flight.
- Removal of an enablement is refused while any worker binding depends on its agent.
- Removal of an agent provider is refused while a default configuration or entry names it.
- A removal refusal lists its dependents.
- The check and removal are atomic.
- The [collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) preserves the shared invariants with the Project Service and the Worker Service.
- Each agent provider has a report-only [resource healthcheck](agent.impl.md#agent-provider-healthcheck).
- That check belongs to the health report, not the liveness answer or claim path.
- A human reads the models that an agent provider serves, with the reasoning efforts of each model. The list holds exactly the values that the validation accepts.

## Agent session

- An agent session runs the agent loop of one agent for one consumer.
- The component serves the resume of an agent session.
- A resume restores an agent session after the end of its client or the end of its consumer process.
- A turn that runs at that end is lost, and the resumed session restores every completed turn.
- The runtime of the agent stores the agent session in its own session format, on the host that runs the session.
- kanthord stores no copy of an agent session.
- The runtime owns its data directory, and kanthord deletes no file in it.
- The consumer names the identity of each agent session that it opens.
- A resume opens only the session of that identity.
