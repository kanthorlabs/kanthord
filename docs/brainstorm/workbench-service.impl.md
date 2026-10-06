---
title: Workbench Service Implementation
---

# Workbench Service Implementation

This file holds the mechanisms that realize [workbench-service.md](workbench-service.md).
This file is not a design document, and `workbench-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.

## Workbench session

- The identity of a workbench session is `workbench_session_<ulid>`. The service passes it to pi as the session `id`.
- The workbench directory of an agent is `workbench/<agent name>/` of the state directory.
- The list calls `SessionManager.list` of pi with that directory.
- Each item of the list answers `id`, `name`, `created`, `modified`, `messageCount` and `firstMessage`.
- A resume opens the session whose `id` the human picks.
- The `model_change` and `thinking_level_change` entries of pi carry `modelIdentifier` and `reasoningEffort`. pi writes them at each change of the model or of the thinking level.
- A `custom` entry of pi with `customType` `kanthord.workbench.configuration` carries `{ agentProvider }`. The service appends it at the session create and at each change of `agentProvider`.
- A resume takes the last entry of each kind, and the Agent component validates the three values as a complete entry.
- The credential view of a workbench session exposes only the credential of the agent provider that the configuration of the session names.

## Prompt

- The workbench prompt is [assets/prompt/workbench.md](assets/prompt/workbench.md).
- pi receives the base prompt, the agent prompt and the workbench prompt as its system prompt, and the global prompt as marked content, as for a worker.
- The source of the workbench prompt is the "Work with Ulrich" rules of `AGENTS.md`, adapted to any human.

## Tools

- The tool name is the operation ID, and the tool parameters are the input schema of the operation.
- The tool calls the direct adapter of the operation registry.
- A mutation takes a new idempotency key for each tool call.
- A refusal reaches the agent as a tool error that holds the code of the owning service.
- The `beforeToolCall` hook of pi waits for the approval of a mutation tool.
- The snapshot of a long poll adds `pendingApproval`: `{ toolCallId, operationId, input }`.
- A rejected call returns `{ block: true, reason: "The human rejected the call." }` to pi.
- An abort of the run rejects every pending approval.

## Operations

Every operation has `human` access.

| Operation ID | Route | Lifetime | Answer |
| --- | --- | --- | --- |
| `workbench.session.list` | `GET /api/workbench/session` with `agentName` | `unary` | The session list of the agent. |
| `workbench.session.create` | `POST /api/workbench/session` with `{ agentName, agentProvider, modelIdentifier, reasoningEffort }` | `unary` | The new session. |
| `workbench.session.get` | `GET /api/workbench/session/:sessionId` | `unary` | The configuration, the entries of the completed runs and `runActive`. |
| `workbench.session.configure` | `PUT /api/workbench/session/:sessionId/configuration` | `unary` | The new configuration. |
| `workbench.session.message` | `POST /api/workbench/session/:sessionId/message` with `{ text }` | `unary` | 202. 409 `workbench.session.run_active` while a run is active. |
| `workbench.session.approve` | `POST /api/workbench/session/:sessionId/approve` with `{ toolCallId, approved }` | `unary` | The pending call runs or returns blocked. |
| `workbench.session.abort` | `POST /api/workbench/session/:sessionId/abort` | `unary` | The active run stops. |
| `workbench.session.events` | `GET /api/workbench/session/:sessionId/events` with `after` | `wait` | The entries after `after` and the snapshot of the active run. |

- `after` names the id of the last session entry that the client holds.
- A poll answers the session entries after `after`, and a snapshot of the active run: `streamingMessage`, `pendingToolCalls`, `pendingApproval`, `runActive` and `errorMessage`.
- A poll answers when the entries or the snapshot change, or when its wait window ends.
- The route timeout of `workbench.session.events` is 30 s, and its wait window is 25 s.
- The Workbench Service holds no event of a run.
- A run starts at the `agent_start` event of pi and ends at its `agent_end` event. One run holds one or more turns of pi.
