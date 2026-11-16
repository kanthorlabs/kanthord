---
title: Workbench Service Vocabulary
---

# Workbench Service Vocabulary

This file holds the values and the examples of the terms that [workbench-service.md](workbench-service.md) owns.
This file is not a design document, and `workbench-service.md` stays the single source of truth.

## workbench session

An agent session that a human drives with one agent of the catalog, through the chat of the dashboard or through the API.
The term names no closed set.
Ulrich picks `swe@1` on the Agents page and starts a workbench session in the chat.
In that session, `swe@1` pulls "Add password reset", a dependency of "Account recovery", and reads the plan of "Billing".

## conversation

The exchange of one human with the member agents that share one host Workbench session.
The term names no closed set.
Ulrich opens a conversation with Yumi, then asks `@SWE` a question. Yumi and SWE answer in the same transcript.

## host session

The workbench session that starts a [conversation](#conversation) and owns its run, its queue and its settings.
The term names no closed set.
Ulrich picks `swe@1` in New Session. That session is the host session, and every later member joins it.

## participant session

The workbench session of one more agent that joins a [conversation](#conversation) at its first [mention](#mention). A conversation holds one for each agent.
The term names no closed set.
Ulrich writes "@RE check this plan" in a conversation with `swe@1`. The server creates one participant session for `re@1`.

## mention

A leading `@<display name>` in a human message. It names the member that runs the message and matches case-insensitively.
The term names no closed set.
Ulrich writes "@yumi Report the system status". Yumi runs the message. A message with no leading mention goes to the member that answered last.

## run

The work of the agent on one human message of a workbench session.
The term names no closed set.
Ulrich writes "List the open dependencies of Account recovery". The run of `swe@1` on that message holds 3 turns of pi and ends with the list.

## queued message

A human message that waits behind the active run of a workbench session. A session holds at most 10.
The term names no closed set.
Ulrich sends a second message while `swe@1` runs. The message waits as a queued message and runs after the active run.

## replace

The delivery of a message that clears the queue, stops the active run, and runs the new message next.
The term names no closed set.
Ulrich sends "Stop & send draft" with two queued messages. The two texts return to his composer, the run stops, and the draft runs next.

## fork

A new conversation that the owner starts from an existing conversation with "/new <text>". It starts with a checked [fork summary](#fork-summary) of the source, and `<text>` is its first human message.
The term names no closed set.
Ulrich writes "/new Continue with the billing nodes" in a conversation with `swe@1`. The server creates a fork with the summary of that conversation, and `swe@1` runs the text.

## fork summary

The one text that a [fork](#fork) carries from its source. One model call writes it under fixed headings, and `guard@1` checks it for orders and secrets before the fork exists.
The term names no closed set.
The summary of Ulrich's conversation states "Open in the earlier conversation: node_9 is still blocked; no decision was made." `guard@1` passes it. A summary that says "Discard node_9 now" is refused, and no fork exists.

## approval wait

The maximum time that a pending tool call approval waits for a human decision. The setting is `workbench.approval_wait_ms`, one hour by default.
The term names no closed set.
Ulrich leaves an approval of `swe@1` open for one hour. The call returns blocked as expired, and the run ends.

## Home chat

The standing Yumi conversation on the Home screen. Home opens the latest `ops@1` conversation that is no case conversation.
The term names no closed set.
Ulrich opens Home and sees his latest `ops@1` conversation, with the deck of waiting acts under it.

## case conversation

An `ops@1` conversation that "Ask Yumi" creates for one card of Home. Its first message is a case request.
The term names no closed set.
Ulrich clicks "Ask Yumi" on a blocked node. Home creates one `ops@1` conversation for that card, and the Home chat skips it.

## case request

The first message of a case conversation. It starts with "Case: " and names one card by its ids, then asks one question of its kind.
The term names no closed set.
The plain text of one case request:
Case: node `node_01J` (Blocked). Explain why it is blocked and recommend how to unblock it.

## slash command

A command that a human types in the composer of the chat. It starts with "/".
The closed set is `/brief`, `/health` and `/new`.
Ulrich types "/health" in the Home chat. The chat sends "Check the health of the gateway and the providers."

## action card

One card in the chat that offers exactly one owner act on one target.
The closed set of acts is the eleven ids of `ACTION_CARD_OPERATIONS`.
Yumi finds a blocked node and offers `mission.node.unblock` on it. Ulrich clicks the card, and the act runs as his own act.

## setup card

An [action card](#action-card) for a credential rotation, a binding edit or an agent enablement edit. It opens the existing dashboard dialog with the target id only.
The closed set of acts is `llm.credential.rotate`, `project.bindingSet.write` and `agent.enablement.put`.
Yumi finds a refused credential and offers `llm.credential.rotate` on it. Ulrich clicks the card and types the new secret in the rotate sheet.

## action offer

The `action_offer` [Workbench record](#workbench-record) that the tool `offer_action` appends. It holds the act, the target and what the server read on the target.
The term names no closed set.
Yumi calls `offer_action` for `mission.node.pause` on `node_01J`. The server reads the node and appends the action offer with its name, its state and its attempt.

## action result

The `kanthord.workbench.action_result` custom message that `workbench.session.action.report` appends. It holds the outcome of the act that the owner ran from an action card.
The closed set of outcomes is `done` and `failed`.
Ulrich clicks the card of `mission.node.unblock` and the act fails. The dashboard reports `failed`, and the next run of Yumi reads "The owner ran mission.node.unblock on node_01J. Result: failed, mission.node.state_conflict."

## evidence read

One `evidence_read` call that gives the text of one evidence asset to an agent.
The term names no closed set.
Ulrich asks `swe@1` why a node failed. `swe@1` calls `evidence_read` on the log of the attempt and gets the first 65536 bytes as text.

## evidence grant

The owner approval that lets one conversation read every evidence asset of one node until kanthord restarts.
The term names no closed set.
Ulrich approves the evidence card of "Add password reset". `swe@1` then reads every asset of that node with no new card, until kanthord restarts.
While [auto mode](#auto-mode) is on, a run that the owner started with a message that holds a node id gets the same access for that run with no card. That access is the message grant. It never becomes an evidence grant.

## guard

The decision of the Workbench Service on each operation tool call of an agent, before the call runs. It is the [guard floor](#guard-floor), the [reversible operation](#reversible-operation) set and the classifier `guard@1`.
The term names no closed set.
Yumi calls the tool of `mission.node.pause` on "Add password reset". The guard decides that the call waits on the card, and Ulrich decides the card.

## guard floor

The deterministic part of the [guard](#guard). It runs reads and blocks [human-only](#human-only-operation) calls. It holds a plan import with no retirement and format json for the card. It leaves every other mutation to the later rules of the guard. It never calls a model.
The closed set of answers is `run`, `block`, `confirm` and no answer.
Yumi reads the plan of "Billing", and the guard floor answers `run`. Yumi then calls `mission.import.apply` with `format: markdown`, and the guard floor answers `block`. Yumi calls it again with `format: json`, the guard floor answers `confirm` for a json import, and Ulrich decides the card.

## human-only operation

An operation that only a human runs, through the dashboard or the CLI. The set is fixed in code.
The closed set is the ids of `HUMAN_ONLY_OPERATIONS`.
Yumi asks to discard a node. No tool exists for it, and Ulrich discards the node in the node dialog.

## Workbench record

A server fact in a session file that no model reads.
The closed set of kinds is `action_offer`, `auto_mode` and `guard`.
The server appends an action offer to the session file when `offer_action` shows a card. The model never sees that entry.

## auto mode

The setting of a workbench session that lets the guard run a [reversible operation](#reversible-operation) with no card and a [classified operation](#classified-operation) when the [run message](#run-message) directs it. It is on for a new session. The [auto mode switch](#auto-mode-switch) changes it.
The closed set of values is `on` and `off`.
Ulrich asks Yumi to resume "Add password reset" with auto mode on, and the resume runs with no card. Ulrich turns auto mode off, and the next mutation of Yumi waits on a card.

## reversible operation

A mutation that the owner undoes with one act, so the guard runs it with no card while [auto mode](#auto-mode) is on. The set is fixed in code.
The closed set is the nine ids of `REVERSIBLE_OPERATIONS`.
Yumi pauses "Add password reset" with `mission.node.pause`. The call runs with no card, and Ulrich resumes the node if he disagrees.

## classified operation

An R2 mutation that the classifier `guard@1` decides. No floor rule decides it and it is no [reversible operation](#reversible-operation).
The term names no closed set.
Ulrich writes "Unblock Add password reset". Yumi calls `mission.node.unblock`, a classified operation. `guard@1` finds that the run message directs it, so the call runs with no card.

## guard verdict

The answer of `guard@1` on one classified operation call. It holds a tier, a confidence, a quote of the [run message](#run-message) and a reason.
The closed set of tiers is `auto` and `confirm`.
`guard@1` answers `auto` with confidence 0.97 and the quote "Unblock Add password reset". The guard runs the call. For the message "Is Add password reset stuck?", `guard@1` answers `confirm`, and the call waits on the card.

## run message

The human message that started the active [run](#run). It is the only text that authorizes a call.
The term names no closed set.
Ulrich writes "Unblock Add password reset". That message is the run message. A value that Yumi writes into a call never authorizes it.

## auto mode switch

The control in the chat header that sets [auto mode](#auto-mode) of the session. Only the owner changes it. The setting stays across a restart.
The closed set of values is `on` and `off`.
Ulrich turns the switch off before he asks Yumi to review a plan. Each mutation of the run that the guard does not block waits on a card.
