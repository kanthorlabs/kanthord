---
title: Repository Vocabulary
---

# Repository Vocabulary

This file holds the values and the examples of the terms that [repository.md](repository.md) owns.
This file is not a design document, and `repository.md` stays the single source of truth.

## repository component

The shared component through which services reach a repository and its platform after Project Service authorization.
For "Add password reset", the Intake Service calls the Repository component to open pull request 42 for the Worker action performer.

## platform implementation

A platform implementation exposes the operations of its platform under the names and the parameters of that platform.
The set is open.
The first version holds one value.

- **GitHub implementation**

The GitHub implementation exposes the operations of GitHub.
For example, it opens a pull request, reads a pull request and lists the review comments of a pull request.
It derives the owner `kanthorlabs` and the repository `kanthord` from the repository binding.
A caller supplies neither resource selector.

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

## write operation

One write that the Repository component exposes under the [write rules](repository.md#write-operations).
The set is closed and holds two values.

- **node-branch push**
- **configured-action write**
