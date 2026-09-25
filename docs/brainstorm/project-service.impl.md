---
title: Project Service Implementation
---

# Project Service Implementation

This file holds the implementation rulings for the mechanisms that realize [project-service.md](project-service.md).
This file is not a design document, and `project-service.md` stays the single source of truth, so a mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.
The binding store and authorization use these mechanisms.

The implementation adds no package.
Node.js 24.15.0 and the installed set satisfy every requirement.
The installed set provides `node:sqlite` `DatabaseSync`, `node:crypto` `hkdfSync`, `createCipheriv`, `createDecipheriv`, `createHmac`, `createHash`, `randomBytes` and `timingSafeEqual`.
It also provides `zod` at 4.4.3 and `ulid`.
The repository action catalog supports GitHub.
[Custody](custody.impl.md#platform-implementations) owns credential platforms.
The GitHub action catalog holds exactly two actions.

- `pull_request` opens a pull request from the node branch into the base branch. It requires the platform action capability. Its expected end state is the merge of that pull request.
- `merge_push` merges the node branch into the base branch and pushes. It requires the network git write capability. Its expected end state is the push to the base branch.
- Each action implies its expected end state and takes no parameter.
- A repository strategy holds at most one action, because a policy configures one external action.

## The binding store

The Project Service owns its tables in the operational database, and [architecture.impl.md](architecture.impl.md) rules that file and its driver.
It reads no table of another service.
The tables are below.

- `project_project(id, name, binding_set_version, created_at)` holds the identity of a project and the version of its binding set.
- A new project takes binding-set version 1 in `binding_set_version`.
- Its first write names version 1 and commits version 2.
- `project_binding(id, project_id, name, kind, resource_identity, current_revision, created_at, removed_at)` holds the identity of a binding.
- `project_binding_revision(id, project_id, binding_id, revision, config, created_at)` holds one immutable row for each revision, and `config` holds the configuration as the canonical JSON that [architecture.impl.md](architecture.impl.md) rules.

Every table above holds `id` as its first column and `project_id` as its second column.
A binding references the [credential store](custody.impl.md#the-credential-store-record) through custody, never through a direct table read.
A project creation inserts the `project_project` row and calls the Mission collaboration `createMission` inside the same transaction, which [architecture.impl.md](architecture.impl.md) rules.

The constraints are below.

- A unique index over `project_project.name` enforces the uniqueness of a project name, and the name is the natural key of the project creation.
- A project name follows the form of a binding name.
- A creation or a rename to a name that another project holds returns 409 with code `project.name_conflict` and the identity of that project in `error.details`.
- A rename commits in one transaction, and the last write wins.
- The Project Service keeps a removed binding and every revision for the life of the project, and no sweep deletes them. Only a human edit adds a row, so the tables grow with human edits alone.
- The primary key of `project_binding` is `id`, an identity of the convention that [architecture.impl.md](architecture.impl.md) rules, so a binding identity is unique across the server and satisfies the rule of `project-service.md` that it is unique inside its project.
- `project_binding.current_revision` carries a composite foreign key to `project_binding_revision`, whose own real key is the pair of the binding and the revision under a unique index.
- A partial unique index over `project_id` and `name` where `removed_at` is absent enforces the uniqueness of a binding name among the current bindings, so a removed binding releases its name.
- `project_binding.resource_identity` names the resource that the binding allocates, and a partial unique index over `project_id` and `resource_identity` where `removed_at` is absent enforces the cardinality of the kind, so a project binds a resource again after its removal. The section below gives its form. A worker binding holds no resource identity, because a project holds any number of bindings of one worker, and SQLite treats two absent values as distinct. `kind` stays a plain column that the validation reads.
- A credential reference and a reference to another binding sit inside `config`, and the write validates each one against `project_binding`. SQLite enforces no foreign key inside JSON.
- A binding name holds 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens.
- A new binding takes revision 1.

A binding identity and a project identity follow the identity convention of [architecture.impl.md](architecture.impl.md).

## The identities of the Project Service

- A binding identity is `binding_<ulid>` for every binding kind, because the entity kind is the binding and `kind` is a column.
- Validation of the `binding` claim of a machine JWT checks the `binding_` prefix and the canonical ULID portion.
- [gateway-service.impl.md](gateway-service.impl.md#the-jwt) rules that JWT.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.

## The resource identity

`resource_identity` holds the normalized identity of the resource that a binding allocates, in three colon-separated parts, `<platform>:<resource kind>:<identifier>`.
It names the resource that the binding allocates, and `credential.remote_identity` names the identity that a credential acts as at a remote. The two hold the same form and never the same subject.
A per-kind function derives it from the binding configuration on every write, so a human enters it never and it disagrees with that configuration never.
The values of the first version are below.

- `github:repository:kanthorlabs/kanthord` for the repository binding with the SSH address `git@github.com:kanthorlabs/kanthord.git`.
- `github:webhook:kanthorlabs/kanthord` for the source binding of the GitHub webhook of that repository.
- A worker binding holds no value.

The middle part names the resource and not the binding kind, so a GitHub webhook and a source of another platform hold different values under the one kind `source`.
Normalization decides a revision against a replacement.

- A repository identity derives from its SSH address alone.

## The write of a binding set

A write submits the complete binding set of the project as one object keyed by binding name.
The submission names the version of the binding set that the client read.
One `BEGIN IMMEDIATE` transaction holds the read of `project_project.binding_set_version`, the comparison, the difference and every write of the edit.
The transaction refuses a submission that names another version, so two concurrent writes never interleave.
It increments that column on every write that it commits.
The transaction spans no `await`, no network call and no nested transaction, because one synchronous connection serves four services.
The current binding set is the set of the rows of `project_binding` that hold no `removed_at`.
A reference inside a submission names a binding name of that submission. The transaction resolves each reference to the identity that the name holds after the write, and it stores that identity in the configuration. A stored reference always holds an identity.
The transaction compares the canonical JSON of each configuration, so a reordered property of the submission creates no revision.
The outcomes of the comparison by binding name are below.

- A name with an unchanged configuration keeps its identity and its revision.
- A name whose configuration changed and whose named resource stays keeps its identity and takes a new revision, and the transaction inserts one `project_binding_revision` row.
- A name whose named resource changed takes a new identity, and the transaction sets `removed_at` on the binding that held the name.
- A new name adds a binding with a generated identity at revision 1.
- A name that the submission omits takes `removed_at`, and the transaction keeps its rows.
- A worker binding whose worker changed under the same name is refused.
- A submission equal to the stored set increments the version and changes no binding.

A dependent reference follows the name, so a new identity under a name repoints every dependent reference in the same edit and gives each dependent binding a new revision.
Validation refuses a set that references a binding name that the submission does not hold.
The invocation chain records the answer of the edit in memory after the commit, which [gateway-service.impl.md](gateway-service.impl.md#idempotency-of-a-mutation) rules, and a repeat of the edit after a restart runs the handler again against the same submitted set.

## Revision, disablement and rotation

A revision is the unit of a configuration change.
The local disablement of a binding is a field of the configuration, so a disablement creates a revision.
A resolution reads `current_revision` of the binding row, so a disablement takes effect at the next resolution and cancels no operation in flight.
[Custody](custody.impl.md#the-credential-store-record) owns credential rotation and record revisions.
A secret change behind an unchanged reference creates no binding revision.

## Validation

One `zod` schema at 4.4.3 covers each binding kind, and a discriminated union on the kind covers the set.
A schema validates the shape, and a `superRefine` validates the relations of the whole set.
The validation of the whole set runs at the write, and the validation of one binding with its dependencies runs again at each resolution.
A rejected configuration prevents use, so a resolution that fails validation refuses the operation.
The write refuses a submission that changes the worker of an existing worker binding under the same binding name.

- Worker binding validation calls [Worker configuration validation](worker-service.impl.md#agent-configuration-validation) inside the write transaction.
- Repository credential validation consumes [custody suitability](custody.impl.md#suitability) with `{ credential, platform }`.
- The `instanceCount` field is an integer from 0 to 64. A value outside that range refuses the write with `project.bindings.worker.instance_count_range`.
- An instance count of 0 makes the worker binding unavailable. A worker binding holds no `available` field.
- The repository, source and storage kinds keep `available`.
- A `projectPrompt` above 32768 UTF-8 bytes refuses the write with `project.bindings.repository.project_prompt_too_large`.
- Every repository binding names exactly one `credential` of type `api_key` of its platform. An absent credential refuses the write.
- An HTTPS repository address refuses the write.
- A strategy with more than one action refuses the write.

## Storage configuration

The `storage` binding names one S3-compatible bucket of a project.
A project holds at most one current storage binding.
The set validation and a partial unique index on `project_id` for current `storage` rows enforce that cardinality.
The configuration holds these fields beside `available`:

- `endpoint`: required URL of the S3-compatible service.
- `bucket`: required nonblank bucket name.
- `region`: required nonblank region.
- `prefix`: required text for the object-key prefix.
- `credential`: required reference to a custody record, never inline secret material.

The storage binding sends `{ credential, platform: s3 }` to [custody's use check](custody.impl.md#suitability).
The work endpoint, bucket, region and prefix stay in the binding.
Validation checks the field types, the endpoint URL, the custody reference and project cardinality at write and resolution.
An absent field, invalid value or second storage binding refuses the write.
The binding write probes no store capability or version support.
The store controls object versioning; kanthord enforces no object immutability.
A human who disables versioning accepts that choice.
Without a storage binding, the Mission Service accepts only inline evidence content, not object uploads.

Tests reject absent fields, invalid values, an unknown custody reference and a second storage binding.
Tests accept an `s3` credential and refuse a credential of another platform.
Tests assert that suitability compares no endpoint, bucket or region metadata.
Tests assert that binding writes make no capability probe and that stores without versions remain valid.
Tests preserve the storage binding revision in each object evidence record.

## Worker binding configuration

- A worker binding holds `instanceCount`, optional `resourceBudget` and optional per-agent entries.
- [Entry forms](worker-service.vocabulary.md#entry) define those overrides; the binding holds no `options`.
- [Stop and budget](worker-service.impl.md#stop-and-budget) defines the budget schema and defaults.
- The Project Service offers `entriesOfAgent(tx, agentName)` through its `contract.ts`.
- It returns entries of every worker binding whose worker references that agent, including bindings with no explicit entry.
- The write calls `validateEntry(tx, workerName, entry)` of the Worker Service for every agent of the worker.
- The [co-location contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) holds both calls inside the write transaction.

## The resolution of a binding

An execution calls the resolution at the moment that it needs the resource.
One read resolves the dependency chain of the binding.
For an agent configuration, the Project Service asks the [Worker Service](worker-service.impl.md#agent-configuration-validation).
The Project Service merges no configuration itself.
It checks the disablement of every binding of the chain, and a disabled or removed member refuses the operation.
The resolution records the revision of every binding of the chain, and not the revision of the worker binding alone.
It performs no cache, because `DatabaseSync` reads the local file synchronously.
A recorded revision authorizes nothing, so the next operation resolves the chain again.

## The webhook key

[architecture.impl.md](architecture.impl.md) holds the field `masterKey` of the configuration file, the rule that a service derives its keys from it and never uses it directly, and the cipher key of the `credential` table.
The Project Service derives its keys with `crypto.hkdfSync`, SHA-256 and an empty salt.

- `HKDF(masterKey, info = "webhook/<binding id>/<rotation>")` is the verification secret of one source binding.

It derives that secret at the moment that it needs one, so no webhook secret sits in the store.
A manual replacement of `masterKey` invalidates every derived webhook secret.
A human pastes a new value at the platform for every source binding.

## Authorization integration

The Project Service supplies system authorization to [custody's protected facility](custody.impl.md#the-protected-facility).
It permits the Scheduler Service to read an external object and the Intake Service to use acquisition grants.
External-object resolution reaches the repository binding, project and node through authoritative records, never caller-supplied associations.

## Presigned storage grants

Custody mints a presigned storage grant inside `use` after the protected facility authorizes the operation.
Custody derives the endpoint, bucket and credential from the storage binding.
The Mission Service supplies the server-generated object key, never an agent-selected destination.
A PUT grant authorizes one object upload and expires after 1 hour.
It requires the checksum header only when begin supplies a SHA-256.
Custody also provides the object metadata check for complete and a presigned GET for an authorized reader's kanthord component.
The GET addresses the recorded version when one exists.
Each grant authorizes one operation on one object for a bounded time.
The API answer carries the URL directly to the component, never through the credential handover.
The storage credential stays in server custody at every placement and every co-location.
The component keeps the grant outside the context of an agent.
kanthord cannot prove that a harness keeps it out of the model context; the single-object scope bounds that risk.

Tests assert authorization before custody use and derive the destination only from the checked binding and server-generated key.
Tests assert the 1 hour PUT expiry, optional checksum header and authorized GET for the recorded object version.
Tests assert that no storage credential or presigned URL enters the handover, logs or agent context.
Tests refuse grants for unauthorized readers or executions without a live claim.

## The acquisition grant

- The operation is `project.acquisition_grant`, a `unary` mutation under the `service` access policy, reachable through the direct adapter alone. Its input holds the source binding identity, the kind from `webhook-register`, `poll` and `stream-open`, and the subscription identity. Its caller is the service identity of the Intake Service, and the facility refuses every other service identity for this operation.
- The facility resolves the source binding to its project and credential record. The source binding configuration names that record for its platform. The facility checks the disablement of the binding and refuses a disabled or removed binding.
- The answer holds the grant identity `acquisition_grant_<ulid>`, the acquisition material, the platform, the remote identity of the record and the expiry. The acquisition material is the record's pi-ai credential value or platform token. The value contract of [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters) names this operation as one of the two whose answer carries credential material. [intake-service.md](intake-service.md#boundary) requires that material in the memory of the Intake Service. For `webhook-register`, the answer also holds the current verification secret of the source binding. The log and the idempotency component redact the answer, and no HTTP route reaches the operation.
- The table `project_acquisition_grant(id, project_id, source_binding_id, subscription_id, kind, service, credential_id, issued_at, expires_at, ended_at, end_reason)` records every grant. `end_reason` is one of `session_end`, `binding_disabled`, `binding_removed`, `credential_rotated`, `expired`. The row holds no material.
- The code fixes the maximum lifetime at 24 hours from `issued_at`, and a sweep every minute ends an expired grant.
- A grant ends through `project.acquisition_grant_end`, a `unary` mutation under the `service` policy. The Intake Service calls it with the grant identity when its session ends, and the facility writes `session_end`.
- The facility revokes a grant when a binding set edit commits a disablement or removal of its source binding. It also revokes the grant when the material of its credential record changes and at its expiry. The revocation writes `ended_at` and `end_reason` in the same transaction as the cause where one exists. After the commit, the facility calls `intake.grant_revoked` of the Intake Service with the grant identity and the reason. That operation is a `unary` mutation under the `service` policy. The facility retries a lost answer with backoff until the Intake Service acknowledges, because the Intake Service closes the acquisition at once on receipt.
- The facility refuses `use` for an acquisition grant, because the Intake Service performs its acquisition itself with the material.
- A registration of a webhook, a poll and a stream open each consume one grant of their kind. A subscription holds at most one open grant at a time.

## The network git operations

Custody performs a network git read and a network git write through the repository connector of the Worker Service, which runs the git CLI.
Custody requires git 2.40 or later and OpenSSH 9.0 or later on the host, and it stops the start when the host holds neither.
It passes no secret on the command line of a child, because the command line of a process is readable by every user of the host.

- Custody supplies no material for git.
- The `git` child inherits the SSH environment of the user that runs the hosting application.
- That environment includes `SSH_AUTH_SOCK`, and SSH uses the host files `~/.ssh/config` and `~/.ssh/known_hosts`.
- Custody sets no `GIT_SSH_COMMAND` and no `GIT_SSH`.
- At every repository binding write, custody runs one `git ls-remote` of that repository through the repository connector.
- The read precedes the `BEGIN IMMEDIATE` transaction.
- A deadline of 30 s bounds that read.
- A failed or timed-out read refuses the write with the error code `project.bindings.repository.ssh_unreachable`.
- Custody attributes a network git operation to no credential record.

## The resource healthcheck

The [resource healthcheck rule](architecture.md#resource-healthcheck) governs the checks that the Project Service owns.
The [Gateway Service](gateway-service.impl.md#the-resource-healthcheck-report) bounds the checks and groups their entries.

- A repository binding runs the SSH read of [the network git operations](project-service.impl.md#the-network-git-operations).
- That read answers `project.bindings.repository.ssh_unreachable` on failure and reports the capability `network git read`.
- The resource healthcheck deadline replaces the binding-write deadline for this read.
- The target rule permits one read per repository address in a request.
- The network git operation keeps its existing attribution rule.
- The call record holds no check result.

[Custody](custody.impl.md#the-resource-healthcheck) owns credential checks.
The [Worker Service](worker-service.impl.md#agent-provider-healthcheck) owns agent provider checks.

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

- A test covers a creation and a rename to a taken project name, and it asserts 409 with the identity of the holder.
- A test covers a project creation whose mission insert fails, and it asserts that no project row remains.
- Tests cover repository coverage and custody suitability; an absent platform key and an HTTPS repository address fail.
- Tests assert `validateEntry` inside the write transaction and refusal when an agent lacks enabled enablement.
- Tests assert that `entriesOfAgent` includes every dependent binding, including bindings without explicit entries.
- A test asserts one SSH read per repository address, its failure code and the resource healthcheck deadline.
- A test asserts that the repository check names no credential store record in its attribution.
- A test covers integer instance counts from 0 to 64, invalid counts and the error code. It checks that 0 makes the binding unavailable.
- A test covers the project prompt bound in UTF-8 bytes and its error code.
- A test covers both GitHub actions, their capabilities and their implied expected end states. It refuses more than one action.
- A test covers each of the five changes, and it asserts the revision that each one creates.
- A test covers a disablement that takes effect at the next resolution, and a consumed grant that authorizes no second operation.
- A test covers an omitted name, a name whose resource changed, a set that references a name absent from the submission, and a dependent reference that follows a new identity under its name.
- A test covers a worker change under the same name, and it asserts that the write refuses the change.
- A test covers the reuse of a name after its removal.
- A test covers a stale binding-set version and a submission equal to the stored set.
- A test covers two concurrent writes of one binding set, and it asserts that the second one is refused.
- A test covers a reordered JSON property that creates no revision.
- A test covers a resolution of the whole dependency chain, and it asserts the recorded revision of each member.
- A test covers the derivation of a webhook secret, and it asserts that two labels produce two different secrets.
- A test covers a `masterKey` that decodes to other than 32 bytes.
- A test covers an execution identity that names another node, a machine identity that names no live registration, and a client identity whose worker binding is not the worker binding of the claim.
- A test covers a repository binding whose network git read fails. It asserts that the Project Service refuses the write with its error code.
- A test covers a worker binding that is absent, removed or unavailable, and it asserts that the verification of a machine JWT that names it fails.
- A test covers a missing, a duplicate, a malformed and a wrong-length delivery signature, and a valid signature over the exact bytes.
- A test covers an increment of `webhookSecretRotation`, and it asserts that a delivery signed with the previous secret fails.
- A test asserts that no log record and no error body holds secret material.
- A test covers an acquisition grant for a disabled source binding, and it asserts the refusal.
- A test covers a binding set edit that disables a source binding with an open grant. It asserts the `binding_disabled` row and the revocation call.
- A test covers a grant beyond 24 hours, and it asserts the `expired` row and the revocation call.
- A test asserts that the answer of `project.acquisition_grant` reaches no HTTP route and appears redacted in every log record.
- A test covers a call of `project.acquisition_grant` under the service identity of the Scheduler Service, and it asserts the refusal.

## Open decisions of an epic

- The shape of the RESTful API of the binding set, which [gateway-service.impl.md](gateway-service.impl.md) registers as routes.
- The replacement of `masterKey`, which makes every stored ciphertext unreadable and every webhook secret stale, and which no command performs today.
