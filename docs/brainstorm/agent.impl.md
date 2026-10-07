---
title: Agent Implementation
---

# Agent Implementation

This file holds the mechanisms that realize [agent.md](agent.md).
This file is not a design document, and `agent.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## Runtime reuse

- The runtime is `@earendil-works/pi-coding-agent` at 0.86.0.
- A design of a consumer starts from the capability of pi that serves it, and it states the gap that kanthord builds.

## The agent catalog

- The catalog is a static server module that holds one declaration per agent name, with options, a whole-configuration constraint and prompts.
- Options use `zod` at 4.4.3, and the constraint uses `superRefine`.
- `swe@1` and `re@1` declare an empty option schema.
- The declaration supplies no provider, model identifier or reasoning-effort default.
- `agent list` answers one summary per catalog agent: `agentName`, `workerNames` and `enablement`.
- `agent get` answers `prompt`, `configurationSchema`, `overridableFields` and `enablement`.
- `enablement` is null when no record exists.
- `agent.get` is `GET /api/agent/:agentName`, keyed by agent name. It answers `agentName`, `configurationSchema`, `overridableFields`, `prompt`, `tools` and `enablement`, the agent enablement or `null`. An unknown agent answers 404 `agent.catalog.not_found`. [The prompt answer](#the-prompt-answer) defines `prompt`. [Configuration schema](#configuration-schema) defines the schema, and [the agent catalog](#the-agent-catalog) owns the declaration.
- Tests cover each human read, each unknown name, and null and disabled enablements.

## The prompt answer

- `prompt` holds `layers` and `final`.
- `layers` holds the system layer, the agent layer and the working layer, in reading order. Each layer holds `{ layer, sources }`.
- Each source answers `{ source, origin, path, enabled, state, digest, text }`.
- `origin` is one of `binary`, `file` and `database`.
- `state` is one of `present`, `absent`, `invalid`, `off` and `deferred`. `deferred` marks an agent file of a workspace, which only the worker application reads.
- `path` is the home-relative path of a `file` source, else `null`. `digest` and `text` are `null` unless `state` is `present`.
- `final` holds the framing, then the text of every `present` source, in reading order.
- The query `view=final` answers `prompt` with `final` only.
- The optional queries `projectId` and `bindingId` select the working layer of that repository binding. Without them, the working layer is the workbench working layer of the agent.
- A `bindingId` that names no repository binding of `projectId` answers 404 `project.binding.not_found`. One of the two queries without the other answers 400 `gateway.request.validation_failed`.
- Tests cover every origin, every state, `view=final`, the workbench working layer, a binding working layer and each refusal.

## Agent configuration validation

- The Agent component owns enablement writes and effective configuration resolution.
- The Worker Service owns `validateEntry(tx, workerName, entry)`, and it validates the entry of each agent of the worker through the Agent component.
- The [entry forms](worker-service.vocabulary.md#entry) define inheritance and required fields.
- A write refuses nonempty `options`.
- Every enablement write, worker binding write and resolution runs the same checks.
- Every enablement write names `expectedRevision`, the latest row of the agent that the human read. A `put` for an agent with no row names none. A stale or absent value answers 409 `agent.enablement.revision_conflict` with the current value in `details`.
- A `put` or a `provider.add` that names the name of another agent provider of the same enablement answers 409 `agent.enablement.provider.name_conflict`.
- A `put` or a `provider.add` that names a credential of another agent provider of the same enablement answers 409 `agent.enablement.provider.credential_conflict`. A `provider.add` names the credential and the holding agent provider in `details`.
- It checks the override allowlist before the merge, then validates the complete effective configuration.
- `overridableFields` of `swe@1` and `re@1` is `["agentProvider", "modelIdentifier", "reasoningEffort"]`.
- `validateEntry` refuses a worker whose agent has no enabled enablement, and names that agent.
- This refusal occurs inside the worker binding write transaction.
- An enablement change calls `entriesOfAgent(tx, agentName)` of the Project Service in the transaction of its commit.
- It validates every dependent worker binding and lists invalid bindings in its refusal.
- Removal checks all dependents in that same transaction.
- [The collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) requires co-location of the two owners.
- A resolution reads the worker binding, entry, enablement and credential metadata from one snapshot, and it records the revisions of the binding, the entry and the enablement.
- The span of each native model inference call carries the worker binding and the agent enablement as identity attributes. Each value is the row id that the resolution read, so the span records the revisions of the binding, the entry and the enablement.
- Resolution makes no network call.
- The instance healthcheck reports whether the effective configuration resolves.

Provider definitions contain no auth types; the [LLM component](llm.impl.md#platform-validators) owns those types, and custody owns suitability.

- A provider is a member of the [agent provider set](agent.vocabulary.md#agent-provider).
- Built-in definitions use `getBuiltinProviders()` of `@earendil-works/pi-ai` at 0.86.0.
- A model identifier belongs to `getBuiltinModels(provider)` or to the [approved models](llm.impl.md#the-approved-models) that the LLM component answers for an `openai-compatible` credential.
- An empty `models` list permits no model selection.
- The reasoning effort belongs to the model's supported levels from `getSupportedThinkingLevels` or credential metadata `reasoningLevels`, which defaults to `["off"]`.
- A level that no source establishes fails validation.
- The Agent component sends `{ credential, platform }` to custody and consumes its suitability result.
- It reads no metadata and no secret.

## Model list

- `agent.enablement.provider.model.list` is `GET /api/agent/enablement/:agentName/provider/:providerName/model`, `human`, `unary`, `mutation: false`.
- It answers `{ items: [{ modelIdentifier, reasoningEfforts }] }` for the agent provider of the latest enablement row of the agent.
- A built-in platform answers `getBuiltinModels(provider)` of pi-ai, and `reasoningEfforts` holds `getSupportedThinkingLevels` of each model.
- An `openai-compatible` provider answers the approved models of its credential, and `reasoningEfforts` holds the `reasoningLevels` of each model.
- The list uses the sources of [the validation](#agent-configuration-validation), so every listed pair passes it.
- An unknown agent answers 404 `agent.catalog.not_found`. An absent enablement answers 404 `agent.enablement.not_found`. An absent provider answers 404 `agent.enablement.provider.not_found`.
- The dashboard fills the model picker and the reasoning-effort picker of a workbench session from this list.
- A switch of the agent provider in a picker reloads this list and resets the model to its first model. The effort stays when the new model lists it, else it takes the first listed effort.

## Configuration schema

- `configurationSchema` uses JSON Schema draft 2020-12, emitted by `z.toJSONSchema` of `zod` at 4.4.3.
- Its source is the effective-configuration schema, not the template's option schema.
- The root is an object with `additionalProperties: false`.
- All five properties below are required; none carries `default`, and the schema holds no `options`.

| Property          | Schema                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `agentProvider`   | `string`; the name of an agent provider of the enablement         |
| `provider`        | `string`, enum of every platform of the [LLM platform list](llm.impl.md#platform-validators) |
| `credential`      | `string`; a credential name                                       |
| `modelIdentifier` | `string`                                                          |
| `reasoningEffort` | enum `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`    |

- The schema description states the whole-configuration constraint of [configuration validation](#agent-configuration-validation).
- It names model membership in the provider catalog and reasoning-effort membership in the supported levels of that model.
- JSON Schema validates no cross-field lookup; the Agent component enforces it.

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
- A test covers two enablement writes that name one expected revision, and it asserts that the second one answers 409 `agent.enablement.revision_conflict`. A test covers a `put` without `expectedRevision` for an agent that holds a row.
- Tests cover override allowlists, model catalogs, established reasoning levels and all five effective-configuration fields.
- Tests assert schema draft, required properties, absent defaults, absent options and the whole-configuration description.
- Tests cover transactional changes and removals, dependency lists, snapshot reads and recorded revisions.
- Tests cover the metadata provider build, per-model base URLs, zero costs and absent environment keys.
- Tests cover every provider-check answer, status, deadline and the absence of raw keys.
- Tests cover healthcheck grouping, attribution, report-only behaviour and no inference call.

## Prompt composer configuration

- `agent.prompt.systemFile` holds the path of a Markdown file, as a string, and it defaults to an empty string.
- An empty value runs host discovery: `~/.agents/AGENTS.md`, then `~/.claude/CLAUDE.md`. The first file that exists is the host agent file.
- A nonempty value names the host agent file, and the composer runs no discovery.
- `agent.prompt.agentDirectory` holds the path of a directory, as a string, and it defaults to an empty string.
- An empty value means the agent layer holds no agent file source.
- A relative path of either field resolves against the data directory.
- The loader reads each file under the rules of [prompt composition](worker-service.impl.md#prompt-composition).
- Tests cover an empty and a nonempty `systemFile`, each discovery file, an empty and a nonempty `agentDirectory`, and a relative path.

## Session file

- The adapter stores an agent session as the JSONL session file of `@earendil-works/pi-coding-agent` at 0.86.0.
- The session file lives under `sessions/` of the pi agent directory that `PI_CODING_AGENT_DIR` names.
- pi appends each entry of the session to that file.
- A resume opens that file through the `SessionManager` of pi.
- The adapter passes the session identity of the consumer as `id` to `SessionManager.create`.
- A resume takes the file whose session id equals that identity, and it never calls `continueRecent`.
