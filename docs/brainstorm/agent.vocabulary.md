---
title: Agent Vocabulary
---

# Agent Vocabulary

This file holds the values and the examples of the terms that [agent.md](agent.md) owns.
This file is not a design document, and `agent.md` stays the single source of truth.

## agent component

The shared component that holds the runtime of a native agent and the agent session.
For "Add password reset", Execution 1 opens an agent session of `swe@1` through the Agent component.

## agent session

One run of the agent loop of one agent for one consumer.
The term names no closed set.
Execution 1 opens one agent session of `swe@1` under worker binding `general-main`.

## consumer

A service that opens an agent session under its own authority.
The term names no closed set.
The Worker Service is a consumer, and Execution 1 supplies the effective configuration of `swe@1` that `general-main` resolves.
