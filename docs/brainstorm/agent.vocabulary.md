---
title: Agent Vocabulary
---

# Agent Vocabulary

This file holds the values and the examples of the terms that [agent.md](agent.md) owns.
This file is not a design document, and `agent.md` stays the single source of truth.

## agent component

The shared component that holds the agent catalog, the agent configuration, the runtime of a native agent and the agent session.
For "Add password reset", Execution 1 opens an agent session of `swe@1` through the Agent component.

## in the catalog

The phrase states that the catalog holds an agent declaration; it is no state value.
`swe@1` is in the catalog when no enablement exists for it.

## agent enablement

The global record keyed by agent name that permits agent use.
The closed state set is:

- `enabled`
- `disabled`

The `swe@1` enablement holds agent providers `openai-org` and `atlas-llm`, and one default configuration.
An absent record denies use like `disabled`.

## agent provider

One named provider and credential pair inside an agent enablement.
Its fields are `name`, `provider` and `credential`; it holds no model list.
For example, `{ name: "openai-org", provider: "openai-compatible", credential: "openai-main" }` belongs to the `swe@1` enablement.
The closed provider set is every [LLM platform](llm.vocabulary.md#llm-platform), for example `anthropic`, `openai-compatible` and `groq`.
Each value maps to the same-named LLM platform.

## default configuration

The values that a human selects in an agent enablement: `agentProvider`, `modelIdentifier` and `reasoningEffort`.
For example, the `swe@1` default names `atlas-llm`, approved model `qwen3-coder` and effort `off`.
A catalog declaration supplies none of these values.

## effective configuration

The configuration that the Agent component resolves for one agent from its enablement and one optional entry.
It holds `agentProvider`, `provider`, `credential`, `modelIdentifier` and `reasoningEffort`.
Under `general-main`, a complete entry selects `atlas-llm`, which supplies provider `openai-compatible` and credential `atlas-key`.
The model is `qwen3-coder` and the effort is `off`.
The closed reasoning-effort set is:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

## agent session

One run of the agent loop of one agent for one consumer.
The term names no closed set.
Execution 1 opens one agent session of `swe@1` under worker binding `general-main`.

## resume

The reopen of an agent session from the turns that its runtime stored.
The term names no closed set.
Execution 1 finishes 40 turns of `swe@1`, and the host of the `worker` application restarts.
The resumed session of Execution 1 holds the 40 turns, and `swe@1` continues at turn 41.

## consumer

A service that opens an agent session under its own authority.
The term names no closed set.
The Worker Service is a consumer, and Execution 1 supplies the effective configuration of `swe@1` that `general-main` resolves.
