---
title: Overview Vocabulary
---

# Overview Vocabulary

This file holds the values and the examples of the product terms that [overview.md](viewer.html?p=overview.md) owns.
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
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
Run 1 opens the pull request of "Add password reset", then releases. A human merges that pull request. An observer records the landing.

## worker

A worker is the HOW: a template that defines how executions happen.
The term names no closed set.
`tdd@1` is one example among several workers.
For each task of an objective, a run of `tdd@1` repeats a RED-GREEN-REFACTOR loop with `swe@1` and `te@1`.

## worker instance

A worker instance is a background instance of one worker that takes an available initiative or objective.
The term names no closed set.
A `tdd@1` instance claims the objective "Add password reset". Run 1 starts.

## run

A run is one occurrence of a worker instance working one initiative or objective.
The term names no closed set.
Run 1 runs a RED-GREEN-REFACTOR loop for each task of the objective "Add password reset", on a branch, with one commit for each task.

## agent

An agent is an automated participant responsible for carrying out steps as the WHO.
The term names no closed set.
The worker supplies agents. A `tdd@1` run repeats a RED-GREEN-REFACTOR loop with `swe@1` and `te@1`.

## human participant

A human participant is a person responsible for carrying out steps as the WHO.
The term names no closed set.
A human merges the pull request of "Add password reset", and an observer records the landing.

## binding

A binding is the record that allocates a resource to a project and permits an operation on that resource.
The term names no closed set.
The [Project Service Vocabulary](viewer.html?p=project-service.vocabulary.md#binding-kind) owns the three binding kinds and their values.
A project holds a repository binding for the repository that the objective "Add password reset" belongs to.
The binding permits three capabilities.
The approved pages name no cardinality for the binding.

## provider account

A provider account is an account at a large language model provider that a project binds.
The term names no closed set.
A provider account binding holds a credential reference for a model inference call.

## deliverable

A deliverable is what a project ships.
The term names no closed set.
A project delivers coding work.

## prompt

A prompt is instructions that guide an agent's work.
The term names no closed set.
Each sub-agent has its own personal prompt that defines its responsibilities and contribution to the WHAT.

## Terms that still need an entry

- memory: no approved page gives a concrete example of information that the HOW retains because a later step can depend on it.
- tool: no approved page names a concrete tool.
