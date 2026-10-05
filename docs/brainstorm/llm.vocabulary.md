---
title: LLM Vocabulary
---

# LLM Vocabulary

This file holds the values and the examples of the terms that [llm.md](llm.md) owns.
This file is not a design document, and `llm.md` stays the single source of truth.

## llm component

The shared component that owns the LLM platforms, their credential records and the model connector.
For "Add password reset", the Worker execution asks the LLM component for the model runtime of agent provider `claude-main`, and the component builds it from the credential `anthropic-main`.

## llm platform

A [platform](architecture.vocabulary.md#platform) at which a model credential authenticates.
The set is closed and the [platform table](llm.impl.md#platform-validators) holds it:

- `openai-compatible`
- every `KnownProvider` of `@earendil-works/pi-ai` at 0.86.0, for example `openai`, `anthropic`, `github-copilot` and `groq`

Each provider of an agent provider maps to one LLM platform.
The pi adapter id `openai-compatible` names no platform.
The platform and the metadata of the credential identify the external system.

## llm provider

The capability of one LLM platform. Today it holds one method, the check.
The LLM provider of `openai-compatible` checks `compat-main` with `GET <baseUrl>/models` and answers `{ connection: "ok", models: [...] }`.
The LLM provider of `openai-codex` checks `codex-main` with one model call and answers `{ connection: "ok", models: null }`.
`groq` has no check, so it has no LLM provider.

The closed `connection` set is:

- `ok`
- `unauthorized`
- `unreachable`
- `invalid_response`

## login session

One human attempt to obtain an OAuth credential on the server.
Its closed state set is:

- `pending`
- `completed`
- `failed`
- `expired`

Its closed mode set is:

- `browser`
- `device`

A platform offers only the modes that it supports.
Ulrich starts `copilot-login` in device mode and enters code `ABCD-1234` at `https://github.com/login/device`.
The LLM component stores the credential through custody when the session completes.
