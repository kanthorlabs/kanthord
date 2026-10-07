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
- The chat shows the input of a tool call and a tool result that is a JSON object or array as indented, colored JSON. Other text stays as it is.
- The chat shows the resource names of a `gateway--healthcheck` result with each segment decoded. Two names that decode to one label stay encoded.
- The chat header copies the pi command that continues the session outside kanthord. That pi uses its own login, its own prompt and its own tools, and a write from both sides forks the session.
- While a run is active and no text streams, the chat shows that the agent works, with the seconds since the run started. The draft stays editable, and Stop takes the place of Send until the run ends.
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
- The session list of the Workbench lists the sessions of every agent.
- The dashboard lists the workbench sessions under Workforce › Workbench, with a filter by agent.
- New Session opens a dialog with a blank Agent field that offers the enabled agents. The quick action of the agent list opens it with its agent.
- The dialog names the agent providers of the enablement and links to the agent page, where a human adds one.
- A [workbench session implementation](workbench-service.impl.md#workbench-session) declares the workbench directory and the list.

## Prompt

- The prompt of a workbench session composes the [system layer](agent.md#prompt-composer), the agent prompt of its agent, and its working layer.
- The composition places the system layer first, then the agent prompt, then the working layer.
- The working layer joins `AGENTS.md`, `AGENTS.local.md`, `CLAUDE.md` and `CLAUDE.local.md` of the workbench directory, then the shipped workbench prompt, then the custom workbench prompt.
- A workbench session takes no work prompt. Each human message is a message of the session.
- The Workbench Service owns the workbench prompt. It states that a human reads every reply.
- The workbench prompt adds the conduct for a human interlocutor, and it revokes no obligation of the system layer or the agent prompt.
- The agent prompt holds the highest precedence, then the system layer, then the working layer.

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
