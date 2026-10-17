---
title: Worker Service Vocabulary
---

# Worker Service Vocabulary

This file holds the values and the examples of the terms that [worker-service.md](worker-service.md) owns.
A product term lives in [overview.vocabulary.md](overview.vocabulary.md).
This file is not a design document, and `worker-service.md` stays the single source of truth.

## worker

The overview owns the term.
This revision of the Worker Service supplies three workers.

- **coder@1**: the steps method with the native agent `swe@1`.
- **reviewer@1**: the evaluation method with the native agent `re@1`.
- **claude-code@1**: hosted by the external harness `claude-code`, declares `Available`, `Waiting` and `External.Requested`.

## host

The host of a worker is the system that runs the instances of the worker.
The set is closed and it holds two values.

- **kanthord**
- **an external harness**

`coder@1` and `reviewer@1` have kanthord as their host.
`claude-code@1` has the external harness `claude-code` as its host.

## placement

The placement of an instance is the application of kanthord that runs it.
A worker binding of a worker that kanthord hosts states the placement of all its instances.
The set is closed and it holds two values.

- **`server`**, which runs the instance in a worker thread of the `server` application
- **`worker`**, which runs the instance inside a `worker` application

Both placements run the same [worker unit](#worker-unit) inside the same worker boundary.
The placement changes the [placement wrapper](#placement-wrapper) and the [worker transport](#worker-transport) only.
Worker binding `coder-main` holds `placement: server` and instance count 2, so the `server` application runs two instances of `coder@1`.
Worker binding `coder-remote` holds `placement: worker`, so each instance of `coder@1` runs in its own `kanthord serve worker` process.
An instance that an external harness hosts holds no placement, because kanthord runs it never.

## worker unit

The worker unit is the application code that hosts one instance.
It owns the registration, the heartbeat, the work pulls and the executions of the instance.
It also owns the workspace, the pi tools, the transcripts and the log of the instance.
It is the same code at both placements, and it holds no branch on its placement.
The instance of `coder-main` and the instance of `coder-remote` run the same worker unit.

## placement wrapper

The placement wrapper is the code that starts a worker unit at one placement.
It gives the worker unit its transport, its directories, its environment and its client secret.
The set is closed and it holds two values.

- **`worker` wrapper**, the `kanthord serve worker` process, which reads `cli.yaml` and builds the HTTP transport
- **`server` wrapper**, the pool host of the `server` application, which starts one worker thread for each started pool slot

## worker transport

The worker transport is the one object through which a worker unit reaches kanthord.
It reaches only the operations that the published API routes.
The invocation chain refuses each operation that the machine identity of the instance may not call.
The set is closed and it holds two values.

- **HTTP transport**, which sends each call to the RESTful API with the machine JWT of the instance
- **port transport**, which sends each call over the message port of a worker thread to the Gateway invocation chain

Both transports reach the same invocation chain, so a call answers the same result and the same refusal on both.
The instance of `coder-main` calls `scheduler.work.pull` over the port transport.
The instance of `coder-remote` calls the same operation over the HTTP transport.

## steps method

The steps method is the method of a worker whose executions carry out the steps of a node.
`coder@1` holds the steps method.
A `coder@1` instance of worker binding `coder-main` claims "Add password reset" from `Available`.
Its execution takes the three tasks of the pinned revision in the order of the revision, commits the work of each task on the node branch, and releases with no further work.
A `coder@1` instance claims the `examine` node "Account recovery" from `Available`.
Its execution writes the report on the outcomes of the direct dependencies, submits it as produced evidence and releases with no further work.

## evaluation method

The evaluation method is the method of a worker whose executions evaluate a node and request its required external actions.
`reviewer@1` holds the evaluation method.
A `reviewer@1` instance claims "Add password reset" from `Waiting`.
It checks out the commit that the evidence of the node names in a fresh workspace.
It runs the verifications, records their results as produced evidence and writes the assessment.
A later `reviewer@1` instance claims the same node from `External.Requested` and evaluates nothing.
The action performer requests the unrequested action whose predecessor reaches its expected end state, and the reviewer execution releases.
A change request on pull request 42 blocks the node.
For the reviewer execution of attempt 2, the action performer reuses that pull request because it stays open and fulfils the operands.
The action performer performs the network git write only.

## native agent

A native agent is an agent loop that the Worker Service runs itself.
The agent `swe@1` of `coder@1` and the agent `re@1` of `reviewer@1` are native agents.
The Worker Service runs `swe@1` under worker binding `coder-main`.
Each model inference call uses the model [connector](architecture.vocabulary.md#connector) and the agent's effective configuration.

## prompt layer

A prompt layer is one part of the prompt of a native agent, and it has one owner.
The set is closed and it holds four values.

- **system layer**: the operator of the server owns it, and it holds for every agent of the server. The [Agent component](agent.vocabulary.md#system-layer) defines it.
- **agent prompt**: the worker that declares the agent owns it.
- **project prompt**: the project that binds the repository owns it.
- **workbench prompt**: the [Workbench Service](workbench-service.md#prompt) owns it, and it holds for every workbench session.

The custom system prompt of the server states "Every answer is short. A commit message states the change and no reason."
The shipped `base.md` of the system layer describes a senior software engineer.
`coder@1` declares the agent prompt of `swe@1`, `assets/prompt/swe@1.md`, and `reviewer@1` declares the agent prompt of `re@1`, `assets/prompt/re@1.md`.
`reviewer@1` declares the agent prompt of `re@1`.
The prompt states that the agent judges evidence against the criterion and changes no file of the repository.
The repository binding of `kanthorlabs/kanthord` holds the project prompt "The work product is TypeScript. A test file sits beside its source file."
The catalog holds one prompt declaration for `swe@1`, and `coder@1` references that declaration.

## work prompt

The task message that a consumer sends to an agent session. The node revision that the attempt pins owns it.
It belongs to no prompt layer, and it holds no switch.
The term names no closed set.
The work prompt of task "Add reset token expiry" states its requirement, its criterion and its verifications.

## prompt source

A prompt source is one origin of the text of a prompt layer.
The system layer, the agent prompt and the project prompt each hold an ordered list, and the set of each list is closed.

- system layer: **the agent file of the host**, then **the shipped `base.md`**, then **the custom system prompt**. The composer joins every source that is on.
- agent prompt: **the agent file of the agent directory**, then **the shipped agent prompt**, then **the custom agent prompt**. The composer joins every source that is on.
- project prompt: **the agent files of the workspace**, then **the repository binding**. The composer joins every source that is on.

The work prompt takes the pinned node revision.
The agent file of the host and the custom system prompt are on, and `base.md` is off, so the system layer holds that file and then the custom system prompt.
The repository binding of `kanthorlabs/kanthord` holds no project prompt and the workspace holds an agent file, so the project prompt takes that file.
The workspace holds an agent file that exceeds the bound, so that source is invalid and adds no text.
The switch of the agent file of the host is off, so the composer reads no agent file of the host.

## agent file

An agent file is a convention file that an agent harness reads by convention.
The set is closed and it holds four values.

- **AGENTS.md**
- **AGENTS.local.md**
- **CLAUDE.md**
- **CLAUDE.local.md**

Host discovery reads `AGENTS.md` and `CLAUDE.md` only.
The working directory of `kanthorlabs/kanthord` holds `AGENTS.md` and `CLAUDE.local.md`.
A fresh clone of that repository holds `AGENTS.md` only, because git ignores `CLAUDE.local.md`.

## prompt composer

The prompt composer is the Worker Service component that produces the prompt of a native agent.
The term names no closed set.
The composer of Execution 1 on "Add password reset" resolves three layers and pins the work prompt.
It takes the system layer from the agent file of the host and the shipped `base.md`.
It takes the agent prompt from the shipped `swe@1.md`.
It takes the project prompt from `AGENTS.md` of the workspace and the repository binding of `kanthorlabs/kanthord`.
It pins the work prompt of task "Add reset token expiry".
The reviewer execution of the same node composes the project prompt from that repository binding, and it reads no agent file of the workspace.

## entry

The optional override of one agent's default configuration inside a worker binding.
The closed form set is:

- **tuning**: `model_identifier`, `reasoning_effort` or both; it keeps the default agent provider and inherits each absent value.
- **complete**: `agent_provider`, `model_identifier` and `reasoning_effort`, all required; it inherits nothing.

`coder-frontier` holds the tuning entry `{ reasoning_effort: "high" }` for `swe@1`.
A complete entry names `{ agent_provider: "atlas-llm", model_identifier: "qwen3-coder", reasoning_effort: "off" }`.
An entry can also hold `fallback_configurations`, a list of at most 7 complete configurations. It replaces the fallback configurations of the enablement whole, and `[]` means no fallback.
An entry that holds only `fallback_configurations` keeps the default configuration as its head.
`coder-solo` holds the entry `{ fallback_configurations: [] }` for `swe@1`, so `swe@1` has no fallback under `coder-solo`.
An entry holds no `options`.

## action performer

The action performer requests the required external actions of one attempt for every reviewer execution, whichever harness hosts it.
Its callers form a closed set of two values.

- **evaluation method of reviewer@1**
- **MCP tool of a native agent or an external harness**

The reviewer execution of `reviewer@1` evaluates "Add password reset" with agent `re@1`.
Its evaluation method passes only the execution identity to the action performer, which opens pull request 42 through the [Repository component](repository.md#write-operations).
The reviewer execution of external harness `claude-code` invokes the same action performer through its MCP tool for "Add password reset".
It passes only its execution identity.
The action performer derives node branch `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV` and base branch `main` from the records, without operands from either caller.
A second invocation under the same claim dispatches nothing when the first dispatch remains unresolved.

## return class

A return class identifies one kind of item that the action performer returns.
The set is closed and holds four values.

- **submitted request evidence**
- **actions that await a prerequisite**, with the request evidence that each one follows
- **actions whose request fails before any effect**, with the refusal
- **actions whose effect or recording is uncertain**

For "Add password reset", the action performer submits pull request 42 as a request evidence and returns that request evidence.
For "Add password reset", a second action awaits the expected end state of pull request 42, and the action performer returns that action with its prerequisite.
For "Add password reset", the platform refuses an action for authorization before any effect, and the action performer returns the refusal.
For "Add password reset", the platform response fails to arrive after dispatch, and the action performer returns the action with an uncertain effect.

## MCP server

The MCP server is the server component that exposes tools as one form of the API.
The server runs one MCP server.
Its client kinds form a closed set of two values.

- **native agent**, under the machine identity of its instance and the execution identity of its live claim
- **external harness**, under the credential of its client identity and the execution identity of its live claim

Each tool maps to one method of a [platform implementation](repository.vocabulary.md#platform-implementation) of the Repository component or to the action performer.
The MCP server exposes individually approved resource-scoped read methods and the tool of the action performer.
It exposes the same tools to every client, and no state of a claim or of an assessment changes the list.
It exposes no other write.
The external harness `claude-code` authenticates with the JWT of its client identity `client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X6`.
It presents the execution identity of its evaluation claim on "Add password reset" and calls the tool of the action performer.
The MCP server exposes the read of pull request 42 and the list of its review comments to that external harness.
It exposes no direct platform write.

## runtime identity

The runtime identity is the identity that the Worker Service mints for a worker instance and that names its worker binding.
Worker binding `coder-main` holds the `server` placement and instance count 2.
The `server` application starts two instances, and each one registers and receives its runtime identity.
A server restart starts the two instances again under the same two client identities.
A registration that is still live resumes with its runtime identity.
A revision of `coder-main` that changes the model identifier of its entry replaces no instance.

## heartbeat

The signal that a registered instance sends to keep its registration live.
The set of signals that count as a heartbeat is closed.

- A work pull.
- An execution operation.
- An MCP request.
- An explicit heartbeat request.

The `claude-code` instance of worker binding `claude-main` pulls work every 60 s while idle, so every pull is its heartbeat.
While it runs a 20-minute MCP tool call, it sends an explicit heartbeat request.
When the laptop of Ulrich sleeps, no heartbeat arrives inside the window, and the registration ends.
A restart of `claude-code` therefore registers again.

## pool

The pool is the instances of one worker binding.
The pool of worker binding `coder-main` holds two instances.
Both are idle, both pull, and the Scheduler serves "Add password reset" to the first pull.
The second instance keeps its pull outstanding and starts no other pull.

## pool slot

A pool slot is one unit of the instance count of a worker binding at the `server` placement.
A slot holds a slot number from 0 to 63 and one client identity.
The client identity stays the same across server restarts, and a new binding generation gets new ones.
Worker binding `coder-main` with instance count 2 holds slots 0 and 1.
A raise of the count to 3 adds slot 2.

## compatibility declarations

The compatibility declarations are the worker name, the declared node states and the declared works that an instance carries on a work pull.
An instance of `coder@1` carries the worker name `coder@1`, the declared node state `Available` and the declared works `implement` and `examine`.
An instance of `reviewer@1` carries the worker name `reviewer@1`, the declared node states `Waiting` and `External.Requested` and the declared works `implement` and `examine`.

## declared works

The declared works are the values of [work](mission-service.vocabulary.md#work) that the method of a worker takes.
Every worker of this page declares both values.

- **implement**
- **examine**

The [match rule](scheduler-service.md#match) admits a node only when the declared works of the worker hold the work of the node.
`coder@1` declares `implement` and `examine`, so a `coder@1` instance takes the steps claim of "Add password reset" and of "Account recovery".

## instance healthcheck

The [Scheduler Service](scheduler-service.vocabulary.md#instance-healthcheck) owns the term, and the Worker Service produces the check.
The instance of `coder@1` passes when its effective configuration resolves under the current worker binding and enabled agent enablement.
It fails when the `swe@1` enablement is absent or disabled.
The instance of `claude-code@1` fails when its registration is not live.

## trust boundary

The trust boundary is the containment that the operator provides.
The Worker Service runs the tool of an agent and the verifications of a node inside it.
The term names no closed set.
The verifications of "Add password reset" come from the repository `kanthorlabs/kanthord`.
They run inside the boundary and reach no resource of another project.

## workspace

A workspace is the host-local working directory of one execution.
The workspace of Execution 1 on "Add password reset" is a checkout of `kanthorlabs/kanthord` on the node branch, under the workspace root of the server, keyed by the node and its repository binding.
Execution 3 of the same node under the same repository binding reuses it.
The Worker Service removes it after the fixed retention period.
The reviewer execution of the node uses a fresh workspace with a clean checkout of the repository snapshot, and the Worker Service removes it at the release.
The steps execution of the `examine` node "Account recovery" uses a workspace with no checkout, and its agent writes the report there.

## node branch

The node branch is the branch that the steps method uses for one `implement` node in one repository, from the latest attempt that starts from the base branch.
The node branch of "Add password reset" takes its name from the node identity, for example `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV`.
Attempt 1 and attempt 2 both work on that branch when attempt 2 records the start point `node_branch`.
When attempt 2 records the start point `base_branch`, attempt 2 starts the node branch `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV-a2` from the base branch.
A revision of the node that names another repository binding starts a new node branch in that repository.

## task commit

The task commit is the head of the node branch after the last commit of the task work in the attempt that executed the task.
Task "Add reset token expiry" of "Add password reset" ends with two commits on the node branch: the commit of the first task work and the commit of the revision after the first verification failed, and the second one is the task commit.
No record of the Mission Service names that commit.

## checkpoint commit

A checkpoint commit is the commit of the task work in progress that the execution makes before a release with further work.
The resource budget of Execution 1 ends while task "Add reset token expiry" is half done, so the execution commits the changed files as a checkpoint commit, pushes the node branch and releases with further work.
Execution 2 runs the task verifications at the head of the node branch and continues the task from that commit.

## resource budget

The resource budget bounds the agent work of one execution by wall time and, when declared, turn count.
`coder@1` declares 200 turns and 2 hours, and `coder-lab` overrides them with 50 turns and 30 minutes.
`claude-code@1` declares 2 hours of wall time.
The [budget contract](worker-service.impl.md#stop-and-budget) defines measurement and validation.
