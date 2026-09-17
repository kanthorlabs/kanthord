---
title: Scheduler Service Vocabulary
---

# Scheduler Service Vocabulary

This file holds the values and the examples of the terms that [scheduler-service.md](viewer.html?p=scheduler-service.md#vocabulary) owns.
A product term lives in [overview.vocabulary.md](viewer.html?p=overview.vocabulary.md).
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `scheduler-service.md` stays the single source of truth.

## claimant

The holder of a role and a count that claims a node.
The term names no closed set.

Worker binding `tdd-main` is a claimant through each of its `tdd@1` instances, with the executor role and its instance count.
Two `tdd@1` instances of `tdd-main` are one claimant.
The executor client identity of `claude-code` is another claimant, with its role and its execution count.
The reviewer client identity of `claude-code` is a third claimant.
The executor client identity of `claude-code` never becomes a reviewer, and a project that needs a reviewer permits a second client identity.

## work pull

A `tdd@1` instance of worker binding `tdd-main` issues a work pull for its project.
The Scheduler selects "Add password reset", accepts the claim and returns Execution 1.

## targeted claim

The external harness `claude-code` names "Add password reset" under its executor client identity and requests a targeted claim.
The Scheduler accepts the claim and returns Execution 3 with its execution identity.
The request carries a request identifier, and a retry with that identifier returns Execution 3 again.

## on-demand request

The API ingress of the daemon issues an on-demand request for "Add password reset", which holds an entry behind "Add recovery codes".
The Scheduler serves "Add password reset" to the next compatible `tdd@1` work pull ahead of the order, and the request returns with Execution 1.

## role

The set is closed and holds two values.

- **executor**
- **reviewer**

`tdd@1` declares `Available`, which gives worker binding `tdd-main` the executor role.
`reviewer@1` declares `Waiting` and `External.Requested`, which give its worker binding the reviewer role.

## scheduling processor

A scheduling processor handles the work pull of a `tdd@1` instance of worker binding `tdd-main`.
It selects "Add password reset" and completes the claim decision.
It returns to the pool while Execution 1 executes that objective.

## work queue

The work queue holds entries for "Add password reset" and "Add recovery codes", both at priority 0.
The entry for "Add password reset" has the older time-ordered identity.
It comes first, even when a newer entry for "Add recovery codes" arrives.
The Mission Service inserts the entry of "Add password reset" in the transaction that moves the objective to `Available`, and it removes the entry in the transaction that records the claim.
A peek reads the entry of "Add password reset" and removes nothing.

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
The terminal state of the last objective satisfies the wait in the transaction that commits it.
A later work pull takes "Account recovery".

Execution 2 of "Add password reset" opens pull request 42 and releases with the landing observation of that pull request as its wait fact, because the notification that follows the merge is unrequested.
The Scheduler holds the entry out until the observer records the landing.
A later work pull of a `reviewer@1` instance takes "Add password reset" from `External.Requested`.

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
