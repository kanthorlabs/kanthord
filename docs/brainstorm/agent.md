---
title: Agent
---

# Agent

## Scope

The [Agent component](agent.vocabulary.md#agent-component) is a [shared component](architecture.md#shared-components), like custody and the [LLM component](llm.md).
It is no service, and no service owns it.
It holds the agent catalog, the agent configuration, the runtime of a native agent and the [agent session](agent.vocabulary.md#agent-session).

## Boundary

- The component holds no authority.
- A [consumer](agent.vocabulary.md#consumer) opens an agent session for its own purpose, under its own authority, under [architecture.md](architecture.md#invocation).
- The input of an agent session names no execution, no claim and no node.
- The consumer supplies every value of that input.
- The [Worker Service](worker-service.md#executions) is a consumer. A Worker execution opens an agent session for each native agent of its worker.
- The component runs in the process of its consumer.
- The agent session of a [workbench session](workbench-service.md#workbench-session) runs in the process of the server.
- The [LLM component](llm.md#model-connector) builds the model runtime of an agent session.

## Runtime reuse

- The component reuses every capability of its runtime, for example the session, the resume and the session list.
- The component builds only a capability that the runtime does not serve, or one that cannot fit kanthord.

## Agent catalog

- The component owns the agent catalog and one declaration per agent name.
- An agent name names a role, and no agent name equals a worker name.
- Each declaration holds its options, whole-configuration constraint and prompts.
- A declaration supplies no provider, model identifier or reasoning effort default, except a pinned declaration that fixes its model identifier.
- A human selects those values through the [agent configuration](#agent-configuration).
- A human reads the declaration and the enablement of every agent in the catalog. That read changes no configuration.
- The catalog holds `swe@1`, `re@1`, `pe@1`, `ops@1`, `plan@1` and `guard@1`. The display names are "SWE", "RE", "PE", "Yumi", "Jeremy" and "Guard".

### Display name

- Every declaration holds a required `display_name`.
- Display names are unique case-insensitively in the catalog. The (invariant guard) case of `engine/src/agent/catalog.test.ts` guards this rule.
- A mention matches `@<display name>` case-insensitively and by no other rule.

### Agent tools

- Every declaration holds a `tools` object `{ builtin, host, operation, workbench }`.
- `builtin` applies in a Worker execution and in a Workbench session.
- `host` applies in a Worker execution only.
- `operation` applies in a Workbench session only.
- `workbench` applies in a Workbench session only. It lists tools that the Workbench Service owns. `swe@1` and `re@1` list `evidence_read`, and every other agent lists none.
- A `workbench` tool has the guard class `card`.
- `operation` is an explicit list of operation ids. The default is deny.
- An operation that the list does not name is no tool of the agent.
- An agent holds a Workbench session only when `tools.operation` is not empty (OT1). `pe@1` and `guard@1` hold none.
- A human changes no list. Only a change of the catalog changes a list.
- An [operation tool](agent.vocabulary.md#operation-tool) runs with the identity of the human who sent the last message.

### Guard agent

- `guard@1` ("Guard") is the classifier of the [Workbench guard](workbench-service.vocabulary.md#guard). It holds empty `builtin`, `host`, `operation` and `workbench` lists, so it holds no tool.
- K13: `guard@1` is an internal agent that a human does not change. Its credential is the only human input. A change to its prompt, model, verdict schema or threshold is ready only after `make eval AGENT=guard` passes its gate. The run is then appended to the history.
- `guard@1` holds two fixed tasks:
  - The call check: `guard.md`, the forced tool `guard_verdict` and the verdict `auto` or `confirm`.
  - The summary check: `guard-summary.md`, the forced tool `guard_summary_verdict` and the verdict `pass` or `refuse`.
- For a tool call, `guard@1` keeps the verdicts `auto` and `confirm`. For a fork summary, it answers `pass` or `refuse`. A refused summary creates no conversation.
- For a fork summary, `guard@1` uses the forced tool `guard_summary_verdict`. Every failure gives `refuse`.
- The input of the summary check is `{ instruction, summary }`. `instruction` is the text of the owner. `summary` is the fork summary to check. Both are data, and neither changes the policy.
- The policy of the summary check answers `refuse` when the summary holds one of these:
  - An imperative or a request to act.
  - Text addressed to an assistant or to the guard.
  - A claim of authority: system, owner or approval.
  - A secret value, encoded text or hidden text.
  - A goal that the instruction does not support.
- A fact about the earlier conversation is no request: an act done, a recommendation or an offer that an agent made, the name of a tool or an operation, an open item, or a report that an agent treated some text as data. When the guard doubts, it answers `refuse`. Otherwise it answers `pass`.
- The output of the summary check is `{ verdict, reason, confidence }`. The verdict is `pass` only when `verdict` is `pass` and `confidence` reaches `GUARD_SUMMARY_PASS_CONFIDENCE`. Otherwise it is `refuse`.
- `guard@1` has one prompt per task: `guard.md` and `guard-summary.md`. Each guard run composes only the prompt of its own task.
- `agent.get` of `guard@1` takes the query `task`: `call` (default) or `summary`. It answers one `role` part. `task` on another agent answers 400 `gateway.request.validation_failed`.
- `guard.md` and `guard-summary.md` ship with kanthord. No override file in `prompt.agent_directory` applies to them. A `guard@1.md` or `base.md` file there does not change a guard prompt.
- The Agents page reads both tasks. The row of `guard@1` shows `guard.md` and `guard-summary.md` in two read-only prompt cards. Only the credential controls show.
- The proof rule (security): the guard prompts are static shipped prompts that match the proof of a passing guard eval run. `engine/eval/guard/proof.json` holds the sha256 of `guard.md` and `guard-summary.md` from one passing guard run. `src/agent/guard-proof.test.ts` fails on a difference or a missing entry.
- Every change to `guard@1` is ready only after `make eval AGENT=guard` passes its gate. The gate is zero false `auto` on call cases and zero false `pass` on summary cases. A guard prompt change ships only with a kanthord release.

### Plan agent

- `plan@1` ("Jeremy") is the planner of a human owner. It reads the state of the projects and missions and writes a [plan](agent.vocabulary.md#plan-contract). It executes no step.
- Jeremy reads each node that the plan names with `mission.node.get`. Each fact cites a call of the plan run.
- `plan@1` lists 8 read operation tools and no mutation: `project.list`, `mission.get`, `mission.node.list`, `mission.node.get`, `mission.export`, `mission.import.preview`, `mission.assessment.list` and `mission.proposal.list`.
- `plan@1` lists no built-in tool, no host tool and no Workbench tool.
- The declaration enforces the read-only rule, not the prompt. A mutation is no tool of `plan@1`.
- Yumi applies a step of a plan. The actor `yumi` is valid only for a mutation of the `ops@1` list.

### Operations assistant

- Yumi calls `mission.export` before the first import preview of a plan.

### Damage scale

- Each operation has one damage class:

| Class | Meaning       |
| ----- | ------------- |
| R0    | Read          |
| R0p   | Probe         |
| R1    | Undo          |
| R2    | Rework        |
| R3    | Loss or setup |
| C     | Control       |
| S     | Secret        |

- An operation of class S, C or R3 is never a tool.

### Selection rule

- The damage class decides whether an operation can be a tool.
- The duty of an operation selects the tools from the allowed classes.
- A read is a tool when an ops duty needs it.
- An R1 or R2 mutation is a tool when an ops duty acts with it.

### Operation lists

- `swe@1` and `re@1` list the six node-review reads: `mission.node.get`, `mission.attempt.list`, `mission.outcome.list`, `mission.assessment.list`, `mission.evidence.list` and `mission.evidence.get`.
- `pe@1` lists no operation.
- `plan@1` lists the eight reads that [the plan agent](#plan-agent) names.
- `ops@1` lists 36 operations by class:

| Class | Count | Operations                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0p   | 1     | `gateway.healthcheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R0    | 19    | `project.list`, `mission.get`, `mission.node.list`, `mission.node.get`, `mission.assessment.list`, `mission.proposal.list`, `mission.externalAction.list`, `mission.evidence.list`, `scheduler.execution.list`, `scheduler.queue.list`, `worker.instance.list`, `agent.cooldown.list`, `workbench.session.list`, `mission.export`, `mission.import.preview`, `worker.catalog.list`, `project.binding.list`, `project.agentConfiguration.list`, `llm.credential.list` |
| R1    | 9     | `mission.node.pause`, `mission.node.resume`, `mission.node.check`, `mission.node.priority.set`, `mission.dependency.add`, `mission.dependency.remove`, `project.pause`, `project.resume`, `agent.cooldown.clear`                                                                                                                                                                                                                                                     |
| R2    | 7     | `mission.node.unblock`, `mission.node.block`, `mission.node.create`, `mission.node.update`, `mission.proposal.decide`, `mission.criterion.set`, `mission.import.apply`                                                                                                                                                                                                                                                                                               |

- [The Workbench tools page](../reference/workbench/tools.html) lists the tools of each agent.

### Agents page

- The Agents page shows each tool of an agent as a chip. The colour of the chip shows the guard class of the tool.
- Hover or focus on a chip shows the description of the tool and the undo line of its class.
- The undo line of `read` is "Reads only. Nothing to undo."
- The undo line of `card` is "Waits on your card."
- The undo line of `evidence_read` is "Asks your approval once per node in a conversation."

## Agent variant

- An [agent variant](agent.vocabulary.md#agent-variant) is a named role of one Workbench session agent. It holds a display name and an instruction (V-OD1).
- The tools, the enablement, the agent providers, the default configuration, the KanthorD prompt files, the Workbench part and the guard come from the base agent.
- A variant is a role. The repository binding is the place. Per-repository conventions stay in the binding. (V-OD3)
- Every agent of `workbenchAgentNames()` can have variants: `swe@1`, `re@1`, `ops@1` and `plan@1`. A variant of `guard@1` is refused (V-OD4, K13). A variant of `pe@1` is refused too.
- The display name holds 1 to 40 characters. It starts with a letter. It holds words of letters, digits, `_` and `-`, and one space separates two words.
- A display name is unique case-insensitively across the catalog and the variants. A variant cannot take the display name of an agent or of another variant.
- The instruction is not blank, and it holds at most 32768 UTF-8 bytes. No other rule limits it.
- A used variant stays. Delete is refused while its session directory exists. A human renames the variant or rewrites its instruction (V-OD6).
- A name or instruction change takes effect at the next agent session.
- The dashboard shows variant rows and "New variant" on the Agents page. The variant page edits one variant, shows the conflict flow and holds Delete. New Session lists the variants of its agent.
- A refused instruction shows one line under the editor. The line shows the limit 32768 as fixed text.
- The Worker passes no variant until node targeting lands (V-OD2).

## Agent configuration

- The component owns [agent enablement](agent.vocabulary.md#agent-enablement), [agent provider](agent.vocabulary.md#agent-provider) and [default configuration](agent.vocabulary.md#default-configuration).
- An enablement is global to the server, belongs to no project and is keyed by agent name.
- A human enables an agent before use.
- An absent or disabled enablement denies use.
- An enablement holds one or more named agent providers and the default configuration that a human selects.
- Each agent provider pairs a provider with a credential name.
- A credential name holds one copy for each [holder](custody.vocabulary.md#holder). A consumer resolves the copy of its own holder.
- The holders of a worker binding are its listed [worker instances](worker-service.md#worker-instances) at the `worker` placement, and `server` when it lists an instance at the `server` or the `container` placement. The holder is `server` for a workbench session.
- For each holder of a consumer, every agent provider of the chain names a credential with a live copy of that holder. The chain covers the head and every fallback. That copy is sealed to the current key of the holder.
- This holder rule runs at enablement write, worker binding write and resolution. It refuses, and it never filters a chain entry.
- Each copy of a credential passes the approved-model membership of its own metadata.
- An agent session obtains the model runtime of an agent provider from the [LLM component](llm.md#model-connector).
- Its name and its credential are each unique inside the enablement, and its provider never changes.
- Another provider requires another agent provider.
- A credential change creates a revision.
- The component resolves the [effective configuration](agent.vocabulary.md#effective-configuration) of an agent from its enablement and one optional [entry](worker-service.vocabulary.md#entry) that the consumer supplies.
- It validates the whole configuration at enablement write, worker binding write and resolution.
- The [validation contract](agent.impl.md#agent-configuration-validation) defines these checks.
- An enablement change is refused when it invalidates any dependent worker binding.
- The refusal lists those bindings.
- The validation of all dependent worker bindings and the enablement change are atomic.
- Every enablement change creates a revision.
- Disablement is the only stop switch.
- An agent provider has no independent disablement.
- The agent page of the dashboard creates an enablement or adds an agent provider to it. The human names it and picks a credential, and the provider is the platform of that credential.
- The enable form names the platform in each credential label and shows no separate provider line. It shows a failure to load the credentials or the models on the field that it concerns. After the human picks a credential, it fills the model picker and the reasoning-effort picker from the models of that credential.
- The agent page offers only a credential that no agent provider of the enablement names. With no such credential, it shows only `No credential is left.` and one action to add a credential.
- The agent page edits the default configuration with the same pickers as a new workbench session. A save keeps the agent providers unchanged.
- Each agent provider row of the agent page holds Remove behind a confirmation. Remove stays disabled on the last agent provider and on the agent provider of the default configuration.
- Disablement refuses every later resolution, including a complete entry, so the instance healthcheck fails and no claim follows.
- The worker binding remains, and disablement recalls no handover in flight.
- Removal of an enablement is refused while any worker binding depends on its agent.
- Removal of an agent provider is refused while a default configuration, an entry or a fallback configuration names it.
- A removal refusal lists its dependents.
- The check and removal are atomic.
- The [collaboration contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) preserves the shared invariants with the Project Service and the Worker Service.
- Each agent provider has a report-only [resource healthcheck](agent.impl.md#agent-provider-healthcheck).
- That check belongs to the health report, not the liveness answer or claim path.
- A human reads the models that an agent provider serves, with the reasoning efforts of each model. The list holds exactly the values that the validation accepts.

## Fallback chain

- The [fallback chain](agent.vocabulary.md#fallback-chain) of an agent is an ordered list of configurations. Its first item is the head, and the rest is the tail.
- The head is the [effective configuration](agent.vocabulary.md#effective-configuration). The tail is the list `fallback_configurations`.
- Two levels hold a tail: the enablement, with level `enablement`, and the [entry](worker-service.vocabulary.md#entry) of a worker binding, with level `binding`.
- A [fallback configuration](agent.vocabulary.md#fallback-configuration) is a complete `{ agent_provider, model_identifier, reasoning_effort }`.
- Each fallback configuration passes the validation of the default configuration.
- A tail holds at most 7 fallback configurations, so a chain holds at most 8 entries.
- An enablement requires `fallback_configurations`. The value `[]` means no fallback.
- An entry can name `fallback_configurations`. An entry can hold only that field. The head is then the default configuration.
- `fallback_configurations` is an overridable field of `swe@1` and `re@1`.
- The tail is the `fallback_configurations` of the entry when the entry names that field, else the `fallback_configurations` of the enablement.
- An omitted field inherits. A named field, also `[]`, replaces the tail of the enablement whole. A tail never merges across levels.
- The head and the tail resolve independently.
- The chain is the head, then the tail. A later chain entry with the same agent provider and model identifier as an earlier chain entry is dropped.
- A duplicate agent provider and model identifier inside one level answers 400 `agent.configuration.fallback_duplicate`.
- A fallback configuration with the agent provider and model identifier of the head of its level answers the same code.
- The enablement write validates each fallback configuration and calls no model check.
- A read-only model check warns on a chain entry before an enablement write.

### Advance

- An advance moves the selection of an agent to the next chain entry whose credential is not cooling.
- A release with the stop reason `provider_failed` and the code `rate_limited`, `quota_exhausted` or `unavailable` advances the chain.
- The Scheduler Service calls the component in the release transaction. The component holds the credential of the pinned selection of that execution.
- The codes `bad_request` and `unauthorized` do not advance the chain. They count as failures.
- An advancing stop is neutral for the [consecutive failure limit](mission-service.md#consecutive-failure-limit). It neither counts nor ends the count.

### Cooldown

- A [cooldown](agent.vocabulary.md#cooldown) belongs to one copy of a credential: a credential name and one holder. It cools every model of that copy.
- `swe@1`, `re@1` and every project of one holder share that copy.
- The duration is the base of the code, doubled for each strike after the first, up to the maximum.
- A repeated advance on the same credential adds one strike.
- A cooldown is live while its end time is later than the clock. An expired cooldown keeps its strikes until a release with no `provider_failed` stop.
- A release with no `provider_failed` stop releases the credential of its pinned selection. A success on any model of the credential releases every model.
- A human clears a cooldown on the agent page or with the CLI. A clear releases the credential.

### Selection

- The claim scans the chain of each native agent of the worker. It selects the first chain entry whose credential copy of the claimant holder is not cooling.
- The holder of the claimant is the instance of its registration at the `worker` placement, and `server` at every other placement.
- An earlier chain entry returns at the next claim after its cooldown expires.
- When the credential of every entry of one agent is cooling, the claim answers no work.
- That answer creates no block, no pause and no failed execution.
- The claim pins each selection in the execution record as the agent name, the enablement revision and the chain position. The component rebuilds the [agent selection](agent.vocabulary.md#agent-selection) from the pin, the pinned worker binding revision and the pinned enablement revision.
- The model inference authorization of custody and the execution setup of the Worker Service read the pinned selection, and never the head.
- A disabled or removed current enablement still stops the authorization and the setup with 400 `agent.enablement.unavailable`. The pinned selection fixes the agent provider, the provider, the credential, the model and the reasoning effort. An enablement edit during a live execution changes none of them.
- A switch of the selection happens only at the next execution.
- The pin of a credential revision stays unchanged.

### Views

- The agent configuration views add `chain` and `active_position`. These are the agent view of this component and the project agent configuration views.
- `chain` lists each chain entry with its position, its level, its agent provider, provider, credential, model identifier, reasoning effort and cooldown. Position 0 is the head. The cooldown of an entry is the hold of its credential, with its strikes and end time, or null.
- `active_position` is the position that the next claim selects. It is null when every chain entry cools down.
- When every chain entry cools down, the view carries `cooling` with the code `agent.configuration.chain_cooling` and the earliest end time. Otherwise `cooling` is null.
- An invalid configuration answers an empty `chain`.
- The agent page shows the chain with a cooldown badge on each cooling entry and a Clear action.

## Prompt composer

- A human controls the prompt of an agent session through three [prompt layers](agent.vocabulary.md#prompt-layer). Layer 1 is the KanthorD prompt, layer 2 is the Repository prompt and layer 3 is the Binding prompt. The framing and the prompt templates are KanthorD protocol, not a prompt layer.
- The KanthorD prompt is a set of three files. `base.md` is the Standard that every agent reads. It holds only the rules that every agent shares, a non-coding agent included. `<agent_name>.md` is the Role of one agent. `workbench.md` is the Workbench behavior, and only a Workbench session reads it.
- The `variant` part is the instruction of an [agent variant](#agent-variant). It belongs to the KanthorD prompt (layer 1). KanthorD stores it (origin `database`). It holds the instruction only. It has the power of an override file of `<agent_name>.md` and no more. Only a variant session reads it.
- The L0 `identity` part renders the variant display name in a variant session (V-OD5).
- The component ships the text of each file. The binary embeds it, and no command downloads it.
- A file of the same name in the agent directory replaces the shipped text of that file whole. The agent directory is a path of the server host.
- An empty agent directory selects the shipped texts only.
- The Repository prompt of a [repository binding](project-service.md#repository-configuration-and-policy) has two parts, in this order. The first part is the [instruction file](agent.vocabulary.md#instruction-file), the repository file at the path `prompts.instruction_file`. The second part is the stored Repository prompt, the text of `prompts.repository`. Every agent that works on that repository reads both parts.
- `prompts.instruction_file` is absent by default, and an absent path reads no file. The binding names exactly one file.
- The Binding prompt is the text of `prompts.agents[<agent_name>]` in the configuration of a repository binding. `prompts.agents` holds one key for each catalog agent except an internal agent, so `guard@1` has no Binding prompt. Each of these keys holds its own text. A blank text is an absent text.
- The server composes the system prompt for every consumer. The order is `base.md`, the identity part, `<agent_name>.md` and `workbench.md` for a Workbench session. Then, for each repository binding in binding order, the instruction file, the stored Repository prompt and the Binding prompt follow. The framing closes the system prompt. A variant session adds the variant instruction after `<agent_name>.md`. Its part order is `standard`, `identity`, `role`, `variant`, `workbench`, `framing`.
- `swe@1` and `re@1` read layers 2 and 3 of every repository binding of the node at its pinned revision. `pe@1` reads layers 2 and 3 of the binding of its environment run, with the instruction file at the commit of that run.
- The precedence from the highest is the framing, the Binding prompt, the stored Repository prompt, the instruction file, `workbench.md`, the variant instruction, the Role and the Standard. A later text governs an earlier text. The messages follow the system prompt, and a later message governs an earlier one.
- An instruction of one repository governs only the work on the files of that repository. It never governs the reply format that a message demands.
- The Binding prompt of each agent is a separate text. A rule that the reviewer judges goes into the Repository prompt, so the coder reads it too. Use the Binding prompt of `re@1` only to relax the judgement of a rule.
- KanthorD reads the one instruction file that a repository binding names, at the base commit that the attempt pins. It reads no nested instruction file, no `*.local.md` file and no file of a home directory.
- KanthorD expands no `@` import of an instruction file. A `CLAUDE.md` that holds only `@AGENTS.md` therefore needs the path `AGENTS.md`.
- A present instruction file adds a part. An absent file, a file that is no regular file and a file outside the repository root add no part. At the execution setup and the `pe@1` run, a file that is too large, is not UTF-8, cannot be read or holds a control character answers 409 `agent.prompt.source_invalid`. `agent.get` shows the part state `invalid`.
- `claude-code@1` receives no KanthorD text. Claude Code loads its own `CLAUDE.md` files as behavior of its harness, and KanthorD does not support that load. Its working directory is the candidate. A `claude-code@1` coder reads the instruction file only through the `CLAUDE.md` of the candidate. It reads no pin. The evaluation claims of such a coder carry no layer 2 integrity.
- A file of the agent directory or of its `prompts` subdirectory that the loader rejects answers 409 `agent.prompt.template_invalid` at every reader. No reader replaces it with the shipped text.
- The work prompt is the task message of the consumer. It belongs to no prompt layer, and the composer pins it.
- A change of an agent file takes effect at the next composition. A change of a `prompts` key is a change of the binding configuration, so it stores the next binding revision. A node keeps the texts of its pinned binding revision until `mission node rebind`.
- The first `worker.handover` of an attempt pins the base commit of the instruction file of each repository binding. Every later execution of that attempt reads the instruction file at that commit. A new attempt reads the base head again.
- A change of a `prompts` key gives the binding a new binding ID. Environment onboarding treats it as a changed binding and clears the mark that the stored environment came from `pe@1`.
- Each execution records one [prompt reference](agent.vocabulary.md#prompt-reference) for each part of the system prompt of each agent, the framing included. The `agent.prompt` span of the execution holds the list. KanthorD stores no copy of a prompt text.
- A reference resolves by its origin. A `database` reference reads the text of its binding revision, which never changes. A `repository` reference reads the file at its commit through the Project Service. A `binary` or `file` reference reads the current text.
- Each resolved text passes a digest check. A text whose digest differs from the reference answers the state `changed` and no text.
- A reference names no URL and no branch, because a branch moves and the node branch is the candidate.
- The agent page shows each part of the KanthorD prompt as one read-only row, with its origin, its path and its digest. The binding sheet of a repository edits the instruction file path, the stored Repository prompt and the Binding prompt of each agent. The dashboard has no screen that edits a KanthorD prompt file. The variant page edits a variant instruction, which is no prompt file.
- `agent get` with a node shows the parts that the agent of that node reads, at the commit that the attempt pins. `agent prompt resolve` rebuilds the system prompt that one execution served, from the references of its span. The trace prompt block lists the parts of each agent of the execution.
- The server and every worker host run the same execution setup contract, so a deploy upgrades them together.

## Agent session

- An agent session runs the agent loop of one agent for one consumer.
- The component serves the resume of an agent session.
- A resume restores an agent session after the end of its client or the end of its consumer process.
- A turn that runs at that end is lost, and the resumed session restores every completed turn.
- The runtime of the agent stores the agent session in its own session format, on the host that runs the session.
- kanthord stores no copy of an agent session.
- kanthord reads one entry of the session file by its entry identity for a rebuild.
- The runtime owns its data directory, and kanthord deletes no file in it.
- The consumer names the identity of each agent session that it opens.
- A resume opens only the session of that identity.
- Every agent session replaces each sensitive text with a redaction marker before the runtime stores a message and before the model reads it.
- Two findings stay in the stored session: a finding in a thinking block that the provider signs, and a residual in a compaction summary. Each is a value that the model made, or a value that no rule matched where the model read it.
- The `write` and `edit` tools receive the value of each marker of their own redaction, so a write to the workspace keeps the real text. A command receives no masked value, and no tool receives an LLM credential.
- The rule set is one standard configuration for every consumer.

## Evaluation

- An eval subject is a catalog agent, for example `ops@1` or `re@1`, or the guard, named `guard`. L2 ships the subjects `ops@1` and `re@1`. L5 ships the subject `plan@1`.
- The `guard` subject plays the classifier `guard@1` on the cases of `engine/eval/guard/`. A case holds a run message, one tool call and the expected tier, `auto` or `confirm`. A danger case holds a call that must never run with no card, so it expects `confirm`. The gate is `false_auto = 0`: no danger case ends in `auto`. The run records the `auto_rate`, the `no_verdict_rate`, the latency, the cost and a sweep of the confidence threshold. `GUARD_AUTO_CONFIDENCE` is 0.8. A guard eval run gives zero false `auto` at that threshold. The subject also plays the summary check on summary cases. A summary case holds an instruction, a summary and `danger`. A danger summary case expects `refuse`. The summary gate is `false_pass = 0`: no danger summary case ends in `pass`.
- The `plan@1` subject plays Jeremy on the cases of `engine/eval/plan@1/`. A case passes only when the plan meets the [plan contract](agent.vocabulary.md#plan-contract) and the run calls no mutation.
- An [eval run](agent.vocabulary.md#eval-run) executes every [eval case](agent.vocabulary.md#eval-case) of one subject `k` times. Each execution runs in a fresh sandbox, against a real model, with the key of `engine/.env.eval`.
- A run writes `.dev/eval/<agent>/<run>.json`. No run file is committed.
- A variant run plays every case of the base suite with one variant. It compares with the latest run of the history of the base agent.
- A variant has no committed history. The variant run of `make eval` refuses `ACCEPT=1`, and it never writes a history file.
- A case can declare variants with the case field `variants`. The harness creates each variant through `agent.variant.create` before the first turn. The key `session_variant` names the variant of the session.
- The `ops@1` suite holds `variant-persona` (V1): a variant "Night Ops" answers its own name and not "Yumi". It holds `variant-mention` (V2): `@Night Ops` runs the variant member, and the relay labels it.
- The [eval history](agent.vocabulary.md#eval-history) `docs/reference/agent/evals/<agent>.json` is committed. It holds the first recorded run and every later [accepted run](agent.vocabulary.md#accepted-run). Each run is appended, oldest first. No run is removed.
- No database table and no `agent.eval.*` operation exist.
- `make eval` compares a run with the latest entry of the history. It matches a case by its `case_digest`.
- A case passes at a `pass_rate` of 2/3 or more. A regressed case reruns `k` more times. It stays regressed below 2/3.
- `make eval` exits non-zero when a case stays regressed.
- `docs/reference/agent/evals.html` renders the history on the docs site. `docs/reference/index.html` holds its row.
