---
title: Overview Vocabulary
---

# Overview Vocabulary

This file holds the values and the examples of the product terms that [overview.md](viewer.html?p=overview.md) owns.
A term that another design page owns lives in that page's own vocabulary sibling.
This file is not a design document, and `overview.md` stays the single source of truth.

## harness

A harness is a system that organizes execution of the WHAT through the HOW and the WHO.
The set is closed and it holds two values.

- **kanthord's own harness**
- **external harness**

## project

A project is an entity identified by what it ships.
The term names no closed set.
A project binds two repositories, one `tdd@1` worker and two provider accounts.

## mission

A mission is the whole work of one project: its initiatives, objectives and tasks and the relations between them.
The term names no closed set.
One project has one mission. The mission includes the objective "Add password reset".

## WHAT

The WHAT is the goal, the steps to achieve it, and the validation criteria for success.
The set is closed and it holds three values.

- **the goal**
- **the steps to achieve it**
- **the validation criteria for success**

## node

A node is a vertex of the mission graph. The set is closed and it holds three values.

- **initiative**
- **objective**
- **task**

Nothing else is a node. The word names a vertex of the graph, and it never names a tier or a degree.

## initiative

An initiative is a node of WHAT with its own validation criteria and outcome.
The term names no closed set.
An initiative contains the objective "Add password reset" and is a root of the graph.

## objective

An objective is a node of WHAT that contains tasks and has its own validation criteria and outcome.
The term names no closed set.
A `tdd@1` instance claims the objective "Add password reset". A `reviewer@1` instance later claims the objective.

## task

A task is a node of WHAT that belongs to an objective and has its own validation criteria and outcome.
The term names no closed set.
The import set holds `add-password-reset.md`, the objective, and `add-reset-token-expiry.md`, a task of that objective.

## evidence

Evidence is what execution records about the results, and what evaluation assesses against the validation criteria.
The term names no closed set.
The landing observation of the objective "Add password reset" appends the landed commit identities to its evidence set.

## outcome

An outcome is an assessment from evaluation of evidence against validation criteria, or a human act that a human assertion records.
The term names no closed set.
The [Mission Service Vocabulary](viewer.html?p=mission-service.vocabulary.md#assessment) owns the three values that an assessment establishes.
A human override of the outcome of "Add password reset" produces a new outcome that carries the human assertion.
kanthord keeps the previous outcome as a reference.
A human discard of "Add password reset" produces an outcome whose asserted result establishes nothing.

## attempt

An attempt is one try at a node across its executions, observations and evaluations.
The term names no closed set.
The first claim of "Add password reset" opens attempt 1, and a human unblock opens attempt 2.

## block

A block is the closure of an attempt on a condition, after which a human unblock authorizes the next attempt.
The term names no closed set.
An assessment that does not pass closes attempt 1 and blocks "Add password reset".

## unblock

An unblock is the human act that authorizes the next attempt of a blocked node.
The term names no closed set.
A human unblocks "Add password reset" into its next attempt.

## landing

Landing is the observed expected end state of every configured repository action of a node.
The term names no closed set.
A passing assessment of "Add password reset" precedes the request of its pull request. A human merges that pull request. An observer records the landing.

## worker

A worker is the HOW: a template that defines how executions happen.
A worker declares the node states that its instances claim.
The term names no closed set.
`tdd@1` is one example among several workers.
For each task of an objective, an execution of `tdd@1` repeats a RED-GREEN-REFACTOR loop with `swe@1`, `te@1` and `re@1`.
`tdd@1` declares `Available`, and `reviewer@1` declares `Waiting` and `External.Requested`.
`claude@1` and `opencode@1` are workers that an external harness hosts, and they declare `Available`, `Waiting` and `External.Requested`.

## worker instance

A worker instance is a background instance of one worker that claims an initiative or an objective in a node state that its worker declares.
The term names no closed set.
A `tdd@1` instance claims the objective "Add password reset". Execution 1 starts.

## execute

The act of a worker instance carrying out work on a node of the Mission Service.
The term names no closed set.
A `tdd@1` instance executes the objective "Add password reset" using its RED-GREEN-REFACTOR method.
An instance of worker binding `claude-main`, which the external harness `claude-code` hosts, pulls "Add password reset" and executes its steps under its execution identity.

## execution

The unit of work that the Scheduler Service records.
An execution is an object that represents the state of work on one initiative or objective.
One worker instance holds that work while it executes the node.
The Worker Service hosts the executions of kanthord's own harness.
Two executions of the same worker share that worker's method.
Each execution has its own execution identity.
The term names no closed set.
A `tdd@1` instance claims the objective "Add password reset" and produces Execution 1.
The instance executes a RED-GREEN-REFACTOR loop for each task, on a branch, with one commit for each task.
Execution 1 represents the state of that work and has its own execution identity.
An instance of `claude-main`, which the external harness `claude-code` hosts, pulls "Add password reset" and produces Execution 3.

## agent

An agent is an automated participant responsible for carrying out steps as the WHO.
The term names no closed set.
The worker supplies agents. A `tdd@1` execution repeats a RED-GREEN-REFACTOR loop with `swe@1`, `te@1` and `re@1`.
A `reviewer@1` execution evaluates the node with `re@1`.

## human participant

A human participant is a person responsible for carrying out steps as the WHO.
The term names no closed set.
A human merges the pull request of "Add password reset", and an observer records the landing.

## human identity

The identity of a logged-in human account, as established by the [Gateway Service](viewer.html?p=gateway-service.md) and passed to a downstream service.
The term names no closed set.

The [Gateway Service](viewer.html?p=gateway-service.md) authenticates `ulrich` and establishes the human identity of `ulrich`.
The Mission Service receives that identity and names it in its authorization call.

## binding

A binding is the record that allocates a resource to a project and permits an operation on that resource.
The term names no closed set.
The [Project Service Vocabulary](viewer.html?p=project-service.vocabulary.md#binding-kind) owns the four binding kinds and their values.
A project holds a repository binding for the repository that the objective "Add password reset" belongs to.
The binding permits three capabilities.
The Project Service vocabulary holds the cardinality of each binding kind.

## resource

A resource is what a binding allocates to a project, and it exists independently of that project.
The term names no closed set, and the [Project Service Vocabulary](viewer.html?p=project-service.vocabulary.md#binding-kind) owns the four binding kinds.
The project of "Account recovery" binds the repository `kanthorlabs/kanthord`, the worker `general@1`, a provider account at `openai` and a source.

## provider

A provider is a large language model provider that serves the models that the agents of a worker use.
The term names no closed set.
The project of "Account recovery" binds two provider accounts at one provider, and the Worker Service reaches that provider for each model inference call.

## provider account

A provider account is an account at a large language model provider that a project binds.
The term names no closed set.
A provider account binding holds a credential reference for a model inference call.

## deliverable

A deliverable is what a project ships.
The term names no closed set.
A project delivers coding work.

## tool

A tool is a capability that an execution uses to perform an operation.
The term names no closed set.
An execution of `tdd@1` uses git as a tool to create the branch of "Add password reset" and one commit for each task.

## memory

Memory is information that the HOW retains because a later step can depend on an earlier step.
The term names no closed set.
An execution of `tdd@1` retains the failing test of the RED step of a task, because the GREEN step makes that test pass.

## prompt

A prompt is instructions that guide an agent's work.
The term names no closed set.
Each sub-agent has its own agent prompt that defines its responsibilities and contribution to the WHAT.

## default standard

The default standard is the standard that the base prompt of a worker states as the default of the human, and an assessment weighs the evidence against it beside the validation criteria.
The worker that declares the base prompt owns the default standard, and a change to it is a new worker version, so the worker version of the reviewer fixes the default standard that an assessment applies.
The term names no closed set.
The base prompt of `swe@1` and `re@1` forbids an abstraction for single-use code.
The change of task "Add reset token expiry" meets every validation criterion of "Add password reset" and adds a helper class with one call site.
The assessment of `reviewer@1` records that finding as a blocker and does not pass, and "Add password reset" moves to `Blocked` for the human review.
