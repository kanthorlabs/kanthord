---
title: Project Service Vocabulary
---

# Project Service Vocabulary

This file holds the values and the examples of the terms that [project-service.md](viewer.html?p=project-service.md) owns.
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `project-service.md` stays the single source of truth.

## capability

One class of authenticated operation on a resource.
`project-service.md` closes the set for each binding kind that it names.

A repository binding holds three capabilities.

- **a network git read**
- **a network git write**
- **a platform action**

A provider account binding holds one capability.

- **a model inference call**

These are the capabilities that `project-service.md` names, and the page closes no set across every resource kind.

- A commit, a branch and a merge are local, so none of them is a capability.
- An unauthenticated operation is not a capability, so a public read requires no capability and no credential reference.

## binding kind

The kind of a binding determines its configuration, the cardinality that a project permits, and its validation.
`project-service.md` names three kinds, and it closes no set of kinds.

- **repository**
- **worker**
- **provider account**

The mission of a project is intrinsic to that project, so no binding allocates it.
A repository binding of the objective "Add password reset" permits three capabilities, and its cardinality permits one binding for each repository that the project uses.

## binding set

The bindings that one project holds.

A project binds two repositories, one `tdd@1` worker and two provider accounts.
The worker binding holds one entry for each agent of `tdd@1`, and each entry names a provider account binding by identity.
The Project Service rejects the set when it references a binding that does not exist.
The Project Service validates the set when the project writes it, and it validates a binding again when a run resolves it.

## revision

One version of the configuration of a binding.

A worker binding holds one entry that names a provider account binding and a model identifier.
The project changes the model identifier.
The identity of the binding stays, and the change creates a revision.
Every reference to that binding stays valid, because a reference never names a revision.
A run that resolves that revision records it.
A change to the credential reference of the binding creates a revision too.

## replacement binding

The binding that a change to the named resource creates.

A repository binding names one repository, and the project moves the work to another repository.
That change names another resource, so it creates a replacement binding.
The replacement invalidates every reference to the binding that it replaces.
The same edit repoints every dependent binding.
A change to the remote that a credential authorizes is also a change to the resource, so it creates a replacement binding.

## credential reference

What a binding holds for a capability that it requires.

A repository binding requires a network git write and a platform action.
It holds one credential reference for each of the two capabilities.
One credential reference satisfies both capabilities when the type of the referenced record performs both classes of operation.
A credential reference names a record of the credential store.

## credential store

The store that holds one record for a secret.

The credential store holds one record for one SSH key, and two projects use that key.
The store holds that one record.
Each project holds its own binding that names the record.
A rotation changes that one record, and every binding that names the record stays valid.
Unrestricted selection of a record is the danger, and central storage is not.

## credential store record

One record of the credential store.

A record holds one SSH key, and it names the configuring actor and the upstream principal.
A human selects the record that satisfies a capability.
The type of the record decides the class of operation that the record performs.
The record serves more than one project.

## coverage

One of the two checks that validate a credential reference.

A repository binding requires a network git write and a platform action.
It holds a credential reference for the network git write only.
Coverage fails, because one required capability holds no credential reference.

## suitability

The other of the two checks that validate a credential reference.

A repository binding requires a platform action, and its credential reference names a record that holds an SSH key.
Suitability fails, because an SSH key does not perform a platform action.
Suitability states no scope, because a binding does not narrow upstream authority.
Coverage and suitability are the whole validation of a credential reference.

## custody

The holding of secret material behind a protected facility.

The credential store holds an SSH key behind the protected facility.
A run requests a network git write.
The facility checks the binding of the project, then it consults custody.
No credential leaves the daemon, so the run holds no credential.
Holding the repository binding does not confer custody of the key.

## protected facility

The component that secret material sits behind.

A run presents its execution identity and requests a platform action.
The protected facility resolves that identity to the project and to the level of the request.
The facility checks the binding of that project for the requested operation.
The facility consults custody after that check, so a refusal never reaches custody.

## system authorization

What kanthord permits an execution to access.

One API key of a git platform account authorizes every repository of that account.
A project holds no binding for one repository of that account.
The protected facility refuses an operation on that repository, because system authorization does not permit it.
The Project Service enforces system authorization.

## credential authority

What the remote permits any holder.

The remote permits any holder of the API key to act on the whole account.
The Project Service records that authority, and no binding narrows it.
An operation that is in progress ends against the remote, because the remote holds the credential authority.

## configuring actor

The actor that a credential store record names as the actor that configures it.

A human configures the record that holds the OAuth credential of the git platform.
The record names that human as its configuring actor.
Another human selects that record for a repository binding, and the configuring actor stays the first human.
The configuring actor, the upstream principal and the execution identity stay separate.

## upstream principal

The principal that a credential store record names at the remote.

A record holds an OAuth credential of a git platform, and it names the account `kanthorlabs` as its upstream principal.
An OAuth credential does not imply a person, so the record states that principal.
A record that holds an API key of a model provider names the account at that provider as its upstream principal.

## execution identity

The identity that a run presents.

A `tdd@1` worker instance takes an objective, and it creates a run.
That run holds its own execution identity, and it presents that identity for a network git write.
The protected facility resolves that identity to the project and to the level of the request.
The record of the operation names the execution identity.

## client identity

The identity that an external harness presents.

`claude-code` requests a platform action through the API, and it presents its client identity.
The protected facility resolves that identity to the project, then it checks the binding.
The external harness holds no credential.
`project-service.md` names the execution identity of a run and the client identity of an external harness.

## liveness token

The token that proves that a run is live.

A run presents a liveness token, and the token proves that the run is live.
The token authorizes no operation.
The protected facility still checks the binding of the project for the requested operation.

## resolution

One act of a run that resolves a binding for one operation.

A run needs a network git write, and it resolves the repository binding at that moment.
That resolution authorizes one operation, and the next operation resolves the binding again.
The run records the binding revision that it resolves.
A local disablement takes effect at the next resolution.

## expected end state

The state that a configured repository action states on the git platform.

Under a repository strategy that requires a pull request for every change, a run opens a pull request.
The expected end state of that action is the merge of that pull request.
Under a repository strategy that requires a merge and push, the expected end state is the push to main.
[overview.md](viewer.html?p=overview.md) owns landing, which is the observed expected end state.

## the five changes

`project-service.md` names five different changes.
The set is closed and it holds five values.

- **local disablement**: It takes effect at the next resolution. A recorded revision never authorizes an operation after it.
- **upstream revocation**
- **rotation**: It changes one record, and every binding that names that record stays valid.
- **expiry**
- **OAuth refresh**

A change to the secret material behind an unchanged credential reference changes no binding.

## Terms that still need an entry

`project-service.md` owns these terms, and each one needs a value list or an example.

- transport form: no approved page names a value of a transport form, and `project-service.md` enumerates none.
- upstream revocation, expiry and OAuth refresh: `project-service.md` names each change and works no instance of it, so no example exists yet.
- cardinality: `project-service.md` states that the kind of a binding determines the cardinality, and it names no cardinality of any kind.
