---
title: Scheduler Service Vocabulary
---

# Scheduler Service Vocabulary

This file holds the values and the examples of the terms that [scheduler-service.md](scheduler-service.md) owns.
A product term lives in [overview.vocabulary.md](overview.vocabulary.md).
This file is not a design document, and `scheduler-service.md` stays the single source of truth.

## claimant

The worker binding that claims a node through its instances, with its count.
The term names no closed set.

Worker binding `tdd-main` is a claimant through each of its `tdd@1` instances, with its instance count.
Two `tdd@1` instances of `tdd-main` are one claimant.
Worker binding `claude-main` of `claude@1`, whose instances the external harness `claude-code` hosts and registers, is another claimant.

## declared node states

The declared node states are the node states that a worker declares its instances consume.
The set of a worker is a subset of the closed set of states that admit a claim, and that set holds three values.

- **Available**
- **Waiting**
- **External.Requested**

`general@1` declares `Available`.
`reviewer@1` declares `Waiting` and `External.Requested`.
`claude@1` declares `Available`, `Waiting` and `External.Requested`, so one instance of `claude-main` obtains a steps claim on "Add password reset" and later an evaluation claim on the same objective.

## work pull

A `tdd@1` instance of worker binding `tdd-main` issues a work pull for its project.
The Scheduler selects "Add password reset", accepts the claim and returns Execution 1.

## on-demand request

The API ingress of the server issues an on-demand request for "Add password reset", which holds an entry behind "Add recovery codes".
The Scheduler serves "Add password reset" to the next compatible `tdd@1` work pull ahead of the order, and the request returns with Execution 1.

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

Admission of a delivery creates an observation obligation for the external object of pull request 42 of "Add password reset".
The observer reads that pull request after its merge and writes the observation record to the Mission Service.
The obligation holds a lease, and the observer holds no claim on "Add password reset".

## delivery admission

Delivery admission is the Scheduler operation that durably decides the disposition and owed effects of one delivery.
The closed set of admission operations holds delivery admission alone.
The Intake Service submits the delivery about pull request 42 of "Add password reset" to delivery admission.
Admission records acceptance as an observation and creates the observation obligation.
A repeat returns that recorded disposition.

## external input

External input is the decoded business meaning that delivery admission considers.
The closed set holds an observation of an external object, a human act on an existing node and a request for new WHAT.
The closed set of human acts holds an unblock, a pause, a resume, an edit and an override.

## linked human identity

The [human identity](overview.vocabulary.md#human-identity) that a delivery links to.
The Scheduler Service passes it to the Mission Service when it invokes a human act on a node.
The term names no closed set.

A delivery from the GitHub webhook source links to the account `ulrich`.
The Scheduler Service passes the linked human identity of `ulrich` with the Mission operation.

## observer

The observer is a Scheduler Service component that the scheduling processors execute on an observation obligation.
It reads the state of the external object through the platform connector of the Worker Service under its service identity.
It folds that state into the observed state.

The GitHub implementation decodes the delivery about pull request 42 into GitHub event types.
Delivery admission resolves that delivery through the repository binding and the address of pull request 42.
The external object names "Add password reset" and attempt 1.
The observer reads the merged state through the platform connector and folds it into the observed state of the observation record.

## instance healthcheck

The Worker Service checks the `tdd@1` instance of worker binding `tdd-main` before it pulls "Add password reset".
The Scheduler requires that fresh instance healthcheck when it accepts the claim.
The check proves no successful outcome of "Add password reset".
