---
title: Workbench Service
---

# Workbench Service

## Scope

This document describes the Workbench Service.
It describes the workbench session, the agent session that a human drives.
It describes no mechanism of another service.

## Boundary

- Every action comes from a human: the owner through a human identity, or a guest through a guest identity.
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
- The [host session](workbench-service.vocabulary.md#host-session) owns a [conversation](workbench-service.vocabulary.md#conversation). The agent picked in New Session is the host. On Home, the host is `ops@1`.
- A new conversation opens with a host greeting from `greeting.md`, with the display name and the model. The server writes it with no model call.
- An untagged first message runs the host. A leading mention in the first message runs the mentioned member (H4).
- One session exists per member: the host session, and one [participant session](workbench-service.vocabulary.md#participant-session) for each other agent. Another agent joins at its first [mention](workbench-service.vocabulary.md#mention).
- Only a leading `@<display name>` routes, case-insensitively. Outside a [shared conversation](workbench-service.vocabulary.md#shared-conversation) (C6), an untagged message goes to the member that answered last (D8). The greeting counts as the answer of the host.
- One run exists per conversation (D14). The queue item stores its mention target, and an untagged item resolves at its start (Q2).
- A queued row shows "to @<display name>", or "to last answer" for an untagged item.
- `get`, `events`, `message`, `abort`, `queue.remove` and `autoMode.set` on a participant session id answer 409 `workbench.session.not_host`.
- "/new <text>" [forks](workbench-service.vocabulary.md#fork) the conversation. One model call on the model and the credential of the source host configuration summarizes the source, with `<text>` as the instruction.
- `guard@1` checks the [fork summary](workbench-service.vocabulary.md#fork-summary) and answers `pass` or `refuse`. There is no owner override. A refused summary creates no conversation, and the composer keeps the text.
- The fork starts with the checked summary. `<text>` is its first human message. No conversation exists before both calls pass.
- The fork host is the agent of the source host with its current configuration. Mention an agent to continue with it.
- The fork carries one text, the summary. No transcript, tool result, approval, queue, card, record or evidence grant carries over. The source does not change.
- Every fork starts with auto mode on, whatever the value of the source.
- Only the owner forks. The operation is human only, and no tool list holds it.
- A [workbench session implementation](workbench-service.impl.md#workbench-session) declares the workbench directory and the list.

## Plan pipeline

- A run of `plan@1` ("Jeremy") is a [plan](workbench-service.vocabulary.md#plan) pipeline. It runs a [planner phase](workbench-service.vocabulary.md#planner-phase), then a [reviewer phase](workbench-service.vocabulary.md#reviewer-phase).
- Each phase is a fresh session with read tools only. The reviewer holds no history of the planner. It receives the request and the draft as text.
- Jeremy never executes a step. Yumi applies a step when the owner asks.
- The final text of the reviewer phase is the plan. It follows the [plan contract](agent.vocabulary.md#plan-contract).
- The server enforces only the Review rule. It sets the [unresolved mark](agent.vocabulary.md#unresolved-mark) of the plan. No further round runs, so an open finding stays in the plan.
- The conversation reads the plan as the final answer of Jeremy. An untagged message after a plan goes to Jeremy (D8).
- Q3, the stop of a pipeline: Stop and replace stop the active phase. No later phase starts, and no plan shows.
- A phase that fails ends the run with its error line. No later phase runs, and no plan shows.
- While the run is active, the run line shows "Jeremy is planning" and the active phase, "Planner" or "Reviewer".
- Each phase session shows one collapsed group, "Planner" or "Reviewer", before the plan. A click opens the entries of the phase.
- A phase group does not show the opening message of its phase session, the rendered template.
- An entry with no `phase` field shows no phase group, so the guest view shows only the plan.
- The plan shows as one item of Jeremy. The plan text sits in a bordered panel.
- A plan with an unresolved mark shows one warning line under its text. A number N gives "Review unresolved: N open action:YES findings". The mark `missing` gives "Review unresolved: no Review section".
- A plan with no unresolved mark shows no warning line.
- A [workbench session implementation](workbench-service.impl.md#plan-pipeline) declares the phase mechanics.

## Shared conversation

- The owner shares a conversation with an [invite](workbench-service.vocabulary.md#invite). One invite names one [guest](workbench-service.vocabulary.md#guest). A guest joins with a link and a name, and holds no account.
- A [shared conversation](workbench-service.vocabulary.md#shared-conversation) holds at least one live invite. An invite lasts 7 days.
- Only the owner creates, lists and revokes an invite. A revoke ends the access of its guest at once. No agent holds a tool for an invite.
- A guest reads the guest view, writes notes and starts a run with a leading mention. A guest holds no owner act.
- A [note](workbench-service.vocabulary.md#note) is a message that starts no run. It shows its author, the owner or a guest by name. The members of the conversation read it with that author.
- A message of a guest with no leading mention is a note. The text of a guest never authorizes an act.
- A guest starts a run with a leading mention. The guest message queues behind an active run.
- A guest mentions only an agent whose `tools.builtin` is empty. Yumi and Jeremy qualify. SWE and RE do not.
- The invite names the projects that a guest-started run reads and acts on. All live invites of one conversation share one set.
- A guest-started run runs under a read-only identity. A call outside the project set fails. The guard blocks it before any card, with one message for an absent and a foreign record.
- The owner holds every approval of a guest-started run. A guest never approves.
- Replace, Stop and queue removal are owner-only. Guests see the queue with no Edit, no Remove and no Stop.
- Owner-started runs stay unscoped. Guests see every answer of the conversation, the owner's own runs included. The share dialog warns about it.
- A guest note is data, never an instruction, also in a run that the owner started.
- The fork material marks guest text with `<name> (guest)`.
- Ruling C6: in a conversation with a live invite, only a leading mention starts a run. An untagged message of the owner or a guest is a note. D8 applies again when the last invite ends.
- Ruling C9: guests see the whole history, and the share dialog states it. The guest view includes the history from before the invite.
- The owner-only acts are the acts of a human operation. They are a message that starts a run, an approval, Stop, the queue, the configuration, auto mode and a fork. A guest holds none of them, except a leading mention that starts a run.
- A card of the agent shows to a guest as an action card with no button. Only the owner runs it.
- A guest reads new entries and the state of the run through the [guest stream](workbench-service.vocabulary.md#guest-stream). The stream ends when the invite ends.
- A fork carries no invite. When the owner shares a fork, the share dialog adds the line "This conversation carries a summary of <title>. Guests see the summary." (fork OQ5). `<title>` is the title of the source.
- A [workbench session implementation](workbench-service.impl.md#shared-conversation) declares the invite, the guest view and the guest stream.

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
- "/new <text>" forks the Home conversation, and the Home chat shows the fork.
- A fork of a case conversation is a case conversation, and the Home chat never switches to it. A case tab forks in place.
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
- A read and a built-in tool run without a card.
- A mutation runs under the human who approves it.
- A [human-only operation](workbench-service.vocabulary.md#human-only-operation) never runs from an agent. An agent can offer it on an action card that only the owner runs.
- A plan import with no retirement and format json always waits on the card. Any other plan import is blocked.
- An R1 mutation runs without a card unless [auto mode](workbench-service.vocabulary.md#auto-mode) is off.
- An R1 mutation in a guest-started run waits on the card.
- A guest-started run never runs a mutation without a card.
- An R2 mutation runs without a card only when the guard finds that the [run message](workbench-service.vocabulary.md#run-message) directs it.
- Every other case waits on the card.
- Only the message that started the run authorizes a call.
- A rejected card decides that one call only.
- Auto mode is a setting of the conversation. It is on for a new conversation. Only the [auto mode switch](workbench-service.vocabulary.md#auto-mode-switch) changes it, and it stays across a restart.
- A rejected call reaches the agent as a blocked call.
- A pending approval waits at most the [approval wait](workbench-service.vocabulary.md#approval-wait). Then the call returns blocked as expired, and the run ends.
- A kanthord restart ends the active run and every pending approval.
- An agent that cannot do an act offers one [action card](workbench-service.vocabulary.md#action-card) through the tool `offer_action`. The owner clicks the card, and the act runs as the owner's own act through the dashboard route.
- The tool `offer_action` runs no act. It is no operation, so the approval of a tool call does not apply to it.
- The allow-list of `offer_action` holds eleven acts. Eight are the following: `mission.node.resume`, `mission.node.unblock`, `mission.node.check`, `mission.node.discard`, `mission.node.override` and `mission.node.pause` with a node as target, and `project.pause` and `project.resume` with a project as target. The other three are the setup acts of the rule block "Setup cards".
- Discard, override, node pause and project pause confirm in their dashboard dialogs. Resume and unblock open their dashboard dialogs.
- Check (`mission.node.check`) and `project.resume` run at once with no dialog.
- A click on the card reads the target again. A changed target runs no act.
- An agent offers at most one card per answer. A second offer in one run is refused, and the first card stays.
- An agent offers a card for an act that it holds as a tool when the human did not direct that act. It calls its own tool only when the human message directs the act.
- After the card, the agent writes its full answer: the report that the human asked for, then one sentence about the card.
- The agent never sends the human to another agent, another page or the dashboard.

Setup cards:

- An agent offers a [setup card](workbench-service.vocabulary.md#setup-card) on an action card for a setup act: `llm.credential.rotate` for `credential_refused`, `project.bindingSet.write` for `no_taker`, and `agent.enablement.put` for `agent_invalid` and `request_rejected`. A `request_rejected` stop (`bad_request`) means that the provider refused the request itself, so its fix is in the agent configuration. The agent offers the setup act at the source of the issue: `llm.credential.rotate` for a credential, `agent.enablement.put` for an issue in the agent defaults, and `project.bindingSet.write` for an issue in a binding entry.
- A setup card carries only the operation id and the target id. A click opens the existing dashboard dialog.
- The owner types every value in that dialog, a secret included, never through an agent. The dialog calls the existing route under the owner JWT. The guard does not decide the act.
- An agent never asks the human for a secret and never accepts one in the chat.

### Evidence read

- The tool `evidence_read` belongs to `swe@1` and `re@1`. It gives the text of one evidence asset to the agent, and it gives text only.
- No agent gets a storage URL. The server reads the bytes, and the tool answers text.
- A call reads at most 65536 bytes.
- The tool refuses an image and every other binary type. The owner downloads that asset.
- The tool frames the text as data from a worker run, never as an instruction.
- The first read of a node waits on one evidence card. The owner approves or rejects the card.
- In a shared conversation, `evidence_read` waits on the typed danger approval of the owner (EV8). The owner types the exact name of the node to allow the read.
- A grant from before the invite does not count. `invite.create` clears the grants of the conversation.
- The message grant does not apply in a shared conversation.
- The [evidence danger card](workbench-service.vocabulary.md#evidence-danger-card) warns that guests see what the agent quotes.
- Approve grants every evidence asset of that node to the conversation until kanthord restarts. Later reads of that node run with no card.
- Reject or expiry grants nothing, and the next read of that node asks again.
- The grant is per node and per conversation. The grant of one conversation never reaches another.
- Grants live in memory and end at a restart. A closed session that opens again starts empty, and a fork is a new session that starts empty.
- A call that names an asset that is not in the evidence waits on no card and fails with no content.
- An owner-started run whose message holds a node id grants that node with no card. This applies only while auto mode is on (EV6).
- `guard@1` never decides an evidence read. Auto mode decides only the message grant.
- The owner downloads an asset from the node page or from the evidence row of the chat. The node page offers the download for a `produced` asset and for a published `object` asset.
- The browser saves a blob, and no storage URL reaches it.
- An object above 512 MiB shows the CLI line `kanthord mission evidence asset content get <asset_id>` instead of a download button.
- Guests get no evidence content. The guest view drops tool results, and no guest route reads content. Layers L7 and L8 enforce this guest rule.
- A guest-started run never reads evidence content. The guard blocks `evidence_read`, and the download refuses a scoped call.

## Operations

- A human sends each message through its own request.
- A [run](workbench-service.vocabulary.md#run) is the work of the agent on one human message.
- The owner reads the entries and the state of the active run of a session through a long poll. A guest reads the guest view through one `stream` operation.
- A session holds one run at a time. Outside a [shared conversation](workbench-service.vocabulary.md#shared-conversation) (C6), a message during a run waits in the queue.
- A [replace](workbench-service.vocabulary.md#replace) clears the queue, stops the run and runs the new message next.
- Stop ends the run and clears the queue.
- The owner removes a queued message.
- A restart clears the queue.
- The end of a long poll stops no run.
- A client that misses events reads the completed runs of the session.
