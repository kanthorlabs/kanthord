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

One named provider and credential pair inside an agent enablement. The credential is a credential name, and each consumer resolves the copy of its own holder.
Its fields are `name`, `provider` and `credential`; it holds no model list.
For example, `{ name: "openai-org", provider: "openai-compatible", credential: "openai-main" }` belongs to the `swe@1` enablement.
The closed provider set is every [LLM platform](llm.vocabulary.md#llm-platform), for example `anthropic`, `openai-compatible` and `groq`.
Each value maps to the same-named LLM platform.

## default configuration

The values that a human selects in an agent enablement: `agent_provider`, `model_identifier` and `reasoning_effort`.
For example, the `swe@1` default names `atlas-llm`, approved model `qwen3-coder` and effort `off`.
A catalog declaration supplies none of these values.

## effective configuration

The configuration that the Agent component resolves for one agent from its enablement and one optional entry.
It holds `agent_provider`, `provider`, `credential`, `model_identifier` and `reasoning_effort`.
Under `coder-main`, a complete entry selects `atlas-llm`, which supplies provider `openai-compatible` and credential `atlas-key`.
The model is `qwen3-coder` and the effort is `off`.
The closed reasoning-effort set is:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

## fallback configuration

One complete configuration in a tail of a fallback chain: `agent_provider`, `model_identifier` and `reasoning_effort`.
The term names no closed set.
The `swe@1` enablement holds `fallback_configurations` with `{ agent_provider: "atlas-llm", model_identifier: "qwen3-coder", reasoning_effort: "off" }`.
The `coder-solo` entry for `swe@1` holds `fallback_configurations: []`, so the chain of `coder-solo` has no tail.

## fallback chain

The ordered list of chain entries that the Agent component builds for one agent: the effective configuration as the head, then the tail.
Each chain entry holds a `level`. The closed level set is:

- `enablement`
- `binding`

The `swe@1` default names `openai-org` and model `gpt-6`, and its enablement tail holds `atlas-llm` with `qwen3-coder`.
Under `coder-main`, which names no tail, the chain is `gpt-6` at position 0 and `qwen3-coder` at position 1, both at level `enablement`.

## cooldown

The hold that excludes every model of one credential copy, a credential name and one holder, from a selection until its end time `available_at`.
It counts `strikes`. The code of the failure is one of the closed set `rate_limited`, `quota_exhausted` or `unavailable`, and it sets the base duration.
Execution 1 releases with `provider_failed` and code `rate_limited` on credential `openai-main` and model `gpt-6`.
The cooldown of `openai-main` lasts 60 seconds, and the next claim of `swe@1` and `re@1` selects position 1 of the chain.
The copy of `anthropic` for `box-coder` cools down, and a claim of `box-reviewer` still selects its own copy of `anthropic`.

## agent selection

The chain entry that a claim selects for one native agent.
It holds `agent_name`, `position`, `level`, `agent_provider`, `provider`, `credential`, `model_identifier` and `reasoning_effort`.
The execution record stores only the pin of it: `agent_name`, `enablement_id` and `position`. The component rebuilds the selection from the pin.
The term names no closed set.
The claim of Execution 2 selects position 1 of `swe@1`, because the credential of position 0 cools down. The execution keeps that selection.

## agent session

One run of the agent loop of one agent for one consumer.
The term names no closed set.
Execution 1 opens one agent session of `swe@1` under worker binding `coder-main`.

## Agent prompt

The files that a human controls for every repository: `base.md` (the Standard of every agent), `<agent_name>.md` (the Role of one agent) and `workbench.md` (the Workbench behavior).
A file of the same name in the agent directory replaces the shipped text of that file whole.
The term names no closed set.
Ulrich puts `swe@1.md` into the agent directory, so `swe@1` reads that file in place of the shipped `swe@1.md`, and still reads the shipped `base.md`.

## Binding prompt

The text of `prompts[<agent_name>]` in the configuration of a repository binding.
It joins the system prompt of that agent as `Instructions of repository <name>:` and the text.
The term names no closed set. The keys are the agent names of the catalog.
The binding `app` holds `prompts` with `swe@1` set to "Write comments in English.", so Execution 1 reads that text under the Agent prompt of `swe@1`.

## prompt part

One text of the system prompt that `agent.get` answers.
The closed set is:

- `standard`
- `role`
- `workbench`
- `binding`

`base.md` is the `standard` part of Execution 1, `swe@1.md` is its `role` part, and the text of `app` is its `binding` part.

## prompt origin

The place that holds the text of a prompt part.
The closed set is:

- `binary`
- `file`
- `database`

The shipped `base.md` has origin `binary`, an override `swe@1.md` in the agent directory has origin `file`, and the Binding prompt of `app` has origin `database`.

## resume

The reopen of an agent session from the turns that its runtime stored.
The term names no closed set.
Execution 1 finishes 40 turns of `swe@1`, and the host of the `worker` application restarts.
The resumed session of Execution 1 holds the 40 turns, and `swe@1` continues at turn 41.

## consumer

A service that opens an agent session under its own authority.
The term names no closed set.
The Worker Service is a consumer, and Execution 1 supplies the effective configuration of `swe@1` that `coder-main` resolves.
