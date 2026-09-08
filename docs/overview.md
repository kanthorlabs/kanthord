---
title: Overview
---

# Overview

## Identity

kanthord is a work orchestration system that organizes goals, executes steps, and evaluates results.
It represents the WHAT independently of execution because goals and validation criteria remain meaningful across supported harnesses.
Its own harness provides the primary execution mechanism.

## WHAT

Initiative, objective, and task describe goals, the steps to achieve them, and the validation criteria for success.
Both harnesses share this WHAT.
The initiatives, the objectives and the tasks of one project form its mission.

Success has three separate parts:

- The WHAT specifies validation criteria.
- Execution produces results and evidence.
- Evaluation assesses the evidence against the criteria and produces an outcome.

Some criteria support machine checks; others need judgement.
The evaluation method follows the criterion and never the level.
Completing a run does not establish success, because evaluation assesses the evidence against the WHAT.

Every initiative, objective, and task must have an outcome.
For both harnesses, every ending at each level produces an outcome.
An outcome can record that evidence establishes that the results did not meet the validation criteria.
It can also record that available evidence cannot establish whether the results met the validation criteria.
Neither assessment establishes success.
The outcome records the stopping reason separately from the assessment of evidence.
Stopping execution does not by itself satisfy the outcome requirement.

Only a human can override an outcome to make a bypass exception.
A human override produces a new outcome that carries the human assertion.
kanthord keeps the previous outcome as a reference.
A terminal state never reopens and never repeats.
A human override adds a new outcome and never restarts a terminal run.
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

A project configures which workers are available and how many instances of each worker are available.
A worker instance takes an available initiative, objective or task.
A worker instance creates a run each time it takes a level.
A run implements the steps that achieve the WHAT of that level.

At each level, a run is responsible for producing that level's outcome because each level has its own validation criteria and outcome.
A run ends when the current outcome is successful, when an assessment does not pass, on cancellation, on a resource limit, or when the run cannot progress.
An assessment that does not pass ends the run and blocks the level.
A blocked level is not available for a further run.
Only a human unblocks a level.
An unblock authorizes a further run, and it asserts nothing about the results.
The run reads the current outcome from evaluation or a human override; it does not decide success.
A human override ends the run only when its new outcome asserts success.

Project configuration specifies the repository strategy.
The repository strategy belongs to the project whichever harness executes the work.
Whichever harness executes the work follows that strategy.
A run follows the project's repository strategy when it acts on a repository.
Work on a repository requires a configured repository strategy, because configuration supplies the project's policy without an implicit default.
A run of an objective performs the configured repository action before a successful outcome of that objective.

Completing the configured repository action, completing all tasks, and achieving the objective are three different conditions.
The shared outcome rules govern repository action failures.

### Worked example: `tdd@1`

`tdd@1` is one example among several workers.
On a task, a run of `tdd@1` repeats a RED-GREEN-REFACTOR loop with `swe@1` and `te@1`.

For an objective, a run of `tdd@1` creates a branch and makes a separate commit for each task on that branch.
These branch and commit practices apply to `tdd@1`, not to every worker.

Once all tasks of the objective are complete, a run of `tdd@1` performs the configured repository action.
Under a repository strategy that requires a pull request for every change, a run of `tdd@1` opens a pull request on the git platform.
Under a repository strategy that requires a merge and push, a run of `tdd@1` merges the branch and pushes to main.

Opening a pull request does not merge it.
Evaluation determines whether the results meet the objective's validation criteria.
A successful push to main does not establish achievement of the objective.

## External harness

`claude-code` and `opencode` are the external harnesses.
kanthord's own harness holds the first priority; an external harness holds the second priority.
An external harness supports ongoing integration and maintenance with an existing system.

An external harness supplies its HOW through its own orchestration skill, usually named `/work`.
It reaches kanthord's initiative, objective, and task model through the CLI or the API.
Its method can adapt dynamically to the capabilities and availability of its agents.

The external harness's sub-agents supply the WHO.
Each sub-agent has its own personal prompt that defines its responsibilities and contribution to the WHAT.

## Vocabulary

- **harness**: A system that organizes execution of the WHAT through the HOW and the WHO.
- **project**: An entity that holds the repository strategy that a run follows.
- **mission**: The whole work of one project: its initiatives, objectives and tasks and the relations between them.
  A project has one mission.
- **WHAT**: The goal, the steps to achieve it, and the validation criteria for success.
- **initiative**: A level of WHAT with its own validation criteria and outcome.
- **objective**: A level of WHAT that contains tasks and has its own validation criteria and outcome.
- **task**: A level of WHAT that belongs to an objective and has its own validation criteria and outcome.
  This relation lets a run organize task execution toward the objective's goal.
- **evidence**: What execution records about the results, and what evaluation assesses against the validation criteria.
- **outcome**: An assessment from evaluation of evidence against validation criteria, or a human assertion that an override records.
  The assessment can establish that results meet or do not meet the criteria, or that available evidence cannot establish either.
  The outcome records the stopping reason separately from the assessment.
- **worker**: The HOW: a template that defines how executions happen.
  It includes methods, agents, tools, memory, and prompts.
  A worker name has the form `<implementation>@<version>`, and the same name always identifies the same implementation.
- **worker instance**: A background instance of one worker that takes an available initiative, objective or task.
  A project configures how many instances of a worker are available.
- **run**: One occurrence of a worker instance working one initiative, objective or task.
  A run implements the steps that achieve the WHAT of that level.
  Two runs of the same worker share that worker's method.
  Each run has its own execution identity.
- **agent**: An automated participant responsible for carrying out steps as the WHO.
- **human participant**: A person responsible for carrying out steps as the WHO.
- **tool**: A capability that a run uses to perform an operation.
- **memory**: Information that the HOW retains because a later step can depend on an earlier step.
- **prompt**: Instructions that guide an agent's work.
