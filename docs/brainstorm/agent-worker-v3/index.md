# Agent V2 and Worker V3

This set designs the next agent and worker of KanthorD. It starts from the direction of Ulrich of 2026-11-21 and from Worker V2 (the Foundry, D32), which merged into `main` on 2026-11-20. The round builds the CLI first and the coding category first.

## Goals

1. **R1.** An agent runs one agent profile with no KanthorD server. The agent CLI `kanthord run agent` gives it the input as options, a JSON file or a Markdown file.
2. **R2.** The coding category has the agent profiles and the tools that it needs today, and no more.
3. **R3.** A worker adds instructions, capabilities and worker tools to an agent session. Each tool that calls the KanthorD server is a worker tool or a consumer tool.
4. **R4.** The line runs inside the worker behind typed ports and opens an agent session only through the agent contract.
5. **R5.** The worker CLI `kanthord run worker` runs `coder@1` against a KanthorD server.
6. **R6.** Each credential rule of today keeps its strength or becomes stricter at every layer.
7. **R7.** L6 gives an ordered list of build steps from the code of today to this design. After each step, `main` works, and the step names the check that proves it.
8. **R8.** Each point of the direction of Ulrich has a verdict with evidence. A point that does not fit has a suggestion for Ulrich.

## Reading order

1. Read [L1](L1-model.md) first. It fixes the actors, the boundaries, the tool ownership rule and the credential flow.
2. Read [L2](L2-agent.md), then [L3](L3-agent-cli.md), for the agent and its CLI.
3. Read [L4](L4-worker.md), then [L5](L5-worker-cli.md), for the worker and its CLI.
4. Read [L6](L6-migration.md) last, for the build order.

Each layer file starts with its goals `G1`, `G2`, ..., ends with its decisions and its open questions for Ulrich, and names the goals that each section serves.

## Layer files

The status set is `planned` (no file yet), `draft`, `reviewed` and `accepted`.

| Layer | File                                 | Title                        | Purpose                                                                                                   | Round goals    | Status     |
| ----- | ------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- | ---------- |
| L1    | [L1-model.md](L1-model.md)           | The model and its boundaries | Fix the actors, the boundary, tool ownership, statelessness, the credential flow and the mapping of today | R3, R4, R6, R8 | `reviewed` |
| L2    | [L2-agent.md](L2-agent.md)           | The agent                    | Specify the agent profiles, their prompts, the coding tool set and the input and output contract          | R1, R2, R6, R8 | `planned`  |
| L3    | [L3-agent-cli.md](L3-agent-cli.md)   | The agent CLI                | Specify the CLI that runs one agent with no KanthorD                                                      | R1, R6, R8     | `planned`  |
| L4    | [L4-worker.md](L4-worker.md)         | The worker                   | Specify `coder@1`, the worker layer, the profile selection, the link to the line and the server           | R3, R4, R6, R8 | `planned`  |
| L5    | [L5-worker-cli.md](L5-worker-cli.md) | The worker CLI               | Specify the CLI that runs a worker against a KanthorD server                                              | R5, R6, R8     | `planned`  |
| L6    | [L6-migration.md](L6-migration.md)   | Migration                    | Specify the build order from the code of today                                                            | R7             | `planned`  |

L1 links these anchors of later files. Each later file keeps the heading of each anchor.

- `L2-agent.md#coding-tools`, `#profile-prompts`, `#input-and-output-contract`
- `L4-worker.md#worker-instructions`, `#worker-capabilities`, `#worker-tools`, `#profile-selection`

[L1](L1-model.md#handoffs-to-later-layers) lists the other items that it hands to a later layer.

## Open rulings

[L1](L1-model.md#open-questions-for-ulrich) holds one open question for Ulrich, `Q4`. Each layer marks a place that depends on a ruling with **(Q<n>)**.

## Glossary

One meaning per term. A term of today keeps its meaning unless its entry marks `Change:`.

- **agent.** One LLM working unit that runs one agent profile on pi-coding-agent. It is stateless and runs without KanthorD ([L1](L1-model.md#statelessness)). Change: today an agent is "an automated participant responsible for carrying out steps as the WHO" ([overview.vocabulary.md](../overview.vocabulary.md#agent)). The role in the WHO stays. The new meaning adds the unit and its boundary.
- **agent runtime.** The part of the Agent component that is the agent of the model: the session open, the profiles, the guards, the tools and the prompt join. Change: a new term ([L1](L1-model.md#agent-runtime-and-server-part-of-the-agent-component)).
- **agent profile.** The catalog declaration of one agent name of the form `<role>@<version>`, for example `swe@1` or `re@1`. It fixes the profile prompt, the profile tools and the confinement. Change: a new term for the "agent declaration" of today (`engine/src/agent/catalog.ts`). The `host_tools` field leaves it.
- **role profile.** An implementation profile of one role of a category, for example `bee@1`, `fee@1` or `te@1`. It uses the configuration of its configuration owner. Change: a new term.
- **configuration owner.** The profile whose enablement, providers, fallback chain, cooldown, selection, pin, worker binding entry and Binding prompt a role profile uses. `swe@1` is the configuration owner of the coding role profiles. Change: a new term.
- **profile prompt.** The Standard (`base.md`), the shared text of the category, and the Role (`<agent_name>.md`) of a profile. Change: today the agent part of the KanthorD prompt (layer 1) is the Standard and the Role ([agent.md](../agent.md#prompt-composer)). The shared text of the category is new.
- **agent session.** The pi session of one agent profile for one consumer, known by its session identity. A resume restores it after its close ([agent.md](../agent.md#agent-session)). Change: wording only; [agent.vocabulary.md](../agent.vocabulary.md#agent-session) defines it with "run".
- **run.** One open-to-close of an agent session. A resume of the session starts a new run. A run holds one or more turns. Change: a new term. The command name `kanthord worker tasks run` keeps its name. The global root `run` of `kanthord run agent` and `kanthord run worker` is a command name, not this term.
- **agent CLI.** The one-shot command `kanthord run agent`. It runs one agent profile from one input and exits. It holds only the LLM credential, on standard input. Change: a new command under the new global root `run` ([L1](L1-model.md#e5-two-clis-fits-with-the-root-run)).
- **worker CLI.** The one-shot command `kanthord run worker`. It claims one execution, runs it and exits. It holds only the instance key. Change: a new command under the new global root `run` ([L1](L1-model.md#e5-two-clis-fits-with-the-root-run)).
- **consumer.** The code that opens an agent session for its own purpose: a worker, the Workbench Service, the Project Service or the agent CLI. Change: today a consumer is a service ([agent.vocabulary.md](../agent.vocabulary.md#consumer)); the agent CLI is no service.
- **agent contract.** The input and the output of a run. [L2](L2-agent.md#input-and-output-contract) specifies it. Change: a new term.
- **agent input.** The input of one run: the profile name, the model selection and runtime, the workspace roots, the budget, the system prompt or the instructions, and the consumer records. Change: a new term.
- **workspace roots.** The working directory of a session and, for a confined profile, the directories that the confinement guard accepts. Change: a new term for `cwd` and the `roots` of `Confinement` (`engine/src/agent/hooks/checkout-confinement.ts`).
- **category.** A kind of work that one or more workers automate, for example coding. Change: a new term.
- **extension.** One pi extension factory (`InlineExtension`) that an agent session loads. A hook, a guard and a capability are each an extension. Change: a new term that names the mechanism.
- **capability.** An extension of a consumer that registers tools or MCP servers. A worker capability belongs to the worker layer. Change: today a capability is an extension of a Foundry host ([worker-service.vocabulary.md](../worker-service.vocabulary.md#capability)); the term keeps its name. "Capacity" means an amount in KanthorD (the claim capacity of a binding, `engine/src/scheduler/claim.ts`, `capacityOutcome`), so the direction word "capacity" is written "capability".
- **guard.** An extension that every agent session of the worker path and the agent CLI holds, and that no consumer can remove: the sensitive-text redaction, the tool allowlist and the checkout confinement. Change: today `sessionParts` adds the redaction to every session, and `agentPort` adds the allowlist and the confinement (`engine/src/agent/agent-session.ts`, `agent-port.ts`).
- **tool.** A pi tool that the model calls in a turn. Change: today a tool is "a capability that an execution uses to perform an operation", for example git ([overview.vocabulary.md](../overview.vocabulary.md#tool)). In the V3 pages, git and the verification commands are operations of the line, not tools.
- **agent tool.** A tool that an agent profile owns. It needs only the workspace roots and the process tree of the session. Change: today an agent tool is every pi tool that the model calls, `evidence-upload` included.
- **worker tool.** A tool that the worker layer grants to an agent session through a worker capability. Each tool that calls the KanthorD server from a worker is a worker tool. Change: a new term. `evidence-upload` and `link_update_list` become worker tools.
- **consumer tool.** A tool that a consumer other than a worker adds to an agent session, for example a server operation tool of the Workbench. Change: a new term.
- **host tool.** A worker tool or a line port: the only path of a side effect of the line. Change: today a host tool is an agent tool or a Foundry port ([worker-service.vocabulary.md](../worker-service.vocabulary.md#host-tool)).
- **host resource.** A long-running object of the worker host beside the line: `claim.watch`, `credential.store`, `ssh.access` ([worker-service.vocabulary.md](../worker-service.vocabulary.md#host-resource)). Change: wording only; today the page names the Foundry host and the Foundry.
- **worker.** The automation of one category of work. It declares the node states and the intents that its instances claim, as today ([overview.vocabulary.md](../overview.vocabulary.md#worker)). `coder@1` and `reviewer@1` are the workers of the coding category. Change: a worker has three parts: the worker host, the line and the worker layer ([L1](L1-model.md#worker)). The direction calls a worker a manufacturing line; the V3 pages use "line" only for the part of that name.
- **worker layer.** The part of a worker that it adds to an agent session: the worker instructions, the worker capabilities, the worker tools and the profile selection. Change: a new term.
- **worker instructions.** The texts that the worker layer adds after the profile prompt: the instruction file, the stored Repository prompt, the Binding prompt, the framing and the prompt templates of the turns. Change: a new term that groups layers 2 and 3 and the KanthorD protocol of today.
- **line.** The part of a worker that runs the `tasks` phase of a node execution behind typed ports. Every D32 rule of the Foundry applies to it. Change: "line" replaces "Foundry" as a part of the model ([worker-service.vocabulary.md](../worker-service.vocabulary.md#foundry)). It opens an agent session only through the agent contract, one session per profile. The code keeps the names `foundry-*.ts` this round.
- **worker host.** The part of a worker that calls the line and links it to the outside. It has two run modes: server mode and offline mode. Change: "worker host" replaces "Foundry host" as a part of the model ([worker-service.vocabulary.md](../worker-service.vocabulary.md#foundry-host)). Today "worker host" names only the Foundry host that talks to the server, and the CLI host is the other Foundry host. The code keeps its names this round.
- **server mode.** The run mode of the worker host that talks to KanthorD: `kanthord serve worker` and `kanthord run worker`. Only the worker host in server mode talks to the server. Change: a new term for the worker host of today.
- **offline mode.** The run mode of the worker host that works on local files, a seed and a replay, with no server call: `kanthord worker tasks run`. It covers the `implement` chain only (`engine/docs/cli/worker.md`, section `tasks run`). Change: a new term for the CLI host of today.
- **line port.** A typed function of the worker host that step code of the line calls outside a turn (`engine/src/worker/unit/foundry-ports.ts`). It is no tool. Change: a new name for the Foundry port of today ([worker-service.vocabulary.md](../worker-service.vocabulary.md#foundry-port)).
- **server.** KanthorD: one process that holds the services ([architecture.vocabulary.md](../architecture.vocabulary.md#server)). Unchanged.
- **task.** A part of the WHAT of an `implement` node with its own criterion, but no outcome of its own ([overview.vocabulary.md](../overview.vocabulary.md#task)). Unchanged. A task is one work unit.
- **work unit.** A task, or an `implement` node with no task, which is its own work unit ([worker-service.md](../worker-service.md)). An `examine` node holds no task. Change: the worker selects one profile per work unit; the selection method is open **(Q4)**.
- **execution.** The unit of work that the Scheduler Service records for one node and one worker instance ([overview.vocabulary.md](../overview.vocabulary.md#execution)). Unchanged. An agent knows no execution.
