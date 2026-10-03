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
[Custody](custody.impl.md#platform-validators) owns credential platforms.
The GitHub action catalog holds exactly two actions.

- `pull_request` opens a pull request from the node branch into the base branch. It requires the platform action capability. Its expected end state is the merge of that pull request.
- `merge_push` merges the node branch into the base branch and pushes. It requires the network git write capability. Its expected end state is the push to the base branch.
- Each action implies its expected end state and takes no parameter.
- A repository strategy holds at most one action, because a policy configures one external action.
- The key of a configured action is `<binding name>.<action name>`, for example `kanthord-repo.pull_request`. It matches `^[a-z][a-z0-9-]{0,62}\.(pull_request|merge_push)$` and holds at most 76 bytes: 63, the separator and the longest catalog name. A new catalog action extends the alternation. The key is stable for the life of the binding, because a change of the binding name is a replacement binding under [project-service.md](project-service.md#resource-and-binding-model).

## The binding store

The Project Service owns its tables in the operational database, and [architecture.impl.md](architecture.impl.md) rules that file and its driver.
It reads no table of another service.
The tables are below.

- `project_project(id, name, binding_set_version, created_at)` holds the identity of a project and the version of its binding set.
- A new project takes binding-set version 1 in `binding_set_version`.
- Its first write names version 1 and commits version 2.
- `project_binding(id, project_id, name, resource_identity, revision, config, created_at, removed_at)` holds one immutable row for each revision of a binding, and `config` holds the configuration as the canonical JSON that [architecture.impl.md](architecture.impl.md) rules.

Every table above holds `id` as its first column. Every table that belongs to a project holds `project_id` as its second column.
A binding references the [credential store](custody.impl.md#the-credential-store-record) through custody, never through a direct table read.
A project creation inserts the `project_project` row and calls the Mission collaboration `createMission` inside the same transaction, which [architecture.impl.md](architecture.impl.md) rules.

The constraints are below.

- A unique index over `project_project.name` enforces the uniqueness of a project name, and the name is the natural key of the project creation.
- A project name follows the form of a binding name.
- A creation or a rename to a name that another project holds returns 409 with code `project.name.conflict` and the identity of that project in `error.details`.
- An absent project answers 404 `project.project.not_found`. An absent binding, or a binding of another project, answers 404 `project.binding.not_found`.
- A rename commits in one transaction, and the last write wins.
- The Project Service keeps a removed binding and every revision for the life of the project, and no sweep deletes them. Only a human edit adds a row, so the tables grow with human edits alone.
- The primary key of `project_binding` is `id`, an identity of the convention that [architecture.impl.md](architecture.impl.md) rules, so the identity of a revision is unique across the server.
- A binding is the group of the rows that share `project_id` and `resource_identity`. A unique index over `project_id`, `resource_identity` and `revision` orders the revisions of a group, and the latest revision states the binding.
- The write refuses a binding name that another current binding of the project holds. A partial index cannot select the latest revision of a group, so the write checks this rule. A removed binding releases its name.
- `project_binding.resource_identity` names the resource that the binding allocates, and every kind holds a value. The section below gives its form. The first part of `resource_identity` is the binding kind, so no column holds the kind.
- A credential reference sits inside `config` and names a credential by its name, never a revision. The write validates it through custody. SQLite enforces no foreign key inside JSON.
- A binding name holds 1 to 63 characters: a lower-case letter first, then lower-case letters, digits and hyphens.
- A new binding takes revision 1.
- A tombstone is the next revision of a group with `removed_at` set and the last configuration copied.
- A disablement is the next revision with `available: false`, or with `instanceCount: 0` for a worker binding.

A binding identity and a project identity follow the identity convention of [architecture.impl.md](architecture.impl.md).

## The identities of the Project Service

- A binding identity is `binding_<ulid>` for every binding kind, because the entity kind is the binding and the first part of `resource_identity` is the binding kind.
- A binding identity names one revision of a binding, because each revision is one row of `project_binding`.
- Validation of the `project_id` claim of a machine JWT checks the `project_` prefix and the canonical ULID portion. Validation of the `resource_identity` claim checks the form `worker:kanthord:<binding name>` and the binding-name form.
- [gateway-service.impl.md](gateway-service.impl.md#the-jwt) rules that JWT.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.

## The resource identity

`resource_identity` holds the normalized identity of the resource that a binding allocates, in three colon-separated parts, `<kind>:<platform>:<identifier>`, and its first part is the binding kind.
A per-kind function derives it from the binding configuration on every write, so a human enters it never and it disagrees with that configuration never.
The values of the first version are below.

- `repository:github:kanthorlabs/kanthord` for the repository binding with the SSH address `git@github.com:kanthorlabs/kanthord.git`.
- `worker:kanthord:general-main` for the worker binding with the binding name `general-main`.
- `storage:s3:s3.eu-central-1.amazonaws.com/atlas-evidence` for the storage binding of the bucket `atlas-evidence` at that endpoint.

A submission carries `kind`, and the write uses it to select the configuration schema and the derivation. A read derives `kind` from the first part, and the validation refuses a first part outside the closed set of binding kinds.
Normalization decides whether a change stays in its group or starts a replacement.

- A repository identity derives from its SSH address alone.
- A worker identity derives from its binding name alone.
- A storage identity derives from the host of its endpoint and its bucket alone.

## The write of a binding set

A write submits the complete binding set of the project as one object keyed by binding name.
The submission names the version of the binding set that the client read.
One `BEGIN IMMEDIATE` transaction holds the read of `project_project.binding_set_version`, the comparison, the difference and every write of the edit.
The transaction refuses a submission that names another version with 409 `project.binding_set.version_conflict` and the current version in `error.details`, so two concurrent writes never interleave.
It increments that column on every write that it commits.
The transaction spans no `await`, no network call and no nested transaction, because one synchronous connection serves four services.
The current binding set holds the latest revision of each group of the project that is no tombstone.
A binding references no other binding.
The transaction compares the canonical JSON of each configuration, so a reordered property of the submission creates no revision.
The outcomes of the comparison by binding name are below.

- A name with an unchanged configuration keeps its latest revision, and the transaction inserts no row.
- A name whose configuration changed and whose resource identity stays inserts the next revision of its group.
- A name whose resource identity changed inserts a tombstone in its old group and revision 1 of the new group.
- A new name inserts revision 1 of its group, or the next revision after the tombstone of a group that it binds again.
- A name that the submission omits takes a tombstone, and the transaction keeps its rows.
- A worker binding whose worker changed under the same name is refused.
- A submission equal to the stored set increments the version and changes no binding.
- A worker group whose latest row after the edit is a tombstone or holds `instanceCount: 0` ends every live registration of the group. The transaction calls the Worker collaboration `endRegistrations(tx, projectId, resourceIdentity, now)` for that group. A lowered count of 1 or more ends no registration.

The binding set has one read route and one write route, and both serve the whole set.

- `project.bindingSet.get` at `GET /api/project/:projectId/binding-set` and `project.bindingSet.write` at `PUT /api/project/:projectId/binding-set` are `human` operations of `unary` lifetime.
- `BindingSet` holds `version` and `bindings`. `version` is the binding-set version. `bindings` is the object keyed by binding name, and each value holds `kind` and `config`.
- The read answers the current binding set as `BindingSet`. It holds no secret material.
- The write takes `BindingSet` as its body, and `version` names the version that the client read. A stale `version` answers 409 `project.binding_set.version_conflict` with the current version in `error.details`.
- The write answers the committed binding set as `BindingSet` at its new version.
- No route writes one field or one binding. An `instanceCount` of 0 disables a worker binding, and `available: false` disables a repository binding or a storage binding.

The invocation chain records the answer of the edit in memory after the commit, which [gateway-service.impl.md](gateway-service.impl.md#idempotency-of-a-mutation) rules, and a repeat of the edit after a restart runs the handler again against the same submitted set.

## Revision, disablement and rotation

A revision is the unit of a configuration change.
The local disablement of a binding is a field of the configuration, so a disablement creates a revision.
A resolution reads the configuration of its pinned revision.
A resolution checks the latest revision of the group of that revision, and a disablement refuses it.
A resolution checks the group for a tombstone after its pinned revision, and a removal refuses it.
A disablement and a removal therefore take effect at the next resolution and cancel no operation in flight.
[Custody](custody.impl.md#the-credential-store-record) owns credential rotation and record revisions.
A secret change behind an unchanged reference creates no binding revision.

## Validation

One `zod` schema at 4.4.3 covers each binding kind, and a discriminated union on the kind covers the set.
A schema validates the shape, and a `superRefine` validates the relations of the whole set.
The validation of the whole set runs at the write, and the validation of one binding with its dependencies runs again at each resolution.
A rejected configuration prevents use, so a resolution that fails validation refuses the operation.
The write refuses a submission that changes the worker of an existing worker binding under the same binding name with 409 `project.bindings.worker.resource_changed`.

- Worker binding validation calls [Worker configuration validation](worker-service.impl.md#agent-configuration-validation) inside the write transaction.
- Repository credential validation consumes [custody suitability](custody.impl.md#suitability) with `{ credential, platform }`.
- The `instanceCount` field is an integer from 0 to 64. A value outside that range refuses the write with `project.bindings.worker.instance_count_range`.
- An instance count of 0 makes the worker binding unavailable. A worker binding holds no `available` field.
- The repository and storage kinds keep `available`.
- A `projectPrompt` above 32768 UTF-8 bytes refuses the write with `project.bindings.repository.project_prompt_too_large`.
- The exact `projectPrompt` value `-` disables the project prompt layer under [prompt composition](worker-service.impl.md#prompt-composition).
- Every repository binding names exactly one `credential` of its platform. An absent credential refuses the write.
- An HTTPS repository address refuses the write with 400 `project.bindings.repository.address_invalid`.
- Two bindings of one submission with the same `resource_identity` refuse the write with 400 `project.bindings.duplicate_resource`.
- An entry that names an agent that the catalog does not declare for its worker refuses the write with 400 `project.bindings.worker.agent_unknown`.
- For a worker with no declared agent, the write first calls `validateEntry(tx, workerName, null)` inside the transaction, so an unknown worker name answers `worker.agent.configuration.invalid`.
- A worker binding of a known worker with no declared agent, an external harness, that carries `entries` or `resourceBudget` then refuses the write with 400 `project.bindings.worker.field_forbidden` with `details: { binding, field }`.
- A strategy with more than one action refuses the write.

## Storage configuration

The `storage` binding names one S3-compatible bucket of a project.
A project holds any number of storage bindings.
The configuration holds these fields beside `available`:

- `endpoint`: required URL of the S3-compatible service.
- `bucket`: required nonblank bucket name.
- `region`: required nonblank region.
- `prefix`: required text for the object-key prefix.
- `credential`: required credential name, never inline secret material.

The storage binding sends `{ credential, platform: s3 }` to [custody's use check](custody.impl.md#suitability).
The work endpoint, bucket, region and prefix stay in the binding.
Validation checks the field types, the endpoint URL and the custody reference at write and resolution.
An absent field or an invalid value refuses the write.
The binding write probes no store capability or version support.
The store controls object versioning; kanthord enforces no object immutability.
A human who disables versioning accepts that choice.
A node without a storage binding accepts only inline evidence content, not object uploads.

Tests reject absent fields, invalid values and an unknown custody reference.
Tests accept an `s3` credential and refuse a credential of another platform.
Tests assert that suitability compares no endpoint, bucket or region metadata.
Tests assert that binding writes make no capability probe and that stores without versions remain valid.
Tests preserve the pinned storage binding identity in each object evidence record.

## Worker binding configuration

- A worker binding holds `instanceCount`, optional `resourceBudget` and optional per-agent entries.
- [Entry forms](worker-service.vocabulary.md#entry) define those overrides; the binding holds no `options`.
- [Stop and budget](worker-service.impl.md#stop-and-budget) defines the budget schema and defaults.
- The Project Service offers `entriesOfAgent(tx, agentName)` through its `contract.ts`.
- It returns entries of every worker binding whose worker references that agent, including bindings with no explicit entry.
- The write calls `validateEntry(tx, workerName, entry)` of the Worker Service for every agent of the worker.
- The [co-location contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) holds both calls inside the write transaction.

## The credential dependents of a binding

- The Project Service offers `bindingsNaming(tx, credentialName)` to custody through its `contract.ts`.
- It answers every binding revision that names the credential, when that revision is the latest revision of its binding and no tombstone, or when no tombstone follows it and the Mission collaboration `liveNodesPinning(tx, bindingId)` answers a node.
- A binding edit that names another credential is permitted, so an older revision of the same binding can hold the dependency.
- Tests assert that a credential of a pinned older revision is a dependent, and that a rebind of every pinning node frees it once no open attempt pins the older revision, as a terminal state of every pinning node does.

## The resolution of a binding

An execution calls the resolution at the moment that it needs the resource.
One read resolves the pinned revision and its dependency chain.
For an agent configuration, the Project Service asks the [Worker Service](worker-service.impl.md#agent-configuration-validation).
The Project Service merges no configuration itself.
It checks the disablement and the removal of every binding of the chain, and a disabled or removed member refuses the operation.
The resolution records the identity of every revision of the chain, and not the identity of the worker binding revision alone.
It performs no cache, because `DatabaseSync` reads the local file synchronously.
A resolution authorizes one operation, so the next operation resolves the chain again.

- The Project Service offers `getBindingRevision(tx, bindingRevisionId)` to the Mission Service through its `contract.ts`. It answers the binding revision with its `projectId`, so the Mission Service checks the project ownership of a rebind target directly.

## Authorization integration

The Project Service supplies system authorization to [custody's protected facility](custody.impl.md#the-protected-facility) for its own entities only.
The Mission Service authorizes a request evidence, a configured action and an evidence asset, and the Worker Service authorizes a model inference credential.
The Project resolution checks the disablement and the removal of a binding revision for those services.

## The network git operations

- At every repository binding write, the Project Service performs one `git ls-remote` through the repository connector of the [Repository component](repository.impl.md#repository-connector).
- The read precedes the `BEGIN IMMEDIATE` transaction.
- A deadline of 30 s bounds that read.
- A failed or timed-out read refuses the write with 422 `project.bindings.repository.ssh_unreachable`.
- The [Repository implementation](repository.impl.md#the-ssh-environment) defines the SSH environment.

## The resource healthcheck

The [resource healthcheck rule](architecture.md#resource-healthcheck) governs the checks that the Project Service owns.
The [Gateway Service](gateway-service.impl.md#the-resource-healthcheck-report) bounds the checks and groups their entries.

- A repository binding runs the SSH read of [the network git operations](project-service.impl.md#the-network-git-operations).
- That read answers `project.bindings.repository.ssh_unreachable` on failure and reports the capability `network git read`.
- The resource healthcheck deadline replaces the binding-write deadline for this read.
- The target rule permits one read per repository address in a request.
- The network git operation follows the [Repository attribution rule](repository.impl.md#the-ssh-environment).
- The call record holds no check result.

[Custody](custody.impl.md#the-resource-healthcheck) owns credential checks.
The [Worker Service](worker-service.impl.md#agent-provider-healthcheck) owns agent provider checks.

## The client identity

The Project Service holds no table of client identities and no secret of a client identity.
[gateway-service.impl.md](gateway-service.impl.md#the-jwt) generates the client identity inside a machine JWT, and its verification asks the Project Service whether the worker binding of that JWT exists and is available.
The JWT names one binding group by `project_id` and `resource_identity`, and no revision.
The answer reads the latest row of that group. It refuses a disabled or removed binding, and a token whose `iat` is before the latest tombstone of the group.

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
- A test covers a removal, a removal by omission and a revision to `instanceCount: 0` of a worker binding with live registrations. It asserts the end of every live registration in the transaction of the write, that a failed write ends no registration, and that a lowered count of 1 ends no registration.
- A test covers a reordered JSON property that creates no revision.
- A test covers a resolution of the whole dependency chain, and it asserts the recorded revision of each member.
- A test covers the derivation of a webhook secret, and it asserts that two labels produce two different secrets.
- A test covers a `masterKey` that decodes to other than 32 bytes.
- A test covers an execution identity that names another node, a machine identity that names no live registration, and a client identity whose binding group is not the binding group of the claim.
- A test covers a repository binding whose network git read fails. It asserts that the Project Service refuses the write with its error code.
- A test covers a worker binding that is absent, removed or unavailable, and it asserts that the verification of a machine JWT that names it fails.
- A test asserts that no log record and no error body holds secret material.

## Open decisions of an epic

- The replacement of `masterKey`, which makes every stored ciphertext unreadable and every webhook secret stale, and which no command performs today.
