---
title: Overview
---

# Overview

## Identity

kanthord is a work orchestration system that organizes requirements, executes steps, and evaluates results.
It represents the WHAT independently of execution because requirements and their criterion remain meaningful across supported harnesses.
Its own harness provides the primary execution mechanism.

## WHAT

Initiative, objective, and task each state a requirement, a criterion and the verifications that check it.
Both harnesses share this WHAT.
The initiatives, the objectives and the tasks of one project form its mission.

Success has three separate parts:

- The WHAT specifies a criterion.
- Execution produces results and evidence.
- Evaluation assesses the evidence against the criterion and produces an outcome.
  It also applies the [default standard](overview.vocabulary.md#default-standard) when the worker declares a base prompt.

The verifications supply machine checks, and the criterion needs judgement.
Completing an execution does not establish success, because evaluation assesses the evidence against the WHAT.

Every initiative, objective, and task must have an outcome.
For both harnesses, every ending at each node produces an outcome.
An outcome can record that evidence establishes that the results do not meet the criterion or the default standard.
It can also record that available evidence cannot establish whether the results meet the criterion.
Neither assessment establishes success.
The outcome records the stopping reason separately from the assessment of evidence.
Stopping execution does not by itself satisfy the outcome requirement.

A human reaches kanthord through the [Gateway Service](gateway-service.md), which authenticates the human and establishes a [human identity](overview.vocabulary.md#human-identity).
Every act of a human carries that identity.

Only a human can override an outcome to make a bypass exception.
A human override produces a new outcome that carries the human assertion.
kanthord keeps the previous outcome as a reference.
A terminal state never reopens and never repeats.
A human override never reaches a terminal node, and follow-up work is a new node.
This authority differs from the human role that carries out steps as the WHO.

## kanthord's own harness

kanthord's own harness supplies workers.
A worker is a template that defines how executions happen.
Each worker provides its own method for the steps that achieve the WHAT.
A worker name has the form `<implementation>@<version>`.
The same name always identifies the same implementation.
`tdd@1` and `general@1` are worker names.
kanthord can add more workers.

The worker supplies the HOW.
It includes methods, agents, tools, memory, and prompts.
The harness mostly uses deterministic methods and predefined processes.
A specific agent or a human participant supplies the WHO and takes responsibility for carrying out the necessary steps.

A project binds each worker that it permits.
A project configures how many instances of each worker binding are available.
A worker instance claims an initiative or an objective in a node state that its worker declares, and it executes that node.
The instance produces an execution object each time it takes a node.
The execution is the unit of work that the Scheduler Service records, and it represents the state of the work that the instance holds.
The Worker Service hosts the executions of kanthord's own harness.
The instance executes the steps that achieve the WHAT of that node.

An execution is responsible for producing the outcome of the node that it takes, and the outcome of every task of that node.
An execution ends when the current outcome is successful, an assessment does not pass, a human pauses the node, or a human discards the node.
An execution also ends on a resource limit or when the execution cannot progress.
An assessment that does not pass ends the execution and blocks the node.
A blocked node is not available for a further execution.
Only a human unblocks a node.
An unblock authorizes a further execution, and it asserts nothing about the results.
The execution reads the current outcome from evaluation or a human override; it does not decide success.
A human override ends the execution only when its new outcome asserts success.

Project configuration specifies the repository strategy.
The repository strategy belongs to the project whichever harness executes the work.
Whichever harness executes the work follows that strategy.
An execution follows the project's repository strategy when it acts on a repository.
Work on a repository requires a configured repository strategy, because configuration supplies the project's policy without an implicit default.
The configured repository action of an objective follows a passing assessment and precedes a successful outcome of that objective.

Completing the configured repository action, completing all tasks, and achieving the objective are three different conditions.
The shared outcome rules govern repository action failures.

### Worked example: `tdd@1`

`tdd@1` is one example among several workers.
For each task of an objective, an execution of `tdd@1` repeats a RED-GREEN-REFACTOR loop with `swe@1`, `te@1` and `re@1`.

For an objective, an execution of `tdd@1` creates a branch and makes a separate commit for each task on that branch.
These branch and commit practices apply to `tdd@1`, not to every worker.

Once all tasks of the objective are complete, an execution of `tdd@1` releases the objective for its evaluation.
The configured repository action follows the passing assessment.
Under a repository strategy that requires a pull request for every change, that action opens a pull request on the git platform.
Under a repository strategy that requires a merge and push, that action merges the branch and pushes to main.

Opening a pull request does not merge it.
Evaluation determines whether the results meet the objective's criterion.
A successful push to main does not establish achievement of the objective.

## External harness

`claude-code` and `opencode` are the external harnesses.
kanthord's own harness holds the first priority; an external harness holds the second priority.
An external harness supports ongoing integration and maintenance with an existing system.

An external harness supplies its HOW through its own orchestration skill, usually named `/work`.
It reaches kanthord's initiative, objective, and task model through the CLI or the API.
An external harness is a worker that the harness hosts: a human starts its program, and the kanthord extension of that program registers a worker instance of a worker binding of the project under its client identity.
Its instances acquire work through the work pull, like every worker instance, and its worker declares `Available`, `Waiting` and `External.Requested`, so an instance of it can carry out the steps of a node, evaluate it and request its external actions, through separate claims.
The node content is its only input, and kanthord configures no agent, no prompt and no tool of an external harness.
Its method can adapt dynamically to the capabilities and availability of its agents.

The external harness's sub-agents supply the WHO.
Each sub-agent has its own agent prompt that defines its responsibilities and contribution to the WHAT.
