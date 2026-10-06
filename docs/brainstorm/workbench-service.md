---
title: Workbench Service
---

# Workbench Service

## Scope

This document describes the Workbench Service.
It describes the workbench session, the agent session that a human drives.
It describes no mechanism of another service.

## Boundary

- Every action of the Workbench Service comes from a human.
- The Workbench Service is a consumer of the [Agent component](agent.md).
- The Workbench Service owns no worker, no registration and no claim.

## Workbench session

- The chat of the dashboard is the interface of a workbench session. It is no separate entity.
- The Workbench Service owns the [workbench session](workbench-service.vocabulary.md#workbench-session).
- A human drives a workbench session through the chat of the dashboard or through the API.
- The chat renders the text of an assistant message as Markdown.
- Every action of a workbench session comes from its human.
- A human picks one agent of the catalog and starts a workbench session with that agent.
- A workbench session belongs to one agent and to no project.
- One workbench session can act on several projects.
- A workbench session holds its own configuration: `agentProvider`, `modelIdentifier` and `reasoningEffort`.
- At the start of a workbench session, the dashboard shows the default configuration of the agent. The human confirms it or changes it.
- The human changes the configuration of a workbench session at any time.
- The Agent component validates every configuration of a workbench session as a complete [entry](worker-service.vocabulary.md#entry).
- The working directory of a workbench session is the workbench directory of its agent.
- The session list of an agent lists the sessions that the runtime stores for that workbench directory.
- A [workbench session implementation](workbench-service.impl.md#workbench-session) declares the workbench directory and the list.

## Prompt

- The prompt of a workbench session composes the global prompt, the base prompt and the agent prompt of its agent, and the workbench prompt.
- The composition places the global prompt first, then the base prompt, then the agent prompt, then the workbench prompt.
- A workbench session takes no project prompt and no work prompt. Each human message is a message of the session.
- The Workbench Service owns the workbench prompt. It states that a human reads every reply.
- The workbench prompt adds the conduct for a human interlocutor, and it revokes no obligation of the base prompt or the agent prompt.
- The agent prompt holds the highest precedence, then the base prompt, then the workbench prompt, then the global prompt.

## Tools

- A workbench session holds the built-in tools that the declaration of its agent enables.
- It also holds one tool for each `human` operation of the server. The tool invokes the operation under the human identity of the run.
- The owning service authorizes each call.
- A workbench session holds no tool of an operation that carries secret material.
- A tool of a mutation operation runs only after the human approves that call.
- A tool of a read operation and a built-in tool run without an approval.
- A rejected call reaches the agent as a blocked call.

## Operations

- A human sends each message through its own request.
- A [run](workbench-service.vocabulary.md#run) is the work of the agent on one human message.
- A client reads the entries and the state of the active run of a session through a long poll. A workbench session uses no `stream` operation.
- A session holds one run at a time.
- The end of a long poll stops no run.
- A client that misses events reads the completed runs of the session.
