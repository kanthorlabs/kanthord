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
