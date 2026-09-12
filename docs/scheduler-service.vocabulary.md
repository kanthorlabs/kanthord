---
title: Scheduler Service Vocabulary
---

# Scheduler Service Vocabulary

This file holds the values and the examples of the terms that [scheduler-service.md](viewer.html?p=scheduler-service.md#vocabulary) owns.
A product term lives in [overview.vocabulary.md](viewer.html?p=overview.vocabulary.md).
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `scheduler-service.md` stays the single source of truth.

## requester

The holder of a role and a count that requests a claim.
The term names no closed set.

Worker binding `tdd-main` is a requester through each of its `tdd@1` instances, with the executor role and its instance count.
Two `tdd@1` instances of `tdd-main` are one requester.
The executor client identity of `claude-code` is another requester, with its role and its execution count.
The reviewer client identity of `claude-code` is a third requester.
The executor client identity of `claude-code` never becomes a reviewer, and a project that needs a reviewer permits a second client identity.

## work pull

A `tdd@1` instance of worker binding `tdd-main` issues a work pull for its project.
The Scheduler selects "Add password reset", accepts the claim and returns Execution 1.

## targeted claim

The external harness `claude-code` names "Add password reset" under its executor client identity and requests a targeted claim.
The Scheduler accepts the claim and returns Execution 3 with its execution identity.
The request carries a request identifier, and a retry with that identifier returns Execution 3 again.

## role

The set is closed and holds two values.

- **executor**
- **reviewer**

The method of `tdd@1` gives worker binding `tdd-main` the executor role.
The method of `reviewer@1` gives its worker binding the reviewer role.

## scheduling processor

A scheduling processor handles the work pull of a `tdd@1` instance of worker binding `tdd-main`.
It selects "Add password reset" and completes the claim decision.
It returns to the pool while Execution 1 executes that objective.

## work queue

The work queue holds entries for "Add password reset" and "Add recovery codes", both at priority 0.
The entry for "Add password reset" has the older time-ordered identity.
It comes first, even when a newer entry for "Add recovery codes" arrives.

## priority

The actor `ulrich` sets the priority of "Add password reset" to 1 through the node API.
Its entry moves ahead of "Add recovery codes" at priority 0.
The priority change preserves the identity of the entry.

## claim

The claim has two kinds.

- **a steps claim**
- **an evaluation claim**

The claim has two acquisition paths.

- **a work pull**
- **a targeted claim**

A `tdd@1` instance of worker binding `tdd-main` obtains a steps claim on "Add password reset" through a work pull.
After the release and the readiness condition, a `reviewer@1` instance obtains an evaluation claim on that objective through its own work pull.

## lease

Execution 1 of "Add password reset" renews its lease while its `tdd@1` instance executes the steps.
The Scheduler records a loss declaration when that execution loses its claim.
The loss declaration revokes the authority of Execution 1 before any replacement claim.

## wait record

A `general@1` instance releases "Account recovery" while its objectives "Add password reset" and "Add recovery codes" hold no terminal state.
The release names the terminal state of that child set as its wait fact.
The Scheduler writes a wait record and holds the entry out of work-pull selection.
The notification for the last objective's terminal state satisfies the wait.
A later work pull takes "Account recovery".

A `tdd@1` instance releases "Add recovery codes" at its pull request, because a landing dependency of that objective names "Add password reset" and that objective has not landed.
The release names the landing of every node that a landing dependency of "Add recovery codes" or of an ancestor names.
The landing observation of pull request 42 of "Add password reset" satisfies the wait, and a later work pull takes "Add recovery codes".

## observation obligation

An observation obligation names the external object for pull request 42 of "Add password reset".
The observer reads that pull request after its merge and writes the observation record to the Mission Service.
The obligation holds a lease, and the observer holds no claim on "Add password reset".

## inbox

GitHub delivers the merge of pull request 42 for "Add password reset".
The Scheduler stores the delivery durably in its inbox before it acknowledges acceptance.
A duplicate with the same source and provider delivery identity creates no second effect for that project's external object.

## adapter

The GitHub adapter resolves the delivery about pull request 42 through the repository binding and the address of that pull request.
The external object names "Add password reset" and attempt 1.
The adapter reads the merged provider state and folds it into the observed state of the observation record.

## instance healthcheck

The Worker Service checks the `tdd@1` instance of worker binding `tdd-main` before it pulls "Add password reset".
The Scheduler requires that fresh instance healthcheck when it accepts the claim.
The check proves no successful outcome of "Add password reset".
