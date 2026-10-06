---
title: Agent Implementation
---

# Agent Implementation

This file holds the mechanisms that realize [agent.md](agent.md).
This file is not a design document, and `agent.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## The agent catalog

- The catalog is a static server module that holds one declaration per agent name, with options, a whole-configuration constraint and prompts.
- Options use `zod` at 4.4.3, and the constraint uses `superRefine`.
- `swe@1` and `re@1` declare an empty option schema.
- The declaration supplies no provider, model identifier or reasoning-effort default.
- `agent list` answers one summary per catalog agent: `agentName`, `workerNames` and `enablement`.
- `agent get` answers the prompts of the declaration, `configurationSchema`, `overridableFields` and `enablement`.
- `enablement` is null when no record exists.
- `agent.get` is `GET /api/agent/:agentName`, keyed by agent name. It answers `agentName`, `configurationSchema`, `overridableFields`, `basePrompt` when declared, `agentPrompt`, `tools` and `enablement`, the agent enablement or `null`. It composes no prompt and reads no agent file. An unknown agent answers 404 `agent.not_found`. [Configuration schema](#configuration-schema) defines the schema, and [the agent catalog](#the-agent-catalog) owns the declaration.
- Tests cover each human read, each unknown name, and null and disabled enablements.

## Agent configuration validation

- The Agent component owns enablement writes and effective configuration resolution.
- The Worker Service owns `validateEntry(tx, workerName, entry)`, and it validates the entry of each agent of the worker through the Agent component.
- The [entry forms](worker-service.vocabulary.md#entry) define inheritance and required fields.
- A write refuses nonempty `options`.
- Every enablement write, worker binding write and resolution runs the same checks.
- Every enablement write names `expectedRevision`, the latest row of the agent that the human read. A `put` for an agent with no row names none. A stale or absent value answers 409 `agent.enablement.revision_conflict` with the current value in `details`.
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

## Session file

- The adapter stores an agent session as the JSONL session file of `@earendil-works/pi-coding-agent` at 0.86.0.
- The session file lives under `sessions/` of the pi agent directory that `PI_CODING_AGENT_DIR` names.
- pi appends each entry of the session to that file.
- A resume opens that file through the `SessionManager` of pi.
- The adapter passes the session identity of the consumer as `id` to `SessionManager.create`.
- A resume takes the file whose session id equals that identity, and it never calls `continueRecent`.
