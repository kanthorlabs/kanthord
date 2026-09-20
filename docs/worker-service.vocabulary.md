---
title: Worker Service Vocabulary
---

# Worker Service Vocabulary

This file holds the values and the examples of the terms that [worker-service.md](viewer.html?p=worker-service.md) owns.
A product term lives in [overview.vocabulary.md](viewer.html?p=overview.vocabulary.md).
This file is not a design document, and `worker-service.md` stays the single source of truth.

## worker

The overview owns the term.
This revision of the Worker Service supplies four workers.

- **general@1**: the steps method with the native agent `swe@1`.
- **reviewer@1**: the evaluation method with the native agent `re@1`.
- **claude@1**: hosted by the external harness `claude-code`, declares `Available`, `Waiting` and `External.Requested`.
- **opencode@1**: hosted by the external harness `opencode`, declares `Available`, `Waiting` and `External.Requested`.

## host

The host of a worker is the system that runs the instances of the worker.
The set is closed and it holds two values.

- **the daemon**
- **an external harness**

`general@1` and `reviewer@1` have the daemon as their host.
`claude@1` has the external harness `claude-code` as its host, and `opencode@1` has the external harness `opencode`.

## steps method

The steps method is the method of a worker whose executions carry out the steps of a node.
`general@1` holds the steps method.
A `general@1` instance of worker binding `general-main` claims "Add password reset" from `Available`.
Its execution takes the three tasks of the pinned revision in the order of the revision, commits the work of each task on the node branch, and releases with no further work.

## evaluation method

The evaluation method is the method of a worker whose executions evaluate a node and request its required external actions.
`reviewer@1` holds the evaluation method.
A `reviewer@1` instance claims "Add password reset" from `Waiting`, checks out the commit that the objective evidence names in a fresh workspace, runs the verification command, records its result as produced evidence and writes the assessment.
A later `reviewer@1` instance claims the same objective from `External.Requested` and evaluates nothing.
The action performer requests the unrequested action whose predecessor reaches its expected end state, and the reviewer execution releases.
A change request on pull request 42 blocks the objective.
For the reviewer execution of attempt 2, the action performer reuses that pull request because it stays open and fulfils the operands.
The action performer performs the network git write only.

## native agent

A native agent is an agent loop that the Worker Service runs itself.
The agent `swe@1` of `general@1` and the agent `re@1` of `reviewer@1` are native agents.
The Worker Service runs the agent loop of `swe@1` and sends each model inference call through the model connector with the provider account, the model identifier and the reasoning effort of the effective configuration of the agent under worker binding `general-main`.

## prompt layer

A prompt layer is one part of the prompt of a native agent, and it has one owner.
The set is closed and it holds five values.

- **global prompt**: the operator of the daemon owns it.
- **base prompt**: the worker that declares the agent owns it, and it holds for every agent that uses it.
- **agent prompt**: the worker that declares the agent owns it.
- **project prompt**: the project that binds the repository owns it.
- **work prompt**: the node revision that the attempt pins owns it.

The global prompt of the daemon states "Every answer is short. A commit message states the change and no reason."
`general@1` and `reviewer@1` declare one base prompt for `swe@1` and `re@1`, which describes a senior software engineer, and its text is `assets/prompt/base.md`.
`general@1` declares the agent prompt of `swe@1`, `assets/prompt/swe@1.md`, and `reviewer@1` declares the agent prompt of `re@1`, `assets/prompt/re@1.md`.
`reviewer@1` declares the agent prompt of `re@1`, which states that the agent judges evidence against criteria and changes no file of the repository.
The repository binding of `kanthorlabs/kanthord` holds the project prompt "The work product is TypeScript. A test file sits beside its source file."
The work prompt of task "Add reset token expiry" states its goal, its steps and its validation criteria.
`general@2` declares another agent prompt for `swe@1`, because a change to an agent prompt is a new worker version.

## prompt source

A prompt source is one origin of the text of a prompt layer.
The global prompt and the project prompt each hold an ordered list, and the set of each list is closed.

- global prompt: **the configuration of the daemon**, then **the agent file of the host**.
- project prompt: **the repository binding**, then **the agent file of the workspace**.

The base prompt and the agent prompt each take the declaration of their worker, and the work prompt takes the pinned node revision.
The daemon holds no configured global prompt and the host holds an agent file, so the global prompt takes that file.
The daemon holds a configured global prompt and the host holds an agent file.
The global prompt takes the configuration, and the composer reads no file.
The repository binding of `kanthorlabs/kanthord` holds no project prompt and the workspace holds an agent file, so the project prompt takes that file.
The workspace holds an agent file that exceeds the bound, so that source is invalid and the project prompt is absent.
The configuration of the global prompt holds the value that disables the layer, so the composer reads no agent file of the host.

## agent file

An agent file is a convention file that an agent harness reads by convention.
The set is closed and it holds two values.

- **AGENTS.md**
- **CLAUDE.md**

The host of the daemon holds both files.
The workspace root of `kanthorlabs/kanthord` holds `AGENTS.md` only.

## prompt composer

The prompt composer is the Worker Service component that produces the prompt of a native agent.
The term names no closed set.
The composer of Execution 1 on "Add password reset" resolves five layers.
It takes the global prompt from the agent file of the host.
It takes the base prompt and the agent prompt from the declaration of `general@1`.
It takes the project prompt from the repository binding of `kanthorlabs/kanthord`.
It takes the work prompt from task "Add reset token expiry".
It reads no agent file of the workspace, because the repository binding supplies the project prompt.
The reviewer execution of the same objective composes the project prompt from that repository binding, and it reads no agent file of the workspace.

## default configuration

The default configuration is the configuration of an agent that its worker declares, with the options that a project can override and the constraint that a whole configuration satisfies, and it is part of the contract of the worker name.
`general@1` declares for its agent the provider `openai`, a cheap model identifier and the reasoning effort `medium`.
A change to a default configuration is a new worker version.

## connector

A connector is a Worker Service component through which a caller performs an authenticated operation that the Project Service authorizes.
The set is closed and it holds three values.

- **model connector**: performs a model inference call.
- **repository connector**: performs a network git read and a network git write.
- **platform connector**: performs every operation on the API of an external platform through the platform implementation of that platform.

Execution 1 of "Add password reset" asks the repository connector to push the node branch.
The connector resolves the repository binding of the objective through the Project Service under the execution identity of Execution 1, and the protected facility consults custody after the check.

The action performer asks the platform connector to open pull request 42 for the node branch of "Add password reset".
The platform connector selects the GitHub implementation because the repository binding of the objective names GitHub.
The GitHub implementation resolves the binding through the Project Service under the execution identity before the call.

## platform implementation

A platform implementation exposes the operations of its platform under the names and the parameters of that platform.
The set is open.
The first version holds one value.

- **GitHub implementation**

The GitHub implementation exposes the operations of GitHub.
For example, it opens a pull request, reads a pull request and lists the review comments of a pull request.
It derives the owner `kanthorlabs` and the repository `kanthord` from the repository binding.
A caller supplies neither resource selector.

## action performer

The action performer requests the required external actions of one attempt for every reviewer execution, whichever harness hosts it.
Its callers form a closed set of two values.

- **evaluation method of reviewer@1**
- **MCP tool of an external harness**

The reviewer execution of `reviewer@1` evaluates "Add password reset" with agent `re@1`.
Its evaluation method passes only the execution identity to the action performer, which opens pull request 42.
The reviewer execution of external harness `claude-code` invokes the same action performer through its MCP tool for "Add password reset".
It passes only its execution identity.
The action performer derives node branch `kanthord/obj-7f3a` and base branch `main` from the records, without operands from either caller.
A second invocation under the same claim dispatches nothing when the first dispatch remains unresolved.

## return class

A return class identifies one kind of item that the action performer returns.
The set is closed and holds four values.

- **submitted external objects**
- **actions that await a prerequisite**, with the observation that each one follows
- **actions whose request fails before any effect**, with the refusal
- **actions whose effect or recording is uncertain**

For "Add password reset", the action performer submits pull request 42 as an external object and returns that external object.
For "Add password reset", a second action awaits the merge observation of pull request 42 and returns that observation as its wait fact.
For "Add password reset", the platform refuses an action for authorization before any effect, and the action performer returns the refusal.
For "Add password reset", the platform response fails to arrive after dispatch, and the action performer returns the action with an uncertain effect.
Only the prerequisite class carries a wait fact.

## result class

A result class identifies the outcome that a platform call reports when it does not succeed.
A call that succeeds returns the result of the operation and no result class.
The set is closed and holds four values.

- **confirmed failure that establishes no effect**
- **retryable refusal that establishes no effect**
- **final refusal**
- **unknown outcome**

A GitHub call fails before dispatch and confirms no effect.
GitHub refuses a read of pull request 42 because of a rate limit, with no effect, and permits a retry.
GitHub refuses a call to open pull request 42 because authorization fails, and the call returns a final refusal.
A GitHub call to open pull request 42 loses its response after dispatch, so the implementation reports an unknown outcome.

## MCP server

The MCP server is the daemon component that exposes tools as one form of the API.
The daemon runs one MCP server.
Its client kinds form a closed set of two values.

- **native agent**, under the execution identity of its hosted execution
- **external harness**, under its client identity, client secret and the execution identity of its live claim

Each tool maps to one method of a platform implementation or to the action performer.
The MCP server exposes individually approved resource-scoped read methods and the tool of the action performer.
It exposes the tool of the action performer to an external harness only.
It exposes no other write.
The external harness `claude-code` authenticates with client identity `claude-code-main` and its client secret.
It presents the execution identity of its evaluation claim on "Add password reset" and calls the tool of the action performer.
The MCP server exposes the read of pull request 42 and the list of its review comments to that external harness.
It exposes no direct platform write.

## runtime identity

The runtime identity is the identity that the Worker Service mints for a worker instance and that names its worker binding.
The Worker Service creates two instances for worker binding `general-main`, whose instance count is 2, and mints a runtime identity for each one.
A daemon restart creates two new instances with two new runtime identities.
A revision of `general-main` that changes the model identifier of its entry replaces no instance.

## pool

The pool is the instances of one worker binding.
The pool of worker binding `general-main` holds two instances.
Both are idle, both pull, and the Scheduler serves "Add password reset" to the first pull.
The second instance keeps its pull outstanding and starts no other pull.

## compatibility declarations

The compatibility declarations are the worker name, the declared node states and the required node format that an instance carries on a work pull.
An instance of `general@1` carries the worker name `general@1`, the declared node state `Available` and the required node format.
An instance of `reviewer@1` carries the worker name `reviewer@1`, the declared node states `Waiting` and `External.Requested` and the required node format.

## required node format

The required node format is the fields of a node that a method requires.
Every worker of this page requires the same format, and the set is closed.

- the goal
- the steps
- the validation criteria

The verification command is an optional field, and a method reads it when the node carries it.

## instance healthcheck

The [Scheduler Service](scheduler-service.vocabulary.md#instance-healthcheck) owns the term, and the Worker Service produces the check.
The instance of `general@1` passes: the effective configuration of its agent resolves under the binding set of the project with the default account of its provider, and a native agent requires no program on the host.
The instance of `general@1` fails when the project holds no default account for the provider of the agent and no entry names one.
The instance of `claude@1` fails when its client identity is not a client identity of its binding.

## trust boundary

The trust boundary is the containment that the operator provides, and the Worker Service runs the tool of an agent and the verification command of a node inside it.
The term names no closed set.
The verification command of "Add password reset" comes from the repository `kanthorlabs/kanthord`, so it runs inside the boundary and reaches no resource of another project.

## workspace

A workspace is the host-local working directory of one execution.
The workspace of Execution 1 on "Add password reset" is a checkout of `kanthorlabs/kanthord` on the node branch, under the workspace root of the daemon, keyed by the objective and its repository binding.
Execution 3 of the same objective under the same repository binding reuses it, and the Worker Service removes it after the bounded retention.
The reviewer execution of the objective uses a fresh workspace with a clean checkout of the repository snapshot, and the Worker Service removes it at the release.
The execution of "Account recovery" uses a workspace with no checkout, and its agent writes the report there.

## node branch

The node branch is the branch that the steps method uses for one objective in one repository across its attempts.
The node branch of "Add password reset" takes its name from the node identity, for example `kanthord/obj-7f3a`.
Attempt 1 and attempt 2 both work on that branch.
A revision of the objective that names another repository binding starts a new node branch in that repository.

## task commit

The task commit is the head of the node branch after the last commit of the task work in the attempt that executed the task.
Task "Add reset token expiry" of "Add password reset" ends with two commits on the node branch: the commit of the first task work and the commit of the revision after the first verification failed, and the second one is the task commit.
That commit is the evidence of the task outcome, and the task assessment names it with the tested input that the verification ran against.

## checkpoint commit

A checkpoint commit is the commit of the task work in progress that the execution makes before a release with further work.
The resource budget of Execution 1 ends while task "Add reset token expiry" is half done, so the execution commits the changed files as a checkpoint commit, pushes the node branch and releases with further work.
Execution 2 continues the task from that commit, and the task holds no outcome until Execution 2 records one.

## resource budget

The resource budget is the bound that a worker fixes on one execution: a turn count and a wall time.
`general@1` fixes a bound on the turns of its agent and the wall time of one execution, for example 200 turns and 2 hours.
`claude@1` fixes no resource budget, because the external harness hosts its executions.
The values are illustrations, and the implementation epics set the configured values.

## lease renewal interval

The execution renews its lease at a fixed interval shorter than the lease expiry, for example every 30 seconds against a lease of 2 minutes.
The values are illustrations, and the implementation epics set the configured values.
