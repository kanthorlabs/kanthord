---
title: Project Service Vocabulary
---

# Project Service Vocabulary

This file holds the values and the examples of the terms that [project-service.md](project-service.md) owns.
This file is not a design document, and `project-service.md` stays the single source of truth.

## capability

One class of authenticated operation on a resource.
`project-service.md` closes the set for each binding kind that it names.

A repository binding holds three capabilities.

- **a network git read**
- **a network git write**
- **a platform action**

These are the capabilities that `project-service.md` names, and the page closes no set across every resource kind.

- A commit, a branch and a merge are local, so none of them is a capability.

## binding name

The name that a human chooses for a binding, unique inside its project.
The term names no closed set.

Project `atlas` names its worker binding `general-main`.
A second binding with that name in `atlas` is refused.

## binding kind

The kind of a binding determines its configuration, the cardinality that a project permits, and its validation.
The set holds four kinds.

- **repository**
- **worker**
- **source**
- **storage**

The mission of a project is intrinsic to that project, so no binding allocates it.
A repository binding of the objective "Add password reset" permits three capabilities, and its cardinality permits one binding for each repository that the project uses.

## cardinality

The number of bindings of one kind that a project holds for one resource.
The set is closed for each kind and it holds four values.

- **repository**: one binding for each repository that the project uses.
- **worker**: any number of bindings of one worker, each with its own configuration.
- **source**: one binding for each delivery source that the project accepts.
- **storage**: at most one binding per project, for one S3-compatible bucket.

The project of "Account recovery" binds two repositories and one `tdd@1` worker as `tdd-main`.
A second binding for repository `kanthorlabs/kanthord` is refused.
A second `tdd@1` binding `tdd-experimental` with another entry is accepted.
A third `tdd@1` binding with the values of `tdd-main` is accepted.

## storage binding

The binding of one S3-compatible bucket that holds the object evidence of a project.
A project holds at most one storage binding.
Project `atlas` names its binding `evidence-store` and its bucket `atlas-evidence`.
Its configuration holds `endpoint`, `bucket`, `region`, `prefix` and `credential` beside `available`.
The credential reference names an `s3` [credential store record](custody.vocabulary.md#credential-store-record).
The storage credential stays in server custody.
A presigned grant reaches the kanthord component for one operation on one object, never the context of an agent.
Without this binding, the project accepts only inline evidence content.

## binding set

The bindings that one project holds.

A project binds two repositories and one `tdd@1` worker.
The worker binding holds no [entry](worker-service.vocabulary.md#entry), so each agent uses its enablement's default configuration.
The Project Service rejects the set when it references a binding that does not exist.
The Project Service validates the set when the project writes it, and it validates a binding again when an execution resolves it.

## revision

One version of the configuration of a binding.
[Custody](custody.md#credential-records) owns credential record revisions.

A worker binding holds one entry that names a model identifier.
The project changes the model identifier.
The identity of the binding stays, and the change creates a revision.
Every reference to that binding stays valid, because a reference never names a revision.
An execution that resolves that revision records it.
A change to the credential reference of a repository binding creates a revision of that binding too.

## replacement binding

The binding that a change to the named resource creates.
The replacement keeps the binding name and takes a new identity.

A repository binding names one repository, and the project moves the work to another repository.
That change names another resource, so it creates a replacement binding.
The replacement invalidates every reference to the binding that it replaces.
The same edit repoints every dependent binding.

`credential_A` holds the remote identity `github:user:ulrich`.
The team moves to a token of `github:organization:kanthorlabs`, so a human creates `credential_B`.
The binding `kanthord-repo` of `atlas` changes its credential reference to `credential_B`, which creates a revision.
The binding of `beacon` keeps `credential_A` until its own edit.

## coverage

One of the two checks that validate a credential reference.

- The repository binding of `git@github.com:kanthorlabs/kanthord.git` requires one API key of GitHub for every platform action.
- Git uses the SSH configuration of the host.
- The submission names no credential reference, so coverage fails.

## system authorization

What kanthord permits an identity to access.

One API key of a git platform account authorizes every repository of that account.
A project holds no binding for one repository of that account.
The protected facility refuses an execution operation on that repository, because system authorization does not permit it.
The Project Service enforces system authorization.

The Gateway Service authenticates `ulrich` and passes the human identity of `ulrich` to a downstream service.
The Project Service authorizes that human identity for an operation on any project of the server.

## execution identity

The identity that an execution presents.

A `tdd@1` worker instance executes an objective and produces an execution object.
That execution holds its own execution identity, and the instance presents that identity for a network git write.
The protected facility resolves that identity to the project and to the node of the request.
The record of the operation names the execution identity.

## client identity

The identity of one worker instance, or of one program of an external harness, that registers. `kanthord jwt` generates it inside a machine JWT, and it holds no secret. It is never reused, and it never moves to another worker binding.

`ulrich` generates a machine JWT for worker binding `claude-main` of `claude@1` with the name `Claude Code on ulrich-mbp`, and the command generates the client identity `client_identity_01J8Z3N5K7Q2W4E6R8T0Y2V4X6` inside it.
The program of `claude-code` presents that JWT, and the protected facility resolves the client identity to the worker binding `claude-main` and to its project.
A second program of `claude-code` receives its own JWT and its own client identity, and both instances count against the instance count of `claude-main`.
The external harness holds no credential of a resource.
`project-service.md` names the execution identity of an execution and the client identity of an external harness.

## service identity

A service identity is the identity that a service presents for its own authorized operations.

The observer reads pull request 42 of "Add password reset" under its service identity.
The facility resolves that identity through the external object to the repository binding, the project and the node.
The observer performs no operation class other than the read of an external object.
The Intake Service presents its own service identity for an [acquisition grant](project-service.vocabulary.md#acquisition-grant) on the source binding of `kanthord-web`.

## acquisition grant

An acquisition grant authorizes one acquisition session for one subscription under the service identity of the Intake Service.
The grant names its source binding and its kind.
The closed set of kinds holds `webhook-register`, `poll` and `stream-open`.
The Project Service grants `webhook-register` for the subscription of the GitHub source binding of `kanthord-web`.
The Intake Service uses that grant to register the webhook for `kanthorlabs/kanthord`.

## source binding

The binding of a delivery source that a project accepts.

The project binds the GitHub webhook source of its repository.
The binding holds the verification secret behind custody.
The Project Service verifies each delivery as its own operation.
The binding holds the [subscriptions](intake-service.vocabulary.md#subscription) that the Intake Service uses to acquire its deliveries.

## resolution

One act of an execution that resolves a binding for one operation.

An execution needs a network git write, and it resolves the repository binding at that moment.
That resolution authorizes one operation, and the next operation resolves the binding again.
The execution records the binding revision that it resolves.
A local disablement takes effect at the next resolution.

## policy

The rule on a binding that configures an external action for the nodes of the project and states what that action follows.
The term names no closed set.

The repository strategy of `kanthorlabs/kanthord` requires a pull request for every change.
Its configured repository action opens a pull request that follows the passing assessment of "Add password reset".
"Add password reset" names the binding of `kanthorlabs/kanthord`, so it requires that action.

## base branch

The branch of a repository that the repository strategy names as the origin of every node branch and as the target of the configured repository action.
The term names no closed set.

Project `atlas` names `develop` as the base branch of `kanthorlabs/kanthord` and `main` as the base branch of `kanthorlabs/apps`.
Every node branch of an objective on `kanthorlabs/kanthord` starts from `develop`, and the pull request of the objective targets `develop`.

## expected end state

The state on its platform that an external action states.

Under a repository strategy that requires a pull request for every change, the configured repository action opens a pull request.
The expected end state of that action is the merge of that pull request.
Under a repository strategy that requires a merge and push, the expected end state is the push to the base branch.
[overview.md](overview.md) owns landing, which is the observed expected end state.

## the five changes

`project-service.md` names five different changes.
The set is closed and it holds five values.

- **local disablement**: It takes effect at the next resolution. A recorded revision never authorizes an operation after it.
- **upstream revocation**: The remote withdraws the credential. A human revokes the OAuth credential of `kanthorlabs` at GitHub. The record and every binding that names it stay unchanged, the next platform action ends against the remote, and a human rotates the record.
- **rotation**: It changes one record, and every binding that names that record stays valid.
- **expiry**: The credential reaches its end date at the remote. The API key of an agent provider expires. The next model inference call fails at the remote. The recorded revision still states what the execution selected.
- **OAuth refresh**: Custody obtains a new token behind the record. The OAuth credential of `kanthorlabs` is refreshed, the reference and every binding that names it stay unchanged, and no revision is created.

A change to the secret material behind an unchanged credential reference changes no binding.
