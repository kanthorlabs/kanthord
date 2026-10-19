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
- The declaration supplies no provider, model identifier or reasoning-effort default.
- `agent list` answers one summary per catalog agent: `agent_name`, `worker_names` and `enablement`.
- `agent get` answers `prompt`, `configuration_schema`, `overridable_fields` and `enablement`.
- `enablement` is null when no record exists.
- `agent.get` is `GET /api/agent/:agent_name`, keyed by agent name. It answers `agent_name`, `configuration_schema`, `overridable_fields`, `prompt`, `tools`, `enablement`, the agent enablement or `null`, and the [chain view](#the-chain-view). An unknown agent answers 404 `agent.catalog.not_found`. [The prompt answer](#the-prompt-answer) defines `prompt`. [Configuration schema](#configuration-schema) defines the schema, and [the agent catalog](#the-agent-catalog) owns the declaration.
- Tests cover each human read, each unknown name, and null and disabled enablements.

## The prompt answer

- `prompt` holds `layers` and `final`.
- `layers` holds the system layer, the agent layer and the working layer, in reading order. Each layer holds `{ layer, enabled, sources }`. `enabled` is the effective state of the layer: for the system layer, the override of the agent or, under `inherit`, the layer switch of the server; for another layer, always `true`.
- A source of a layer that is not `enabled` answers the state `off`.
- Each source answers `{ source, origin, path, enabled, state, digest, text }`.
- `origin` is one of `binary`, `file` and `database`.
- `state` is one of `present`, `absent`, `invalid`, `off` and `deferred`. `deferred` marks an agent file of a workspace, which only the worker application reads.
- `path` is the home-relative path of a `file` source, else `null`. `digest` and `text` are `null` unless `state` is `present`.
- `final` holds the system prompt that ends with the framing, then the message of every `present` source of the working layer, in reading order.
- The query `view=final` answers `prompt` with `final` only.
- The optional queries `project_id` and `binding_id` select the working layer of that repository binding. Without them, the working layer is the workbench working layer of the agent.
- A `binding_id` that names no repository binding of `project_id` answers 404 `project.binding.not_found`. One of the two queries without the other answers 400 `gateway.request.validation_failed`.
- Tests cover every origin, every state, `view=final`, the workbench working layer, a binding working layer and each refusal.

## Agent configuration validation

- The Agent component owns enablement writes and effective configuration resolution.
- The Worker Service owns `validateEntry(tx, workerName, entry)`, and it validates the entry of each agent of the worker through the Agent component.
- The [entry forms](worker-service.vocabulary.md#entry) define inheritance and required fields.
- A write refuses nonempty `options`.
- Every enablement write, worker binding write and resolution runs the same checks.
- Every enablement write names `expected_revision`, the latest row of the agent that the human read. A `put` for an agent with no row names none. A stale or absent value answers 409 `agent.enablement.revision_conflict` with the current value in `details`.
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

## Model list

- `agent.enablement.provider.model.list` is `GET /api/agent/enablement/:agent_name/provider/:provider_name/model`, `human`, `unary`, `mutation: false`.
- It answers `{ items: [{ model_identifier, reasoning_efforts }] }` for the agent provider of the latest enablement row of the agent.
- A built-in platform answers `getBuiltinModels(provider)` of pi-ai, and `reasoning_efforts` holds `getSupportedThinkingLevels` of each model.
- An `openai-compatible` provider answers the approved models of its credential, and `reasoning_efforts` holds the `reasoning_levels` of each model.
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
- `cooldown` is `null` or `{ strikes, available_at }`. It reads the hold of the credential of the chain entry, so every chain entry of one credential shows the same `cooldown`.
  - A hold that expired still shows in `cooldown` with its `strikes` and a past `available_at` until a success or a clear. Selection treats it as free.
- `active_position` is the position of the first chain entry whose `cooldown` is `null` or whose `available_at` is not later than the clock reading. It is `null` when every chain entry has a live cooldown.
- `cooling` is `null`, or `{ code: "agent.configuration.chain_cooling", available_at }` when `active_position` is `null`. `available_at` is the earliest `available_at` of the chain.
- The `agent.get` view of an agent builds the chain from the enablement alone. An absent enablement answers `chain: []`, `active_position: null` and `cooling: null`.
- The project agent configuration views build the chain from the effective configuration and the entry of the worker binding. An invalid configuration answers `chain: []`.
- The views read the clock once for each answer.
- Tests cover a chain with no cooldown, one cooling entry, every entry cooling, an expired cooldown and an invalid configuration.

## The agent cooldown

- The cooldown of a credential lives on the row of revision 1 of its name, in the columns `credential.available_at` and `credential.strikes` of [ERD 1](../reference/erd/01-setup.md). No table `agent_cooldown` exists.
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
- A `stop` with the reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` holds the credential of each pinned selection. A credential that two selections share is held once.
- The hold adds 1 to `strikes`, so the first failure sets `strikes` to 1, and it sets `available_at`.
- A `stop` with the reason `provider_failed` and the code `bad_request` or `unauthorized` holds no credential and releases no credential.
- A release with no `stop`, or with a `stop` whose reason is not `provider_failed`, releases the credential of each pinned selection. A success on any model therefore releases the whole credential.
- A release of a credential sets `available_at` to null and `strikes` to 0. It changes a row only when `strikes` is above 0, also for a hold whose `available_at` is in the past.
- An advancing `stop` is neutral for the failure count, as [the failure count](scheduler-service.impl.md#loss-settlement) states.
- The write logs `agent.fallback.cooldown_started` at level `info` with `execution_id`, `credential_name`, `code`, `strikes` and `available_at`, once for each held credential. `strikes` and `available_at` are the new values of the hold.
- A release that changes a row logs `agent.fallback.cooldown_cleared` at level `info` with `execution_id` and `credential_name`. A release of a credential with `strikes` 0 logs nothing.
- A human clear of a cooldown logs `agent.fallback.cooldown_cleared` at level `info` with `credential_name` and no `execution_id`.
- The release and the clear write the cooldown logs after their commit, so a rolled-back write leaves no log line. Today they write the logs inside their transaction, so a rolled-back write still leaves its log line, and no hold row.

### The claim selection

- The claim transaction calls the Agent component with the pinned worker binding row and the native agents of the worker.
- The component builds the chain of each agent and reads the hold of the credential of each chain entry.
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
- It answers `{ items: [{ credential, strikes, available_at }] }`. It lists each credential with `strikes` above 0, live and expired, ordered by credential name.
- `agent.cooldown.clear` is `DELETE /api/agent/cooldown/:credential`, `human`, `unary`, `mutation: true`. It releases the credential and answers 204.
- A `credential` with no hold, that is `strikes` 0 or an unknown name, answers 404 `agent.cooldown.not_found` with `details: { credential }`.
- The CLI commands are `kanthord agent cooldown list` and `kanthord agent cooldown clear <credential>`.
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
- Tests cover the metadata provider build, per-model base URLs, zero costs and absent environment keys.
- Tests cover every provider-check answer, status, deadline and the absence of raw keys.
- Tests cover healthcheck grouping, attribution, report-only behaviour and no inference call.

## Prompt settings

- The table `agent_prompt` of [ERD 1](../reference/erd/01-setup.md) holds one row per scope: `system`, then `agent` and `workbench` for each catalog agent.
- `agent.prompt.get` is `GET /api/agent/prompt`, `human`, `unary`, `mutation: false`. The query holds `scope` and, for the `agent` and `workbench` scopes, `agent_name`. It answers the settings of that scope, the absent row included.
- `agent.prompt.put` replaces the `custom_text` of one scope. `agent.prompt.switch` sets one switch of one scope, or the system layer override of one `agent` scope.
- The switches of the `system` scope hold `layer`, the layer switch of the system layer, beside its source switches.
- The table `agent_prompt` holds the column `system_layer`: `inherit`, `on` or `off` for an `agent` row, `NULL` for any other row. The settings answer it as `system_layer`.
- `agent.prompt.switch` takes either `switch` with `enabled`, or `system_layer` with the `agent` scope. Any other combination answers 400 `gateway.request.validation_failed`.
- Both writes take `expected_revision`. A stale or absent value answers 409 `agent.prompt.revision_conflict` with the current row in `details`.
- A `custom_text` above 32768 UTF-8 bytes answers 400 `agent.prompt.too_large`.
- A switch that turns off every source of an `agent` scope answers 409 `agent.prompt.agent_layer_empty`.
- The settings answer holds `locked_switches`, the names of the switches of that scope that the configuration locks. The list is empty when no lock applies.
- A switch of a name in `locked_switches` answers 409 `agent.prompt.switch_locked` with `scope` and `switch` in `details`.
- A write creates the row of its scope at `revision` 1 when none exists. A read of an absent row answers every switch on, an empty `custom_text` and, for an `agent` row, `system_layer` `inherit`.
- The Project Service owns the working switches of a repository binding, in its `config` JSON.
- Tests cover each scope, each write, each refusal, an absent row and two writes at one `expected_revision`.

## Prompt composer configuration

- `agent.prompt.system_file` holds the path of a Markdown file, as a string, and it defaults to an empty string.
- An empty value runs host discovery: `~/.agents/AGENTS.md`, then `~/.claude/CLAUDE.md`. The first file that exists is the host agent file.
- A nonempty value names the host agent file, and the composer runs no discovery.
- `agent.prompt.host_file` holds a boolean, and it defaults to `true`.
- `false` locks the `host_file` switch of the `system` scope. The composer resolves the host agent file source as `off` for every agent, whatever the stored switch holds.
- The lock keeps the stored switch. When the configuration returns to `true`, the stored switch controls the source again.
- `agent.prompt.agent_directory` holds the path of a directory, as a string, and it defaults to `agents`. The agent file of `swe@1` is then `~/.local/share/kanthord/agents/swe@1.md`, and the agent page shows that path on the agent file row.
- An empty value means the agent layer holds no agent file source.
- A relative path of either field resolves against the data directory.
- The loader reads each file under the rules of [prompt composition](worker-service.impl.md#prompt-composition).
- Tests cover an empty and a nonempty `system_file`, each discovery file, each value of `host_file`, an empty and a nonempty `agent_directory`, and a relative path.

## Prompt templates

- The binary ships one Handlebars template per agent-facing text under `static/prompt/template/`: `work`, `layer-message`, `framing-worker`, `framing-workbench`, `task-judgement`, `task-choice`, `task-revision`, `criterion-revision`, `conflict`, `evaluation`, `examine` and `repair`.
- A file `<name>.md` in the subdirectory `prompts` of the agent directory replaces the shipped template of that name. With the default `agent_directory`, the file of `evaluation` is `~/.local/share/kanthord/agents/prompts/evaluation.md`.
- An empty `agent_directory` means that every template is the shipped template.
- The server resolves the template set at each prompt composition. The loader reads each file under the rules of [prompt composition](worker-service.impl.md#prompt-composition).
- A file that the loader rejects, or that Handlebars cannot compile, answers 409 `agent.prompt.template_invalid` with `template`, `path` and `reason` in `details`. The server uses no shipped template in its place.
- A render answers 409 `agent.prompt.template_invalid` with `reason` `render` when the template names a value that the caller does not supply.
- The renderer escapes no value, and it permits no helper other than the built-in block helpers and `json`. `json` writes its argument as JSON.
- The renderer removes the trailing whitespace of the rendered text.
- The execution setup carries the resolved template set, so the worker application reads no template file.
- The values of each template:

| Template             | Values                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `work`               | `name`, `requirement`, `criterion`, `verifications[].number`, `verifications[].command`, `repositories` |
| `layer-message`      | `source`, `text`                                                                                        |
| `framing-worker`     | none                                                                                                    |
| `framing-workbench`  | none                                                                                                    |
| `task-judgement`     | `task_id`, `criterion`, `prior_rationale`, `marker`                                                     |
| `task-choice`        | `failure`, `tasks[].filename`, `tasks[].name`, `tasks[].criterion`, `marker`                            |
| `task-revision`      | `rationale`, `results`, `output`                                                                        |
| `criterion-revision` | `rationale`                                                                                             |
| `conflict`           | `binding`, `directory`, `base_branch`, `files`                                                          |
| `evaluation`         | `tasks`, `tested_input`, `evidence`, `dependencies`, `marker`                                           |
| `examine`            | `repositories`, `verification`, `dependencies`, `outcomes`, `evidence`                                  |
| `repair`             | `marker`                                                                                                |

- `repositories` lists `{ name, directory, base_branch }` for each repository binding of the pinned revision, in binding order. `work` receives an empty list for a node with one repository binding.
- `verification` holds the results of the node verifications that the execution code runs. `dependencies`, `outcomes` and `evidence` are empty for an `examine` node with no direct dependency.
- `marker` is the marker that the worker parses. A replacement of `task-judgement`, `task-choice`, `evaluation` or `repair` keeps the marker line, or the worker treats the reply as invalid.
- Tests cover the shipped set, a replacement, each rejection, a render without a value and the absence of escaping.

## Session file

- The adapter stores an agent session as the JSONL session file of `@earendil-works/pi-coding-agent` at 1.1.0.
- The session file lives under `sessions/` of the pi agent directory that `PI_CODING_AGENT_DIR` names.
- pi appends each entry of the session to that file.
- A resume opens that file through the `SessionManager` of pi.
- The adapter passes the session identity of the consumer as `id` to `SessionManager.create`.
- A resume takes the file whose session id equals that identity, and it never calls `continueRecent`.
