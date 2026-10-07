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
- Its name and its credential are each unique inside the enablement, and its provider never changes.
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
- The agent page of the dashboard creates an enablement or adds an agent provider to it. The human names it and picks a credential, and the provider is the platform of that credential.
- The enable form names the platform in each credential label and shows no separate provider line. It shows a failure to load the credentials or the models on the field that it concerns. After the human picks a credential, it fills the model picker and the reasoning-effort picker from the models of that credential.
- The agent page offers only a credential that no agent provider of the enablement names. With no such credential, it shows only `No credential is left.` and one action to add a credential.
- The agent page edits the default configuration with the same pickers as a new workbench session. A save keeps the agent providers unchanged.
- Each agent provider row of the agent page holds Remove behind a confirmation. Remove stays disabled on the last agent provider and on the agent provider of the default configuration.
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

## Prompt composer

- The prompt of an agent session has three layers: the system layer, the agent layer and the working layer.
- The component ships one base prompt, `base.md`, and one agent prompt for each agent of the catalog.
- A shipped prompt is the default of its agent. The binary embeds it, and no command downloads it.
- The system layer joins its sources in this order: the host agent file, the shipped `base.md`, the custom system prompt.
- The host agent file is the first of `~/.agents/AGENTS.md` and `~/.claude/CLAUDE.md` that exists.
- A human edits the custom system prompt on the dashboard, and the database stores it.
- Each source of the system layer holds one on or off switch. The system layer also holds one layer switch.
- Each agent name holds a system layer override: `inherit`, `on` or `off`. `inherit` takes the layer switch of the server. `on` and `off` decide the system layer of that agent only.
- When the system layer of an agent is off, the composer joins no source of the system layer for that agent. When it is on, the source switches decide which sources join.
- The composer joins every source that is on. No source has a merge or override mode.
- The agent layer joins its sources in this order: the agent file of the agent directory, the shipped agent prompt, the custom agent prompt.
- The agent file of the agent directory is `<agentName>.md`, for example `~/workdir/swe@1.md`.
- A human edits the custom agent prompt on the dashboard, and the database stores it.
- Each source of the agent layer holds one on or off switch. A switch change that turns off every source of the agent layer is refused.
- The working layer joins its sources in this order: `AGENTS.md`, `AGENTS.local.md`, `CLAUDE.md` and `CLAUDE.local.md` of the working directory, the shipped consumer prompt, the custom working prompt.
- Each source of the working layer holds one on or off switch. An evaluation reads no agent file of the workspace.
- The layer switch and the source switches of the system layer belong to the server. The system layer override and the agent layer switches belong to the agent name.
- The working layer switches belong to the repository binding for a Worker execution, and to the agent name for a workbench session.
- The server composes the system layer and the agent layer for every consumer. The host that holds the working directory reads the agent files of the working layer.
- The `Settings` section of the dashboard, at `/settings/prompts`, manages the system layer: its layer switch, its source switches and its custom system prompt. The agent page manages the system layer override, the agent layer and the workbench working layer of its agent.
- The agent page shows the system layer override as a three-way control with the effective state, for example `Follows server: Off`. While the system layer of a scope is off, its source rows are dimmed and stay editable.
- The custom source row holds an edit button. It opens a sheet with a Write tab and a markdown Preview tab, a byte counter against the 32768-byte limit and one save action. Save stays disabled while the text is unchanged or above the limit. An empty text removes the custom prompt.
- A close of the editor with unsaved changes asks before it discards the draft. A revision conflict keeps the draft and offers to load the latest revision.
- The Settings section edits the custom system prompt. The agent page edits the custom agent prompt and the custom working prompt of its agent.
- Each source row holds its on or off switch. A switch is disabled, with a tooltip that states the reason, for the last source that is on in the agent layer and for a file source whose state is `absent`.
- The agent page shows each prompt source as one row, collapsed by default. The title of a row is the path of its file, else the name of the source. A chevron points right when the row is collapsed and down when it is expanded. The expanded row renders the text as markdown in a scrollable panel.
- Each row with text holds a button that copies the raw markdown. A row with no text is inactive: it holds no chevron and no copy button.
- `kanthord.yaml` holds the paths of the prompt sources only: the system file and the agent directory.
- When `kanthord.yaml` names a system file, the host agent file is that file, and the composer runs no discovery.
- The database holds every switch and every custom text. The dashboard edits a switch or a custom text, and it edits no path.
- A path change takes effect at the next server start. A switch change or a text change takes effect at the next agent session.
- The work prompt is the task message of the consumer. It belongs to no layer, it holds no switch, and the composer pins it.
- An operator override replaces or extends a shipped prompt on one server.
- An override takes the position and the precedence of the prompt that it replaces or extends.
- The composition record names the source and the digest of every prompt that an agent session runs with.

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
