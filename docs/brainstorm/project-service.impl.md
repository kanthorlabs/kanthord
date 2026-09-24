---
title: Project Service Implementation
---

# Project Service Implementation

This file holds the implementation rulings for the mechanisms that realize [project-service.md](project-service.md).
This file is not a design document, and `project-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
A change to it changes the binding store, the protected facility or custody.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.
The installed set provides `node:sqlite` `DatabaseSync`, `node:crypto` `hkdfSync`, `createCipheriv`, `createDecipheriv`, `createHmac`, `createHash`, `randomBytes` and `timingSafeEqual`.
It also provides `zod` at 4.4.3 and `ulid`.
The first version holds one platform entry, GitHub.
Slack, Telegram and Jira hold no platform entry until their design lands.
A credential type is no platform, because an API key spans platforms.

## The binding store

The Project Service owns its tables in the operational database, and [architecture.impl.md](architecture.impl.md) rules that file and its driver.
It reads no table of another service.
The tables are below.

- `project_project(id, name, binding_set_version, created_at)` holds the identity of a project and the version of its binding set.
- `project_binding(id, project_id, kind, resource_identity, current_revision, created_at, removed_at, replaced_by)` holds the identity of a binding.
- `project_binding_revision(id, project_id, binding_id, revision, config, created_at)` holds one immutable row for each revision, and `config` holds the configuration as the canonical JSON that [architecture.impl.md](architecture.impl.md) rules.

Every table above holds `id` as its first column and `project_id` as its second column.
The credential store sits in the shared table `credential`, which [architecture.impl.md](architecture.impl.md) rules with its envelope and its cipher key.
The Project Service owns that table through custody, and a binding names one of its records with a credential reference.

The constraints are below.

- The primary key of `project_binding` is `id`, an identity of the convention that [architecture.impl.md](architecture.impl.md) rules, so a binding identity is unique across the server and satisfies the rule of `project-service.md` that it is unique inside its project.
- `project_binding.current_revision` carries a composite foreign key to `project_binding_revision`, whose own real key is the pair of the binding and the revision under a unique index.
- `project_binding.resource_identity` names the resource that the binding allocates, and a unique index over `project_id` and `resource_identity` enforces the cardinality of the kind. The section below gives its form. A worker binding holds no resource identity, because a project holds any number of bindings of one worker, and SQLite treats two absent values as distinct. `kind` stays a plain column that the validation reads.
- A credential reference and a reference to another binding sit inside `config`, and the write validates each one against `project_binding`. SQLite enforces no foreign key inside JSON.

A binding identity and a project identity follow the identity convention of [architecture.impl.md](architecture.impl.md).

## The identities of the Project Service

- A binding identity is `binding_<ulid>` for every binding kind, because the entity kind is the binding and `kind` is a column.
- A credential record identity is `credential_<ulid>`.
- Validation of the `binding` claim of a machine JWT checks the `binding_` prefix and the canonical ULID portion.
- [gateway-service.impl.md](gateway-service.impl.md#the-jwt) rules that JWT.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.

## The resource identity

`resource_identity` holds the normalized identity of the resource that a binding allocates, in three colon-separated parts, `<platform>:<resource kind>:<identifier>`.
It names the resource that the binding allocates, and `credential.remote_identity` names the identity that a credential acts as at a remote. The two hold the same form and never the same subject.
A per-kind function derives it from the binding configuration on every write, so a human enters it never and it disagrees with that configuration never.
The values of the first version are below.

- `github:repository:kanthorlabs/kanthord` for the repository binding of that repository, under either transport form of its address.
- `openai:account:org-kanthorlabs` for the provider account binding of that account.
- `github:webhook:kanthorlabs/kanthord` for the source binding of the GitHub webhook of that repository.
- A worker binding holds no value.

The middle part names the resource and not the binding kind, so a GitHub webhook and a source of another platform hold different values under the one kind `source`.
Normalization decides a revision against a replacement. `git@github.com:kanthorlabs/kanthord.git` and `https://github.com/kanthorlabs/kanthord.git` are one repository, so a change between them changes the transport form alone, creates a revision and invalidates no reference.

## The write of a binding set

A write submits the complete binding set of the project.
The submission names the version of the binding set that the client read.
One `BEGIN IMMEDIATE` transaction holds the read of `project_project.binding_set_version`, the comparison, the difference and every write of the edit.
The transaction refuses a submission that names another version, so two concurrent writes never interleave.
It increments that column on every write that it commits.
The transaction spans no `await`, no network call and no nested transaction, because one synchronous connection serves four services.
The current binding set is the set of the rows of `project_binding` that hold no `removed_at` and no `replaced_by`.
The transaction compares the canonical JSON of each configuration, so a reordered property of the submission creates no revision.
The outcomes of the comparison are below.

- An unchanged binding keeps its revision.
- A binding whose configuration changed takes a new revision, and the transaction inserts one `project_binding_revision` row.
- A binding whose named resource changed takes a new binding identity, and the transaction sets `replaced_by` on the binding that it replaces.
- A binding that the submission omits takes `removed_at`, and the transaction keeps its rows.
- A submission equal to the stored set increments the version and changes no binding.

A removal differs from a replacement.
A removal names no successor, and a replacement names one in `replaced_by`.
Validation refuses a set that references a removed binding, a replaced binding or a binding that does not exist.
The submitted set therefore carries the repointing of every dependent binding, which `project-service.md` requires in one edit.
The invocation chain records the answer of the edit in memory after the commit, which [gateway-service.impl.md](gateway-service.impl.md#idempotency-of-a-mutation) rules, and a repeat of the edit after a restart runs the handler again against the same submitted set.

## Revision, disablement and the change of a remote

A revision is the unit of a configuration change.
The local disablement of a binding is a field of the configuration, so a disablement creates a revision.
A resolution reads `current_revision` of the binding row, so a disablement takes effect at the next resolution and cancels no operation in flight.
A change to the secret material behind a credential record creates no revision, because a reference names the record and never its content.
A rotation therefore updates one `credential` row in place and creates a revision nowhere.
An `oauth` record obtains material through the refresh of pi-ai, which runs inside `modify` under the credential store lock.
That refresh updates the row in place and creates no revision.
A change to the remote that a record authorizes is no rotation.
It is a change to the resource, so it creates a replacement binding in every project that names that record, and each of those projects submits that edit.
The Project Service marks such a record and refuses a resolution that reaches it through a binding which no edit repointed.

## Validation

One `zod` schema at 4.4.3 covers each binding kind, and a discriminated union on the kind covers the set.
A schema validates the shape, and a `superRefine` validates the relations of the whole set.
The validation of the whole set runs at the write, and the validation of one binding with its dependencies runs again at each resolution.
A rejected configuration prevents use, so a resolution that fails validation refuses the operation.

## The worker template registry

A worker template is a static module of the server.
The registry maps a worker name to its template, and it loads no runtime plugin.
A template declares its agents, the default configuration of each agent, the options that a project overrides and the constraint of a whole configuration.
The template expresses the options as a `zod` schema and the constraint as a `superRefine` of that schema.
The registry holds `general@1` and `reviewer@1`, which [worker-service.impl.md](worker-service.impl.md) names as the workers of the first version.

## The resolution of a binding

An execution calls the resolution at the moment that it needs the resource.
One read resolves the dependency chain of the binding.
For a worker binding the chain holds the binding, its revision, the entry of the agent, the provider account binding that the entry names and the default account of the provider that the default configuration names.
The resolution merges the entry over the default configuration, adds the provider account, and parses the result against the schema of the template.
It checks the disablement of every binding of the chain, and a disabled or replaced member refuses the operation.
The resolution records the revision of every binding of the chain, and not the revision of the worker binding alone.
It performs no cache, because `DatabaseSync` reads the local file synchronously.
A recorded revision authorizes nothing, so the next operation resolves the chain again.

## The credential store record

A record holds one secret of one type.
The types are below, and each one names the class of operation that it performs.

- **api_key**: `{type:"api_key", key}` of pi-ai. For a git platform the key is a personal access token, classic or fine-grained. It performs a network git read and a network git write under the HTTPS transport form, and a platform action under both forms. For a provider account the key performs a model inference call. API key providers include `openai` and `anthropic`.
- **oauth**: `{type:"oauth", refresh, access, expires}` of pi-ai. It performs a model inference call for a provider whose pi-ai provider carries OAuth: `anthropic`, `openai-codex`, `github-copilot` and `openrouter`.

The first version registers those two types and no other.

Suitability is a pure function of the type, the capability and the transport form, over the table above.
Coverage is a pure function of the required capabilities, the transport form and the credential references of the binding.
The two functions are the whole validation of a credential reference, and neither one reads secret material.

## The remote identity of a record

`remote_identity` holds one string in three colon-separated parts, `<platform>:<identity kind>:<identifier>`.
The identifier is the login, the slug or the path that the remote displays, and no numeric identity.
The identity kind holds `user` and `organization` in the first version, and a new platform adds its own values.
The server never asks the remote to confirm the value, so the field records an intent that a human wrote and that a human reads when selecting a record.
The values of the first version are below.

- `github:user:ulrich` for a classic personal access token of that account.
- `github:organization:kanthorlabs` for a fine-grained personal access token that the organization owns.
- `openai:organization:org-kanthorlabs` for a key of that account at OpenAI.

Custody logs each human creation or update of a record with the human identity of the caller and the record identity.
The record names no such actor itself, so that log is the whole attribution.

## The keys of the Project Service

[architecture.impl.md](architecture.impl.md) holds the field `masterKey` of the configuration file, the rule that a service derives its keys from it and never uses it directly, and the cipher key of the `credential` table.
The Project Service derives its keys with `crypto.hkdfSync`, SHA-256 and an empty salt.

- `HKDF(masterKey, info = "webhook/<binding id>/<rotation>")` is the verification secret of one source binding.

It derives that secret at the moment that it needs one, so no webhook secret sits in the store.
A hand replacement of `masterKey` makes every stored credential unreadable, so a human enters each secret again into the record that holds its identity, and every binding that names that record stays valid.
The same replacement invalidates every derived webhook secret, so a human pastes a new value at the platform for every source binding.

## The protected facility

The protected facility is one module of the Project Service.
It exposes one authorization function and one use function, and it exposes no function that returns secret material.
The authorization function takes the identity of the requester, the binding and the requested capability, and it returns a grant or a refusal.
The grant is a frozen value that a module-private `WeakSet` records, as [gateway-service.impl.md](gateway-service.impl.md) records a human identity, so no caller fabricates one.
The grant serves one operation, and custody consumes it at the first use.
A disablement therefore reaches every later operation, because a consumed grant authorizes none.
The facility resolves each identity as below.

- A human identity passes `isHumanIdentity` of [gateway-service.impl.md](gateway-service.impl.md), and the facility authorizes it for the operation.
- A machine identity passes `isMachineIdentity` of [gateway-service.impl.md](gateway-service.impl.md), and it names the client identity, the worker binding and the project that the verification of its JWT resolved.
- An execution identity resolves to the node of its claim through a call into the Scheduler Service module, and the facility refuses an operation that names another node.
- A service identity passes `isServiceIdentity` of the kernel, which [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) rules.
- The facility permits each service its own classes: the Scheduler Service the read of an external object, and the Intake Service the acquisition classes.
- The acquisition classes act on a source binding.
- The facility resolves the external object through its own store to the repository binding, the project and the node.
- It takes no association from the caller.

An operation of an execution that an external harness hosts presents the machine identity and the execution identity together.
The facility proves the whole chain: the JWT authenticated the client identity, the JWT names its worker binding, the machine identity names a live registration, the claim of the execution names that worker binding and that instance, the claim is live, and the node of the claim is the node of the operation.
A break at any link refuses the operation.
The facility consults custody after the check, so a refusal reads no ciphertext.

## The use of a secret

Custody exposes `use(grant, request)`.
The request names the operation and its parameters, and it names no destination.
Custody derives the destination from the binding that the grant checked, so a caller reaches no remote of its own choice.
Custody performs the operation, and it returns the result of the operation and no material.
The material leaves the server only through a credential handover.
A child process that the server spawns, configures and reaps is part of the server, so the material that reaches `git` stays inside the server.
The material enters no log record, no workspace file, no transcript, no tool result and no error body.
`pino` redacts the paths of the material, and a test asserts each path.
Custody fills its plaintext buffer with zeroes when the operation returns.
That cleanup is best effort, because a parsed string and a cached token outlive the buffer in this runtime.
[worker-service.impl.md](worker-service.impl.md) owns the trust boundary of the host, including the host of every `worker` application.
Custody defends the material against a record of the system, and it defends nothing against a party that controls that host.

## The credential store of an execution

- Custody implements the `CredentialStore` contract of `@earendil-works/pi-ai` at 0.86.0: `read(providerId)`, `list()`, `modify(providerId, fn)` and `delete(providerId)`.
- A provider account binding names its pi provider id in its configuration, from the closed set of providers that pi-ai ships. Resolution rejects an unknown id.
- Custody builds one store view for each execution. `read(providerId)` maps the pi provider id of the agent's provider account binding to the one credential store record that the binding names. It answers `undefined` for every other id, and the store holds one credential per pi provider id.
- `list()` returns the one non-secret pair of provider id and credential type. `modify()` serializes on the record and writes the result of pi-ai in place. The view refuses `delete()`.
- At the `server` placement the view reads custody directly and the plaintext never leaves the process.
- At the `worker` placement the view is the decrypted handover.
- Custody drops the view when the execution ends.

## The credential handover

- The handover is the answer of `worker.handover` of the Worker Service, which [worker-service.impl.md](worker-service.impl.md#the-credential-handover) declares. This `client` operation has `unary` lifetime and requires a live execution.
- The payload holds the canonical JSON list of the credentials that the capabilities of the execution require. Each entry holds its record identity, its pi provider id or its git platform, and its pi-ai credential.
- The envelope uses AES-256-GCM under `HKDF(masterKey, info = "handover/aes-256-gcm/v1")`, a 12-byte random nonce and a 16-byte tag. The additional authenticated data concatenates the length-prefixed execution identity and runtime identity of the instance.
- The `worker` application holds the same `masterKey` and derives the same key.
- The report uses `worker.credential`, a `client` mutation that requires a live execution. Its body holds one refreshed credential under the same envelope, and its handler writes the record in place.
- Custody marks a record as handed over while a live execution at the `worker` placement holds it. It refreshes no such record itself, and the mark ends with the execution.
- Two executions may hold one record at once. The epic determines whether each provider rotates the refresh token on refresh and invalidates the other holder.
- Custody emits one log record on each handover and report, naming the execution identity and the record identity and no material.
- `pino` redacts the payload paths, and a test asserts each path.

## The network git operations

Custody performs a network git read and a network git write through the repository connector of the Worker Service, which runs the git CLI.
Custody requires git 2.40 or later and OpenSSH 9.0 or later on the host, and it stops the start when the host holds neither.
It passes no secret on the command line of a child, because the command line of a process is readable by every user of the host.

Under the HTTPS transport form, custody sets `GIT_ASKPASS` in the environment of the git child to a helper of the server, and it passes the token in that environment.
The helper prints the token for the password prompt and the account name for the username prompt.
The helper writes no file and it reaches no socket.
At the `worker` placement the application runs the same helper with the token of the handover.

- Under the SSH transport form, custody supplies no material.
- The `git` child inherits the SSH environment of the user that runs the hosting application.
- That environment includes `SSH_AUTH_SOCK`, and SSH uses the host files `~/.ssh/config` and `~/.ssh/known_hosts`.
- Custody sets no `GIT_SSH_COMMAND` and no `GIT_SSH`.
- At the write of a repository binding under the SSH form, custody runs one `git ls-remote` of that repository through the repository connector.
- A deadline of 30 s bounds that read.
- A failed or timed-out read refuses the write with the error code `project.bindings.repository.ssh_unreachable`.
- Custody attributes a network git operation under the SSH form to no credential record.

## The platform action

Custody attaches the credential to the request of a platform implementation inside `use`.
An api key of a git platform travels in the `Authorization` header of that request, and custody builds that header and returns it to no caller.
Custody mints no token and caches no token for a platform action, because that capability uses an API key in the first version.
A request that the remote refuses fails the operation closed, and custody records the failure against the record.

## The model inference call

Custody serves the model inference call through the credential store of the execution.
[worker-service.impl.md](worker-service.impl.md) owns the runtime that consumes it.

## The client identity

The Project Service holds no table of client identities and no secret of a client identity.
[gateway-service.impl.md](gateway-service.impl.md#the-jwt) generates the client identity inside a machine JWT, and its verification asks the Project Service whether the worker binding of that JWT exists and is available.
The answer resolves the project of the worker binding from the current revision of the binding configuration.

## The verification of a delivery

The delivery route is `/hooks/<binding id>`, inside the path group that [gateway-service.impl.md](gateway-service.impl.md) reserves.
The path names the binding, because a signature does not say which source sent the delivery, and a binding identity is unique across the server.
The path holds no secret.

Custody exposes `verifyDelivery(sourceBindingId, bytes, headers)`.
The function derives the verification secret of that source binding, and it reads no stored secret.
The configuration of the source binding holds one integer, `webhookSecretRotation`, which enters the derivation.
An increment of that integer produces a new secret and creates a revision of the binding, and a human pastes the new value at the platform.
A `GET` route of the source binding returns the current secret, so a human reads it again at any time. `GET` is no mutation, so the idempotency middleware of the Gateway Service records no secret.
For a GitHub delivery the function requires exactly one `X-Hub-Signature-256` header.
It rejects a missing header, a duplicate header, a value without the `sha256=` prefix, a value that is not hexadecimal and a value of another length, before any comparison.
It computes the HMAC with `crypto.createHmac` and SHA-256 over the exact bytes, and it compares two 32-byte digests with `timingSafeEqual`.
The signature of the platform over the exact bytes stays the proof of authenticity of a delivery, which [gateway-service.impl.md](gateway-service.impl.md) requires of an untrusted ingress.
[gateway-service.impl.md](gateway-service.impl.md) states that the Gateway Service passes the exact bytes, so the function re-serializes nothing.
The function names no requester identity, and it returns a boolean and no secret.
A valid HMAC proves the possession of the secret alone.
It authenticates no other header, it establishes no repository, and it detects no replay.
The GitHub implementation of [worker-service.impl.md](worker-service.impl.md) associates the payload with its repository, and the Scheduler Service owns the duplicate effect of a repeated delivery.
This sibling states no replay window.

## Repository layout, build, test and release

The Project Service source sits under `src/project/` of the `engine` repository.
A test file sits beside its source as `*.test.ts`.
`node --test` runs the tests.
`tsc -p tsconfig.build.json` builds into `dist/`.
The `kanthord` bin of `package.json` releases it.

## Tests

- A test covers coverage and suitability against every pair of a type and a capability, under both transport forms.
- A test covers each of the five changes, and it asserts the revision that each one creates.
- A test covers a disablement that takes effect at the next resolution, and a consumed grant that authorizes no second operation.
- A test covers an omitted binding, a replaced binding, a set that references either one, and a submission that repoints every dependent binding.
- A test covers a stale binding-set version and a submission equal to the stored set.
- A test covers two concurrent writes of one binding set, and it asserts that the second one is refused.
- A test covers a reordered JSON property that creates no revision.
- A test covers a resolution of the whole dependency chain, and it asserts the recorded revision of each member.
- A test covers the derivation of a webhook secret, and it asserts that two labels produce two different secrets.
- A test covers a `masterKey` that decodes to other than 32 bytes.
- A test covers an execution identity that names another node, a machine identity that names no live registration, and a client identity whose worker binding is not the worker binding of the claim.
- A test covers a repository binding under the SSH form whose network git read fails. It asserts that the Project Service refuses the write with its error code.
- A test covers a worker binding that is absent, removed or unavailable, and it asserts that the verification of a machine JWT that names it fails.
- A test covers a missing, a duplicate, a malformed and a wrong-length delivery signature, and a valid signature over the exact bytes.
- A test covers an increment of `webhookSecretRotation`, and it asserts that a delivery signed with the previous secret fails.
- A test asserts that no log record and no error body holds secret material.
- A test covers the round trip of a handover envelope, a payload moved to another execution identity, and a truncated payload.
- A test covers a store view that answers `undefined` for a provider id outside the binding of the execution. It covers a refresh through `modify` that updates the row in place and creates no revision.
- A test covers a report of a refreshed credential for an execution that is not live, and it asserts 403.

## Open decisions of an epic

- The shape of the RESTful API of the binding set, which [gateway-service.impl.md](gateway-service.impl.md) registers as routes.
- The retention of a removed binding, of a replaced binding and of an old revision.
- The replacement of `masterKey`, which makes every stored ciphertext unreadable and every webhook secret stale, and which no command performs today.
- The record of the failure of a credential, and the healthcheck of a provider account, which [HANDOFF.md](HANDOFF.md) holds as a B9 item.
- The support of a GitHub App installation credential, which the first version omits and which needs a short-lived token, a mint and a cache.
- The rotation behaviour of the refresh token of each OAuth provider under two concurrent holders.
- The login flow of an OAuth provider account. pi-ai drives a device code or a browser callback through an interactive prompt, and every CLI command is non-interactive.
