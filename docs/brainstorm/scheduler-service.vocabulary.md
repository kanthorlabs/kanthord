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

The API ingress of the server issues an on-demand request for "Add password reset", which holds a job behind "Add recovery codes".
The Scheduler serves "Add password reset" to the next compatible `tdd@1` work pull ahead of the order, and the request returns with Execution 1.

## scheduling processor

A scheduling processor handles the work pull of a `tdd@1` instance of worker binding `tdd-main`.
It selects "Add password reset" and completes the claim decision.
It returns to the pool while Execution 1 executes that objective.

## job

An entry of the work queue for one claimable node. The claim deletes it.

The Mission Service inserts a job for "Add password reset" when the objective becomes `Available`.
A `tdd@1` instance of worker binding `tdd-main` claims the objective, and the claim deletes that job.
No job exists for "Add password reset" while Execution 1 executes it.
A release with further work inserts a new job with a new identity.

## work queue

The work queue holds jobs for "Add password reset" and "Add recovery codes", both at priority 0.
The job for "Add password reset" has the older time-ordered identity.
It comes first, even when a newer job for "Add recovery codes" arrives.
The Mission Service inserts the job of "Add password reset" in the transaction that moves the objective to `Available`, and it removes the job in the transaction that records the claim.
A peek reads the job of "Add password reset" and removes nothing.

## priority

The actor `ulrich` sets the priority of "Add password reset" to 1 through the node API.
Its job moves ahead of "Add recovery codes" at priority 0.
The priority change preserves the identity of the job.

## claim

The claim has two kinds.

- **a steps claim**
- **an evaluation claim**

A `tdd@1` instance of worker binding `tdd-main` obtains a steps claim on "Add password reset" through a work pull.
After the release and the readiness condition, a `reviewer@1` instance obtains an evaluation claim on that objective through its own work pull.

## execution record

The record of an execution that the Scheduler Service holds.
For a registered instance, it names the client identity and the display name of its credential through the registration of its runtime identity.
It holds neither for an instance that the server hosts.
Both are attribution and no authority.

The `claude-code` instance of worker binding `claude-main` claims the objective "Add password reset".
Its execution record names the client identity and the display name after that instance deregisters, because the registration row stays, so a trace still names the program.

## deadline

The fixed time at which the claim of an execution loses its authority.
The claim sets it once, and nothing moves it.

Execution 1 of "Add password reset" claims at 10:00 with a 2 h wall time and a 600 s reserve.
Its `expired_at` is 12:10.
If Execution 1 holds no earlier end, it loses its authority at 12:10, before any replacement claim.
The Scheduler records the loss declaration when it settles that loss.

## instance healthcheck

The Worker Service checks the `tdd@1` instance of worker binding `tdd-main` before it pulls "Add password reset".
The Scheduler requires that fresh instance healthcheck when it accepts the claim.
The check proves no successful outcome of "Add password reset".
