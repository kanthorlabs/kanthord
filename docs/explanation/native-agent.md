# How the native agent works

A native agent is an LLM agent that KanthorD runs inside its own process. An external harness, for example `claude@1` or `opencode@1`, runs a third-party agent program instead. This page explains how KanthorD builds a native agent, what the agent can see and do, and where its limits are.

KanthorD does not implement the agent loop itself. It embeds [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) (`@earendil-works/pi-coding-agent` 0.86.0) as the runtime. pi supplies the loop, the built-in tools, the session file and the resume. KanthorD supplies the configuration, the credentials, the prompt, the tool set and the budget. KanthorD builds only what pi does not serve.

## The two agents

The agent catalog is static and holds two declarations. An agent name names a role, not a worker.

| Agent   | Role              | Built-in tools                                     | Host tools        | Used by                    |
| ------- | ----------------- | -------------------------------------------------- | ----------------- | -------------------------- |
| `swe@1` | Software engineer | `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash` | `evidence-upload` | Worker `general@1`, the Workbench |
| `re@1`  | Reviewer          | `read`, `grep`, `find`, `ls`                       | none              | Worker `reviewer@1`, the Workbench |

`re@1` has no tool that writes a file or runs a command. Its prompt also forbids a change to the repository. The tool set enforces that rule; the prompt only states it.

Each declaration holds a shipped agent prompt and its tool set. A declaration holds no provider, no model and no reasoning effort. A human selects those values.

## Two consumers

The Agent component belongs to no service. A consumer opens an agent session for its own purpose, under its own authority:

- **Worker execution.** A Worker execution of `general@1` or `reviewer@1` opens a session to do or to judge the work of one node. No human is present during the run.
- **Workbench session.** A human opens a session from the dashboard and talks to the agent. The agent can call KanthorD operations for the human.

Both consumers use the same open path. They differ in the prompt, the tools, the budget and the session storage.

## From configuration to a running session

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#f5f5f5", "primaryTextColor": "#2d3142", "actorBkg": "#f5f5f5", "actorBorder": "#4f5d75", "actorTextColor": "#2d3142", "actorLineColor": "#bfc0c0", "signalColor": "#4f5d75", "signalTextColor": "#2d3142", "noteBkgColor": "#ececec", "noteBorderColor": "#bfc0c0", "noteTextColor": "#2d3142", "activationBkgColor": "#fbeae1", "activationBorderColor": "#eb6c36"}, "themeCSS": "& { background-color: #f5f5f5; }", "sequence": {"mirrorActors": false, "useMaxWidth": false}}}%%
sequenceDiagram
    accTitle: Opening a native agent session
    accDescr: A consumer resolves the effective configuration, builds a model runtime from a credential, composes the prompt, selects the tools and opens a pi agent session.
    autonumber
    participant C as Consumer<br/>(Worker / Workbench)
    participant A as Agent component
    participant L as LLM component
    participant P as pi runtime

    C->>A: Resolve effective configuration
    A-->>C: agentProvider, provider, credential,<br/>modelIdentifier, reasoningEffort
    C->>L: Build model runtime (credential, configuration)
    L-->>C: Model runtime and model,<br/>or setup refusal
    C->>C: Compose system prompt and pinned layers
    C->>C: Select tools from the declaration
    C->>P: createAgentSession(cwd, model, tools, prompt, hooks)
    P-->>C: Agent session
    Note over C,P: Each setup step has a 30-second deadline
```

### Effective configuration

An agent is usable only when a human enables it. The **agent enablement** is global to the server and keyed by agent name. It holds:

- One or more **agent providers**. Each one pairs a provider platform, for example `anthropic` or `openai-compatible`, with one credential.
- One **default configuration**: an agent provider, a model identifier and a reasoning effort.

A consumer can supply an **entry** that overrides any of these three fields. A Worker execution takes the entry from its worker binding. A Workbench session takes the values that the human picked. The Agent component merges the entry over the default and validates the whole result:

- The agent provider exists in the enablement.
- Custody accepts the credential for the platform.
- The model belongs to the built-in model list of the platform. For `openai-compatible`, the model belongs to the approved models of the credential.
- The reasoning effort is one of the levels that the model supports.

The same check runs at enablement write, at worker binding write and at resolution. A configuration that passes once can therefore fail later only when a human changes the enablement or the credential. An enablement change that breaks a worker binding is refused, so that case does not occur in practice. Disablement is the only stop switch: it refuses every later resolution.

### Model runtime

The LLM component turns the effective configuration into a pi `ModelRuntime` and one model:

- The runtime reads secrets through a credential store that custody hands over for this one session. The agent never sees the secret as a value.
- The runtime makes no network call to refresh model lists (`allowModelNetwork: false`). The model must already be known.
- For `openai-compatible`, KanthorD registers a provider from the credential metadata: its base URL, its models and the reasoning levels of each model. These models use the OpenAI Responses API and report zero cost.
- Some platforms need extra values, for example `AWS_REGION` for Amazon Bedrock. KanthorD takes these values from the credential metadata, not from the server environment.

The runtime refuses the setup when the credential does not match the configuration or when the model or the effort is unknown. The refusal reasons are `credential_absent`, `credential_revision_mismatch`, `model_unknown` and `reasoning_effort_unsupported`.

### Isolation from the host pi installation

The host can have its own pi installation with extensions, skills and settings. The native agent ignores all of them:

- pi runs with its own agent directory, `~/.local/state/kanthord/pi`, through `PI_CODING_AGENT_DIR`.
- pi runs offline (`PI_OFFLINE=1`), with telemetry and analytics off.
- The session loads no extension, no skill, no prompt template, no theme and no context file. KanthorD supplies the system prompt and its own hooks only.
- The system prompt shows the working directory relative to the home directory, for example `~/work/repo`, not the absolute path.

## The prompt

The prompt of a native agent has three **layers**: the system layer, the agent layer and the working layer. Each layer joins an ordered list of **sources**. Each source has one on/off switch, and the composer joins every source that is on, present and valid. No source has a merge or override mode: to replace a shipped text, switch it off and switch your own source on.

Each source reaches the model inside a `<prompt-layer>` tag that names the layer, the owner and the source. For example, the host agent file on a host without other configuration reads:

```text
<prompt-layer name="system layer" owner="operator of the server" source="file ~/.claude/CLAUDE.md">
…the text of the file…
</prompt-layer>
```

### The three layers and their sources

| Layer | Sources, in order | Origin | Switches belong to |
| ----- | ----------------- | ------ | ------------------ |
| System | Host agent file, then the shipped `base.md`, then the custom system prompt | file, binary, database | The server |
| Agent | `<agentName>.md` of the agent directory, then the shipped agent prompt, then the custom agent prompt | file, binary, database | The agent name |
| Working | `AGENTS.md`, `AGENTS.local.md`, `CLAUDE.md`, `CLAUDE.local.md` of the working directory, then the shipped consumer prompt, then the custom working prompt | file, binary, database | The repository binding or the agent name |

- **Host agent file.** When `agent.prompt.systemFile` in `~/.config/kanthord/kanthord.yaml` names a file, the host agent file is that file. Otherwise KanthorD takes the first of `~/.agents/AGENTS.md` and `~/.claude/CLAUDE.md` that exists. A relative path resolves against `~/.local/share/kanthord`.
- **Agent directory.** `agent.prompt.agentDirectory` names a directory, for example `~/workdir`. The agent layer of `swe@1` then reads `~/workdir/swe@1.md`.
- **Shipped prompts.** `base.md`, `swe@1.md`, `re@1.md` and `workbench.md` are embedded in the binary. No command downloads them, and an upgrade replaces them together with the code that depends on them.
- **Custom prompts.** A human writes the custom system, agent and workbench prompts through `agent.prompt.put`, and sets a switch through `agent.prompt.switch`. The database table `agent_prompt` holds one row per scope with its switches, its custom text and a revision.
- **Working directory.** It is the workspace of a Worker execution, or `~/.local/state/kanthord/workbench/<agentName>` for a Workbench session.
- **Working layer of a Worker execution.** It joins the four files of the workspace, then the `projectPrompt` of the repository binding. It has no shipped prompt. The binding holds its five switches in `working_layer`, and a switch change creates a binding revision.
- **Working layer of a Workbench session.** It joins the four files of the workbench directory, the shipped `workbench.md`, then the custom workbench prompt.

Every switch defaults to on. On a host with `~/.claude/CLAUDE.md`, the system layer therefore holds that file and the shipped `base.md`. Switch one of them off when the two repeat each other.

### The order that the model reads

The model reads the prompt from top to bottom:

| # | Part | Worker execution | Workbench session |
| - | ---- | ---------------- | ----------------- |
| 1 | System prompt | Framing | Framing |
| 2 | System prompt | System layer | System layer |
| 3 | System prompt | Agent layer | Agent layer |
| 4 | Pinned message | Working layer | Working layer |
| 5 | Pinned message | Work prompt | — |
| 6 | Conversation | Instructions and replies | Human messages and replies |

The framing is a fixed paragraph that states the precedence. The **work prompt** is the task message of a Worker execution: the name, the requirement, the criterion and the verification commands of one pinned node revision. It belongs to no layer and has no switch.

### Precedence

The position of a layer is not its authority. The framing states the precedence, from highest to lowest:

- Worker execution: agent layer, system layer, work prompt, working layer.
- Workbench session: agent layer, system layer, working layer.

A layer of higher precedence governs a layer of lower precedence. No layer revokes an obligation of the agent layer or the system layer. The working layer comes last because it comes from the repository, and the candidate under review can write it. No layer authorizes an operation: the tool set and the authority of the consumer decide what the agent can do.

### Where each layer is composed

The server composes the system layer and the agent layer for every consumer. A Worker execution receives them as `prompt.final` in its execution setup. The worker application reads no home file. It reads only the agent files of its own workspace, with the switches of `repositories[].working_layer`, and adds the `projectPrompt`. An evaluation reads no file of the workspace, because the candidate under review wrote those files.

### Reading the composed prompt

`agent.get` answers every source of the three layers with its origin (`binary`, `file` or `database`), its path, its switch, its state, its digest and its text, plus the final prompt:

- The state is one of `present`, `absent`, `invalid`, `off` and `deferred`.
- `deferred` marks a workspace file that only the worker application reads.
- The query `view=final` answers the final prompt only.
- The queries `projectId` and `bindingId` select the working layer of one repository binding. Without them, the working layer is the workbench working layer of the agent.

### Limits of a source

KanthorD rejects a source that is larger than 32 KiB, that is not UTF-8, that holds control characters, that is not a regular file, that lies outside its working directory, or that takes longer than 10 seconds to read. A rejected source adds no text, and the composer continues with the next source. The **composition record** lists every selected source with its SHA-256 digest and every rejected source with its reason.

### Why the working layer is pinned

The working layer and the work prompt are **pinned**. Before each model call, a pi `context` hook inserts them as messages directly after the system prompt. A second guard on the stream function re-inserts any pinned text that is missing from the request.

Pinning has two effects. A pinned text survives when pi compacts a long conversation, because KanthorD inserts it again on each call. The work prompt can also change between tasks without a new session: each `prompt` or `instruct` call sets the current work, and the next model call carries it.

## Tools

The agent receives only the tools of its declaration. A tool outside the allowlist does not exist for the agent.

- **Built-in tools** are the pi tools `read`, `edit`, `write`, `grep`, `find`, `ls` and `bash`. They act on the working directory. `grep` and `find` need `rg` and `fd` on the host; the worker refuses to start without them.
- **`bash`** runs commands on the host, as the user of the KanthorD process. KanthorD removes every provider API key from the environment of each command, so a command cannot read the credentials of the agent. In a Worker execution, the timeout of each command is capped at the remaining budget.
- **`evidence-upload`** (`swe@1` in a Worker execution) uploads a workspace file as evidence of the attempt and returns its `evidenceId`, `assetId` and `uri`.
- **Operation tools** (Workbench only) expose KanthorD operations. Each call runs with the identity of the human who sent the last message. The [operation tool reference](../reference/workbench/tools.md) lists every tool.

An operation becomes a tool when it meets all of these conditions:

- Its access is `human`. A worker or machine operation is never a tool.
- It is not a stream.
- It handles no secret.

The tool name is the operation id with each `.` replaced by `--`, for example `mission--node--create`.

These ten human operations handle a secret, so the agent cannot call them:

- `llm.credential.create`, `llm.credential.rotate`, `llm.credential.check`, `llm.credential.login_code`
- `repository.credential.create`, `repository.credential.rotate`, `repository.credential.check`
- `storage.credential.create`, `storage.credential.rotate`, `storage.credential.check`

The agent therefore cannot create a credential, change a secret, or finish an OAuth login. A human does that in the dashboard or the CLI.

A Workbench operation tool that changes state waits for the human. The dashboard shows the pending call, and the human approves or rejects it. A rejection, an abort or the end of the run counts as a rejection. A read operation and a built-in tool run without approval. A Worker execution has no approval step, because no human is present.

## A session inside a Worker execution

A Worker execution opens one session per claim, in a workspace that the worker prepares. The worker method then drives the session with two calls:

- `prompt(work)` sends the work prompt as the user message.
- `instruct(work, text)` pins the work prompt and sends another instruction, for example a revision request.

After each call, the worker reads the last reply of the agent. The worker, not the agent, decides when the work is done.

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#f5f5f5", "primaryColor": "#ffffff", "primaryTextColor": "#2d3142", "primaryBorderColor": "#4f5d75", "secondaryColor": "#ececec", "tertiaryColor": "#f5f5f5", "lineColor": "#4f5d75", "edgeLabelBackground": "#f5f5f5", "fontFamily": "system-ui, sans-serif", "fontSize": "14px"}, "flowchart": {"htmlLabels": true, "useMaxWidth": false, "nodeSpacing": 24, "rankSpacing": 40}}}%%
flowchart TB
    accTitle: One task in the steps method
    accDescr: The agent works on the task, the worker commits and runs the verification commands, then asks the agent to judge the criterion. Failure leads to a revision instruction until the budget ends.
    start([Task]) --> work["Agent works on the task<br/>prompt or instruct"]
    work --> commit["Worker commits the workspace"]
    commit --> verify{"Verification<br/>commands pass?"}
    verify -- no --> fix["Revision instruction<br/>with the failed results"] --> work
    verify -- yes --> judge["Agent judges the criterion<br/>JSON judgement"]
    judge --> met{"Criterion met?"}
    met -- no --> revise["Revision instruction<br/>with the rationale"] --> work
    met -- yes --> done([Task complete])
    classDef stop fill:#fbeae1,stroke:#eb6c36,color:#2d3142;
    class done stop;
```

The other methods use the same session with a single call:

- **Evaluation** (`re@1`). The worker runs the verification commands first. A failure ends the evaluation without the agent. On success, the agent receives the evidence and returns a JSON judgement.
- **Initiative report** (`swe@1`). When every objective of an initiative ends, the agent writes a report from the objectives, the outcomes and the evidence. The worker stores the report as evidence.

An agent reply that does not parse as the expected judgement ends the execution with `judgement_invalid`.

### Budget

Each native worker has a resource budget of 200 turns and 2 hours of wall time. The wall deadline is also capped by the expiry of the claim. When the budget ends:

- pi stops after the current turn, and KanthorD aborts the session.
- Each later `bash` command is refused.
- The worker method stops and releases or ends the execution.

A cancellation of the execution, for example a server shutdown, also aborts the session.

## A session inside the Workbench

A Workbench session is a conversation between one human and one agent, stored as a pi JSONL session file:

- The working directory is `~/.local/state/kanthord/workbench/<agentName>`.
- The session files live under `~/.local/state/kanthord/pi/sessions/workbench/<agentName>`.
- The session identity that KanthorD assigns is also the pi session id.

KanthorD keeps no copy of the conversation. The session list, the history and the resume all come from pi. When the server restarts, KanthorD reopens the file by its session id; every completed turn is restored, and a turn that was running at the restart is lost. The session also answers a `pi --session <file>` command, so a human can continue the same conversation in a terminal.

The human can change the agent provider, the model and the reasoning effort between runs. KanthorD writes each change into the session file as a pi entry, so the file records which model answered which turn.

## Limitations

- **No resume for a Worker execution.** A Worker execution keeps its session in memory. When the worker process ends, the conversation is lost, and a new attempt starts a new session.
- **No transcript storage.** The worker hands the transcript of each execution to a transcript sink at the end. The current sink discards it.
- **No sandbox.** `bash` and the file tools run on the host with the rights of the KanthorD process. The tool set of `re@1` limits what the reviewer can do. The working directory of `swe@1` is only its default location, not a boundary.
- **No approval in a Worker execution.** Only the Workbench asks a human before a call that changes state.
- **Static catalog.** A new agent or a change of a tool set requires a new KanthorD release. A prompt change does not: the agent directory and the custom prompts override the shipped text.
