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

## Workbench record

A server fact in a session file that no model reads.
The closed set of kinds is `action_offer`.
The server appends an action offer to the session file when `offer_action` shows a card. The model never sees that entry.
