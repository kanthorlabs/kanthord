---
title: Workbench Service Implementation
---

# Workbench Service Implementation

This file holds the mechanisms that realize [workbench-service.md](workbench-service.md).
This file is not a design document, and `workbench-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## Workbench session

- The workbench directory of an agent is `workbench/<agent name>/` of the state directory.
- The list calls `SessionManager.list` of pi with that directory.
- Each item of the list answers `id`, `name`, `created`, `modified`, `messageCount` and `firstMessage`.
- A resume opens the session whose `id` the human picks.
- The credential view of a workbench session exposes only the credential of the agent provider that the configuration of the session names.

## Operations

Every operation has `human` access.

| Operation ID | Route | Lifetime | Answer |
| --- | --- | --- | --- |
| `workbench.session.list` | `GET /api/workbench/session` with `agentName` | `unary` | The session list of the agent. |
| `workbench.session.create` | `POST /api/workbench/session` with `{ agentName, agentProvider, modelIdentifier, reasoningEffort }` | `unary` | The new session. |
| `workbench.session.get` | `GET /api/workbench/session/:sessionId` | `unary` | The configuration, the entries of the completed turns and `turnRunning`. |
| `workbench.session.configure` | `PUT /api/workbench/session/:sessionId/configuration` | `unary` | The new configuration. |
| `workbench.session.message` | `POST /api/workbench/session/:sessionId/message` with `{ text }` | `unary` | 202. 409 `workbench.session.turn_running` while a turn runs. |
| `workbench.session.abort` | `POST /api/workbench/session/:sessionId/abort` | `unary` | The running turn stops. |
| `workbench.session.events` | `GET /api/workbench/session/:sessionId/events` with `after` | `wait` | Every held event later than `after`. It waits until such an event exists or its wait ends. |

- Each event of a session carries a sequence number. `after` names the last sequence number that the client holds.
