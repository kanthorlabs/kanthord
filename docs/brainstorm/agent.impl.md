---
title: Agent Implementation
---

# Agent Implementation

This file holds the mechanisms that realize [agent.md](agent.md).
This file is not a design document, and `agent.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## Runtime reuse

- The runtime is `@earendil-works/pi-coding-agent` at 1.1.0.
- A design of a consumer starts from the capability of pi that serves it, and it states the gap that kanthord builds.

## The agent catalog

- The catalog is a static server module that holds one declaration per agent name, with options, a whole-configuration constraint and prompts.
- Options use `zod` at 4.4.3, and the constraint uses `superRefine`.
- `swe@1` and `re@1` declare an empty option schema.
- A declaration holds `display_name` and `tools`. `AgentTools` is `{ builtin, host, operation, workbench }`. `builtin`, `host` and `workbench` hold tool names, and `operation` holds operation ids. `workbench` holds `evidence_read` for `swe@1` and `re@1`, and it is empty for `pe@1` and `ops@1`.
- `workbenchAgentNames()` is the one reader of the session rule. It answers the agents whose `tools.operation` is not empty. The Workbench lists and opens only those agents, and it refuses another agent with the unknown-agent code. `pe@1` lists no operation.
- The list test of `engine/src/workbench/tools.test.ts` checks that every listed id names an operation that `toolOperations` keeps, and that no list names a secret operation.
- The shipped role of `swe@1` states the split of the coder flow: the agent writes the code, runs any check while it works, and checks the work against the criterion and the default standard before it ends a turn. The worker runs the verifications after the turn. `swe@1` gives no judgement. [assets/prompt/swe@1.md](assets/prompt/swe@1.md) holds the text.
- The worker framing holds the protocol conditions that apply to `swe@1`, `re@1` and `pe@1`: the worker owns the commit, the branch, the push, the verification and the release, and an agent writes a scratch, debug or probe file only under `.kanthord-scratch/` at the workspace root.
- RULED 2026-10-24 by Ulrich (D14). A change of a shipped prompt text before the first tag keeps the agent names `swe@1`, `re@1` and `pe@1` and the worker name `coder@1`. Ulrich renamed the environment repair agent to `pe@1` on 2026-11-12 before the first tag.
- The shipped role of `re@1` judges the evidence against the criterion and changes no file.
- The declaration supplies no provider, model identifier or reasoning-effort default.
- `agent list` answers one summary per catalog agent: `{ agent_name, display_name, worker_names, consumers, tool_counts, enablement }`.
- `consumers` names the services that run the agent, in the order `workbench`, `worker`. `workbench` comes from `workbenchAgentNames()`. `worker` comes from the released workers that name the agent and from the project environment agent `pe@1`. At L0, `swe@1` and `re@1` hold `["workbench", "worker"]`, `ops@1` holds `["workbench"]` and `pe@1` holds `["worker"]`.
- `tool_counts` holds one count for each tool source: `builtin`, `host`, `kanthord-mcp`, `operation` and `workbench`. The count comes from the tools of `agent.get`.
- `agent get` answers `display_name`, `prompt`, `configuration_schema`, `overridable_fields`, `tools`, `enablement`, `chain`, `active_position` and `cooling`.
- `enablement` is null when no record exists.
- `agent.get` is `GET /api/agent/:agent_name`, keyed by agent name. It answers `agent_name`, `display_name`, `configuration_schema`, `overridable_fields`, `prompt`, `tools`, `enablement`, the agent enablement or `null`, and the [chain view](#the-chain-view). A tool item holds the source, the name, `description` and `guard_class`. The source is `builtin`, `host`, `kanthord-mcp`, `operation` or `workbench`. `guard_class` is `read` or `card` for an operation item, `card` for a `workbench` item and `null` for any other source. An unknown agent answers 404 `agent.catalog.not_found`. [The prompt answer](#the-prompt-answer) defines `prompt`. [Configuration schema](#configuration-schema) defines the schema, and [the agent catalog](#the-agent-catalog) owns the declaration.
- Tests cover each human read, each unknown name, and null and disabled enablements.

## The prompt answer

- `prompt` holds `parts` and `final`.
- `parts` holds the parts of the system prompt in reading order, the framing last. Each part holds `{ layer, part, name, origin, path, binding_id, commit, digest, heading, state, text }`.
- The first seven fields form the [prompt reference](agent.vocabulary.md#prompt-reference) of the part. `promptReferenceSchema` of `engine/src/agent/contract.ts` defines it, and `promptPartSchema` adds `layer`, `heading`, `state` and `text`.
- `part` is one of `standard`, `identity`, `role`, `workbench`, `instruction_file`, `repository`, `binding` and `framing`. `origin` is one of `binary`, `file`, `database` and `repository`. `state` is one of `resolved`, `changed`, `invalid` and `unreachable`. The three are the code enums `PromptPart`, `PromptOrigin` and `PromptPartState`.
- `layer` is 1 for `standard`, `identity`, `role` and `workbench`, 2 for `instruction_file` and `repository`, 3 for `binding`, and null for `framing`.
- `standard` is `base.md` and `role` is `<agent_name>.md`. `identity` is the rendered template `identity`. It stands between `standard` and `role` in the system prompt of both surfaces, for every agent of `workbenchAgentNames()`. `workbench` is `workbench.md`, and only the Workbench system prompt holds it. For each repository binding in binding order, `instruction_file` is the file of `prompts.instruction_file`, `repository` is the nonblank text of `prompts.repository`, and `binding` is the nonblank text of `prompts.agents[<agent_name>]`.
- `name` is the file name of a layer 1 part. It is the template name of `framing`, for example `framing-worker`. It is the binding name of a layer 2 or layer 3 part.
- `origin` is `binary` for a shipped text, `file` for an override file, `database` for `repository` and `binding`, and `repository` for `instruction_file`.
- `path` is the override location that the server looked up for `binary` and `file`. It is the repository path for origin `repository`, and `null` for origin `database` and when `agent.prompt.agent_directory` is empty.
- `binding_id` is the binding revision of a layer 2 or layer 3 part, and `null` otherwise. `commit` is the commit of origin `repository`, 40 or 64 lower-case hex, and `null` otherwise.
- `digest` is the SHA-256 hex digest of the exact UTF-8 text of the part, with no heading. It is null for a part that the server cannot read: an `invalid` or `unreachable` instruction file of `agent.get`.
- `heading` is the plain-text line that the server writes before the text. The dashboard renders no heading itself.

| Part                                       | `heading`                                                  |
| ------------------------------------------ | ---------------------------------------------------------- |
| `standard`, `role`, `workbench`, `framing` | null                                                       |
| `instruction_file`                         | `Repository prompt of repository <name>, file <path>:`     |
| `repository`                               | `Repository prompt of repository <name>, set in KanthorD:` |
| `binding`                                  | `Binding prompt of repository <name>:`                     |

- Only a `resolved` part holds `text`. A failed layer 2 read is a part state, and the read itself answers 200. An unreachable remote answers `unreachable`. An instruction file that is too large, is not UTF-8, cannot be read or holds a control character answers `invalid`. A text whose digest differs from its reference answers `changed`.
- `final` holds the system prompt: each part in reading order. A part with a heading renders as the heading, a blank line and the text. `final` is null when a part is not `resolved`.
- The query `view=final` answers `prompt` with `final` only.
- The optional queries `project_id` and `binding_id` select the repository binding whose layers 2 and 3 join `final`, and `final` is then the Worker final. The read takes the instruction file at the current base head, as the next attempt takes it. Without them, a Workbench agent answers the Workbench final, and `pe@1` answers the Worker final.
- The optional queries `node_id` and `attempt` select the stack that the agent of one node reads. `attempt` is a positive integer. Without `attempt`, the read takes the open attempt, else the latest attempt. The read takes the instruction file at the commit that the attempt pins, and at the current base head for an attempt with no pin.
- A `node_id` that names no mission node answers 404 `mission.node.not_found`. A node with no attempt, or with no attempt `attempt`, answers 404 `mission.record.not_found`.
- A `binding_id` that names no repository binding of `project_id` answers 404 `project.binding.not_found`. One of the two queries without the other answers 400 `gateway.request.validation_failed`. `attempt` without `node_id`, and `node_id` with `project_id` or `binding_id`, answer 400 `gateway.request.validation_failed`.
- `agent.prompt.resolve` is `GET /api/agent/prompt/resolve?execution_id=&agent_name=` under the `human` access policy. The static segment `prompt` matches before `:agent_name`.
- The resolve reads the `agent.prompt` span of the execution and the agent, resolves each reference of `kanthord.prompt.sources` by its origin and checks each digest. It answers `{ parts, final, engine_version }`. `engine_version` is the value of `kanthord.engine.version` of the span. Each part holds the `digest` and the `commit` of its span reference, also when the part is not `resolved`.
- The resolve reads only the references that the server wrote in a span, so it reads no file that a caller chooses.
- An absent execution answers 404 `scheduler.execution.not_found`. A trace with no `agent.prompt` span for the agent answers 404 `agent.prompt.record_absent`.
- A `changed` part of origin `binary` holds no text. The page `docs/cli/agent.md` of the engine gives the git command that reads the shipped text from the root release tag `v<engine_version>`: `git -C engine show "$(git rev-parse "v<engine_version>:engine"):static/prompt/<name>"`. A development build has no release tag, so its version names no unique engine commit.
- Tests cover every part, every origin, every state, `view=final`, the Workbench final, a Worker final with a binding, a node with and without a pin, a resolve with a `changed` part, each refusal and a non-human caller of the resolve.

## Agent configuration validation

- The Agent component owns enablement writes and effective configuration resolution.
- The Worker Service owns `validateEntry(tx, workerName, entry)`, and it validates the entry of each agent of the worker through the Agent component.
- The [entry forms](worker-service.vocabulary.md#entry) define inheritance and required fields.
- A write refuses nonempty `options`.
- Every enablement write, worker binding write and resolution runs the same checks.
- Every enablement write names `expected_revision`, the latest row of the agent that the human read. A `put` for an agent with no row names none. A `put` after a removal names none. A stale or absent value answers 409 `agent.enablement.revision_conflict` with the current value in `details`.
- A `put` or a `provider.add` that names the name of another agent provider of the same enablement answers 409 `agent.enablement.provider.name_conflict`.
- A `put` or a `provider.add` that names a credential of another agent provider of the same enablement answers 409 `agent.enablement.provider.credential_conflict`. A `provider.add` names the credential and the holding agent provider in `details`.
- It checks the override allowlist before the merge, then validates the complete effective configuration.
- `overridable_fields` of `swe@1` and `re@1` is `["agent_provider", "model_identifier", "reasoning_effort", "fallback_configurations"]`.
- `validateEntry` refuses a worker whose agent has no enabled enablement, and names that agent.
- This refusal occurs inside the worker binding write transaction.
- An enablement change calls `entriesOfAgent(tx, agentName)` of the Project Service in the transaction of its commit.
- It validates every dependent worker binding and lists invalid bindings in its refusal.
- Removal checks all dependents in that same transaction.
- A dependent of an agent provider is the default configuration, an entry or a fallback configuration. [The fallback chain](#the-fallback-chain) lists the dependents.
- [The collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) requires co-location of the two owners.
- A resolution reads the worker binding, entry, enablement and credential metadata from one snapshot, and it records the revisions of the binding, the entry and the enablement.
- The span of each native model inference call carries the worker binding and the agent enablement as identity attributes. Each value is the row id that the resolution read, so the span records the revisions of the binding, the entry and the enablement.
- Resolution makes no network call.
- The instance healthcheck reports whether the effective configuration resolves.

Provider definitions contain no auth types; the [LLM component](llm.impl.md#platform-validators) owns those types, and custody owns suitability.

- A provider is a member of the [agent provider set](agent.vocabulary.md#agent-provider).
- Built-in definitions use `getBuiltinProviders()` of `@earendil-works/pi-ai` at 1.1.0.
- A model identifier belongs to `getBuiltinModels(provider)` or to the [approved models](llm.impl.md#the-approved-models) that the LLM component answers for an `openai-compatible` credential.
- An empty `models` list permits no model selection.
- The reasoning effort belongs to the model's supported levels from `getSupportedThinkingLevels` or credential metadata `reasoning_levels`, which defaults to `["off"]`.
- A level that no source establishes fails validation.
- The Agent component sends `{ credential, platform }` to custody and consumes its suitability result.
- It reads no metadata and no secret.

### The holder rule

- The holders of a worker binding are the names in `worker_instances` of its instances at the `worker` placement, which the Project Service answers through `workerBindingOf`. The holder `server` joins them when the binding lists an instance at the `server` or the `container` placement. The holder is `server` for a workbench session.
- The chain holds the head and every fallback. For each holder and each agent provider of the chain, custody checks the copy of the [copy holder](custody.vocabulary.md#copy-holder) of that holder. The copy holder of an instance is its own copy when it holds one, else its machine.
- That copy is a live `(credential, copy holder)` group, and its `sealed_current` is true.
- A failure answers 400 `agent.configuration.credential_holder_mismatch` with `details: { agent, agent_provider, credential, holder }`.
- The rule runs at enablement write for every dependent worker binding, at worker binding write and at resolution. It refuses, and it never filters a chain entry.
- A new instance in `worker_instances` needs its own copies or the copies of its machine first. A Reset key of an instance makes every binding that lists it fail at resolution until a human enters each own copy again.
- A Reset key of a machine makes every binding fail at resolution that lists an instance whose copy holder is the machine. A human then signs in again or enters each machine copy again.
- The enablement validation reads the platform of the name and the metadata of every copy. Each copy passes the approved-model membership of its own metadata.

## Model list

- `agent.enablement.provider.model.list` is `GET /api/agent/enablement/:agent_name/provider/:provider_name/model`, `human`, `unary`, `mutation: false`.
- It answers `{ items: [{ model_identifier, reasoning_efforts }] }` for the agent provider of the latest enablement row of the agent.
- A built-in platform answers `getBuiltinModels(provider)` of pi-ai, and `reasoning_efforts` holds `getSupportedThinkingLevels` of each model.
- An `openai-compatible` provider answers the approved models of its credential, and `reasoning_efforts` holds the `reasoning_levels` of each model. A model is approved when every copy of the credential approves it.
- The list uses the sources of [the validation](#agent-configuration-validation), so every listed pair passes it.
- An unknown agent answers 404 `agent.catalog.not_found`. An absent enablement answers 404 `agent.enablement.not_found`. An absent provider answers 404 `agent.enablement.provider.not_found`.
- The dashboard fills the model picker and the reasoning-effort picker of a workbench session from this list.
- `agent.model.list` is `GET /api/agent/model`, `human`, `unary`, `mutation: false`. Its query holds `provider`, an agent provider kind, and `credential`, a credential name. It needs no enablement.
- It answers the same `{ items }` from the same sources for that provider kind and credential. A credential that custody finds unsuitable for the provider kind answers 400 `agent.configuration.credential_unsuitable`.
- The dashboard fills the model picker and the reasoning-effort picker of a new enablement from this list, after the human picks a credential.
- A switch of the agent provider in a picker reloads this list and resets the model to its first model. The effort stays when the new model lists it, else it takes the first listed effort.

## Configuration schema

- `configuration_schema` uses JSON Schema draft 2020-12, emitted by `z.toJSONSchema` of `zod` at 4.4.3.
- Its source is the effective-configuration schema, not the template's option schema.
- The root is an object with `additionalProperties: false`.
- All five properties below are required; none carries `default`, and the schema holds no `options`.

| Property           | Schema                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `agent_provider`   | `string`; the name of an agent provider of the enablement                                    |
| `provider`         | `string`, enum of every platform of the [LLM platform list](llm.impl.md#platform-validators) |
| `credential`       | `string`; a credential name                                                                  |
| `model_identifier` | `string`                                                                                     |
| `reasoning_effort` | enum `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`                               |

- The schema description states the whole-configuration constraint of [configuration validation](#agent-configuration-validation).
- It names model membership in the provider catalog and reasoning-effort membership in the supported levels of that model.
- JSON Schema validates no cross-field lookup; the Agent component enforces it.

## The fallback chain

- The column `agent_enablement.fallback_configurations` is `TEXT NOT NULL DEFAULT '[]'`. It holds a JSON list of `{ agent_provider, model_identifier, reasoning_effort }`.
- An enablement write requires `fallback_configurations`. A write without the field answers 400 `gateway.request.validation_failed`.
- The entry of a worker binding holds the optional field `fallback_configurations` with the same shape.
- A list holds at most 7 items. A longer list answers 400 `gateway.request.validation_failed`.
- Every item passes the validation of the default configuration. The write validates an item of an enablement against the agent providers of that enablement.
- The write validates an item of an entry against the agent providers of the enablement of its agent.
- A duplicate agent provider and model identifier inside one list answers 400 `agent.configuration.fallback_duplicate`.
- An item with the agent provider and model identifier of the head of its level answers the same code. The head of the enablement is its default configuration.
- The resolution reads the snapshot of [the validation](#agent-configuration-validation). The head is the effective configuration.
- The tail is `fallback_configurations` of the entry when the entry names the field, else that of the enablement. The tail never merges.
- The chain is the head and the tail. The resolution drops a later chain entry with the agent provider and model identifier of an earlier chain entry.
- The chain holds at most 8 entries. Each chain entry holds its level, `enablement` or `binding`.
- An entry that names only `fallback_configurations` keeps the default configuration as its head. The allowlist of `overridable_fields` admits the field.
- A removal of an agent provider answers 409 `agent.enablement.provider.in_use` while a tail names it.
- `details.dependents` holds `{ kind: "fallback_configurations" }` for the tail of the enablement, and `{ binding_id, worker_name }` for the tail of an entry.
- [LLM metadata](llm.impl.md#platform-validators) refuses the removal of a model that a tail names. A tail item is a dependent of that model.
- Tests cover inheritance, replacement, `[]`, the drop of a duplicate, the limit of 7 and each refusal.
- Tests cover an enablement write without the field, a provider removal that a tail blocks and a model removal that a tail blocks.

## The chain view

- `chain` is a list of `{ position, level, agent_provider, provider, credential, model_identifier, reasoning_effort, cooldown }`. Position 0 is the head.
- `cooldown` is `null` or `{ strikes, available_at }`. In `agent.get`, it reads the hold of the copy of the `server` holder. In a project view, it reads the hold of the copy of the copy holder of each holder of the binding. It shows the hold with the latest `available_at`. Every chain entry of one credential shows the same `cooldown`.
  - A hold that expired still shows in `cooldown` with its `strikes` and a past `available_at` until a success or a clear. Selection treats it as free.
- `active_position` is the position of the first chain entry whose `cooldown` is `null` or whose `available_at` is not later than the clock reading. It is `null` when every chain entry has a live cooldown.
- `cooling` is `null`, or `{ code: "agent.configuration.chain_cooling", available_at }` when `active_position` is `null`. `available_at` is the earliest `available_at` of the chain.
- The `agent.get` view of an agent builds the chain from the enablement alone. An absent enablement answers `chain: []`, `active_position: null` and `cooling: null`. A disabled enablement answers the same.
- The project agent configuration views build the chain from the effective configuration and the entry of the worker binding. An invalid configuration answers `chain: []`.
- The views read the clock once for each answer.
- Tests cover a chain with no cooldown, one cooling entry, every entry cooling, an expired cooldown and an invalid configuration.

## The agent cooldown

- The cooldown of a credential copy lives on the row of revision 1 of its `(name, holder)` group. The columns are `credential.available_at` and `credential.strikes` of [ERD 1](../reference/erd/01-setup.html). No table `agent_cooldown` exists.
- `available_at` is the Unix millisecond end of the hold, and it is null while no hold exists. `strikes` is a non-negative integer, 0 while no hold exists.
- A hold cools every model of the credential. No model identifier and no execution identity enter the hold.
- The duration is `min(base(code) × 2^(strikes − 1), agent.cooldown.max_ms)`. `available_at` is the clock reading of the transaction plus the duration.
- `base(code)` is the value of `agent.cooldown.rate_limited_ms`, `agent.cooldown.quota_exhausted_ms` or `agent.cooldown.unavailable_ms`.
- A cooldown is live when `available_at` is later than the clock reading of the transaction.
- The Agent component owns the rules of the hold. [Custody](custody.impl.md#the-credential-hold) owns the columns and offers the port `CredentialHolds`. The Agent component reaches the columns through that port only.

### Configuration

The Agent component owns these keys of the section `agent`.

- `agent.cooldown.rate_limited_ms` holds the base duration for `rate_limited`, in milliseconds. It is a positive safe integer and defaults to `60000`.
- `agent.cooldown.unavailable_ms` holds the base duration for `unavailable`, in milliseconds. It is a positive safe integer and defaults to `60000`.
- `agent.cooldown.quota_exhausted_ms` holds the base duration for `quota_exhausted`, in milliseconds. It is a positive safe integer and defaults to `3600000`.
- `agent.cooldown.max_ms` holds the maximum duration, in milliseconds. It is a positive safe integer and defaults to `86400000`.

### The release write

- The Scheduler Service calls the Agent component in the release transaction of an execution. The call carries the pinned selection of each agent of the execution and the `stop`.
- A `stop` with the reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` holds the credential copy of each pinned selection. That copy is the `(name, holder)` group of the row that the execution pins, so `hold` takes the holder of that row. A copy that two selections share is held once.
- The hold adds 1 to `strikes`, so the first failure sets `strikes` to 1, and it sets `available_at`.
- A `stop` with the reason `provider_failed` and the code `bad_request` or `unauthorized` holds no credential and releases no credential.
- A release with no `stop`, or with a `stop` whose reason is not `provider_failed`, releases the credential of each pinned selection. A success on any model therefore releases the whole credential.
- A release of a credential sets `available_at` to null and `strikes` to 0. It changes a row only when `strikes` is above 0, also for a hold whose `available_at` is in the past.
- An advancing `stop` is neutral for the failure count, as [the failure count](scheduler-service.impl.md#loss-settlement) states.
- The write logs `agent.fallback.cooldown_started` at level `info` with `execution_id`, `credential_name`, `holder`, `code`, `strikes` and `available_at`, once for each held credential. `strikes` and `available_at` are the new values of the hold.
- A release that changes a row logs `agent.fallback.cooldown_cleared` at level `info` with `execution_id`, `credential_name` and `holder`, once for each credential. A release of a credential with `strikes` 0 logs nothing.
- A human clear of a cooldown logs `agent.fallback.cooldown_cleared` at level `info` with `credential_name`, `holder` and no `execution_id`.
- The release and the clear write the cooldown logs after their commit, so a rolled-back write leaves no log line. The write returns the cooldown changes to the Scheduler Service, which passes them to the Agent component through `AgentChains.cooldownsChanged` after the release commits. The clear writes its log after its own commit.

### The claim selection

- The claim transaction calls the Agent component with the pinned worker binding row and the native agents of the worker.
- The component builds the chain of each agent and reads the hold of the credential copy of the claimant holder for each chain entry.
- At the `worker` placement, the claimant holder is the instance of the registration. At the `server` and the `container` placements, it is `server`.
- `holdOf` at the claim resolves the claimant holder through the copy holder of custody. The hold of a claimant is thus the hold of its copy holder. Every instance that uses one machine copy shares its hold.
- Custody pins the row of the `(name, copy holder)` group at first use.
- It returns the first chain entry whose credential is not cooling.
- A credential is cooling when its `available_at` is later than the clock reading. Every model of a cooling credential is skipped.
- When the credential of every chain entry of one agent is cooling, the claim answers `{ kind: "no-work" }`. It writes no block, no pause and no execution. The internal answer `AgentChoice.Cooling.available_at` holds the earliest end of the hold. No reader uses it today. A parked work pull waits for its wake or for the earliest job `available_at`, and not for the end of a hold.
- The claim stores one pin for each selection in `scheduler_execution.agent_selections`: `{ agent_name, enablement_id, position }`. `enablement_id` is the identity of the enablement revision that the selection read. The [execution record](scheduler-service.impl.md#operation-contracts) defines the column.
- The component rebuilds the pinned selection from a pin with the pinned worker binding row and the pinned enablement revision. A later hold, enablement revision or worker binding revision changes no pin.
- After the claim commits a new execution, the Scheduler Service passes the selections to the Agent component. The component logs `agent.fallback.selected` at level `info` for each selection with `execution_id`, `agent_name`, `chain_position`, `chain_level`, `agent_provider`, `provider`, `model_identifier` and `credential_name`.
- A pull that claims no work logs no selection. A pull that answers the running execution logs no selection. The probe of a pull rolls back, so it logs no selection.
- The log names the fields `chain_position` and `chain_level`, because the logger writes its own top-level key `level`. The names also match the span attributes `kanthord.agent.chain_position` and `kanthord.agent.chain_level`. It names the credential `credential_name`, because the redaction paths of the operational log hold `credential`.
- The span `agent.turn` of the native producer carries `kanthord.agent.chain_position` and `kanthord.agent.chain_level`. The values come from `position` and `level` of the entry of the agent in the execution setup.
- Tests cover the selection of the first entry with a free credential and the return of an earlier entry after its hold expires.
- Tests cover the skip of every model of a cooling credential and the no-work answer.
- Tests cover the rebuild of the pinned selection from a pin after a later enablement revision.

### The operator operations

- `agent.cooldown.list` is `GET /api/agent/cooldown`, `human`, `unary`, `mutation: false`.
- It answers `{ items: [{ credential, holder, strikes, available_at }] }`. It lists each credential copy with `strikes` above 0, live and expired, ordered by credential name and holder.
- `holder` is the group holder: `server`, a machine name for a machine copy, or an instance name for an own copy.
- `agent.cooldown.clear` is `DELETE /api/agent/cooldown/:credential`, `human`, `unary`, `mutation: true`. It takes the query `holder`, which defaults to `server`. `holder` takes `server`, a machine name or an instance name. It releases the copy and answers 204.
- A copy with no hold, that is `strikes` 0 or an unknown name or holder, answers 404 `agent.cooldown.not_found` with `details: { credential, holder }`.
- The CLI commands are `kanthord agent cooldown list` and `kanthord agent cooldown clear <credential> [--holder <name>]`.
- The static path `/api/agent/cooldown` does not match `GET /api/agent/:agent_name`.
- Tests cover the list with live and expired holds, a clear and the 404.

### The cooldown tests

- Tests cover the hold, the strikes, the maximum for each code and the codes that do not advance.
- Tests cover the release of a credential by a release with no `provider_failed` stop.
- Tests cover the hold of every model of a credential and the hold that agents and projects share.
- A test asserts that a later cooldown leaves the pin of a live execution unchanged.
- Tests cover the neutral advancing stop and the pin in the execution record.
- A test asserts that a rotation of the credential keeps the hold.
- A test runs a fake provider that completes the execution on the first chain entry.

## Agent provider healthcheck

- Every agent provider has a report-only resource healthcheck in the [health report](gateway-service.impl.md#the-resource-healthcheck-report).
- The check calls the [check of the LLM provider](llm.impl.md#the-llm-provider) of its credential and reports provider readiness.
- It groups calls by credential and attributes the result to each agent provider.
- A credential whose platform has no LLM provider reports `unknown`.
- The check reads the copy of the holder `server`. A credential with only machine or instance copies reports `unknown` with `failure_reason: held_by_instance`, and the check releases nothing.
- Its `capability` is the [capability of the LLM provider](llm.impl.md#the-llm-provider) of its credential, which the LLM component answers.
- The check belongs to neither the liveness answer nor the claim path; instance healthchecks retain local resolution.
- [LLM healthcheck limits](llm.impl.md#the-resource-healthcheck) govern forbidden calls, unavailable calls and OAuth expiry without refresh.
- Shared probe code changes no owner.

## Configuration tests

- Tests cover both entry forms, missing enablement, disablement, complete-entry refusal and the empty option schema.
- A test covers two enablement writes that name one expected revision, and it asserts that the second one answers 409 `agent.enablement.revision_conflict`. A test covers a `put` without `expected_revision` for an agent that holds a row.
- Tests cover override allowlists, model catalogs, established reasoning levels and all five effective-configuration fields.
- Tests assert schema draft, required properties, absent defaults, absent options and the whole-configuration description.
- Tests cover transactional changes and removals, dependency lists, snapshot reads and recorded revisions.
- Tests cover the holder rule at enablement write, binding write and resolution. The cases are a missing copy, a copy sealed to an ended fingerprint and a fallback entry without a copy. A test checks the copy that a claim of each holder resolves.
- Tests cover the metadata provider build, per-model base URLs, zero costs and absent environment keys.
- Tests cover every provider-check answer, status, deadline and the absence of raw keys.
- Tests cover healthcheck grouping, attribution, report-only behaviour and no inference call.

## Prompt files

- The KanthorD prompt holds no table and no setting row. The files `base.md`, `<agent_name>.md` and `workbench.md` are its only source.
- The server composes every consumer from the same reader of the agent directory. The worker application reads no prompt file.
- `agent.prompt.agent_directory` holds the path of a directory, as a string, and it defaults to `agents`. The file of `swe@1` is then `~/.local/share/kanthord/agents/swe@1.md`.
- An empty value means that every file is the shipped text.
- A relative path resolves against the data directory.
- A file of the same name in the agent directory replaces the shipped text of that file whole.
- The reader takes a file as UTF-8 Markdown of at most 32768 bytes, with no control character other than a tab and a newline. The reader resolves no `@` import. A deadline of 10 seconds bounds each read.
- A file that the reader rejects answers 409 `agent.prompt.template_invalid` with `file`, `path` and `reason` in `details`. `file` names the file, for example `swe@1.md`. An absent file selects the shipped text.
- Every reader refuses in the same way: `agent.get`, the execution setup, the Workbench session open and the `pe@1` run. No reader replaces an invalid file with the shipped text.
- The Repository prompt and the Binding prompt are the key `prompts` of the `config` JSON of a repository binding: `prompts.instruction_file`, `prompts.repository` and `prompts.agents`. The [Project Service](project-service.impl.md#validation) owns their validation.
- The keys of `prompts.agents` are the agent names of the catalog. The catalog is the only list, so no new enum exists.
- The composer reads the instruction file through the Project read `instructionFileOf`, with the Repository component reader. The reader follows a symbolic link inside the tree at the commit, so `AGENTS.md -> docs/agents.md` reads `docs/agents.md`.
- The reader state `present` gives a part. `absent`, `not_regular_file` and `outside_root` give no part. `too_large`, `not_utf8` and `unreadable` answer 409 `agent.prompt.source_invalid`.
- A present text passes the text validation of a prompt file. A text with a control character answers 409 `agent.prompt.source_invalid` with `reason: control_character`. A carriage return is a control character, so a file with CRLF line ends is invalid. The reader converts no newline.
- `agent.prompt.source_invalid` holds `details: { part, name, binding_id, path, commit, reason }`. `binding_id` and `commit` are null for a layer 1 part. The execution setup and the `pe@1` run answer it.
- A retried execution setup that finds a stored part that no longer resolves answers 409 `agent.prompt.source_invalid` with `reason: changed`.
- The configuration holds no `agent.prompt.system_file` or `agent.prompt.host_file`. A config step deletes both.
- Tests cover an empty and a nonempty `agent_directory`, a relative path, an absent file, each rejection and each reader that refuses. Tests cover each reader state of an instruction file, a link inside the tree and a file with CRLF line ends.

## Prompt templates

- The binary ships one Handlebars template per agent-facing text under `static/prompt/template/`: `work`, `identity`, `framing-worker`, `framing-workbench`, `task-revision`, `criterion-revision`, `conflict`, `evaluation`, `examine` and `repair`.
- A file `<name>.md` in the subdirectory `prompts` of the agent directory replaces the shipped template of that name. With the default `agent_directory`, the file of `evaluation` is `~/.local/share/kanthord/agents/prompts/evaluation.md`.
- An empty `agent_directory` means that every template is the shipped template.
- The server resolves the template set at each prompt composition. The loader reads each file under the rules of [prompt composition](worker-service.impl.md#prompt-composition).
- A file that the loader rejects, or that Handlebars cannot compile, answers 409 `agent.prompt.template_invalid` with `template`, `file`, `path` and `reason` in `details`. The server uses no shipped template in its place.
- A render answers 409 `agent.prompt.template_invalid` with `reason` `render` when the template names a value that the caller does not supply.
- The renderer escapes no value, and it permits no helper other than the built-in block helpers and `json`. `json` writes its argument as JSON.
- The renderer removes the trailing whitespace of the rendered text.
- The execution setup carries the resolved template set, so the worker application reads no template file.
- The values of each template:

| Template             | Values                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `work`               | `node.name`, `node.requirement`, `node.criterion`, `name`, `requirement`, `criterion`, `verifications[].number`, `verifications[].command`, `tasks[].number`, `tasks[].id`, `tasks[].name`, `tasks[].criterion`, `repositories`, `affected_tests` |
| `identity`           | `display_name`                                                                                                                                                                                                                                    |
| `framing-worker`     | none                                                                                                                                                                                                                                              |
| `framing-workbench`  | none                                                                                                                                                                                                                                              |
| `task-revision`      | `rationale`, `results`, `output`, `release`                                                                                                                                                                                                       |
| `criterion-revision` | `rationale`, `findings`                                                                                                                                                                                                                           |
| `conflict`           | `binding`, `directory`, `base_branch`, `files`                                                                                                                                                                                                    |
| `evaluation`         | `tasks`, `tested_input`, `evidence`, `dependencies`, `affected`, `marker`, `round`, `prior_findings`, `full_change`                                                                                                                               |
| `examine`            | `repositories`, `verification`, `dependencies`, `outcomes`, `evidence`                                                                                                                                                                            |
| `repair`             | `marker`, `issues`                                                                                                                                                                                                                                |

- `repositories` lists `{ name, directory, base_branch }` for each repository binding of the pinned revision, in binding order. `work` receives an empty list for a node with one repository binding.
- `affected_tests` lists `{ name, command, gate_files }` for each checkout of an `implement` node with a valid [affected test declaration](project-service.impl.md#the-affected-test-declaration), in binding order, also for a node with one repository binding. An invalid declaration adds no entry. `repositories` does not carry the command. `gate_files` holds the `gate_files` list of the declaration, in declaration order.
- The shipped `work` text names each entry of `affected_tests`, for example ``Repository engine: affected tests `pnpm --silent run test:affected` ``. The coder does not run the command. For an entry with a nonempty `gate_files`, the next line is ``Gate files of repository engine: `package.json`, `scripts/test-path.mjs`. Change a gate file only when the requirement names it.`` An empty list adds no line. `swe@1.md` does not change.
- `affected` is the evidence JSON of `Affected test results` of the evaluation, or null when no repository declares a command. The shipped `evaluation` text holds the input line `Affected test results of this evaluation: {{json affected}}`.
- The shipped `evaluation` text also holds two sentences: "KanthorD ran the affected test command of each repository after the verifications; weigh a `base_red` verdict, each flaky test and each excluded e2e test as facts about the change." and "A change to a file that selects or runs tests is a test change; judge it against the criterion."
- `verification` holds the results of the node verifications that the execution code runs. `dependencies`, `outcomes` and `evidence` are empty for an `examine` node with no direct dependency.
- `tasks` lists the tasks of the node for the work prompt of the node unit, and is empty for the work prompt of a task.
- `node` holds the name, the requirement and the criterion of the node for the work prompt of a task. It is null for every other work prompt.
- `marker` is the marker that the worker parses. A replacement of `evaluation` or `repair` keeps the marker line, or the worker treats the reply as invalid.
- The shipped `evaluation` text holds the `ground` instruction: "Give each blocker a ground: stated for a requirement or criterion of the work prompt, standard for a default-standard rule, unstated for a defect that neither states, conflict for two stated requirements or criteria that the work cannot meet together. Give each suggestion the ground null." A replacement of `evaluation` keeps it, or the reply goes through the repair turn.
- `round` of `evaluation` holds `{ number, review_base }` of the [review round](mission-service.md#rework-limit). `prior_findings` lists each open finding of the attempt with the fields `id`, `label`, `round`, `kind`, `action`, `task_id`, `ground`, `name`, `description`, `fix` and `why`. A round with a review base renders the round block of the shipped text. `full_change` is true for a round of an `implement` review with no review base and with at least one nonempty patch. Such a round renders the full change block instead.
- `findings` of `criterion-revision` lists each open finding of the attempt with `id`, `label`, `round`, `name`, `description`, `fix` and `why`.
- `issues` of `repair` lists `{ path, message }` for each issue of the refused judgement line. An absent marker line gives an empty list. A JSON syntax error of the marker line gives one issue with the path `""` and the message of the JSON parser.
- A replacement of `evaluation` that omits `findings` from the marker line fails the schema, and the reply goes through the repair turn.
- The loader reads only the files of the template names above. A file `task-judgement.md` or `task-choice.md` in `prompts` is unused, and the loader gives no warning.
- Tests cover the shipped set, a replacement, each rejection, a render without a value and the absence of escaping.

## Session file

- The adapter stores an agent session as the JSONL session file of `@earendil-works/pi-coding-agent` at 1.1.0.
- The session file lives under `sessions/` of the pi agent directory that `PI_CODING_AGENT_DIR` names.
- pi appends each entry of the session to that file.
- A resume opens that file through the `SessionManager` of pi.
- The adapter passes the session identity of the consumer as `id` to `SessionManager.create`.
- A resume takes the file whose session id equals that identity, and it never calls `continueRecent`.
- The Worker Service reads one entry by its `id` and `type` from the file whose name ends with `_<session id>.jsonl`.

## Sensitive text redaction

- Sensitive text redaction is the first [session hook](agent.vocabulary.md#session-hook). It replaces each [sensitive text](agent.vocabulary.md#sensitive-text) of an agent session with a [redaction marker](agent.vocabulary.md#redaction-marker).
- It acts before pi persists a message and before the model reads it.
- The rule module is `engine/src/agent/sensitive-text.ts`. The session hooks live in `engine/src/agent/hooks/sensitive-text-redaction.ts`.
- One redaction object exists for each call of `sensitiveTextRedaction`. It holds the rule set, one growing known set, the redaction table and the tag. It exposes two session hooks: `restore` and `hook`.
- `openSession` creates the redaction object from the pi session id, unless the consumer passes one. The input of `openSession` holds exactly one of `knownSecrets` and `redaction`, so no consumer opens a session without a redaction.
- `openSession` redacts the system prompt once with `redaction.text`, passes the result to the resource loader, and returns it. The worker and the workbench pin that text with `pinInference`. The worker pins the redacted work.
- The worker passes the secrets of every credential of the execution as the known secrets of each session. The workbench passes the secrets of the holder of its current configuration. `pe@1` passes the secrets of the server agent credentials.
- The workbench keeps one redaction object for the life of its session in the process. Each later `openAgent` passes that object, so a marker from before `configure` restores after it.
- The tracer applies rule 0 and rules 1 to 17 to its entry copy, with one `KnownMatcher` for each session and the tracer marker `<redacted:RULE>`.
- The Intake Service is the second consumer of the rule set. `intake.inbound.event.describe` and `intake.inbound.event.get` apply rule 0 and rules 1 to 17 to the text of a stored inbound event before they answer.
- No `bash`, `grep` or `sed` runs at run time. The rule set extends the port of the reference scanner `hooks/secret-guard/` of `kanthorlabs/dotagents`. A citation of `scan.sh`, `test.sh` or `pi.ts` names a file of that directory.

### The rule set

The rule set holds 11 categories of sensitive text, 17 pattern rules, rule 0 and rule 0b. It also holds a list of text that stays visible. Its aim is the common developer case.

The categories:

- C1: cloud provider credentials (AWS, Google Cloud, Azure)
- C2: developer platform tokens (forge, package registry, infrastructure platform)
- C3: LLM and AI provider keys
- C4: chat tokens and webhook URLs
- C5: payment and SaaS keys
- C6: HTTP credentials (headers, cookies, `curl -u`)
- C7: JSON Web Tokens
- C8: private keys
- C9: configuration and environment assignments
- C10: connection strings, DSNs and URL credentials
- C11: tool credential files

Constants:

| Constant                           | Value                                         |
| ---------------------------------- | --------------------------------------------- |
| `SENSITIVE_VALUE_MAX_CHARACTERS`   | 16384                                         |
| `SENSITIVE_NAME_MAX_CHARACTERS`    | 256                                           |
| `LINE_PREFIX_MAX_CHARACTERS`       | 512                                           |
| `TOKEN_MAX_CHARACTERS`             | 512                                           |
| `ASSIGNMENT_VALUE_MIN_CHARACTERS`  | 8                                             |
| `KNOWN_VALUE_MIN_CHARACTERS`       | 12                                            |
| `KNOWN_VALUE_MIN_ENTROPY_BITS`     | 3.25                                          |
| `KNOWN_PART_MIN_CHARACTERS`        | 12                                            |
| `INDEXED_PREFIX_CHARACTERS`        | 32                                            |
| `KNOWN_PREFIX_PATTERN`             | `/^[a-z]{2,8}(?:[-_][a-z0-9]{2,8}){0,3}[-_]/` |
| `BASE64_WRAP_WIDTHS`               | 64 and 76                                     |
| `JWT_SEGMENT_MIN_CHARACTERS`       | 11, 11 and 16                                 |
| `COMMAND_ARGUMENTS_MAX_CHARACTERS` | 512                                           |
| `SENSITIVE_SCAN_MAX_CHARACTERS`    | 8388608                                       |

- Each free bound uses a named constant. A format bound stays in the pattern text.
- `SensitiveRule` is a `const` object of the rule ids. `SCAN_FAILED` is `scan_failed`.
- One label of `SensitiveRule` holds a keyword of rule 12: the label `ConnectionSecret` with its value `connection_secret`. No other rule id holds a keyword of rules 12 to 17.

Notation:

- `H` stands for `[^\S\n]`: a white space character that is not a line end. No line rule crosses a line end.
- `V` is `SENSITIVE_VALUE_MAX_CHARACTERS`, `NM` is `SENSITIVE_NAME_MAX_CHARACTERS`, `T` is `TOKEN_MAX_CHARACTERS`, `A` is `ASSIGNMENT_VALUE_MIN_CHARACTERS`.
- `P` is one optional line prefix: `(?:[^\n]{0,512}?:\d+[:-]H?|[^\n]{0,512}?-\d+-H?|[+\- ]H*\d+H|[+-]H?|H*\d+\t)?`. The bound 512 is `LINE_PREFIX_MAX_CHARACTERS`.
- `P` accepts a `grep` match line, a `grep` context line, an `edit` diff line, a `git diff` line and a `cat -n` line.
- Each line rule runs with the flags `g` and `d`. The `d` flag gives the span of the named group `value`.
- `C` is `COMMAND_ARGUMENTS_MAX_CHARACTERS`. `UN`, `K`, `LN` and `LV` are the name parts and the value part of rule 13.
- In the pattern block, `|` is the regex alternation. A pattern that continues on the next line of the block continues with no white space.

Each rule starts at a literal or at a line start. A bound limits the cost of one start, and the literal limits the number of starts.

| #   | Rule                | Category    | Start                                                                               | Prefilter (case-insensitive)                                                                    | Masked span                                            | Promotes            |
| --- | ------------------- | ----------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------- |
| 0   | `llm_credential`    | C3          | automaton                                                                           | none                                                                                            | whole match                                            | always in the table |
| 0b  | table values        | all         | automaton                                                                           | none                                                                                            | whole match                                            | n/a                 |
| 1   | `aws_access_key_id` | C1          | token prefix                                                                        | none: combined token pass                                                                       | whole match                                            | yes                 |
| 2   | `aws_signing_key`   | C1          | keyword                                                                             | `aws`                                                                                           | `value`                                                | yes                 |
| 3   | `aws_session_token` | C1          | keyword                                                                             | `aws`                                                                                           | `value`                                                | yes                 |
| 4   | `url_userinfo`      | C10         | scheme start                                                                        | `://`                                                                                           | `value`: the user, the `:` and the password            | free value          |
| 5   | `go_mysql_dsn`      | C10         | literal `@tcp(` or `@unix(`                                                         | `@tcp(`, `@unix(`                                                                               | `value`                                                | free value          |
| 6   | `private_key`       | C8          | `-----BEGIN`, `Private-Lines:`, `AGE-SECRET-KEY-1`                                  | `private key`, `private-lines:`, `age-secret-key-`                                              | body lines; whole age key                              | yes                 |
| 7   | `platform_token`    | C2          | token prefix                                                                        | none: combined token pass                                                                       | whole match; Terraform from `.atlasv1.`                | yes                 |
| 8   | `chat_token`        | C4          | token prefix, webhook host                                                          | none: combined token pass                                                                       | whole token; webhook path `value`; Telegram from `:AA` | yes                 |
| 9   | `saas_token`        | C5          | token prefix                                                                        | none: combined token pass                                                                       | whole match                                            | yes                 |
| 10  | `google_cloud_key`  | C1          | token prefix                                                                        | none: combined token pass                                                                       | whole match                                            | yes                 |
| 11  | `llm_provider_key`  | C3          | token prefix                                                                        | none: combined token pass                                                                       | whole match                                            | yes                 |
| 12  | `quoted_assignment` | C9          | keyword                                                                             | `pass`, `secret`, `key`, `token`                                                                | `value`                                                | free value          |
| 13  | `env_assignment`    | C9          | line start                                                                          | `pass`, `secret`, `token`, `key`, `pwd`, `credential`                                           | `value`                                                | free value          |
| 14  | `connection_secret` | C10, C1, C4 | keyword and `=`                                                                     | `password=`, `pwd=`, `accountkey=`, `sharedaccesskey=`, `?`, `&`                                | `value`                                                | free value          |
| 15  | `http_credential`   | C6          | `authorization`, header names, `cookie`, `curl`                                     | `authorization`, `api-key`, `-token`, `cookie`, `curl`                                          | `value`                                                | free value          |
| 16  | `jwt`               | C7          | `eyJ`, anchored walk                                                                | `eyj`                                                                                           | whole match                                            | yes                 |
| 17  | `credential_file`   | C11         | `_auth`, `_password`, `"auth"`, a registry token key, `client-key-data`, `password` | `_auth`, `_password`, `"auth"`, `identitytoken`, `registrytoken`, `client-key-data`, `password` | `value`                                                | free value          |

Patterns:

```text
1   \b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b
2   /aws_?secret_?(?:access_?)?key["']?H*[:=]H*["']?(?<value>[A-Za-z0-9/+=]{40})/gid
3   /aws_?session_?token["']?H*[:=]H*["']?(?<value>[A-Za-z0-9/+=]{100,V})/gid
4   /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,31}://(?<value>[^/\s:@"']{0,NM}:(?<password>[^/\s@"'$<]{1,V}))
     @(?<host>[^/\s:?#"'),]{1,253})/gd
5   anchored match: "Rule 5, anchored"
6   -----BEGIN (?:[A-Z0-9]+ ){0,2}PRIVATE KEY(?: BLOCK)?-----
    ^Private-Lines: (\d+)$
    \bAGE-SECRET-KEY-1[0-9A-Z]{58}\b
7   \b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,T}|gl(?:pat|dt|ptt|rt|cbt|soat)-[A-Za-z0-9_.-]{20,T}
    |ATBB[A-Za-z0-9_=.-]{32,T}|ATATT3[A-Za-z0-9_=-]{180,T}|npm_[A-Za-z0-9]{36}|pypi-AgE[A-Za-z0-9_-]{50,T}
    |dckr_(?:pat|oat)_[A-Za-z0-9_-]{27,T}|rubygems_[a-f0-9]{48}|do[opr]_v1_[a-f0-9]{64}|hv[sbr]\.[A-Za-z0-9_-]{24,T}
    |sbp_[a-f0-9]{40}|sb_secret_[A-Za-z0-9_-]{20,T})(?![A-Za-z0-9])
    (?<=\b[a-z0-9]{14})\.atlasv1\.[A-Za-z0-9_=-]{60,T}
8   \bxox[abeoprs](?:\.xox[bp])?-[A-Za-z0-9-]{10,T}
    \bxapp-\d-[A-Za-z0-9-]{10,T}
    hooks\.slack\.com/(?:services|workflows|triggers)/(?<value>[A-Za-z0-9_/+-]{20,T})
    discord(?:app)?\.com/api/webhooks/(?<value>\d{17,20}/[A-Za-z0-9_-]{60,T})
    (?<=\b\d{8,10}):AA[A-Za-z0-9_-]{32,33}(?![A-Za-z0-9_-])
9   \b(?:(?:sk|rk)_live_[A-Za-z0-9]{24,T}|whsec_[A-Za-z0-9+/=]{32,T}|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}
    |shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32})(?![A-Za-z0-9])
10  \bAIza[A-Za-z0-9_-]{35}
    \bGOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])
    \bya29\.[A-Za-z0-9_-]{30,T}
11  \bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,T}
    \b(?:gsk_[A-Za-z0-9]{52}|(?:hf|api_org)_[A-Za-z0-9]{34}|xai-[A-Za-z0-9]{80}|pplx-[A-Za-z0-9]{48}|r8_[A-Za-z0-9]{37})
    (?![A-Za-z0-9])
12  /(?:password|passwd|secret|api_?key|access_?token|auth_?token|refresh_?token|(?<![A-Za-z0-9_])token)["']?H*[:=]H*["']
     (?<value>[^"'\s$<{][^"'\s]{A-1,V})["']/gid
13  UN = [A-Z0-9_]{0,NM}(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|CREDENTIALS|(?:API|ACCESS|SECRET|PRIVATE|SIGNING|ENCRYPTION|MASTER)_?KEY)
    K  = (?:password|passwd|secret|token|api_?key)
    LN = (?:K|[a-z](?:[a-z0-9_.]|-(?!\d+-)){0,NM}K)
    LV = [^\s$"'{<(),;`]{A,V}
    /^PH*(?:(?:-H+|exportH+)?UN=["']?(?<value>[^\s$"'{<]{A,V})
          |(?:-H+)?UN:H+["']?(?<value>LV)["']?H*$
          |(?:-H+)?LN(?::H+|H*=H*)(?<value>LV)H*$)/gmd
14  /(?:^|[;\s"'?&-])(?:password|pwd|accountkey|sharedaccesskey)=(?<value>[^;&\s"'$<{]{1,V})/gid
    /[?&](?:access_?token|refresh_?token|token|api_?key|apikey|client_?secret|secret|sig|signature
     |x-amz-signature|x-amz-security-token|x-goog-signature)=(?<value>[^&#\s"'$<{]{A,V})/gid
15  /(?<![A-Za-z0-9-])(?:proxy-)?authorization["']?H*[:=]H*["'`]?(?:bearer|basic|token)H+(?<value>[A-Za-z0-9._~+/=-]{A,V})/gid
    /(?<![A-Za-z0-9-])(?:x-api-key|api-key|x-auth-token|x-access-token|private-token|x-goog-api-key|x-vault-token)["']?H*:H*["']?
     (?<value>[^\s"'$<{,;`]{A,V})/gid
    /(?<![A-Za-z0-9-])(?:set-)?cookie["']?H*:H*["']?(?<value>[^\s;=,"'$<{`]{1,NM}=[^\n"'`]{1,V})/gid
    /\bcurl\b(?:(?!\bcurl\b)[^\n]){0,C}?H(?:-u|--user)(?:H+|=)["']?(?<value>[^\s:"'$<{]{1,NM}:[^\s"']{1,V})/gd
16  anchored walk: "Rule 16, anchored"
17  /(?:^|:)_(?:authToken|auth|password)H*=H*(?<value>[^\s"'$<{]{1,V})/gmd
    /"(?:auth|identitytoken|registrytoken)"H*:H*"(?<value>[A-Za-z0-9+/=._-]{A,V})"/gd
    /client-key-data:H*["']?(?<value>[A-Za-z0-9+/=]{16,V})/gd
    /\b(?:machine|login)H+\S{1,NM}H+passwordH+(?<value>\S{1,V})/gd
    /^PH*passwordH+(?<value>[^\s$<{]{1,V})H*$/gmd
```

- Rules 1, 4 to 11, 13, 16 and 17 are case-sensitive. Rules 2, 3, 12, 14 and 15 are case-insensitive.
- **Combined token pass.** Rules 1 and 7 to 11 run as one combined regex of all their patterns, with no literal prefilter. The matched alternative gives the rule.
- Every other rule keeps its prefilter. A rule runs on a string only when the lower-case string holds one of its literals.
- The lookbehind of rule 4 lets the scheme start only where no scheme character precedes it. So one `://` gives one start, not 32.
- Rule 4 masks the whole userinfo, the user and the password, and the user part is optional. So a URL with an empty user and a password matches. A userinfo with no `:` gives no finding, so a Sentry DSN stays visible.
- The format bounds of rules 1, 7 to 11 and the DNS host bound 253 come from the token or host format. The scheme bound 31 comes from the URI format.
- Rules 7, 9 and 11 end with `(?![A-Za-z0-9])`, and the `GOCSPX-` pattern ends with `(?![A-Za-z0-9_-])`. A trailing `\b` fails when a token ends with `-` or `_`, for example a Docker Hub token.
- Rule 7 starts the Terraform pattern at the literal `.atlasv1.`. The token id before it stays visible.
- Rule 8 keeps the webhook host and the Telegram bot id visible, so the model knows the target.
- Rule 9 matches only `sk_live_` and `rk_live_` of Stripe. Stripe test keys (`sk_test_`, `rk_test_`) stay visible. Rule 13 still masks a test key by the name of its variable.
- Rule 12 adds `refresh_?token` and a bare `token`. The lookbehind keeps a name such as `PlatformToken` out.
- Rule 13 has three forms: the `=` form, the upper-case colon form of a YAML map, and the lower-case YAML and INI form. The lower-case form covers `application.yml`, `.pypirc`, `.my.cnf` and `pip.conf`.
- The lower-case name `LN` starts at a letter or at the keyword, and it refuses a `-` that starts a `-\d+-` run. So a `grep` context prefix `-N-` of `P` gives no second start for each of its dashes.
- The two colon forms and the lower-case form need the value to fill the rest of the line. `LV` refuses `(`, `)`, `,`, `;` and the backtick. So a TS property such as `password: token,` stays visible.
- Rule 14 has a key-value part and a query part. The key-value part covers libpq, JDBC, ADO.NET, Azure `AccountKey=` and `SharedAccessKey=`, and the `--password=` flag. The query part covers query tokens, `sig=` and presigned URL signatures. Its name is `connection_secret`.
- Rule 15 has four parts, each with its own literal. Its value classes refuse `$`, `<` and `{`, so a template such as `` `Bearer ${token}` `` gives no finding. The `curl` literal keeps `docker run -u 1000:1000` and `git push -u` out. The lazy run of the `curl` part stops at the next `curl`, so repeated `curl` words cost one pass.
- Rule 17 covers `.npmrc`, the Docker `config.json`, the kubeconfig `client-key-data` and `.netrc`. Its line form can share the line-start pass of rule 13.

#### Rule 0, the known secrets

- The known secrets are the growing known set of the redaction object. A part of length 0 plays no part.
- The forms of each secret are exact strings. They are the secret itself, base64 and base64url at the byte offsets 0, 1 and 2, and percent encoding.
- At every offset, a base64 form drops each leading and trailing character that also depends on a byte outside the secret.
- The **wrapped view** finds a form that `base64` wraps. It is built only from runs of wrapped lines.
- A run is two or more consecutive lines of base64 characters. Each line except the last has exactly 64 or 76 characters (`BASE64_WRAP_WIDTHS`). The last line has at most that width.
- The lines of one run have the same leading white space. Before the width test, the scanner strips that white space and one trailing `\r` of each line.
- The wrapped view joins the lines of each run and maps each view character back to its source. Only a second automaton of the rule 0 forms scans a run. The scanner builds no copy of the other text.
- A table value in a run takes no part. Its span takes index 0 in any case.
- A form of a secret of 100 or more characters spans two or more lines, so each such form lies in one run.
- A **part** of a secret matches when it holds `KNOWN_PART_MIN_CHARACTERS` or more characters after the public prefix of the secret. The public prefix is the match of `KNOWN_PREFIX_PATTERN` at the start of the secret, for example `sk-ant-api03-`.
- The part checks apply only to the known secrets, not to the table values of rule 0b.
- A **window map** maps each window of `KNOWN_PART_MIN_CHARACTERS` characters of each secret body to the secret and the offset. The matcher builds it with the automaton.
- Suffix part: at each string start and each line start, the scanner looks up the next 12 characters in the window map. On a hit, it compares the rest of the line with the rest of the secret (`pi-coding-agent/core/tools/bash.js`).
- Prefix part: the scanner finds each `... [truncated]` text (`pi-coding-agent/core/tools/truncate.js`). It looks up the 12 characters before it in the window map. On a hit, it compares the text that ends there with the start of the secret.
- So each line start and each cut costs one lookup, whatever the number of secrets.
- The part checks run on the source and on each escaped view.
- Each form and each part counts as `llm_credential`.

#### Rule 0b, the table values

- `promotes(value, rule)` is true when a rule of 1 to 3, 6 to 11 or 16 found the value. These formats hold more than 12 characters.
- For the free-value rules 4, 5, 12 to 15 and 17, the value also needs `KNOWN_VALUE_MIN_CHARACTERS` or more characters. Its Shannon entropy must be `KNOWN_VALUE_MIN_ENTROPY_BITS` or more bits per character.
- A restored value spreads to rule 0b when `promotes(value, rule)` is true, or when it has `KNOWN_VALUE_MIN_CHARACTERS` or more characters. A shorter restored value is masked only in the `toolResult` of the same call.
- Rules 0 and 0b run as one Aho-Corasick automaton over all forms and all promoted values. One pass over the text finds every match.
- The automaton indexes the first `INDEXED_PREFIX_CHARACTERS` characters of each value, or the whole value when it is shorter. Each key node keeps the length of the longest value with that key.
- A hit of a key masks from its start to that length, clipped at the end of the string. The matcher does not check the rest of a long value.
- So the mask can cover more text than the value, and never less. The table value of the span is the exact source text, so a restore never changes text.
- At each text position, the matcher reads one key: the node itself, or the longest key on its suffix link. Every shorter key that ends there lies inside that span, because only a key of 32 characters can mask past its end.
- A span that overlaps the current span extends it, at its start or at its end.
- So one scan costs one step for each character, whatever the table holds. The automaton holds at most 32 nodes for each table value and each form.
- `INDEXED_PREFIX_CHARACTERS` has one meaning: the number of leading characters that the matcher indexes. A key of 32 random characters repeats only by chance. A value that starts with 32 or more public characters masks after each copy of that start.
- `add` and `addSecret` only queue a value. So the matcher rebuilds at most once after pass 1 of a message. It also rebuilds once after the restore of a call, and once after a refresh that adds a secret.

#### Rule 5, anchored

- The regex form of rule 5 is the bounded form of the `scan.sh` DSN pattern: `/[^/\s:@"']{1,NM}:[^/\s@"'$<]{1,V}@(?:tcp|unix)\([^):\s]{1,253}/g`. The scanner does not run it.
- The scanner finds each `@tcp(` and `@unix(` with `indexOf`.
- From that anchor, it walks backward over the value class `[^/\s@"'$<]` for at most `V` characters. That run is the value window.
- Inside the window, it takes the first `:` that has a value of 1 or more characters after it.
- The user part walks back from that colon over the user class `[^/\s:@"']`, for 1 to `NM` characters. The start of the value window does not bound it.
- Forward from the anchor, the host is `[^):\s]{1,253}`.
- A differential test against the regex form of rule 5 checks the walk. The anchored rule keeps every regex finding. An extra match that overlaps a previous match is allowed.

#### Rule 6, the private key walk

Rule 6 finds a private key by its header: a PEM header, the PGP header `-----BEGIN PGP PRIVATE KEY BLOCK-----`, a PuTTY `Private-Lines:` line or an age key. For a PEM or PGP block, it masks only the body lines. The scanner walks the lines after the header once:

- A base64 line is a body line. An empty line and a PEM field line such as `Proc-Type:` or `DEK-Info:` are allowed lines. A PGP checksum line is a base64 line, and a PGP `Comment:` or `Version:` line is a field line.
- A line that holds a rule 6 header stops the walk, also when it is a field line.
- When the walk reaches a `-----END ... PRIVATE KEY-----` or `-----END PGP PRIVATE KEY BLOCK-----` line, the span runs from the first body line to the line before the END line.
- When the walk reaches any other line, or the text end, the span is the run of body lines from the first body line.
- So a header and an END line with code lines between them give no END span. Only the base64 run after the header can be masked.
- The header and the END line of a key stay visible, because they carry no secret. A later text with the same header loses no character, for example `engine/src/repository/ssh-key.ts`.
- An earlier key can still mask the END line of a later key. Their bodies can share a start of 32 or more characters.
- The walk state lives for one rule 6 pass over one string. It holds the line end and the body start of the last walk.
- A header with the same body start in the same pass adds no second span and skips the walk. A later scan, also of an equal string, starts with a new state.
- The walks of two distinct body starts do not overlap, because every line with a header stops a walk. So all headers of one string cost one pass.
- PuTTY: after a line `Private-Lines: N`, the scanner masks the next `N` lines while each one is a base64 line. It stops at the first other line, so `N` needs no bound.
- age: `AGE-SECRET-KEY-1` and 58 upper-case characters form one whole-match span.

#### Rule 16, anchored

- The scanner finds each `eyJ` at a word start with `indexOf`.
- From that start, it walks three segments of `[A-Za-z0-9_-]`, each of at most `V` characters, with one `.` between them.
- The second segment starts with `eyJ`. The three segments hold at least 11, 11 and 16 characters (`JWT_SEGMENT_MIN_CHARACTERS`).
- The span is the whole match. The fixture line does not drop it.
- After a failed walk, the scanner skips only the starts inside the first segment of that walk. A start inside a first segment always fails or lies inside the same span, so the skip loses no JWT.
- After a matched walk, the span extends over each further `.` and segment. So a chain `h1.p1.s1-h2.p2.s2` is one span, and `p2.s2` does not stay visible.
- Each character is read at most three times, so the walk stays linear.
-

#### The escaped view

- When a string holds a JSON escape, the scanner also scans an unescaped view of it.
- The view decodes every JSON escape, left to right: `\n`, `\r`, `\t`, `\b`, `\f`, `\"`, `\/`, `\\` and `\uXXXX`. It also decodes `\'`. So `\\n` decodes to a backslash and an `n`.
- An offset map links each view character to its source characters. A span of the view masks the source characters that produced it.
- A view span starts at the first source character of its first view character. It ends after the last source character of its last view character.
- The part checks and the wrapped view also run on each escaped view.
- So a `.env` line inside the JSON `tail` of `pe@1` (`engine/src/project/environment-agent.ts`) is found, also with CRLF line ends.

#### Exclusions

- **Fixture value.** The scanner marks a fixture span on each line that matches `/^PH*(?:-H+|exportH+)?(?:E2E_|TEST_|DEBUG_)[A-Za-z0-9_]{0,NM}(?:=|:H+)(?<value>"[^"\n]*"|'[^'\n]*'|\S*)/gmd`, case-sensitive.
- The fixture span drops a finding of the context rules 2 to 5, 12 to 15 and 17 only. The token rules 0, 1, 6 to 11 and 16 ignore it, because a provider token is real whatever the name of its variable.
- **Deviation.** The reference allows `TEST_GITHUB_TOKEN` and `- E2E_GITHUB_TOKEN` with a token (`test.sh`). The port denies both, because `E2E_GH_TOKEN` in `engine/.env.e2e` is a real token (`AGENTS.md`).
- **Local host.** Rules 4 and 5 drop a finding whose `host` equals `localhost` or `127.0.0.1`, or matches `192\.168\.\d{1,3}\.\d{1,3}` in full (`scan.sh`).
- **Fixture password.** Rules 4, 5, 14 and 17 drop a finding whose password starts with `debug_` or `test_` (`scan.sh`). For rule 4, the password is the group `password`. For the other rules, it is `value`.
- **Fixture assignment.** Rules 12 and 13 drop a finding whose `value` starts with `debug_` or `test_`, case-sensitive (`scan.sh`; `test.sh`).
- **Placeholder.** Rules 4, 5, 12 to 15 and 17 refuse a value that starts with `$`, `<` or `{` (`test.sh`). For rule 4, the check applies to the group `password`.
- **curl user.** Rule 15 drops a `curl -u` value of the form `digits:digits`, for example a uid and a gid.
- **Marker.** The scanner drops a span only inside a valid marker. A text such as `<redacted:` plus a token plus `>` is no valid marker, and every rule scans it.
- **JSON Web Token.** Rule 16 finds a JWT. This is a deviation from `test.sh`, which lets a JWT pass.

#### Overlaps

- The scanner collects every span of every rule, sorts by start, and merges overlapping spans.
- The lowest rule number wins, with 0b between 0 and 1. So rule 0 takes priority over every other rule.
- A 0b part takes the rule of its table entry.
- A bearer JWT is a rule 15 finding and a rule 16 finding. The lower rule number wins, so the marker names rule 15.
- A span that holds a valid marker is cut at the marker bounds. The marker stays unchanged, and each part outside it stays a span.

### Text that stays visible

- No per-project allowlist, no baseline file, no inline pragma in version 1: one standard configuration. Ulrich adds exceptions later.
- In `write` and `edit`, the restore puts the real text back, so a false positive costs only the view of the model.
- In `bash`, a marker blocks the call. So a false positive that the model copies into `bash` blocks that call.
- The tag keeps a literal marker in a file harmless. A foreign marker stays text.
- The entropy floor keeps a common word of the free-value rules out of rule 0b. Only a word that the model used in a tool input spreads.
- The fixture exclusions keep test values readable for the context rules.
- The counts per rule show the noise of each rule in a dogfood run.

| Text                        | Example shape                            | Reason               |
| --------------------------- | ---------------------------------------- | -------------------- |
| Hash, commit SHA            | 40 or 64 hexadecimal characters          | Public digest        |
| UUID, ULID                  | 36 or 26 characters                      | Id, no access        |
| Lockfile integrity          | `sha512-` and base64                     | Public digest        |
| Image digest, `go.sum`      | `sha256:` and hex, `h1:` and base64      | Public digest        |
| SSH public key              | `ssh-ed25519 AAAA...`                    | Public               |
| Certificate, public key PEM | `BEGIN CERTIFICATE`, `BEGIN PUBLIC KEY`  | Public               |
| Base64 image                | `data:image/png;base64,...`              | Content, no access   |
| Random base64 blob          | base64 and base64url data                | Data                 |
| Stripe publishable key      | `pk_live_`                               | Public by design     |
| Stripe test key             | `sk_test_`, `rk_test_`                   | Test mode only       |
| Sentry DSN                  | a key in the userinfo with no `:`        | Public by design     |
| AWS ARN, account id         | `arn:aws:iam::<12 digits>:...`           | Id                   |
| Template or variable        | `${TOKEN}`, `<token>`, `{{ secrets.X }}` | No value             |
| TS type or expression       | `password: string;`, `password: token,`  | Code                 |
| `docker -u`                 | `-u 1000:1000`                           | uid and gid          |
| Local URL                   | a URL with the host `localhost`          | Local host exclusion |

- Rule 13 still masks a Stripe test key by the name of its variable, for example in a `.env` line.
- Two public-by-design values stay masked: a Firebase web `apiKey` (rule 10) and a Supabase anon key (rule 16). The same shapes hold real secrets.
- Placeholder values such as `your-api-key-here` stay masked by rules 12 and 13. Ulrich adds an exception later if the dogfood counts show noise.

### The redaction marker and the redaction table

Marker grammar:

- Session marker: `<redacted:RULE:N:TAG>`. `RULE` is a value of `SensitiveRule` or `scan_failed`. `N` is the decimal index with each digit 0-9 written as `a`-`j`, with no leading `a` except the single `a` for 0: `a|[b-j][a-j]{0,9}`. `TAG` is the hexadecimal tag with each nibble 0-f written as `a`-`p`: `[a-p]{16}`.
- A session marker holds no digit, so that no status scanner reads a status code in it.
- Tracer marker: `<redacted:RULE>`, with no index and no tag, because the tracer holds no table.
- Any other text that starts with `<redacted:` is no marker.

The tag:

- `TAG` is the session part followed by the process part, 8 hexadecimal characters each, written as letters.
- The session part is the first 8 characters of the sha-256 hex digest of the pi session id.
- The process part is 8 random hexadecimal characters from `randomBytes`. It names one redaction object. A worker session and a `pe@1` session have one object; a workbench session has one object for its life in the process.
- Example: `<redacted:url_userinfo:d:jpcmebklahnbofmd>`.
- `openSession` builds the redaction object from `sessionManager.getSessionId()` before it creates the pi session (`engine/src/agent/agent-session.ts`). So `text()` of the system prompt, `text()` of the work and every handler use one tag. With two tags, the pins find no equal text and insert a second copy.

The table:

- The table maps each value to its index (from 1) and to its rule.
- Pass 1 adds its merged values before pass 2, so that pass 2 finds them.
- Each final merged span enters the table at the replacement, with the exact text of its source range.
- A final merged span longer than `SENSITIVE_VALUE_MAX_CHARACTERS` gets index 0. So no table value is longer than 16384 characters, and one key masks at most 16384 characters.
- A merged span with a view part maps to its source range. When the view text of that range differs from the source text, the table keeps no value, and the marker takes index 0. A span of the wrapped view is such a case.
- The same value always gets the same marker for one redaction object, also when another rule finds it later.
- Index 0 marks a value that the session could not keep: `<redacted:scan_failed:a:TAG>` for a scan failure. `<redacted:RULE:a:TAG>` marks a value above `REDACTION_TABLE_MAX`, a span longer than `SENSITIVE_VALUE_MAX_CHARACTERS`, or a value whose view text differs from its source text.
- The hook module owns `REDACTION_TABLE_MAX`: 4096 values.
- The workbench table holds at most `REDACTION_TABLE_MAX` values for the life of the session in the process. Above it, each new value takes index 0, and `unkept` counts each such marker.
- A marker starts with `<`, as the current URL userinfo marker `<redacted>` does (`engine/src/repository/connector.ts`).

### The two-pass scan

The two-pass scan applies to `message_end`, `text()` and the `context` handler:

- Pass 1 runs rules 1 to 17 over every string of the message and over each escaped view. It adds each new value to the table after the merge.
- Pass 2 runs rules 0 and 0b over every string, each escaped view and each run of the wrapped view, with the updated table.
- Then the merged spans of both passes are replaced, and each final merged span enters the table.
- So a value that a rule finds on line 2 is also masked on line 1. The same holds for another string of the message and for a second tool call.
- Pass 2 does not change a kept thinking block.

### The handlers

| Handler           | Extension | Effect                                                                                                                                                                                                                                            |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_call`       | `restore` | For each valid marker in each string of `event.input`, act on its tag and on the tool. The cases follow below.                                                                                                                                    |
| `turn_start`      | `hook`    | Refresh the known secrets with `await known()`. On a rejection, keep the last set (`engine/src/worker/unit/agent-telemetry.ts`).                                                                                                                  |
| `message_end`     | `hook`    | For an `assistant` message, refresh the known secrets first, because pi resolves the key in the stream call (`pi-agent-core/agent-loop.js`).                                                                                                      |
| `message_end`     | `hook`    | Return a redacted copy of a `system`, `user`, `assistant`, `toolResult` or `custom` message. Return nothing when no string changes.                                                                                                               |
| `context`         | `hook`    | Redact the `summary` of each `compactionSummary` message, and each `custom` message. This cleans the summary of a resumed session file, because `SessionManager.open` loads the raw text.                                                         |
| `session_compact` | `hook`    | Redact `compactionEntry.summary` in place, and count each finding as `compaction_residual`. This cleans the projection of this process (`pi-coding-agent/core/session-manager.js`) and the tracer copy. The session file keeps the residual (G1). |

The `context` handler sees no `system` message (`pi-coding-agent/core/extensions/runner.js`). The `systemMessage` of a compaction entry is a copy of the redacted `system` message, so it needs no handler.

The `context` handler and the `custom` messages:

- A `context` handler of a consumer can add a `custom` message that never passes `message_end`. `pinnedLayersHook` adds `kanthord.prompt-layer` (`engine/src/agent/hooks/pinned-layers.ts`).
- `hook` runs last, so its `context` handler sees that message and redacts it.
- A persisted `custom` message already holds markers, and the scanner keeps a valid marker unchanged. So its second scan changes no text.

### The restore by tool

- The restore writes a value back only into the input of `write` and `edit`.
- A marker of this session in a `bash` call blocks the call. So no command receives a masked value. This closes the path of a prompt injection that sends a value with `curl`.
- A marker of the LLM credential blocks the call in every tool.
- Every other tool, for example `read`, `grep`, a workbench operation tool or a custom tool, receives the marker text unchanged.

Restore cases, in this order:

| Marker                                                                      | `write`, `edit`                                                                                  | `bash`                            | Every other tool                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------- |
| Session part of this session, `RULE` `llm_credential`                       | Block with the credential reason.                                                                | Block with the credential reason. | Block with the credential reason. |
| Full tag of this redaction object, index 1 or more, value in the table      | Replace the marker with the value. Then apply the checks below.                                  | Block with the shell reason.      | Leave the text unchanged.         |
| Full tag of this redaction object, index 0, or an index with no table value | Block with the unkept reason.                                                                    | Block with the shell reason.      | Leave the text unchanged.         |
| Session part of this session, another process part                          | Block with the resume reason. The marker comes from an earlier redaction object of this session. | Block with the shell reason.      | Leave the text unchanged.         |
| Any other tag, or a tracer marker                                           | Leave the text unchanged. It is a literal in a file or a marker of another session.              | Leave the text unchanged.         | Leave the text unchanged.         |

Checks after the replacement in `write` and `edit`:

- A restored value can contain a secret of the growing known set, or one of its forms of rule 0. Then the restore blocks the call with the credential reason. The rule of the marker plays no part.
- A restored value spreads to rule 0b by the rule of [rule 0b](#rule-0b-the-table-values).
- The restore keeps each other restored value in a list under the `toolCallId` of the call. A nested call adds its values to the list of the outermost call.
- The `message_end` of the `toolResult` with that `toolCallId` masks each listed value with an exact `indexOf` search of its strings. The matcher does not change.
- The list of a call goes at its `toolResult`, at a block and at `agent_end`.
- Each block grows `restore_blocked`.

Block reasons:

- Unkept: `The input holds a value that this session could not keep. Read the source of the value again, then repeat the call.`
- Resume: `The input holds a marker of an earlier run of this session. Read the source of the value again, then repeat the call.`
- Credential: `The input holds a marker of the LLM credential. No tool receives this value.`
- Shell: `A command cannot hold a masked value. To write the value into a file, use the write or edit tool. Otherwise read the value through the shell from its source, for example with $(sed -n ...), then repeat the call.`

Schema validation:

- pi validates the arguments against the tool schema before `tool_call` (`pi-agent-core/agent-loop.js`). So the schema checks the marker, not the value.
- pi does no validation after the restore (`pi-coding-agent/core/extensions/types.d.ts`). A `pattern`, a `format` or an enum of a parameter never checks the restored value.
- A marker can fail a strict parameter. The model then gets the validation error and can choose another input.
- The restore changes the validated copy of the arguments (`pi-ai/utils/validation.js`). So the persisted assistant message keeps the marker. A test pins this behavior of pi.

Strings that the `message_end` handler redacts:

- On the message object and on each content block, the handler skips the structural keys. The keys are `type`, `role`, `id`, `toolCallId`, `toolName`, `customType`, `api`, `provider`, `model` and `stopReason`.
- More structural keys: `timestamp`, `mimeType`, `textSignature`, `thinkingSignature`, `thoughtSignature`, `namespace` and `responseId`. The handler also skips the `data` of an image block.
- Inside `arguments`, `details`, `nestedCalls`, `sections`, `toolsAdded` and custom `content`, the handler redacts every string at any depth.
- For a `toolResult` message, the handler walks every string of every key, not only `content` and `details`. pi 1.1.0 drops `structuredContent` from the message (`pi-agent-core/agent-loop.js`). A later pi version that keeps it gets the same redaction, and a test pins the persisted keys.

Thinking blocks:

The handler applies the first thinking rule that matches, in this order:

1. A block of `openai-completions` whose `thinkingSignature` is a reasoning field name is redacted. pi replays its text in that field with no signature check (`pi-ai/api/openai-completions.js`).
2. A block with `redacted: true` or a non-empty `thinkingSignature` stays whole, and each finding in it counts as `thinking_kept`.
3. Every other block is redacted.

- Each redacted block keeps its `thinkingSignature`.
- Rule 3 redacts an unsigned Google block and an unsigned Bedrock block (`pi-ai/api/google-generative-ai.js`; `pi-ai/api/bedrock-converse-stream.js`).
- For a kept block, the handler scans its text and its signature. It adds each finding to the table and counts it as `thinking_kept`. Rule 0b then masks each later occurrence.

Hook order:

- `restore` runs before every consumer `tool_call` handler. So every gate checks the input that the tool executes: the restored input of `write` and `edit`, and the unchanged input of every other tool.
- `checkoutConfinement` checks the path that `read` opens (`engine/src/agent/hooks/checkout-confinement.ts`).
- The workbench approval acts only on a mutation operation tool (`engine/src/workbench/service.ts`). It holds the input that the operation receives, in memory only, in `session.approvals`. For an operation tool, that input holds the marker text, because a pattern value restores only into `write` and `edit`.
- A block from a consumer gate ends the chain (`pi-coding-agent/core/extensions/runner.js`). The tool does not run.
- A nested call of `ctx.executeTool` passes the same chain.
- `hook` runs last, so no later `message_end` handler adds text after the redaction.

- The process part never restores a marker of another redaction object, whatever the history holds. Such a marker blocks instead.
- A wrong restore needs a 32-bit collision of two process parts of one session.

### Gaps

| Entry or payload                                                                                  | Covered by                                                                                                                  | State                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User message (work prompt, instruction, workbench human text, `pe@1` JSON failure)                | `message_end`, escaped view; the worker also redacts before `session.prompt`                                                | Covered                                                                                                                                                                                          |
| System message (prompt sections, `toolsAdded`), with the instruction file and the Binding prompts | `message_end`; `openSession` redacts the loader input                                                                       | Covered                                                                                                                                                                                          |
| Assistant text, tool call arguments, `errorMessage`                                               | `message_end`                                                                                                               | Covered                                                                                                                                                                                          |
| Thinking with a provider signature                                                                | Scanned, kept whole, counted, values added to the table                                                                     | Kept                                                                                                                                                                                             |
| Tool result content, `details` and every other key of every tool                                  | `message_end` of the `toolResult` message; rules 0 and 0b                                                                   | Covered                                                                                                                                                                                          |
| Restored value in a later tool output                                                             | Rule 0b for a restored value that spreads; the result of the same call for a shorter value                                  | Covered, except a later output of a short value                                                                                                                                                  |
| Truncated, encoded or wrapped LLM credential                                                      | Rule 0 forms, parts and the wrapped view                                                                                    | Covered                                                                                                                                                                                          |
| Custom message of a run                                                                           | `message_end` of the `custom` message                                                                                       | Covered                                                                                                                                                                                          |
| Custom message of a consumer `context` handler (`kanthord.prompt-layer`)                          | The `context` handler of `hook`                                                                                             | Covered                                                                                                                                                                                          |
| System prompt and work text in the pins of the model input                                        | `openSession` redacts the system prompt once; the worker and the workbench pin that text; the worker pins the redacted work | Covered                                                                                                                                                                                          |
| `kanthord.pinned_context` custom entry                                                            | `{ part: "system_prompt" }` only (`engine/src/worker/unit/native-agent.ts`)                                                 | No free text                                                                                                                                                                                     |
| Workbench configuration entry                                                                     | `agent_provider` only (`engine/src/workbench/service.ts`)                                                                   | No free text                                                                                                                                                                                     |
| Virtual model state entry                                                                         | `provider`, `modelId`, `state` (`pi-coding-agent/core/agent-session.js`)                                                    | No free text                                                                                                                                                                                     |
| `model_change`, `thinking_level_change`, session header                                           | `pi-coding-agent/core/session-manager.d.ts`                                                                                 | No free text                                                                                                                                                                                     |
| **G1** Compaction summary                                                                         | No event edits the summary before the append (`pi-coding-agent/core/agent-session.js`)                                      | Gap. The summarizer reads only redacted messages. A residual needs a value that the model makes, or one that no rule matched.                                                                    |
| **G2** `sendCustomMessage` outside a run, `appendEntry`, turn boundary drafts                     | No extension `message_end`                                                                                                  | Gap, unreachable: no KanthorD code calls them. Rule: a hook passes each injected text through `redaction.text` first.                                                                            |
| **G3** Direct `appendCustomEntry` of KanthorD                                                     | No event                                                                                                                    | Closed: the worker entry holds no text, and the workbench entry holds `agent_provider` only.                                                                                                     |
| **G4** User `!` bash message, branch summary                                                      | No `message_end` (`pi-coding-agent/core/agent-session.js`)                                                                  | Gap, unreachable: interactive mode only.                                                                                                                                                         |
| **G5** `message_update`, `tool_execution_update`, `tool_execution_end` payloads                   | No persistence                                                                                                              | Out of scope: no session file. No KanthorD listener reads their content.                                                                                                                         |
| **G6** Image content                                                                              | No text rule                                                                                                                | Out of scope.                                                                                                                                                                                    |
| **G7** Encoded value of a pattern rule                                                            | No decoder                                                                                                                  | Out of scope. Rule 0 covers the encoded forms of the LLM credential.                                                                                                                             |
| **G8** Session files written before this hook                                                     | Not rewritten, and no rule-set version entry                                                                                | No change: the old files are dogfood data only. A workbench resume of an old file sends its values to the model. The worker never resumes an old file ([Traces](worker-service.impl.md#traces)). |
| **G9** `bash` full output file                                                                    | Not redacted (`pi-coding-agent/core/tools/bash.js`)                                                                         | No change by the hook. A `read` of the file goes through `message_end`. The Footprint Service measures the files, and a human removes them.                                                      |
| **G10** A value in an earlier message, before any rule found it                                   | That entry is already persisted                                                                                             | Gap. Rule 0b masks only later text.                                                                                                                                                              |

### Performance

- Target: the whole scan of 1 MiB stays at or below 200 ms (median) on the host of Ulrich, with a full table. The target applies only to that host.
- The whole scan of one string is pass 1 with the escaped view, plus pass 2 with the table, the known secrets, the part checks and the wrapped view.
- A performance row is one input of the gate bench of the engine. The inputs are 1 MiB of random text, of code, of code as one JSON string, and of base64 in lines of 76 as one JSON string. They also are 50 KiB of code and the adversarial unit of each rule.
- A test runs every performance row on the CI runner, with a limit of 600 ms per row. That limit only catches a quadratic case. A CI pass does not show that the target holds.
- The scan of one string stops at `SENSITIVE_SCAN_MAX_CHARACTERS`. Above it, the string becomes `<redacted:scan_failed:a:TAG>`. A string of 8 MiB costs about 8 times a row.

### Telemetry

The worker writes seven attributes at the end of the `agent.session` span (`engine/src/worker/unit/native-agent.ts`):

| Attribute                              | Value                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `kanthord.session.redaction_count`     | Sum of `counts().redacted`                                                                           |
| `kanthord.session.redaction_rules`     | Sorted rule ids with a count above 0                                                                 |
| `kanthord.session.redaction_failed`    | `scan_failed`                                                                                        |
| `kanthord.session.unkept`              | `unkept`: each index 0 marker other than `scan_failed`, for a full table or a view text that differs |
| `kanthord.session.restore_blocked`     | `restore_blocked`                                                                                    |
| `kanthord.session.compaction_residual` | `compaction_residual`                                                                                |
| `kanthord.session.thinking_kept`       | `thinking_kept`                                                                                      |

- The workbench logs one record `sensitive text redacted` at each `closeAgent`, with the same seven fields, when a count is above 0. The counts do not reset. Each record holds the totals of the redaction object.
- `pe@1` logs the same record after `drive` returns or throws.
- No attribute or log field holds a value, a marker index, a tag, a length or a digest of a value.

### Errors

- A rule throws for a string, for example a `RangeError`. The string becomes `<redacted:scan_failed:a:TAG>`, and `scan_failed` grows. The reference also fails closed (`pi.ts`).
- The `message_end` handler catches every error itself, because pi persists the unchanged message after a handler error (`pi-coding-agent/core/extensions/runner.js`). On an error outside a string, each non-structural string becomes `<redacted:scan_failed:a:TAG>`.
- The `context` handler catches every error, and the summary becomes `<redacted:scan_failed:a:TAG>`.
- The `tool_call` handler catches every error and returns `{ block: true, reason }`. On a throw, pi also fails the call (`pi-agent-core/agent-loop.js`).
- `known()` rejects at the first call: the set stays empty, and rules 0b to 17 still apply.

### Tests

A test file builds every fake key from parts at run time, for example `["AKIA", "KANTHORDCANARY01"].join("")`. No file of the repositories holds a literal that a secret scanner matches. The reference test file `pi.test.mjs` is a counter-example: a local scanner blocks its read.

`engine/src/agent/sensitive-text.test.ts`:

- `findPatternText`: a case table with one row for each decision case of `test.sh`. A deny case gives a span, and an allow case gives none.
- The two deviations: the `TEST_GITHUB_TOKEN` case and the `- E2E_GITHUB_TOKEN` case of `test.sh` are deny cases. The JWT case of `test.sh` is a deny case of rule 16.
- Category positives: one row for each of the 86 shapes of the 11 categories, built from parts at run time. Each row names the expected rule.
- Category negatives: one row for each text of [Text that stays visible](#text-that-stays-visible). Each row gives no span.
- Rule 4: a URL with a user and a password, and a URL with an empty user and a password, mask the whole userinfo. A userinfo with no `:` gives no span. A password that starts with `test_` or `$` gives no span.
- Rule 6: a PGP block masks only its base64 lines and its checksum line. A PuTTY file masks the `Private-Lines:` count of lines. An age key is one span.
- Rule 7: a Docker Hub token that ends with `-` gives one span. A Terraform token keeps its token id visible.
- Rule 8: a Slack webhook and a Discord webhook keep the host visible. A Telegram token keeps the bot id visible.
- Rule 9: `sk_live_` gives a span, and `sk_test_` and `rk_test_` give none. A `.env` line `STRIPE_SECRET_KEY=` with a test key gives a rule 13 span.
- Rule 12: `refresh_token` and a bare `token` give a span. The label `PlatformToken` gives none.
- Rule 13: one row each for `application.yml`, `.pypirc`, `.my.cnf` and `pip.conf`, and for a Compose `POSTGRES_PASSWORD:` line. The TS properties `password: token,` and `KANTHORD_TOKEN: token,` give no span.
- Rule 14: libpq, JDBC with `;` and with `?`, ADO.NET, `AccountKey=`, `SharedAccessKey=`, `--password=`, a query `token=` and `X-Amz-Signature=`.
- Rule 15: a bearer header, a basic header, `X-API-Key`, a cookie, `curl -u` and `curl --user=`. `curl -u 1000:1000`, `docker run -u 1000:1000`, `git push -u` and `` `Bearer ${token}` `` give no span.
- Rule 16: `eyJ` and 12 characters, `.eyJ` and 4 characters, `-`, then a valid JWT: the valid JWT gets its span. A chain `h1.p1.s1-h2.p2.s2` gives one span.
- Rule 16: a JWT at a word start gives one span. A second segment that does not start with `eyJ`, or a short third segment, gives none. A bearer JWT gives one rule 15 span.
- Rule 17: `.npmrc` `_authToken=`, a Docker `"auth"`, a kubeconfig `client-key-data`, a `.netrc` line and a `password` line.
- Rule 13 and the fixture rule on each line form of `P`: `grep` match, `grep` context, pi `edit` diff, `git diff` and `cat -n`.
- The escaped view: a JSON `tail` string with a rule 13 line and a rule 12 line.
- The escaped view: a CRLF line in a JSON tail, a value with a backslash, and `\\n` that decodes to a backslash and `n`.
- The escaped view: a span that ends on `A` or on `\\` ends after the last source character of the escape.
- The escaped view: the part checks find a suffix part at a line start inside a JSON string.
- A 2 KiB JWT literal for rule 12. A 1 KiB URL password for rule 4.
- Rule 4: the performance unit of 31 scheme letters before each `://` gives one start per `://`, and a valid URL still gives its value.
- Rule 5: anchored on the performance inputs and on a valid DSN. A user that ends with `$` or `<` matches.
- Rule 5 differential: 200000 random short strings against the regex form of rule 5. Every regex finding is found.
- Rule 6: a full PEM block masks only its body lines; the header and the END line stay. A header with base64 lines to the text end; a header in a JSON string keeps the rest of its line.
- Rule 6: a table with the body of one RSA 4096 key masks nothing in `engine/src/repository/ssh-key.ts`.
- Rule 6: a body of 20000 base64 characters between a header and its END line gets index 0, and its restore blocks.
- Rule 6: a header constant and an END constant 300 code lines apart give no END span and mask no code line.
- Rule 6: an encrypted PEM block with `Proc-Type:`, `DEK-Info:` and an empty line masks only its base64 lines, also with no END line.
- Rule 6: one line of many headers, then base64 lines, gives one span, and the performance row stays below 600 ms.
- Rule 6: field lines that each hold a header, then base64 lines, give one span, and the performance row stays below 600 ms.
- Rule 6: two scans of an equal PEM string each give one rule 6 span, also after a scan of another text.
- Overlaps: a partial overlap of rules 13 and 0b gives one span with the exact merged text.
- Overlaps: a rule 1 token inside a rule 12 value gives one span of the whole value. Rule 0 wins over rule 11.
- `findKnownText`: the exact secret, base64url and percent encoding.
- `findKnownText`: base64 at offsets 0 to 2 with a trailing byte after the secret, and base64 wrapped at 64 and at 76 characters.
- `findKnownText`: base64 wrapped at 76 characters with CRLF, with two spaces of indent, and inside a JSON string.
- `findKnownText`: a run of one full line and one short line; a single full line is no run.
- `findKnownText`: `addSecret` after the first scan adds the forms and the parts of a refreshed secret.
- `findKnownText` parts: a prefix before `... [truncated]` in a 600-character line, and a suffix at a line start.
- `findKnownText` parts: a part of 12 characters that holds `sk-ant-api03-` and less of the body gives no span.
- `promotes`: `postgres` from rule 4 and `development` from rule 12 are not promoted.
- `promotes`: a 16-character random value of rule 12, a rule 1 value and a rule 16 value are promoted. A low-entropy value of rule 15 is not promoted.
- Matcher: 64 nested values `a` x 12 to `a` x 75 on a text of `a` give one merged span.
- Matcher: a text that shares the first 32 characters of a value and then differs is masked to the length of that value.
- Matcher: a value of 12 to 31 characters is found only as a whole.
- Matcher: a differential test runs with the production `INDEXED_PREFIX_CHARACTERS`. Its values reach 87 characters, so it covers keys of 32 characters and whole values.
- Matcher: a table of 4096 random values of 128 characters holds at most 32 nodes for each value and form. The heap growth of the matcher stays below 64 MB.
- Matcher: 455 groups of 9 values with a shared prefix of 2048 characters hold at most 32 nodes for each value. The build stays below 600 ms.
- Window map: 600 secrets cost one lookup for each line start and each cut. The performance rows with 600 secrets stay below 600 ms.
- `restore`: a short value of a nested call is masked in the `toolResult` of the outermost call. The list goes after a block and at `agent_end`.
- Overlaps: a 0b part takes the rule of its table entry.
- Overlaps: a rule 12 value that holds a valid marker is cut at the marker bounds, and the marker stays unchanged.
- A provider token inside an invalid marker gives a span.
- Every whole-scan performance row stays below 600 ms. The test pins its code input to the files of one engine commit.
- The adversarial units of the rule set stay below 600 ms each. They are the `-eyJ` units and the starts of rules 14, 15 and 17. They also are the rule 13 `-1` and `-1-a` units, the `curl ` and `curl c ` units, and the 256 KiB regression row of repeated `-eyJ`.
- A string above `SENSITIVE_SCAN_MAX_CHARACTERS` becomes `scan_failed`.
- The source of `sensitive-text.ts` gives exactly one span for itself: the rule 12 span of the `ConnectionSecret` label.
- `redactValue`: keeps structural keys, masks a pattern finding of rules 1 to 17 with `<redacted:RULE>`, and leaves a session marker unchanged.
- `redactValue`: one matcher masks a secret that `addSecret` added after an earlier call.

`engine/src/agent/hooks/sensitive-text-redaction.test.ts`:

- `message_end` for each role, with `system` sections and `toolsAdded`.
- Same message: line 1 of a tool result holds the value in a form that no rule matches. Line 2 holds a rule 4 finding. Both lines hold the marker.
- Same message: two tool calls of one assistant message hold one value.
- A rule 12 value restored into `edit`, then the `toolResult` with its `diff` holds the marker.
- A rule 4 password `pass` is restored into `edit`, and the `toolResult` of that call holds the marker. A later `npm test` output with `passed` stays unchanged.
- A rule 13 value of 12 characters and entropy below 3.25 is restored into `write`. A later `cat` `toolResult` of that file holds the marker.
- A `bash` `toolResult`: the persisted message holds only the keys `role`, `toolCallId`, `toolName`, `content`, `details`, `usage`, `isError`, `durationMs` and `timestamp`.
- A `toolResult` with an extra key that holds a value: the persisted message holds the marker in that key.
- After a restore into `write`, the persisted assistant `toolCall.arguments` hold the marker.
- Thinking: a signed Anthropic block, a signed Codex block and a signed Azure Responses block stay whole, and `thinking_kept` grows.
- Thinking: an unsigned Google block and a Bedrock block with an empty signature are redacted, and each keeps its `thinkingSignature`.
- Thinking: an `openai-completions` block with `reasoning_content` is redacted and keeps its signature. A block of another API with a signature stays whole.
- Thinking: pass 2 leaves a kept block unchanged, and a kept finding masks a later text.
- Structural keys: `thoughtSignature` stays; a key `model` inside `arguments` is redacted.
- `restore`: `write` and `edit` input; a nested `write` call with `parentToolCallId`.
- `restore` by tool: a `read` and a `grep` input with a rule 12 marker reach the tool unchanged. A `read` input with a `llm_credential` marker blocks.
- `restore` blocks: index 0, an index with no value, a resumed session file that holds a marker of an earlier redaction object.
- `restore` blocks: a value that equals a known secret under another rule, and a value that contains a known secret.
- `restore` blocks every `bash` input with a marker of this session, with the shell reason. The cases are a value of shell-safe characters, a resume marker and an index 0 marker.
- `restore` blocks: a rule 6 PEM block in `bash`, and the reason names the write and edit tools.
- `restore` blocks: a `llm_credential` marker after the holder changes and the current set no longer holds its secret.
- `restore` blocks: a value whose view text differs from its source text has index 0, and its restore into `write` blocks.
- Table: each final merged span of pass 2 enters the table, and its marker restores the exact source text.
- `mergedSecrets` of two sources returns the secrets of both.
- `restore` leaves text: a tracer marker, a marker of another session, also in `bash`.
- A table above `REDACTION_TABLE_MAX` gives index 0, and its restore blocks.
- A custom tool with a `pattern` parameter refuses a marker before the restore.
- `checkoutConfinement` after `restore` receives the unchanged marker of a `read` path.
- `toolApproval` after `restore` holds the unchanged marker of a mutation operation input in `session.approvals`. A `write` call passes the approval with no entry.
- A prompt holds a provider key before the first refresh; a `bash` call with its marker blocks.
- Refresh at `turn_start` and at the `message_end` of an assistant message; a rejected `known`.
- `context` redacts the summary of a resumed file; `session_compact` counts the residual.
- `context`: a `custom` message that a consumer `context` handler adds before `hook` reaches the request redacted.
- `counts`, `text()` counts, a handler error that fails closed.

Engine consumers:

- `engine/src/worker/unit/agent-session.test.ts`: `openSession` installs `restore` after `homeRelativeCwd` and `hook` last, and returns the redacted system prompt. A passed `redaction` is used, and none is created.
- In that test: the tag of the returned system prompt equals the tag of a later `message_end` marker of the same session.
- `engine/src/worker/unit/native-agent.test.ts`: `openNativeAgent` with `scriptedProvider` and `SessionManager.create` on a temporary directory. The work prompt and the system prompt hold a fake key.
- In that test: the script calls `write` with the marker of the work prompt key, then `bash` with the same marker.
- In that test: the written file holds the real value, and the `bash` call blocks with the shell reason. The session file and the model context of each call hold no fake key.
- In that test: the pins insert no second work prompt. `work.digest` equals the digest of the rendered work prompt.
- In that test: the seven span attributes are present, and each prompt finding counts once.
- `engine/src/worker/unit/session-entries.test.ts`: `sessionEntryRecord` redacts a known secret and a pattern finding with `<redacted:RULE>`.
- `engine/src/worker/unit/agent-telemetry.test.ts`: the tracer matcher of a session masks a secret of a refresh.
- `engine/src/worker/unit/pinned-layers.test.ts`: `pinInference` with a redacted system prompt and work inserts nothing. The request roles are `system, user`, and the request holds no value.
- `engine/src/apps/server/e2e-workbench.test.ts`: a fake key in the workbench prompt reaches no model request.
- In that test: a marker from before `session.configure` restores into `write` after it, and `closeAgent` writes the log record with `unkept`.
- In that test: a `llm_credential` marker from before `configure` to another credential blocks after it.
- `engine/src/project/environment-agent.test.ts`: the `pe@1` session opens with the redaction, keeps the confinement, and redacts its JSON failure message. The log record follows `drive`.
