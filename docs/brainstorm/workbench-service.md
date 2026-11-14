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
- Every bubble of the chat shows its author and its time. An agent bubble shows an avatar whose colour derives from the agent name.
- A Workbench path of two or more segments in agent text opens in a new tab. A slash command never becomes a link.
- An error shows as one line directly under its cause, code first. The full text wraps and no hover is needed. The failed bubble or card gets a red border.
- The chat header copies the pi command that continues the session outside kanthord. That pi uses its own login, its own prompt and its own tools, and a write from both sides forks the session.
- While a run is active and no text streams, the chat shows that the agent works, with the seconds since the run started.
- Every screen holds one composer: the input and Send on one row, an optional menu or confirm above, and one muted hint line below.
- Send is always one plain button. During a run, Enter and Send queue the message.
- Only the placeholder and the hint change with the state of the composer: idle, running or disabled.
- The idle placeholder is "Message <display name> · / for commands". The running placeholder is "Message · sends after this run".
- The hint line shows only context hints. A slash hint is an example.
- The queue shows above the composer as one line with the count and the next item, "N queued" and "Next: <text>". A click expands it to the full list.
- Each queued row has Edit and Remove. Edit removes the message, then refills the composer with its text.
- The open state of the queue changes only on the click of the owner.
- A run line sits on the running item, next to the request that started the run. It holds the state "Running" and Stop only.
- A finished act shows no run controls.
- Stop with an empty queue ends the run with no confirm.
- Stop with queued messages opens a red confirm above the composer. Its title is "Stop the run and clear N queued?".
- The confirm says "Your N queued messages return to the composer." For one message, it says "Your 1 queued message returns to the composer."
- When the composer holds a draft, the confirm adds "Your draft sends next."
- The confirm offers Stop, or "Stop & send draft" when the composer holds a draft, and Cancel.
- "Stop & send draft" replaces the run. Cancel keeps the run, the queue and the draft.
- A draft that is the "/new" command counts as no draft in the confirm.
- When Edit or Remove finds that the message already started, the chat shows "The message already started."
- While a run is active, the pickers of the agent provider, the model and the reasoning effort stay disabled. They stay disabled while a message waits in the queue.
- The cleared texts return to the composer before the draft, joined with one newline. The chat shows no line about them in the transcript.
- The hint line shows "N cleared messages are back in your draft" after Stop or replace clears the queue. One message reads "1 cleared message is back in your draft".
- A call with no result shows "No Result" with the line "No result. The run ended before this call finished."
- Every action of a workbench session comes from its human.
- A human picks one agent of the catalog and starts a workbench session with that agent.
- No conversation exists without a human message.
- A workbench session belongs to one agent and to no project.
- One workbench session can act on several projects.
- A workbench session holds its own configuration: `agent_provider`, `model_identifier` and `reasoning_effort`.
- At the start of a workbench session, the dashboard shows the default configuration of the agent. The human confirms it or changes it.
- The human changes the configuration of a workbench session at any time.
- The Agent component validates every configuration of a workbench session as a complete [entry](worker-service.vocabulary.md#entry).
- The working directory of a workbench session is the workbench directory of its agent.
- The session list of an agent lists the sessions that the runtime stores for that workbench directory.
- The session list of the Workbench lists the sessions of every agent.
- The dashboard lists the workbench sessions under Workforce › Workbench, with a filter by agent.
- New Session lists only the enabled agents whose `agent list` item holds `workbench` in `consumers`. `workbench.session.create` still refuses any other agent.
- New Session opens the route `/workbench/new` with no API call. The route shows a greeting from the display name of the agent. The quick action of the agent list opens it with its agent.
- The first Send calls `workbench.session.create`, then `workbench.session.message`. A closed tab with no message writes nothing.
- The `/workbench/new` route names the agent providers of the enablement and links to the agent page, where a human adds one.
- A [workbench session implementation](workbench-service.impl.md#workbench-session) declares the workbench directory and the list.

## Home

[The Home page](architecture.impl.md#the-home-page) owns every other Home rule. This section holds the Yumi chat, "Ask Yumi" and the slash commands.

- Home opens the latest `ops@1` conversation by `modified` whose first message does not start with "Case: ". It skips an item with an empty first message.
- "New chat" makes no API call. The first Send creates the conversation, then sends the message.
- The pending approval of the open Home conversation shows as the [queue line](architecture.impl.md#the-home-page), and its acts sit on the deck card.
- With Yumi off, Home shows "Yumi is not enabled. Enable Yumi to chat here." with a link to the agent page of `ops@1`. The composer is disabled with no command list.
- The command list floats above the composer on focus of an empty draft or on "/".
- The command "/brief" sends "Report the system status and the actions that need me."
- The command "/health" sends "Check the health of the gateway and the providers." "/health" is the only command that leads to `gateway--healthcheck`.
- The owner bubble of a command text shows the command name, with the text on the next line.
- "/brief" and "/health" show only in an `ops@1` conversation. "/new" shows in every conversation.
- A command and its natural-language form give the same answer.
- "/new" alone opens a new chat and sends nothing. In a Workbench chat, it opens `/workbench/new` with the agent and the configuration of the current conversation. In the Home chat, it acts as "New chat".
- Until the fork ships, "/new <text>" shows the hint "/new takes no text yet" and sends nothing.
- A click on "Ask Yumi" opens a named tab at once, before any `await`. Home creates one `ops@1` conversation, sends the case request of the card at once, and points the tab at it.
- The Home chat gets no case message.
- One tab and one conversation exist for each card in one page load. A later click shows the same tab and sends nothing. A reload of Home forgets the cases.
- When the case request fails after the create, Home shows the toast "The case request was not sent." with Retry. Retry, or a later click, sends the same request to the same conversation.
- No delete operation exists. No URL starts a conversation or a model run.
- A tool approval card and an Inbox card have no "Ask Yumi".
- The node case text reads "Case: node `<id>` (<state>). <ask of the kind>". It holds no node name. The ask of each node kind follows.

| Kind                   | Ask                                                                |
| ---------------------- | ------------------------------------------------------------------ |
| `blocked`              | Explain why it is blocked and recommend how to unblock it.         |
| `paused`               | Explain why it is paused and recommend whether to resume it.       |
| `dependency_discarded` | A dependency of it was discarded. Recommend how to continue.       |
| `finding_review`       | Explain each open finding and recommend a decision.                |
| `followup_proposal`    | Explain each follow-up proposal and recommend approve or reject.   |
| `merge_wait`           | It waits for a human merge. Report what the merge needs.           |
| `delivery_unconfirmed` | Its delivery is not confirmed. Report what the confirmation needs. |

- The Fix case text reads "Case: fix <kind> <subject>. <ask of the kind>". It holds only the ids that the item shows. The subject and the ask of each Fix kind follow.

| Kind                  | Subject                                                                | Ask                                                                  |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `project_paused`      | project `<project id>`                                                 | Explain why it is paused and recommend whether to resume it.         |
| `environment_failed`  | binding `<binding>` of project `<project id>`                          | Explain why the environment failed and recommend the fix.            |
| `environment_pending` | binding `<binding>` of project `<project id>`                          | Explain what the environment waits for.                              |
| `no_taker`            | jobs in state <state> (<job count>) of project `<project id>`          | Explain why no worker takes them and recommend the setup change.     |
| `agent_invalid`       | agent `<agent>` in binding `<first binding>` of project `<project id>` | Explain the invalid configuration and recommend the fix.             |
| `credential_refused`  | credential `<credential>`                                              | Explain why the provider refuses it and recommend the fix.           |
| `request_rejected`    | agent `<agent>`                                                        | Explain why the provider rejects its requests and recommend the fix. |

## Prompt

- The system prompt of a workbench session composes the [KanthorD prompt](agent.md#prompt-composer) of its agent: `base.md`, the Role of the agent and `workbench.md`. The framing of the Workbench closes it.
- A workbench session reads no Repository prompt, no Binding prompt, no instruction file of the workbench directory and no file of a home directory.
- A workbench session takes no work prompt. Each human message is a message of the session.
- The Workbench Service owns `workbench.md`. It states that a human reads every reply.
- `workbench.md` adds the conduct for a human interlocutor, and it revokes no obligation of `base.md` or of the Role.
- The precedence from the highest is the framing, `workbench.md`, the Role and the Standard. A later message governs an earlier one.
- An invalid file of the agent directory refuses the session open with 409 `agent.prompt.template_invalid`. The open uses no shipped text in its place.

## Tools

- A workbench session holds the built-in tools that the declaration of its agent enables.
- It also holds one tool for each operation that the declaration of its agent lists. A listed operation has `human` access, is no stream and carries no secret material. The tool invokes the operation under the human identity of the run.
- The owning service authorizes each call.
- A workbench session holds no tool of an operation that carries secret material or answers a presigned URL.
- `swe@1` and `re@1` read evidence metadata only until A1.
- A tool of a mutation operation runs only after the human approves that call.
- A tool of a read operation and a built-in tool run without an approval.
- A rejected call reaches the agent as a blocked call.
- A pending approval waits at most the [approval wait](workbench-service.vocabulary.md#approval-wait). Then the call returns blocked as expired, and the run ends.
- A kanthord restart ends the active run and every pending approval.
- An agent that cannot do an act offers one [action card](workbench-service.vocabulary.md#action-card) through the tool `offer_action`. The owner clicks the card, and the act runs as the owner's own act through the dashboard route.
- The tool `offer_action` runs no act. It is no operation, so the approval of a tool call does not apply to it.
- The allow-list of `offer_action` holds eight acts: `mission.node.resume`, `mission.node.unblock`, `mission.node.check`, `mission.node.discard`, `mission.node.override` and `mission.node.pause` with a node as target, and `project.pause` and `project.resume` with a project as target.
- Discard, override, node pause and project pause confirm in their dashboard dialogs. Resume and unblock open their dashboard dialogs.
- Check (`mission.node.check`) and `project.resume` run at once with no dialog.
- A click on the card reads the target again. A changed target runs no act.
- One card per answer. A second offer in one run is refused, and the first card stays.
- An agent offers a card for an act that it holds as a tool when the human did not direct that act. It calls its own tool only when the run message directs the act.
- The agent never sends the human to another agent, another page or the dashboard.

## Operations

- A human sends each message through its own request.
- A [run](workbench-service.vocabulary.md#run) is the work of the agent on one human message.
- A client reads the entries and the state of the active run of a session through a long poll. A workbench session uses no `stream` operation.
- A session holds one run at a time. A message during a run waits in the queue.
- A [replace](workbench-service.vocabulary.md#replace) clears the queue, stops the run and runs the new message next.
- Stop ends the run and clears the queue.
- The owner removes a queued message.
- A restart clears the queue.
- The end of a long poll stops no run.
- A client that misses events reads the completed runs of the session.
