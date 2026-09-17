---
title: Worker Service Vocabulary
---

# Worker Service Vocabulary

This file holds the values and the examples of the terms that [worker-service.md](viewer.html?p=worker-service.md#vocabulary) owns.
A product term lives in [overview.vocabulary.md](viewer.html?p=overview.vocabulary.md).
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `worker-service.md` stays the single source of truth.

## worker

The overview owns the term.
This revision of the Worker Service supplies four workers.

- **general@1**: the steps method with the native agent `general@1`.
- **reviewer@1**: the evaluation method with the native agent `re@1`.
- **claude@1**: the steps method with the coding agent `claude@1`, the Claude Code program.
- **opencode@1**: the steps method with the coding agent `opencode@1`, the opencode program.

## steps method

`general@1`, `claude@1` and `opencode@1` hold the steps method.
A `general@1` instance of worker binding `general-main` claims "Add password reset" from `Available`.
Its execution takes the three tasks of the pinned revision in the order of the revision, makes one commit for each task on the node branch, and releases with no further work.

## evaluation method

`reviewer@1` holds the evaluation method.
A `reviewer@1` instance claims "Add password reset" from `Waiting`, checks out the commit that the objective evidence names in a fresh workspace, runs the verification command, records its result as produced evidence and writes the assessment.
A later `reviewer@1` instance claims the same objective from `External.Requested`, evaluates nothing, requests the unrequested action whose predecessor landed, and releases.
After a change request on pull request 42 blocks the objective, the `reviewer@1` execution of attempt 2 reuses that pull request, because it is open and it fulfils the operands, and it performs the network git write only.

## native agent

`general@1` and `re@1` are native agents.
The Worker Service runs the agent loop of `general@1` and sends each model inference call through the model gateway with the provider account, the model identifier and the reasoning effort of the entry `general@1` of worker binding `general-main`.

## coding agent

The agent of `claude@1` and the agent of `opencode@1` are coding agents.
The Worker Service starts the Claude Code program in the workspace of "Add password reset" with the prompt of task "Add reset token expiry".
The program runs under the model identifier and the reasoning effort of the entry `claude@1`, and it performs its own model inference call under the provider authentication that the operator configured, so no model gateway of the daemon takes part in the execution of a coding agent.
The program pushes nothing itself, because the repository gateway performs the network git write after the program exits.

## gateway

The set is closed and it holds two values.

- **model gateway**: performs a model inference call.
- **repository gateway**: performs a network git read, a network git write and a platform action.

Execution 1 of "Add password reset" asks the repository gateway to push the node branch.
The gateway resolves the repository binding of the objective through the Project Service under the execution identity of Execution 1, and the protected facility consults custody after the check.

## runtime identity

The Worker Service creates two instances for worker binding `general-main`, whose instance count is 2, and mints a runtime identity for each one.
A daemon restart creates two new instances with two new runtime identities.
A revision of `general-main` that changes the model identifier of its entry replaces no instance.

## pool

The pool of worker binding `general-main` holds two instances.
Both are idle, both pull, and the Scheduler serves "Add password reset" to the first pull.
The second instance keeps its pull outstanding and starts no other pull.

## compatibility declarations

An instance of `general@1` carries the worker name `general@1`, the declared node state `Available` and the required node format.
An instance of `reviewer@1` carries the worker name `reviewer@1`, the declared node states `Waiting` and `External.Requested` and the required node format.

## required node format

Every worker of this page requires the same format, and the set is closed.

- the goal
- the steps
- the validation criteria

The verification command is an optional field, and a method reads it when the node carries it.

## instance healthcheck

The Scheduler Service owns the term, and the Worker Service produces the check.
The instance of `general@1` passes: the daemon runs, so the program of its native agent is available, and the entry `general@1` is present in the binding set of the project.
The instance of `claude@1` fails when the Claude Code program is absent from the host, and it fails when a revision of the project removes the entry `claude@1`.

## workspace

The workspace of Execution 1 on "Add password reset" is a checkout of `kanthorlabs/kanthord` on the node branch, under the workspace root of the daemon, keyed by the objective and its repository binding.
Execution 3 of the same objective under the same repository binding reuses it, and the Worker Service removes it after the bounded retention.
The reviewer execution of the objective uses a fresh workspace with a clean checkout of the tested snapshot, and the Worker Service removes it at the release.
The execution of "Account recovery" uses a workspace with no checkout, and its agent writes the report there.

## node branch

The node branch of "Add password reset" takes its name from the node identity, for example `kanthord/obj-7f3a`.
Attempt 1 and attempt 2 both work on that branch.
A revision of the objective that names another repository binding starts a new node branch in that repository.

## task commit

Task "Add reset token expiry" of "Add password reset" ends with one commit on the node branch.
That commit is the evidence of the task outcome, and the task assessment names it with the snapshot that the verification ran against.

## resource budget

`general@1` fixes a bound on the model inference calls and the wall time of one execution, for example 200 calls and 2 hours.
`claude@1` fixes a bound on the turns of the Claude Code program and the wall time of one execution, for example 50 turns and 2 hours.
The values are illustrations, and the implementation epics set the configured values.

## lease renewal interval

The execution renews its lease at a fixed interval shorter than the lease expiry, for example every 30 seconds against a lease of 2 minutes.
The values are illustrations, and the implementation epics set the configured values.
