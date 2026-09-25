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

A provider account binding holds one capability.

- **a model inference call**

These are the capabilities that `project-service.md` names, and the page closes no set across every resource kind.

- A commit, a branch and a merge are local, so none of them is a capability.

## platform

The platform is the external platform that a binding names.
The set is open.
The first version holds one value.

- **GitHub**

The repository binding of `kanthorlabs/kanthord` names GitHub.
A self-hosted address reveals no platform, so the binding names it explicitly.

## custom provider

The provider that a human defines for a server that serves the OpenAI API.
The term names no closed set.

- The provider account binding `atlas-llm` names the custom provider and the base URL `https://llm.atlas.internal/v1`.
- It names the approved model `qwen3-coder` with a context window of 32768 and a maximum of 8192 output tokens.
- Its resource identity is `openai-compatible:account:llm.atlas.internal`.

## binding name

The name that a human chooses for a binding, unique inside its project.
The term names no closed set.

Project `atlas` names its worker binding `general-main` and its provider account binding `openai-atlas`. The `swe@1` entry of `general-main` names `openai-atlas`. A second binding named `general-main` in `atlas` is refused.

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
- **worker**: any number of bindings of one worker, each with its own configuration.
- **provider account**: one binding for each account at a provider.
- **source**: one binding for each delivery source that the project accepts.

The project of "Account recovery" binds two repositories, one `tdd@1` worker as `tdd-main` and two provider accounts at one provider.
A second binding for the repository `kanthorlabs/kanthord` is refused, and a second `tdd@1` binding `tdd-experimental` with another provider account is accepted.
A third `tdd@1` binding with the values of `tdd-main` is accepted.

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

One version of the configuration of a binding, or one version of a credential store record.

A worker binding holds one entry that names a model identifier.
The project changes the model identifier.
The identity of the binding stays, and the change creates a revision.
Every reference to that binding stays valid, because a reference never names a revision.
An execution that resolves that revision records it.
A change to the credential reference of a provider account binding creates a revision of that binding too.
A credential store record keeps its identity across a rotation, an OAuth refresh and every other change to its secret material, and none of those changes creates a revision, because a reference names the record and never its content.

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

## credential name

The name that a human chooses for a credential store record, unique on the server.
The term names no closed set.

The record `credential_A` holds the credential name `atlas-github`.
A second `credential create` with `atlas-github` returns the holder `credential_A`.

## credential reference

What a binding holds for a capability that it requires.

- The repository binding of `git@github.com:kanthorlabs/kanthord.git` names one API key of GitHub for every platform action.
- Git uses the SSH configuration of the host.
- A credential reference names a record of the credential store.

## credential store

The store that holds one record for a secret.

The credential store holds one record for one API key, a fine-grained personal access token of the organization `kanthorlabs`.
Two projects use that key.
The store holds that one record.
Each project holds its own binding that names the record.
A rotation changes that one record, and every binding that names the record stays valid.
Unrestricted selection of a record is the danger, and central storage is not.

## credential store record

One record of the credential store.

A record holds one API key of the account `org-kanthorlabs` at OpenAI, and it names the remote identity.
A human selects the record that satisfies a capability.
The type of the record decides the class of operation that the record performs.
The record serves more than one project.

## coverage

One of the two checks that validate a credential reference.

- The repository binding of `git@github.com:kanthorlabs/kanthord.git` requires one API key of GitHub for every platform action.
- Git uses the SSH configuration of the host.
- The submission names no credential reference, so coverage fails.

## suitability

The other of the two checks that validate a credential reference.

A repository binding requires a platform action.
Its credential reference names a record that holds an API key of the account `org-kanthorlabs` at OpenAI.
Suitability fails, because an API key of a model provider does not perform a platform action.
Suitability states no scope, because a binding does not narrow upstream authority.
Coverage and suitability are the whole validation of a credential reference.

## custody

The holding of the secret material of a resource credential behind a protected facility.

The credential store holds an API key behind the protected facility, a fine-grained personal access token of the organization `kanthorlabs`.

- An execution requests a platform action on `git@github.com:kanthorlabs/kanthord.git`.
- Its repository binding names one API key of GitHub for every platform action.
- Git uses the SSH configuration of the host.
- The facility checks the binding of the project, then it consults custody.

The execution holds no credential under the [custody rule](project-service.md#authorization-and-credential-custody).
Holding the repository binding does not confer custody of the key.
A credential handover alone lets material leave the server for the `worker` application, which belongs to the kanthord installation and is no external harness.

## credential handover

Custody transfers the credentials of one execution, encrypted, to the `worker` application that hosts that execution.

The execution of `Add password reset` runs at the `worker` placement on the host `build-02`.

- It resolves the provider account binding `openai-main` and the repository binding of `git@github.com:kanthorlabs/kanthord.git`.
- The repository binding names one API key of GitHub for every platform action.
- Git uses the SSH configuration of the host.
- Custody hands over the API key of `openai-main` and the fine-grained personal access token of the organization `kanthorlabs`.

The `worker` application on `build-02` decrypts both and connects to OpenAI and to GitHub itself.
When the execution ends, the application discards both.

The provider account binding `copilot-main` names an OAuth credential of GitHub Copilot.
The handover carries its access token and its refresh token.
The execution runs for nine hours and refreshes four times on `build-02`.
The application reports each refreshed credential to custody.

## login session

One attempt of a human to obtain an OAuth credential of a provider account on the server.
Its states form the closed set `pending`, `completed`, `failed` and `expired`.
Its modes form the closed set `browser` and `device`.

Ulrich starts a login session for GitHub Copilot in device mode.
The session states the address `https://github.com/login/device` and the code `ABCD-1234`.
Ulrich enters the code in a browser.
The session completes, and custody stores the credential of `copilot-main`.

Ulrich starts a login session for OpenAI Codex in browser mode from a laptop while the server runs on `build-01`.
The session states the authorization address.
Ulrich opens it, and the redirect to `localhost:1455` fails on the laptop.
Ulrich returns the redirect URL to the session, and the session completes.

## protected facility

The component that secret material sits behind.

An execution presents its execution identity and requests a platform action.
The protected facility resolves that identity to the project and to the node of the request.
The facility checks the binding of that project for the requested operation.
The facility consults custody after that check, so a refusal never reaches custody.

## system authorization

What kanthord permits an identity to access.

One API key of a git platform account authorizes every repository of that account.
A project holds no binding for one repository of that account.
The protected facility refuses an execution operation on that repository, because system authorization does not permit it.
The Project Service enforces system authorization.

The Gateway Service authenticates `ulrich` and passes the human identity of `ulrich` to a downstream service.
The Project Service authorizes that human identity for an operation on any project of the server.

## credential authority

What the remote permits any holder.

The remote permits any holder of the API key to act on the whole account.
The Project Service records that authority, and no binding narrows it.
An operation that is in progress ends against the remote, because the remote holds the credential authority.

## remote identity

The identity at the remote that a credential store record acts as.
The value is one string in three colon-separated parts, `<platform>:<identity kind>:<identifier>`.
The term names no closed set, because a new platform adds its own identity kinds.

- `github:user:ulrich` for a classic personal access token of that account.
- `github:organization:kanthorlabs` for a fine-grained personal access token that the organization owns.
- `openai:organization:org-kanthorlabs` for a key of that account at OpenAI.

An OAuth credential does not imply a person, so the record states that identity.
The remote identity and the execution identity stay separate.
kanthord records the remote identity and it asks no remote to confirm it.

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
- **expiry**: The credential reaches its end date at the remote. The API key of a provider account expires, the next model inference call ends against the remote, and the recorded revision that an execution resolved still states what it selected.
- **OAuth refresh**: Custody obtains a new token behind the record. The OAuth credential of `kanthorlabs` is refreshed, the reference and every binding that names it stay unchanged, and no revision is created.

A change to the secret material behind an unchanged credential reference changes no binding.
