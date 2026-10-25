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
- Each agent provider pairs a provider with a credential name.
- A credential name holds one copy for each [holder](custody.vocabulary.md#holder). A consumer resolves the copy of its own holder.
- The holders of a worker binding are its listed [worker instances](worker-service.md#worker-instances) at the `worker` placement, and `server` when it lists an instance at the `server` or the `container` placement. The holder is `server` for a workbench session.
- For each holder of a consumer, every agent provider of the chain names a credential with a live copy of that holder. The chain covers the head and every fallback. That copy is sealed to the current key of the holder.
- This holder rule runs at enablement write, worker binding write and resolution. It refuses, and it never filters a chain entry.
- Each copy of a credential passes the approved-model membership of its own metadata.
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
- Removal of an agent provider is refused while a default configuration, an entry or a fallback configuration names it.
- A removal refusal lists its dependents.
- The check and removal are atomic.
- The [collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) preserves the shared invariants with the Project Service and the Worker Service.
- Each agent provider has a report-only [resource healthcheck](agent.impl.md#agent-provider-healthcheck).
- That check belongs to the health report, not the liveness answer or claim path.
- A human reads the models that an agent provider serves, with the reasoning efforts of each model. The list holds exactly the values that the validation accepts.

## Fallback chain

- The [fallback chain](agent.vocabulary.md#fallback-chain) of an agent is an ordered list of configurations. Its first item is the head, and the rest is the tail.
- The head is the [effective configuration](agent.vocabulary.md#effective-configuration). The tail is the list `fallback_configurations`.
- Two levels hold a tail: the enablement, with level `enablement`, and the [entry](worker-service.vocabulary.md#entry) of a worker binding, with level `binding`.
- A [fallback configuration](agent.vocabulary.md#fallback-configuration) is a complete `{ agent_provider, model_identifier, reasoning_effort }`.
- Each fallback configuration passes the validation of the default configuration.
- A tail holds at most 7 fallback configurations, so a chain holds at most 8 entries.
- An enablement requires `fallback_configurations`. The value `[]` means no fallback.
- An entry can name `fallback_configurations`. An entry can hold only that field. The head is then the default configuration.
- `fallback_configurations` is an overridable field of `swe@1` and `re@1`.
- The tail is the `fallback_configurations` of the entry when the entry names that field, else the `fallback_configurations` of the enablement.
- An omitted field inherits. A named field, also `[]`, replaces the tail of the enablement whole. A tail never merges across levels.
- The head and the tail resolve independently.
- The chain is the head, then the tail. A later chain entry with the same agent provider and model identifier as an earlier chain entry is dropped.
- A duplicate agent provider and model identifier inside one level answers 400 `agent.configuration.fallback_duplicate`.
- A fallback configuration with the agent provider and model identifier of the head of its level answers the same code.
- The enablement write validates each fallback configuration and calls no model check.
- A read-only model check warns on a chain entry before an enablement write.

### Advance

- An advance moves the selection of an agent to the next chain entry whose credential is not cooling.
- A release with the stop reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` advances the chain.
- The Scheduler Service calls the component in the release transaction. The component holds the credential of the pinned selection of that execution.
- The codes `bad_request` and `unauthorized` do not advance the chain. They count as failures.
- An advancing stop is neutral for the [consecutive failure limit](mission-service.md#consecutive-failure-limit). It neither counts nor ends the count.

### Cooldown

- A [cooldown](agent.vocabulary.md#cooldown) belongs to one copy of a credential: a credential name and one holder. It cools every model of that copy.
- `swe@1`, `re@1` and every project of one holder share that copy.
- The duration is the base of the code, doubled for each strike after the first, up to the maximum.
- A repeated advance on the same credential adds one strike.
- A cooldown is live while its end time is later than the clock. An expired cooldown keeps its strikes until a release with no `provider_failed` stop.
- A release with no `provider_failed` stop releases the credential of its pinned selection. A success on any model of the credential releases every model.
- A human clears a cooldown on the agent page or with the CLI. A clear releases the credential.

### Selection

- The claim scans the chain of each native agent of the worker. It selects the first chain entry whose credential copy of the claimant holder is not cooling.
- The holder of the claimant is the instance of its registration at the `worker` placement, and `server` at every other placement.
- An earlier chain entry returns at the next claim after its cooldown expires.
- When the credential of every entry of one agent is cooling, the claim answers no work.
- That answer creates no block, no pause and no failed execution.
- The claim pins each selection in the execution record as the agent name, the enablement revision and the chain position. The component rebuilds the [agent selection](agent.vocabulary.md#agent-selection) from the pin, the pinned worker binding revision and the pinned enablement revision.
- The model inference authorization of custody and the execution setup of the Worker Service read the pinned selection, and never the head.
- A disabled or removed current enablement still stops the authorization and the setup with 400 `agent.enablement.unavailable`. The pinned selection fixes the agent provider, the provider, the credential, the model and the reasoning effort. An enablement edit during a live execution changes none of them.
- A switch of the selection happens only at the next execution.
- The pin of a credential revision stays unchanged.

### Views

- The agent configuration views add `chain` and `active_position`. These are the agent view of this component and the project agent configuration views.
- `chain` lists each chain entry with its position, its level, its agent provider, provider, credential, model identifier, reasoning effort and cooldown. Position 0 is the head. The cooldown of an entry is the hold of its credential, with its strikes and end time, or null.
- `active_position` is the position that the next claim selects. It is null when every chain entry cools down.
- When every chain entry cools down, the view carries `cooling` with the code `agent.configuration.chain_cooling` and the earliest end time. Otherwise `cooling` is null.
- An invalid configuration answers an empty `chain`.
- The agent page shows the chain with a cooldown badge on each cooling entry and a Clear action.

## Prompt composer

- A human controls the prompt of an agent session through two prompts: the Agent prompt and the Binding prompt. The framing and the prompt templates are KanthorD protocol, not a prompt of a human.
- The Agent prompt is a set of three files. `base.md` is the Standard that every agent reads. It holds only the rules that every agent shares, a non-coding agent included. `<agent_name>.md` is the Role of one agent. `workbench.md` is the Workbench behavior, and only a Workbench session reads it.
- The component ships the text of each file. The binary embeds it, and no command downloads it.
- A file of the same name in the agent directory replaces the shipped text of that file whole. The agent directory is a path of the server host.
- An empty agent directory selects the shipped texts only.
- The Binding prompt is the text of `prompts[<agent_name>]` in the configuration of a [repository binding](project-service.md#repository-configuration-and-policy). Each agent name of the catalog holds its own text. A blank text is an absent text.
- The server composes the system prompt for every consumer. The order is `base.md`, `<agent_name>.md`, `workbench.md` for a Workbench session, one Binding prompt for each repository binding that holds a text, then the framing.
- `swe@1` and `re@1` read the Binding prompt of every repository binding of the node at its pinned revision. `env@1` reads the Binding prompt of the binding of its environment run.
- The precedence from the highest is the framing, the Binding prompt, `workbench.md`, the Role and the Standard. The messages follow the system prompt, and a later message governs an earlier one.
- An instruction of one repository governs only the work on the files of that repository. It never governs the reply format that a message demands.
- The Binding prompt of each agent is a separate text. A rule that relaxes the default standard goes into the Binding prompts of both `swe@1` and `re@1`.
- KanthorD reads no `CLAUDE.md`, `AGENTS.md` or `*.local.md` file of a repository or of a home directory. A native agent reads no instruction file in any form.
- `claude-code@1` receives no KanthorD text. Claude Code loads its own `CLAUDE.md` files as behavior of its harness, and KanthorD does not support that load.
- A file of the agent directory or of its `prompts` subdirectory that the loader rejects answers 409 `agent.prompt.template_invalid` at every reader. No reader replaces it with the shipped text.
- The work prompt is the task message of the consumer. It belongs to neither prompt, and the composer pins it.
- A change of an agent file takes effect at the next composition. A change of a Binding prompt is a change of the binding configuration, so it stores the next binding revision. A node keeps the text of its pinned binding revision until `mission node rebind`.
- A change of the Binding prompt gives the binding a new binding ID. Environment onboarding treats it as a changed binding and clears the mark that the stored environment came from `env@1`.
- The agent page shows each part of the system prompt as one read-only row, with its origin, its path and its digest. The binding sheet of a repository edits the Binding prompt of each agent. The dashboard has no screen that edits an Agent prompt file.
- The server and every worker host run the same execution setup contract, so a deploy upgrades them together.

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
