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

## platform

The platform is the external platform that a binding names.
The set is open.
The first version holds one value.

- **GitHub**

The repository binding of `kanthorlabs/kanthord` names GitHub.
A self-hosted address reveals no platform, so the binding names it explicitly.

## transport form

The transport form of a repository address determines the credential type that its network git read and write require.
The set is closed and it holds two values.

- **SSH**: A network git read and a network git write require an SSH key.
- **HTTPS**: A network git read and a network git write require an OAuth credential or an API key of the git platform.

A platform action requires an OAuth credential or an API key under both forms.
The address `git@github.com:kanthorlabs/kanthord.git` has the SSH form, so its repository binding names an SSH key for the git read and the git write and an OAuth credential for the platform action.
The address `https://github.com/kanthorlabs/kanthord.git` has the HTTPS form, so one OAuth credential of the git platform satisfies all three capabilities.

## binding kind

The kind of a binding determines its configuration, the cardinality that a project permits, and its validation.
`project-service.md` names four kinds, and it closes no set of kinds.

- **repository**
- **worker**
- **provider account**
- **source**

The mission of a project is intrinsic to that project, so no binding allocates it.
A repository binding of the objective "Add password reset" permits three capabilities, and its cardinality permits one binding for each repository that the project uses.

## cardinality

The number of bindings of one kind that a project holds for one resource.
The set is closed for each kind and it holds four values.

- **repository**: one binding for each repository that the project uses.
- **worker**: any number of bindings of one worker, and two bindings of one worker carry different configuration.
- **provider account**: one binding for each account at a provider.
- **source**: one binding for each delivery source that the project accepts.

The project of "Account recovery" binds two repositories, one `tdd@1` worker as `tdd-main` and two provider accounts at one provider.
A second binding for the repository `kanthorlabs/kanthord` is refused, and a second `tdd@1` binding `tdd-experimental` with another provider account is accepted.

## binding set

The bindings that one project holds.

A project binds two repositories, one `tdd@1` worker and two provider accounts.
The `tdd@1` binding holds no entry, so its agents run on their default configuration, and the default account of each provider serves them.
The Project Service rejects the set when it references a binding that does not exist.
The Project Service validates the set when the project writes it, and it validates a binding again when an execution resolves it.

## entry

The override of the default configuration of one agent inside a worker binding.
The term names no closed set.

The worker binding `general-frontier` of `general@1` holds an entry for its agent that names the model identifier `gpt-6-astra` and the reasoning effort `high`, and nothing else.
Every other value of the agent comes from the default configuration that `general@1` declares.

## effective configuration

The configuration of one agent under one worker binding: the values that the entry names, and the default configuration for every other value.
The term names no closed set.

Under `general-main`, which holds no entry, the effective configuration of the agent is its default configuration, and the default account of its provider serves it.
Under `general-frontier`, the effective configuration takes the model identifier and the reasoning effort from the entry and the provider from the default configuration.
The Project Service rejects the binding set when `gpt-6-astra` refuses an option that the default configuration supplies.

## default account

The provider account binding that serves a native agent whose entry names no account, for the provider of its default configuration.
A project holds at most one default account for each provider.

Project `atlas` marks `openai-dev` as the default account of `openai`.
A human adds `openai-review` without the mark, and `general-main` keeps `openai-dev`.
The binding `general-frontier` names `openai-review` in its entry.

## revision

One version of the configuration of a binding.

A worker binding holds one entry that names a model identifier.
The project changes the model identifier.
The identity of the binding stays, and the change creates a revision.
Every reference to that binding stays valid, because a reference never names a revision.
An execution that resolves that revision records it.
A change to the credential reference of a provider account binding creates a revision of that binding too.

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
An execution requests a network git write.
The facility checks the binding of the project, then it consults custody.
No credential leaves the daemon, so the execution holds no credential.
Holding the repository binding does not confer custody of the key.

## protected facility

The component that secret material sits behind.

An execution presents its execution identity and requests a platform action.
The protected facility resolves that identity to the project and to the node of the request.
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

The identity that an execution presents.

A `tdd@1` worker instance executes an objective and produces an execution object.
That execution holds its own execution identity, and the instance presents that identity for a network git write.
The protected facility resolves that identity to the project and to the node of the request.
The record of the operation names the execution identity.

## client identity

The identity that an external harness presents.

`claude-code` requests a platform action through the API, and it presents its client identity.
The protected facility resolves that identity to the project, then it checks the binding.
The external harness holds no credential.
`project-service.md` names the execution identity of an execution and the client identity of an external harness.
The project permits `claude-code` with an executor identity and a reviewer identity.
The record that permits each one configures its role and its execution count.
The Project Service issues a client secret for each of the two identities when `ulrich` creates their records.

## client secret

The secret that the Project Service issues once for a permitted client identity and that an external harness presents with that identity to authenticate a request.

`ulrich` creates the record that permits `claude-code-executor`, and the Project Service returns its client secret once and keeps the hash in custody.
`claude-code` presents `claude-code-executor` and that secret on a targeted claim, and the Project Service verifies the hash before it resolves the identity.
A request that names `claude-code-reviewer` without its secret is refused before any resolution.
A rotation issues a new secret and keeps the identity, its role and its execution count.

## execution count

The configured count of live executions that a permitted client identity holds.

The executor identity of `claude-code` holds an execution count of 2, so it holds at most two live executions.

## service identity

The identity that the observer of the Scheduler Service presents.

The observer reads pull request 42 of "Add password reset" under its service identity.
The facility resolves that identity through the external object to the repository binding, the project and the node.
The observer performs no operation class other than the read of an external object.

## source binding

The binding of a delivery source that a project accepts.

The project binds the GitHub webhook source of its repository.
The binding holds the verification secret behind custody.
The Project Service verifies each delivery as its own operation.

## resolution

One act of an execution that resolves a binding for one operation.

An execution needs a network git write, and it resolves the repository binding at that moment.
That resolution authorizes one operation, and the next operation resolves the binding again.
The execution records the binding revision that it resolves.
A local disablement takes effect at the next resolution.

## base branch

The branch of a repository that the repository strategy names as the origin of every node branch and as the target of the configured repository action.
The term names no closed set.

Project `atlas` names `develop` as the base branch of `kanthorlabs/kanthord` and `main` as the base branch of `kanthorlabs/apps`.
Every node branch of an objective on `kanthorlabs/kanthord` starts from `develop`, and the pull request of the objective targets `develop`.

## expected end state

The state that a configured repository action states on the git platform.

Under a repository strategy that requires a pull request for every change, the configured repository action opens a pull request.
The expected end state of that action is the merge of that pull request.
Under a repository strategy that requires a merge and push, the expected end state is the push to the base branch.
[overview.md](viewer.html?p=overview.md) owns landing, which is the observed expected end state.

## fire-and-forget action

An external action that its accepted request resolves, with no end state to observe.
The kind of an external action is a closed set of two values.

- **fire-and-forget action**
- **request-reply action**

Execution 2 posts a notification about "Add password reset" in `#account-recovery`.
The Mission Service accepts the request and records the external object, and no observation follows.

## request-reply action

An external action that an accepted observation of its end state resolves.

Execution 2 opens pull request 42 for "Add password reset" with the expected end state merged.
The observer records the merge, and that accepted observation resolves the action.

## the five changes

`project-service.md` names five different changes.
The set is closed and it holds five values.

- **local disablement**: It takes effect at the next resolution. A recorded revision never authorizes an operation after it.
- **upstream revocation**: The remote withdraws the credential. A human revokes the OAuth credential of `kanthorlabs` at GitHub. The record and every binding that names it stay unchanged, the next platform action ends against the remote, and a human rotates the record.
- **rotation**: It changes one record, and every binding that names that record stays valid.
- **expiry**: The credential reaches its end date at the remote. The API key of a provider account expires, the next model inference call ends against the remote, and the recorded revision that an execution resolved still states what it selected.
- **OAuth refresh**: Custody obtains a new token behind the record. The OAuth credential of `kanthorlabs` is refreshed, the reference and every binding that names it stay unchanged, and no revision is created.

A change to the secret material behind an unchanged credential reference changes no binding.
