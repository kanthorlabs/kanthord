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
A repository binding names the platform `github`, `gitlab` or `bitbucket`. The [git-only platforms](repository.impl.md#git-only-platforms) `gitlab` and `bitbucket` support `merge_push` only.
The [Repository component](repository.impl.md#platform-validators) owns the repository credential platforms.
The GitHub action catalog holds exactly two actions.

- `pull_request` opens a pull request from the node branch into the base branch. It requires the platform action capability. Its expected end state is the merge of that pull request.
- `merge_push` merges the node branch into the base branch and pushes. It requires the network git write capability. Its expected end state is the push to the base branch.
- Each action implies its expected end state. Only `pull_request` takes a parameter: the optional `landing`, `human` or `kanthord`, default `human`. With `kanthord`, the action performer requests the merge as a separate outbound write after the request evidence of the attempt exists. With `human`, a human merges. The frozen action copies `landing` with `base_branch`.
- A change set that changes a gate file of the base declaration lands with `human` for that attempt, whatever `landing` the binding declares. The current assessment of the attempt records the changed gate files under [the affected test run](worker-service.impl.md#the-affected-test-run). The Mission Service refuses a `merge_push` action of that binding for that attempt with `gate_file_changed`.
- A repository strategy holds at most one action, because a policy configures one external action.
- The key of a configured action is `<binding name>.<action name>`, for example `kanthord-repo.pull_request`. It matches `^[a-z][a-z0-9-]{0,62}\.(pull_request|merge_push)$` and holds at most 76 bytes: 63, the separator and the longest catalog name. A new catalog action extends the alternation. The key is stable for the life of the binding, because a change of the binding name is a replacement binding under [project-service.md](project-service.md#resource-and-binding-model).

## The binding store

The Project Service owns its tables in the operational database, and [architecture.impl.md](architecture.impl.md) rules that file and its driver.
It reads no table of another service.
The tables are below.

- `project_project(id, name, created_at, paused_at)` holds the identity of a project and its [pause](#the-project-pause).
- The binding-set version is 1 plus the number of `project_binding` rows of the project. A new project has binding-set version 1. No row of `project_binding` is ever deleted, so every write that inserts a row raises the version.
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
- A disablement is the next revision with `available: false`, or with an effective instance count of 0 for a worker binding. That count is `worker_instances: []` for a native worker binding, or `instance_count: 0` for an external-harness binding.

A binding identity and a project identity follow the identity convention of [architecture.impl.md](architecture.impl.md).

## The identities of the Project Service

- A binding identity is `binding_<ulid>` for every binding kind, because the entity kind is the binding and the first part of `resource_identity` is the binding kind.
- A binding identity names one revision of a binding, because each revision is one row of `project_binding`.
- Validation of the `project_id` claim of a machine JWT checks the `project_` prefix and the canonical ULID portion. Validation of the `resource_identity` claim checks the form `worker:kanthord:<binding name>` and the binding-name form.
- [gateway-service.impl.md](gateway-service.impl.md#the-jwt) rules that JWT.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) rules the form.

## The workspace directory

- The workspace directory is `projects/<project identity>/` of the state directory.
- The project create commits the project, then it creates the directory.
- A consumer that finds the directory absent creates it before use.
- `project.get` and each item of `project.list` answer `workspace_directory`, the path of the workspace directory with the home directory written as `~`.
- No table holds the path. A read derives it from the project identity and the state directory.
- The project details view of the dashboard shows `workspace_directory` as the answer holds it.

## The project pause

- `project_project.paused_at` holds the time of the pause in Unix milliseconds. A null value states an active project.
- A migration adds the nullable column. Every earlier project stays active.
- `project.get`, each item of `project.list` and every project answer hold `paused_at`.
- `project.create` keeps the body `{ name }`, and the insert sets `paused_at` to null.
- `project.pause` at `POST /api/project/:project_id/pause` and `project.resume` at `POST /api/project/:project_id/resume` are `human` mutations of `unary` lifetime. They take no body.
- A pause sets `paused_at` to the transaction time. A resume sets `paused_at` to null. Each answers the project record.
- A pause of a paused project keeps its `paused_at` and writes nothing. A resume of an active project writes nothing. Both answer the project record.
- An absent project answers 404 `project.project.not_found`.
- A pause and a resume take no expected version. The last write wins, as for a rename.
- The resume calls the Scheduler wakeup `wake(projectId)` after its commit. The pause calls no wakeup.
- The Project Service implements the Scheduler collaboration [`projectPaused(tx, projectId)`](scheduler-service.impl.md#the-claim-selection). It answers `true` when `paused_at` holds a value. An absent project throws.
- The claim reads `projectPaused` inside its transaction, under [the claim](scheduler-service.md#claims-and-counts). A paused project answers the work pull `{ kind: "no-work" }`.
- The pause and the resume write no record of the Tracking Service.
- `project.pause` and `project.resume` are Workbench tools, and each call waits for the approval of a human.

## The resource identity

`resource_identity` holds the normalized identity of the resource that a binding allocates, in three colon-separated parts, `<kind>:<platform>:<identifier>`, and its first part is the binding kind.
A per-kind function derives it from the binding configuration on every write, so a human enters it never and it disagrees with that configuration never.
The values of the first version are below.

- `repository:github:kanthorlabs/kanthord` for the repository binding with the SSH address `git@github.com:kanthorlabs/kanthord.git`, and for the address `git@ssh.github.com:kanthorlabs/kanthord.git`.
- `worker:kanthord:coder-main` for the worker binding with the binding name `coder-main`.
- `storage:s3:s3.eu-central-1.amazonaws.com/atlas-evidence` for the storage binding of the bucket `atlas-evidence` at that endpoint.

A submission carries `kind`, and the write uses it to select the configuration schema and the derivation. A read derives `kind` from the first part, and the validation refuses a first part outside the closed set of binding kinds.
Normalization decides whether a change stays in its group or starts a replacement.

- A repository identity derives from the binding platform and from the owner and the repository of its SSH address. The SSH host of the address takes no part in it.
- A worker identity derives from its binding name alone.
- A storage identity derives from the host of its endpoint and its bucket alone.

## The write of a binding set

A write submits the complete binding set of the project as one object keyed by binding name.
The submission names the version of the binding set that the client read.
One `BEGIN IMMEDIATE` transaction holds the count of the binding-set version, the comparison, the difference and every write of the edit.
The transaction refuses a submission that names another version with 409 `project.binding_set.version_conflict` and the current version in `error.details`, so two concurrent writes never interleave.
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
- A submission equal to the stored set inserts no row and keeps the version.
- After the edit, the latest row of a worker group can be a tombstone or an external-harness row with `instance_count: 0`. The edit then ends every live registration of the group. The transaction calls the Worker collaboration `endRegistrations(tx, projectId, resourceIdentity, now)` for that group. A lowered count of 1 or more ends no registration. A revision to `worker_instances: []` ends no registration, because each removed instance drains under the next rule.
- A name that the edit removes from `worker_instances` is a lowered count at every placement. The write ends no registration of that instance. The binding entry of the instance turns `draining`, under [the instance exchange](worker-service.impl.md#the-instance-exchange) and [the server instances](worker-service.impl.md#the-server-instances). The live execution finishes, and the binding gets no new claim from that instance.
- The transaction reads `unmatchedClaims(tx, projectId)` of the [Scheduler Service](scheduler-service.impl.md#the-match) before and after its inserts. A pair that the after-read holds and the before-read lacks refuses the write with 409 `project.bindings.worker.node_unmatched` and `details: { node_ids }`. The refusal writes no row.
- After the commit of a binding-set write, the Project Service calls the Worker contract method `bindingsChanged(projectId)`.
- The Worker Service then sends the new binding entries to each running [server instance](worker-service.impl.md#the-server-instances) that the old list or the new list of a changed binding names. A binding write starts and stops no server instance.
- For a changed binding, `bindingsChanged(projectId)` also increments the `binding_version` of each instance at the `worker` placement that the old list or the new list names. A removed instance thus learns its `draining` state at its next heartbeat.

The binding set has one read route and one write route, and both serve the whole set.

- `project.binding_set.get` at `GET /api/project/:project_id/binding-set` and `project.binding_set.write` at `PUT /api/project/:project_id/binding-set` are `human` operations of `unary` lifetime.
- `BindingSet` holds `version` and `bindings`. `version` is the binding-set version. `bindings` is the object keyed by binding name, and each value holds `kind` and `config`.
- The read answers the current binding set as `BindingSet`. It holds no secret material.
- The write takes `BindingSet` as its body, and `version` names the version that the client read. A stale `version` answers 409 `project.binding_set.version_conflict` with the current version in `error.details`.
- The write answers the committed binding set as `BindingSet` at its new version.
- The answer of the write also holds `stale_pins`, under [Stale pins](#stale-pins).
- No route writes one field or one binding. An effective instance count of 0 disables a worker binding, and `available: false` disables a repository binding or a storage binding.

The invocation chain records the answer of the edit in memory after the commit, which [gateway-service.impl.md](gateway-service.impl.md#idempotency-of-a-mutation) rules, and a repeat of the edit after a restart runs the handler again against the same submitted set.

## Stale pins

The answer of a binding-set write holds `stale_pins`. The list shows the nodes that pin an older revision of a revised binding.

- `stale_pins` holds one item `{ node_id, binding_name, pinned_revision, current_revision }` for each pin of an older revision of a binding that the write revised.
- A revised binding keeps its name and its resource identity and gets the next revision of its group.
- An older revision is each revision of the same group below the new revision and above the latest tombstone of the group.
- A removed binding and a name with a new resource identity add no item.
- `binding_name` and `current_revision` name the new revision. `pinned_revision` is the revision that the node pins.
- The Project Service reads the pins through the Mission collaboration `currentNodePins(tx, projectId, bindingIds)` in the write transaction. It reads no Mission table.
- `currentNodePins` answers `{ node_id, binding_id }` for each node that is not terminal and not retired, when its current node revision pins one of the revisions.
- The node revision of an open attempt does not count. A node that a rebind moved to the new revision is not in the list.
- The list is in the order of `node_id`, then `binding_name`. A write with no revised binding answers `[]`.
- The list is read only, and the write moves no pin. [The rebind](mission-service.impl.md#the-rebind) is the only path that moves a pin.
- `project.binding.environment.set` writes the binding set, so its answer holds the same list.
- The CLI prints the list as a field of the answer of `project binding apply`.
- Tests list a pending node that pins an older revision. Tests list no terminal node, no retired node, no unchanged binding, no removed binding and no node on the new revision. Tests list no pin before a removal and no name with a new resource identity.

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

- Worker binding validation calls [Agent configuration validation](agent.impl.md#agent-configuration-validation) inside the write transaction.
- Repository credential validation consumes [custody suitability](custody.impl.md#suitability) with `{ credential, platform }`.
- A worker binding holds no `placement`. The field refuses the write with 400 `project.bindings.worker.field_forbidden` and `details: { binding, field }`. The [placement](worker-service.vocabulary.md#placement) is a field of each instance, and it never changes.
- A worker binding of a worker that kanthord hosts holds `worker_instances`. An external-harness binding holds `instance_count`. The other field refuses the write with 400 `project.bindings.worker.field_forbidden` and `details: { binding, field }`.
- The `instance_count` field of an external-harness binding is an integer from 0 to 64. A value outside that range refuses the write with `project.bindings.worker.instance_count_range`.
- `worker_instances` is required on a worker binding of a worker that kanthord hosts. A write without it refuses with 400 `project.bindings.worker.instances_required` and `details: { binding }`.
- `worker_instances` is a list of 0 to 64 unique instance names. Another shape, a list above 64 names or a repeated name refuses the write with 400 `project.bindings.worker.instances_invalid` and `details: { binding, instance }`.
- Each name names a live [worker instance](overview.vocabulary.md#worker-instance) record. An unknown or archived name refuses the write with 400 `project.bindings.worker.instance_unknown` and `details: { binding, instance }`.
- Each instance belongs to the worker of the binding. An instance of another worker refuses the write with 400 `project.bindings.worker.instance_worker_mismatch` and `details: { binding, instance, worker }`.
- One binding can list instances of different placements.
- A `container` instance is listed by at most one live worker binding over every project. A second listing refuses the write with 409 `project.bindings.worker.instance_shared` and `details: { binding, instance, listed_by: { project_id, binding } }`. One container runs the image of one environment.
- The Project Service reads the instance records, with their placements, through the Worker contract inside the write transaction.
- Any revision can change the list.
- The [holder rule](agent.impl.md#agent-configuration-validation) of the credential copies runs under Agent configuration validation for each listed instance.
- The `tags` field is a list of unique strings, and an absent field reads as `[]`. Each item matches `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` and holds at most 64 bytes. A nonlist value, a repeated item or an item that violates the form refuses the write with 400 `project.bindings.worker.tags_invalid` and `details: { binding, tag }`.
- Every worker binding holds `tags`, the binding of an external harness included.
- An effective instance count of 0 makes the worker binding unavailable. A worker binding holds no `available` field.
- The repository and storage kinds keep `available`.
- The `config` of a repository binding holds `prompts`, an optional `z.strictObject` with one optional string key for each agent name of `AGENT_DECLARATIONS`: `swe@1`, `re@1` and `env@1`. The catalog is the only list, and no new enum exists.
- A key outside the catalog refuses the write with 400 `gateway.request.validation_failed`.
- The write validates each text with the text validation of a prompt file: at most 32768 UTF-8 bytes and no control character other than a tab and a newline.
- A violation refuses the write with 400 `project.bindings.repository.prompt_invalid` and `details: { agent_name, reason }`. `reason` is `too_large` or `control_character`.
- A blank text counts as absent at the composition.
- The `prompts` of a binding revision joins the system prompt of the agent as `Instructions of repository <name>:` and the text. [agent.md](agent.md#prompt-composer) rules the order and the precedence.
- A change of `prompts` stores the next binding revision with a new binding ID. A node keeps its pinned binding revision, and `mission node rebind` moves the node to the current revision.
- The onboarding group of the binding takes the new binding ID as a changed row, and it clears `environment_from_agent`.
- The execution setup, `agent.get` with a binding and an `env@1` run read the text of the binding revision that each names.
- Tests cover each `prompts` key, an unknown key, each violation, a blank text and the revision that a change stores.
- Every repository binding names exactly one `ssh_credential` of platform `ssh`. An absent SSH credential refuses the write.
- The host of the address must be a member of the SSH host set of the binding platform. Another host refuses the write with 400 `project.bindings.repository.address_invalid`.
- The host of the address must hold a [pin](repository.impl.md#host-keys). An unpinned host refuses the write with 409 `repository.host_key.unpinned`.
- A repository binding of a git-only platform with a `credential` or with the action `pull_request` refuses the write with 400 `project.bindings.repository.action_unsupported`.
- A repository binding names at most one `credential` of its platform. The action `pull_request` without a `credential` refuses the write with 400 `project.bindings.repository.credential_required`.
- An HTTPS repository address refuses the write with 400 `project.bindings.repository.address_invalid`.
- Two bindings of one submission with the same `resource_identity` refuse the write with 400 `project.bindings.duplicate_resource`.
- An entry that names an agent that the catalog does not declare for its worker refuses the write with 400 `project.bindings.worker.agent_unknown`.
- For a worker with no declared agent, the write first calls `validateEntry(tx, workerName, null)` inside the transaction, so an unknown worker name answers `agent.configuration.invalid`.
- A worker binding of a known worker with no declared agent, an external harness, that carries `entries`, `resource_budget` or `worker_instances` then refuses the write with 400 `project.bindings.worker.field_forbidden` with `details: { binding, field }`.
- The binding write reads no placement status. The create of a `container` instance reads it, under [the operations of an instance](worker-service.impl.md#the-operations-of-an-instance).
- A strategy with more than one action refuses the write.
- A `landing` on an action other than `pull_request` refuses the write at the `landing` path.

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

- A worker binding of a worker that kanthord hosts holds `worker_instances`, optional `tags`, optional `resource_budget`, optional per-agent entries and the optional `environment`. An external-harness binding holds `instance_count` and optional `tags`.
- The effective instance count is the length of `worker_instances`, or `instance_count` for an external-harness binding. `workerBindingOf` answers the effective count as `instance_count`, so the registration count, the claim count and the Gateway verification read one value. [The worker pages](architecture.impl.md#the-worker-pages) state the rule of the dashboard.
- [Entry forms](worker-service.vocabulary.md#entry) define those overrides; the binding holds no `options`.
- [Stop and budget](worker-service.impl.md#stop-and-budget) defines the budget schema and defaults.
- The Project Service offers `entriesOfAgent(tx, agentName)` through its `contract.ts`.
- It returns entries of every worker binding whose worker references that agent, including bindings with no explicit entry.
- The write calls `validateEntry(tx, workerName, entry)` of the Worker Service for every agent of the worker.
- The [co-location contract](architecture.impl.md#the-operation-and-its-two-entry-adapters) holds both calls inside the write transaction.
- The Project Service offers `workerBindingsOf(tx, projectId)` to the Scheduler Service through its `contract.ts`. It answers `{ binding_id, worker_name, tags }` for each current worker binding that is no tombstone. `workerBindingOf` answers `tags` with the pinned row.
- A change of `tags` creates the next revision of the binding. A live execution keeps the tags of the row that its claim pins.
- A worker binding of a worker that kanthord hosts holds the optional key `environment`: the binding name of one repository binding of the project. Its `container` instances run the image of that environment, and the binding claims only the nodes that name that repository binding.
- An absent `environment` names the only repository binding of the project. A binding that lists a `container` instance with an absent key refuses the write with 400 `project.bindings.worker.environment_required` and `details: { binding }` when the project holds two repository bindings or more.
- A name that is no repository binding of the submitted set refuses the write with 400 `project.bindings.worker.environment_unknown` and `details: { binding, environment }`.
- `environment` on an external-harness binding refuses the write with 400 `project.bindings.worker.field_forbidden` and `details: { binding, field }`.
- The write stores the key as written. The default resolves at each read, so a write that adds a second repository binding refuses each binding that lists a `container` instance and holds no key.
- `workerBindingsOf` and `workerBindingOf` answer `environment`: the resource identity of the named or the default repository binding when the binding lists a `container` instance, else null.

## The credential dependents of a binding

- The Project Service offers `bindingsNaming(tx, credentialName)` to custody through its `contract.ts`.
- It answers every binding revision that names the credential, when that revision is the latest revision of its binding and no tombstone, or when no tombstone follows it and the Mission collaboration `liveNodesPinning(tx, bindingId)` answers a node.
- A binding edit that names another credential is permitted, so an older revision of the same binding can hold the dependency.
- The Project Service offers `bindingsListingInstance(tx, instanceName, credentialName)` to custody through its `contract.ts`. It answers every worker binding whose latest revision is no tombstone, lists the instance in `worker_instances` and names the credential in its agent configuration.
- Tests assert that a credential of a pinned older revision is a dependent, and that a rebind of every pinning node frees it once no open attempt pins the older revision, as a terminal state of every pinning node does.

## The resolution of a binding

An execution calls the resolution at the moment that it needs the resource.
One read resolves the pinned revision and its dependency chain.
For an agent configuration, the Project Service asks the Worker Service, which validates through the [Agent component](agent.impl.md#agent-configuration-validation).
The Project Service merges no configuration itself.
It checks the disablement and the removal of every binding of the chain, and a disabled or removed member refuses the operation.
The resolution records the identity of every revision of the chain, and not the identity of the worker binding revision alone.
It performs no cache, because `DatabaseSync` reads the local file synchronously.
A resolution authorizes one operation, so the next operation resolves the chain again.

- The Project Service offers `getBindingRevision(tx, bindingRevisionId)` to the Mission Service through its `contract.ts`. It answers the binding revision with its `project_id`, so the Mission Service checks the project ownership of a rebind target directly.

## Authorization integration

The Project Service supplies system authorization to [custody's protected facility](custody.impl.md#the-protected-facility) for its own entities only.
The Mission Service authorizes a request evidence, a configured action and an evidence asset, and the Worker Service authorizes a model inference credential.
The Project resolution checks the disablement and the removal of a binding revision for those services.

## The network git operations

- A repository address has the form `git@<host>:<owner>/<repository>.git` and carries no port. The connector takes the port of the host from a fixed table: 443 for `ssh.github.com`, `altssh.gitlab.com` and `altssh.bitbucket.org`, 22 for every other host. The host starts with a letter or a digit and holds only letters, digits, `.` and `-`.
- The dashboard checks the form and the host set, and it derives the identity without the host.
- The server reads no SSH configuration for the host. The host of the address must be a member of the SSH host set of the binding platform, and it must hold a pin.
- At every repository binding write, the Project Service checks each new or changed repository binding. A binding that is unchanged at the submitted version gets no check. For each checked binding, it releases the key of the `ssh_credential` through the `ssh_identity` grant. It performs one `git ls-remote` through the repository connector of the [Repository component](repository.impl.md#repository-connector), inside one private SSH agent.
- The read precedes the `BEGIN IMMEDIATE` transaction.
- A deadline of 30 s bounds the read.
- A failed or timed-out read refuses the write with 422 `project.bindings.repository.ssh_unreachable`. Its `details.failure_reason` holds the value of [the failure reason](repository.impl.md#the-failure-reason-of-a-git-operation).
- The [Repository implementation](repository.impl.md#the-ssh-identity) defines the SSH identity of an operation.
- The Project Service supplies the authorization function of the `ssh_identity` grant in `src/project/ssh-authorization.ts`, under [the release of an SSH key](custody.impl.md#the-release-of-an-ssh-key).

### Bindings that the address rule refuses

- An address host outside the SSH host set of the platform answers `unhealthy` with `failure_reason: address_invalid`. The binding check and the verify answer it.
- An address host in the set with no pin answers `unhealthy` with `failure_reason: host_key_unknown`. The binding check and the verify answer it.
- The execution setup and every Intake git operation refuse such a binding before any child process starts. The code is `project.bindings.repository.address_invalid` or `repository.host_key.unpinned`. The resource healthcheck answers `unhealthy`.
- The repair is three steps: edit the address to the real host, pin the host, and rotate the `ssh` credential.
- The release note of the first release with the SSH identity states these three repair steps.

## The resource healthcheck

The [resource healthcheck rule](architecture.md#resource-healthcheck) governs the checks that the Project Service owns.
The [Gateway Service](gateway-service.impl.md#the-resource-healthcheck-report) bounds the checks and groups their entries.

- A repository binding runs the SSH read of [the network git operations](project-service.impl.md#the-network-git-operations) under the service identity of the Project Service.
- An address host outside the SSH host set answers `project.bindings.repository.address_invalid`.
- That read answers `project.bindings.repository.ssh_unreachable` on failure and reports the capability `network git read`.
- The resource healthcheck deadline replaces the binding-write deadline for this read.
- The target rule permits one read per repository address in a request.
- The network git operation follows the [Repository attribution rule](repository.impl.md#the-ssh-identity).
- The call record holds no check result.
- `projectNameOf(tx, projectId)` answers the name of a project in the collection transaction of the health report. The Intake inventory callback of the composition root is its only consumer. It opens no transaction, and an absent project throws.

The [LLM](llm.impl.md#the-resource-healthcheck), [Repository](repository.impl.md#platform-validators) and [Storage](storage.impl.md#platform-validators) components own the credential checks of their platforms.
The [Agent component](agent.impl.md#agent-provider-healthcheck) owns agent provider checks.

## The binding verify

- `project.binding.verify` checks one repository binding at `POST /api/project/:project_id/binding/:binding_id/verify`. It is a read under `human` access. It takes no body and no mutation key.
- It checks the configuration of the revision that `binding_id` names.
- It runs the host set check, the pin check and the SSH read of the address with the deadline of the resource healthcheck. Then it calls the [record verify](architecture.impl.md#the-record-verify) of the `ssh_credential` and of the `credential` of the binding.
- It answers `{ address, ssh_credential, credential }`. `credential` is null for a binding without a credential. Each value is the health entry `{ status, capability, failure_reason }`. The `address` entry has the capability `network git read`. A host outside the set, an unpinned host or a failed read answers `unhealthy` with its `failure_reason`. A check whose git read exceeds its deadline answers `unknown` with `failure_reason: deadline_exceeded`.
- A refusal of the record verify refuses the request with the code of the record verify.
- A binding that is absent, belongs to another project, is removed or is no repository binding answers 404 `project.binding.not_found`.
- It stores no result.

## The binding check

- `project.binding.check` checks an unsaved repository configuration at `POST /api/project/:project_id/binding/check`. It is a read under `human` access. It takes the body `{ kind: "repository", config }` and no mutation key.
- It refuses a static violation with the code of the binding write: `credential_required`, `action_unsupported`, `address_invalid`, and the custody suitability of `ssh_credential` and `credential`.
- Then it runs the checks of [the binding verify](#the-binding-verify) on the configuration and answers the same `{ address, ssh_credential, credential }`.
- It stores nothing. An absent project answers 404 `project.project.not_found`.

## The environment of a repository binding

- The stored environment is the key `environment` of the repository binding configuration. Its value is one `devcontainer.json` document.
- Every key inside `environment` keeps its given name, for example `postCreateCommand`. The Dev Container specification or the document author gives that name. The `devcontainer.json` specification is the external requirement that [the naming rule](architecture.impl.md#the-operation-ids) asks for. A key that KanthorD adds, for example under `customizations.kanthord`, stays snake_case.
- `kernel/devcontainer.ts` of the `engine` repository parses the document. It accepts JSONC: `//` and `/* */` comments and trailing commas. It holds no package for JSONC.
- DECIDED 2026-10-23 by Aelita, pending Ulrich: the document accepts only these keys: `image`, `build.dockerfile`, `build.context`, `build.args`, `build.target`, `features`, `containerEnv`, `remoteEnv`, `onCreateCommand`, `updateContentCommand` and `postCreateCommand`. From the Onboarding component on, it also accepts `customizations.kanthord`.
- These inert keys are accepted and dropped from the build document, because no step of KanthorD acts on them: `$schema`, `name`, `customizations` of another tool, `forwardPorts`, `portsAttributes`, `otherPortsAttributes`, `remoteUser`, `containerUser`, `updateRemoteUserUID`, `userEnvProbe`, `overrideCommand`, `shutdownAction`, `hostRequirements`, `waitFor`, `postStartCommand`, `postAttachCommand`, `workspaceFolder`, `init`, `appPort` and `secrets`.
- The first layer drops all of `customizations`. The Onboarding component changes that rule: it keeps `customizations.kanthord` and drops only the `customizations` of another tool.
- Every other key refuses the document with `project.environment.key_refused`, which names the key, for example `build.options`, `dockerComposeFile`, `initializeCommand`, `privileged`, `runArgs`, `mounts`, `capAdd`, `securityOpt` and `workspaceMount`.
- A value that holds `${localEnv:` or `${env:` refuses the document with `project.environment.key_refused`, which names the key.
- `build.dockerfile`, `build.context` and each local feature resolve with `realpath` inside the workspace copy of the build. A path outside it refuses the build.
- A name of `containerEnv` or `remoteEnv` matches `^[A-Za-z_][A-Za-z0-9_]*$`, and a value holds no control character. Another name or value refuses the document.
- `customizations.kanthord` holds one key, `checks`: a list of 0 to 32 nonblank commands. The proof runs them. An absent key reads as `[]`.
- At `environment set` and at a binding-set write, a refused key, value or path answers 400 `project.environment.key_refused` with the message "The environment key <key> is refused: <reason>." and `details: { key, reason }`. A document that is no JSON object or that holds a wrong type answers 400 `project.environment.invalid`.
- Before the Onboarding component, a refused repository file fails the start of a `container` instance and logs `project.environment.key_refused` with the key and the reason. From the Onboarding component on, a refused repository file or a refused build ends the run with the class `build_failed` and the key in the output tail.
- `project.binding.environment.get` at `GET /api/project/:project_id/binding/:binding_id/environment` is a `human` read. It answers `{ source, commit, environment, reason, suite_pass }` of the target of the binding. `suite_pass` follows [the suite pass proposal](#the-suite-pass-proposal). `source` is a value of [the environment source](project-service.vocabulary.md#environment-source). `reason` holds the parse failure of a repository file, or null.
- `project.binding.environment.set` at `PUT /api/project/:project_id/binding/:binding_id/environment` is a `human` mutation with the body `{ environment }`. It writes the whole current binding set with the new key, so the change is a binding revision. A change of the key alone skips the `ls-remote` check of [the network git operations](#the-network-git-operations).
- `project.binding.environment.set` with `{ environment: null }` removes the key, so the source returns to the repository file or the next source.
- A base branch that the remote does not hold answers 422 `project.bindings.repository.base_branch_absent`.
- `kanthord project environment show <project-id> <binding-id>`, `kanthord project environment set <project-id> <binding-id> --file <path>` and `kanthord project environment unset <project-id> <binding-id>` call the two routes. `set` reads JSONC.
- `kanthord project environment export <project-id> <binding-id>` prints the `environment` of `show` as indented JSON. A user who wants one file for KanthorD and the CI commits that output. KanthorD never commits it.
- The setup of an execution reads the environment of the current revision of each repository binding at the claim. The image of a `container` instance reads the same revision. A node that pins an earlier revision therefore runs the current environment.
- At the `server` and the `worker` placements, only the setup commands `updateContentCommand` and `postCreateCommand` of a stored environment apply. `image`, `build`, `features`, `onCreateCommand`, `containerEnv` and `remoteEnv` have no effect there. The docs of `environment show` name them as ignored, and the answer holds no field for them. The repository devcontainer applies only at the `container` placement.

## The affected test declaration

A repository declares its affected test command in the file `.kanthord/affected-tests.json` at the root of the repository. The worker runs it under [the affected test run](worker-service.impl.md#the-affected-test-run).

```json
{
  "version": 1,
  "command": "pnpm --silent run test:affected",
  "time_limit_s": 600
}
```

- The worker reads the file with `fileAtRevision` at `origin/<base branch>`, as `environmentOf` reads `.devcontainer/devcontainer.json`.
- The read applies at the `server`, `worker` and `container` placements. It does not depend on the stored environment or on the target of the environment.
- An absent file means no command.
- `version` is 1. `command` is one nonblank string.
- `time_limit_s` is optional, an integer from 60 to 3600. The default is 600, the value of `COMMAND_LIMIT_MS`.
- `gate_files` is optional, a list of at most 10000 nonblank repository paths with `/`. The default is `[]`. KanthorD compares each path with the paths of the change set as an exact string, with no glob.
- A file that is no JSON object, that holds another key, or that holds a wrong type stops the execution with `environment_failed` and the class `affected_invalid`. The detail names the file and the parse error.
- No proof of the Onboarding component runs the command. The first release gate of a node runs it first.

## The suite pass record

The suite pass record is a repository setup that works without KanthorD. A developer, another harness and CI use it. KanthorD runs no part of it in the release gate or in the evaluation.

- A suite pass record holds one key for each test file that passed. CI skips a test file whose current key matches a record.
- The key of a test file is a SHA-256. It covers the toolchain, the blob ids of the global inputs and of the `gate_files`, and the blob ids of the import closure of the test file.
- The toolchain is the runtime version and the package manager version.
- The global inputs are the lockfile, the test configuration and each path that the selector treats as a global input, for example `package.json`. In `engine`, they also hold `static/pi-tools.json`.
- The import closure comes from the import graph of the selector of [the affected test declaration](#the-affected-test-declaration). No second map exists.
- Only a run in a clean clone with a frozen install writes a record. A dirty or untracked work tree writes no record. A dirty or untracked work tree also reads no record, so every test file runs.
- CI writes the records through `actions/cache` first. A record that a developer or KanthorD writes comes later.
- A repository with no selector, or whose selector gives no import graph, uses one record for the whole tree. Its key is the tree id and the toolchain.
- CI runs every test file with no matching record and every test file of the always-run list. A nightly full run on the base branch runs every test file.
- The CI job summary prints the floor of the affected report and the saved share. The saved share is the test time of the skipped test files divided by the test time of all test files.
- The test files that load every production file run for every production change.
- A push to the base branch runs each test file again that has no record in the cache of the base branch. The cache of a pull request never reaches the base branch.

The suite pass configuration lives in `.kanthord/suite-pass.json` at the root of the repository. The `.gitignore` of the repository holds the exception `!/.kanthord/suite-pass.json`.

```json
{
  "version": 1,
  "always_run": [
    "src/apps/worker/worker-oauth-flows.test.ts",
    "src/apps/cli/index.test.ts"
  ]
}
```

- `version` is 1.
- `always_run` lists the test files that CI runs with no record lookup: a test file that bundles code, reaches `bin/` or reads a path that it builds at run time.
- `.kanthord/affected-tests.json` takes no key of the suite pass record.
- The repository lists `.kanthord/suite-pass.json`, the record steps and its CI workflow file in `gate_files` of [the affected test declaration](#the-affected-test-declaration).

## The Onboarding component

The Onboarding component of the Project Service lives in `src/project/onboarding.ts`. It resolves, builds and proves the environment of each repository binding in the server process. It holds no table, no column, no worker and no claim.

### The group of an environment

- The component keys each environment by its binding group: `project_id` and `resource_identity` of the repository binding.
- It holds one record of each group in process memory: the target, the source, the digest, the status, the start times of the run and its step, the reason of a failed read and the time when that reason started.
- A server start loses the records. The component computes each record again from the binding set, the container runtime and the proof files.

### The target

- The target of a group is `image` when a current worker binding lists a `container` instance and names the repository binding in its `environment` key, also through the default of that key.
- The target is `remote` when the project holds one worker binding or more, and each listed instance of each binding is at the `worker` placement or the binding is the binding of an external harness.
- In every other case the target is `host`. A project with no worker binding has the target `host`.
- One group has one target. A `server` instance next to a `container` instance that runs the image of the group runs on the host with the status of the image.

### The source of each target

- At the `image` target, the first source that exists decides: `stored`, `repository`, `detected`, `universal`.
- At the `host` and the `remote` targets, the first source that exists decides: `stored`, `detected`, then `none`. The repository devcontainer and the universal environment never apply there, because their commands assume their image.
- A `detected` document at the `host` and the `remote` targets contributes only its `checks`. It runs no setup in a checkout.
- One read deadline of 30 s bounds all repository reads of one resolution, the detection read included. `binding.environment.get` has a route timeout of 36 s.

### The digest and the tag

- The digest is the SHA-256 of the canonical JSON `{ resource_identity, target, source, document, files, secrets, base_image, slot_image, version }`, under [the canonical form](architecture.impl.md#the-canonical-form-and-the-digest).
- `files` lists each repository file that the resolution read, as `{ path, state, text }`. `document` is the resolved document, or null. `secrets` lists each entry of `environment_secrets` as `{ variable, credential, revision }` with the newest live revision, sorted by `variable`.
- `base_image` is the image identity of the `image` key at the `image` target. The run pulls a missing base image before it computes the digest. Every other case holds null.
- `slot_image` is the image identity of the slot image `worker.container_image` at the `image` target, and null elsewhere.
- `version` is the version of the server.
- The tag of an image is `localhost/kanthord-env/<identity path>:<digest>`. The identity path splits the resource identity at `:` and `/`, lowercases each part, replaces each run of other characters with `-` and replaces an empty part with `x`. A path above 200 characters keeps its first 180 characters and adds `-` and the first 16 hex characters of the SHA-256 of the resource identity.
- `<tag>-base` names the image of `devcontainer build`. `<tag>-proved` names the image after a passed proof. Each image carries the label `io.kanthord.owner`.
- Every actor computes the tag from the same inputs, so no actor stores it.

### The status

The component computes the status of a group in this order. The first rule that applies decides.

1. A run of the group is active: `building` or `proving`, the step of that run.
2. No read of the inputs of the group succeeded yet, or the component holds no record of the group: `pending`.
3. The proof file of the digest holds the outcome `failed` and the commit of the last read: `failed`. A failure at another commit does not count.
4. At the `image` target, `<tag>-proved` exists: `ready`. At the `host` target, the proof file of the digest holds the outcome `passed`: `ready`.
5. The source is `none`: `none`.
6. Otherwise the component starts a run, and the status is the step of that run.

- At the `remote` target, rules 4 and 6 do not apply. The status is `failed` by rule 3, or `none`.
- At the `image` target, the `universal` source always exists, so the status is never `none`. A `container` instance runs on `worker.container_image` only when no live binding lists it or its worker binding names no repository binding.
- After a failed read, the group keeps its last status and digest and sets `reason`. A transient fetch failure thus never closes the gate of a `ready` environment. A failed read after a change of the target also writes the new target and clears the digest, the tag and the proof of the old target.
- A run that waits in the queue shows the status of its first step, and its `run_started_at` stays null until it starts.
- A claim gate or a read of a group with no record starts the computation of the group in the background and answers `pending`.

### The proof file

- The proof file of a digest is `environments/<identity path>/<digest>.json` of the state directory. The component writes it to a temporary file of the same directory with mode `0600` and renames it.
- It holds `digest`, `outcome` (`passed` or `failed`), `class`, `origin` (`onboarding` or `execution`), `execution_id`, `command`, `exit_code`, `tail`, `reproduce`, `checks`, `repairs`, `ended_at` and `commit`.
- `commit` is the base-branch commit of the read that started the run. For the origin `execution`, it is the commit of the last read of the group.
- `class` is null for `passed`. For `failed` it is `build_failed`, `image_invalid`, `setup_failed`, `command_absent`, `affected_invalid` or `affected_timeout`. Only the origin `execution` writes `affected_invalid` and `affected_timeout`.
- `tail` holds the last 4096 bytes of the output of the failed step. `reproduce` holds `podman run -it --rm <tag> bash` at the `image` target, with the runtime of the server, and null elsewhere.
- `checks` is the red baseline: each check of the proof with an exit code other than 0 and 127, as `{ command, exit_code }`. A check that exceeds its time limit joins the red baseline with `exit_code: null`.
- `repairs` counts the repairs of [the agent `env@1`](#the-agent-env1) for this digest. A new file holds 0. The counter stays with the digest across commits, because a new write keeps the count of the existing file of the digest. A rebuild removes the file and resets the counter.
- The file is a cache for display and the gate of the `host` target. A lost file costs one run.

### The run

- A run onboards one group for one digest. The component runs at most one run at a time on the server, and the others wait in arrival order.
- A trigger for a group with an active run marks the group. The component computes the group again after the run ends.
- At the `image` target, the run reads the inputs at the base-branch head, pulls a missing base image, computes the digest, and stops when rule 3 or rule 4 of [the status](#the-status) applies.
- It then builds `<tag>` when the tag is absent, under [the image build](#the-image-build), with the status `building`. It then proves the image, with the status `proving`.
- At the `host` target, the run computes the digest and proves on the server host, with the status `proving`. A source `none` runs no proof.
- The run writes the proof file. After a passed proof at the `image` target, it tags `<tag>-proved`.
- After the run, the component collects the garbage of the group. It then calls `environmentReady` of the Worker Service, which drains the `container` instances that run another image of the group. Only after that call returns, it wakes the work pulls of the project through `wake(projectId)` of the Scheduler.
- A run has a deadline of 30 minutes. A run that reaches it during the build ends with the class `build_failed`. During the proof, the stopped command goes through the classification of [the proof](#the-proof).
- The stop of the server cancels the run, and the cancellation kills the process group of each child. A cancelled run writes no proof file.
- The component logs `project.onboarding.run_started` and `project.onboarding.run_ended` with the binding, the digest, the target, the status and the class.

### The image build

- The host exports the repository at the base-branch head into `environments/run-<id>/workspace` of the state directory.
- The component writes the build document to `environments/run-<id>/devcontainer.json`, outside the workspace, with the flag `wx`. The build document holds the accepted keys only.
- It runs `node <@devcontainers/cli>/devcontainer.js build --docker-path <runtime> --workspace-folder <workspace> --config <build document> --image-name <tag>-base --label io.kanthord.owner=<owner>`.
- The build gets only the variables `PATH`, `HOME`, `XDG_*`, `CONTAINER_HOST` and `DOCKER_HOST` of the server. It gets no SSH key, no Gateway token and no other secret.
- The KanthorD layer then builds `<tag>-unchecked` from `<tag>-base`. It runs each `onCreateCommand` of the `devcontainer.metadata` label as root in `/`, then copies `/usr/local/bin/kanthord` and the static `tini` as `/usr/bin/tini`, then adds the passwd and the group entries of uid 10001 with the home `/var/lib/kanthord`, then writes each `containerEnv` and `remoteEnv` variable into `ENV`.
- The image check runs in a container of `<tag>-unchecked` as uid 10001 with `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--network=none` and the owner label. It checks `bash`, glibc, git 2.40 or later, OpenSSH 9.0 or later, the passwd entry, `tini` and `kanthord`.
- A passed check tags `<tag>` and removes `<tag>-unchecked`. A failed check removes `<tag>-unchecked` and ends with the class `image_invalid`. A failed build ends with the class `build_failed`.
- The build needs the npm install of `kanthord`. The single binary ends the build with `build_failed` and the reason in the tail.
- The run removes `environments/run-<id>/` at its end. A server start removes each stale `environments/run-*` directory.

### The proof

- The proof runs the setup commands, `updateContentCommand` then `postCreateCommand`, then each command of `checks`, on the base-branch head.
- Each command runs with `bash -c` in the checkout and has the command limit of a verification.
- A setup command that ends with an exit code other than 0, or that exceeds its limit, fails the proof with the class `setup_failed`.
- A check that ends with exit 127 fails the proof with the class `command_absent`.
- A check that ends with another exit code other than 0 joins the red baseline, and the proof passes.
- At the `image` target, the proof starts one container of `<tag>` with the flags of a `container` instance: uid 10001, `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, a `tmpfs` at `/tmp`, the owner label, and a new volume at `/var/lib/kanthord`. The container idles under `tini`.
- The host feeds the base-branch head into the container as a git bundle on standard input, and the container clones it into its home. Each command runs through `<runtime> exec`. The run removes the container and the volume at its end.
- The container removal follows the rules of [names, labels and stale containers](worker-service.impl.md#names-labels-and-stale-containers).
- At the `image` target, a failed step of the proof fails the proof with `worker.pool.environment_proof_failed` and the class `setup_failed`.
- The steps are `volume`, `cache volume`, `start`, `bundle`, `clone`, `remove container` and `remove volume`.
- The message is `The environment proof failed at <step>: <message>`. `<message>` is the trimmed last 4096 bytes of the step output. A runtime command step gives its error output.
- A step with blank output gives the message `The environment proof failed at <step>.`. The message becomes `tail` of the proof file.
- At the `host` target, the host clones the base-branch head into `environments/run-<id>/checkout`. Each command runs with the variables that a `server` instance gives its commands.
- The proof runs no agent and spends no LLM budget.

### The failure of an execution

- The [release of an `environment_failed` stop](scheduler-service.impl.md#the-environment-gate) calls `environmentFailed(input)` of the component after its commit. `input` holds `project_id`, `execution_id`, the resource identities of the repository bindings of the node, the stop and `digests`: the digest of each environment that the execution set up, from the stop detail.
- A group whose current digest differs from its entry in `digests` keeps its status, because a late stop of an old instance says nothing about a newer environment. A group with no entry in `digests` keeps its status. An `environment_failed` stop without `digests` marks no group, so the Scheduler counts it as a failure under [the environment gate](scheduler-service.impl.md#the-environment-gate).
- For each other group, the component writes the proof file of its current digest with the outcome `failed`, the origin `execution`, the class of the stop code and the detail of the stop as `tail`. It reads `command` and `exit_code` from the detail when the detail is a JSON object that holds them.
- The status of the group is then `failed`, and its nodes wait.

### The triggers

- After the commit of a binding-set write, also of `environment set`, `bindingsChanged(projectId)` sets the record of each changed repository binding to `pending` synchronously. A repository binding is changed when the write changed its row or its target. The write wakes the work pulls only after that call, and the component then computes each repository binding of the project again. A computation of the project whose read runs during the call writes no record and reads the inputs again. A pull between the commit and the computation therefore claims no node of a changed binding.
- At the server start, it computes each repository binding of each project. It then collects the files and the images of each identity path that no current repository binding holds.
- At the execution setup of a `container` instance, the Worker Service calls `environmentClaimed(projectId, resourceIdentity)` with the repository binding of the instance. The component reads the inputs again in the background. A changed digest starts a run, so a push of a repository file reaches the `container` instances at their next claim.
- While the status of a group is `pending`, the component reads the inputs again every 60 seconds.
- While the status of a group is `failed`, the component reads the commit of its base branch every 60 seconds (`COMMIT_CHECK_MS`). The read is one `git ls-remote` through the Repository component.
  - A changed commit reads the inputs again. The failure of the old commit no longer counts under rule 3 of [the status](#the-status). Each reader of the proof file treats that failure as absent and ignores `<tag>-proved` for that read, so a run proves the environment again at the new commit. The file stays on disk until the new run writes the file of the digest. At the `image` target, the run builds only a missing `<tag>`. At the `remote` target, the status becomes `none`.
  - An unchanged commit starts no read and no run.
  - The component skips the commit read during a run, a computation or a session of `env@1` of the group, and after a change of its target.
  - A failed commit read keeps the status `failed` and logs `project.onboarding.read_failed` under the rules of a failed read.
- A failed read logs `project.onboarding.read_failed` at the `error` level with the project, the binding, the resource identity, the reason and the failure reason. A failed read with the reason of the last logged record of the group logs no record. A successful read, a successful commit read, a change of the binding, a change of its target and a removal of the binding clear the last logged record, so the next failed read logs again.
- The `reason` of a failed SSH read ends with the sentence `The failure reason is <failure_reason>.`, and `<failure_reason>` is the value of [the failure reason](repository.impl.md#the-failure-reason-of-a-git-operation). Any other failure has a null failure reason.
- `project.binding.environment.rebuild` starts a run.

### The rebuild

- `project.binding.environment.rebuild` at `POST /api/project/:project_id/binding/:binding_id/environment/rebuild` is a `human` mutation with no body.
- It removes the proof file of the current digest and the tags `<tag>`, `<tag>-base` and `<tag>-proved`. At the `image` target with an `image` key, it pulls that image again. It then starts a run and answers the environment state of the group.
- A rebuild during an active run of the group answers 409 `project.environment.run_active`.
- A binding that is absent, belongs to another project, is removed or is no repository binding answers 404 `project.binding.not_found`.
- `kanthord project environment rebuild <project-id> <binding-id>` calls it.

### The environment list

- `project.environment.list` at `GET /api/project/:project_id/environment` is a `human` read. It answers `{ items }` with one environment state for each current repository binding, in binding name order.
- An environment state holds `binding_id`, `binding_name`, `resource_identity`, `target`, `source`, `status`, `digest`, `tag`, `run_started_at`, `step_started_at`, `reason`, `reason_started_at`, `failure`, `checks`, `repairs` and `repairing`.
- `reason_started_at` is the time when `reason` changed from null to a message, and null while `reason` is null. A later message keeps the time.
- `repairing` is true while a session of [the agent `env@1`](#the-agent-env1) runs for the group, and false otherwise.
- `failure` is null unless the status is `failed`. It holds `class`, `origin`, `execution_id`, `command`, `exit_code`, `tail`, `reproduce` and `ended_at` of the proof file.
- `checks` is the red baseline of the proof file of the digest. `tag` is null outside the `image` target.
- The read answers from the records and the proof files. It reads no repository and starts no build.
- `kanthord project environment list <project-id>` calls it.

### The gate collaborations

- The component implements `environmentsClaimable(projectId, resourceIdentities): boolean` for the [claim selection](scheduler-service.impl.md#the-environment-gate). It answers true when the status of each group is `none` or `ready`.
- A group with no record answers false, and the component computes it.
- It reads only process memory, so it runs inside the claim transaction.
- The Project Service, not the component, implements `environmentsMixed(projectId, resourceIdentities): boolean` for [the node content](mission-service.impl.md#the-node-content). It reads the stored `environment` documents of the binding set inside the write transaction and answers true when a worker binding of the project lists a `container` instance and two stored documents differ in canonical JSON.
- It implements `slotImage(projectId, workerResourceIdentity, signal): Promise<string>` for [the slot image](worker-service.impl.md#the-slot-image). A worker binding names the repository binding of its `environment` key, else the only repository binding of the project. The promise resolves with `<worker.container_image>:<version>` when the worker binding names no repository binding, and with `<tag>` when the group of the named repository binding is `ready`. It waits through every other status. The signal ends the wait.

### Garbage collection

- After each run, the component lists the images with the owner label and the reference `localhost/kanthord-env/<identity path>`. It removes each image whose tag is not the current digest, `<digest>-base` or `<digest>-proved`.
- A removal that fails, for example for an image that a `container` instance still runs, leaves the image to the next collection.
- It removes each proof file of the identity path whose digest is not the current digest.
- A repository that fails again and again therefore keeps one digest on the disk.

### Detection

- Detection reads these files at the base-branch head: `.nvmrc`, `.node-version`, `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `.python-version`, `pyproject.toml`, `requirements.txt`, `uv.lock`, `poetry.lock`, `go.mod`, `Cargo.toml`, `rust-toolchain.toml`, `rust-toolchain`, `pom.xml`, `mvnw`, `build.gradle`, `build.gradle.kts`, `gradlew`, `.java-version`, `.tool-versions`, `flake.nix` and `flake.lock`.
- It also reads at most 20 files `.github/workflows/*.yml` and `*.yaml`. It takes the version input of `actions/setup-node`, `actions/setup-python`, `actions/setup-go` and `actions/setup-java`. It reads no `run:` step.
- A stack is present when its manifest exists: `package.json` for Node, `pyproject.toml` or `requirements.txt` for Python, `go.mod` for Go, `Cargo.toml` for Rust, `pom.xml`, `build.gradle` or `build.gradle.kts` for Java.
- The version of a stack comes from the first input that holds it: the version file of the stack, `.tool-versions`, the CI setup input, `engines.node` of `package.json`, the `go` line of `go.mod`. With none, the default is Node 24, Python 3.12, Go 1, Rust 1 and Java 21.
- One stack drafts its image: `mcr.microsoft.com/devcontainers/javascript-node:<major>-bookworm`, `mcr.microsoft.com/devcontainers/python:<major.minor>-bookworm`, `mcr.microsoft.com/devcontainers/go:<major.minor>-bookworm`, `mcr.microsoft.com/devcontainers/rust:1-bookworm` or `mcr.microsoft.com/devcontainers/java:<major>-bookworm`.
- Two stacks or more draft `mcr.microsoft.com/devcontainers/base:bookworm` with one feature `ghcr.io/devcontainers/features/<stack>:1` and its `version` for each stack.
- With two stacks or more, the setup commands join with `&&` in the order Node, Python, Go, Rust, Java, and the checks join in the same order.
- A Rust or a Go feature with the default version takes the feature version `latest`.
- A Java stack without a wrapper takes the feature `ghcr.io/devcontainers/features/java:1` with `installMaven: true` for `pom.xml` or `installGradle: true` for `build.gradle*`. A single Java stack sets the feature version `none`, because its image holds the JDK.
- The setup command and the checks of each stack are below. A tool that the image lacks installs in `onCreateCommand` at the build.

| Stack  | Input                        | `onCreateCommand`                                               | `updateContentCommand`                                                     | `checks`                               |
| ------ | ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| Node   | `pnpm-lock.yaml`             | `npm install -g pnpm@<version>`                                 | `pnpm install --frozen-lockfile`                                           | `node --version`, `pnpm --version`     |
| Node   | `yarn.lock`                  | `corepack enable && corepack prepare yarn@<version> --activate` | `yarn install --immutable`, or `yarn install --frozen-lockfile` for yarn 1 | `node --version`, `yarn --version`     |
| Node   | `package-lock.json`          | none                                                            | `npm ci`                                                                   | `node --version`, `npm --version`      |
| Python | `uv.lock`                    | `pip install uv`                                                | `uv sync --frozen`                                                         | `python --version`, `uv --version`     |
| Python | `poetry.lock`                | `pip install poetry`                                            | `poetry install --no-interaction`                                          | `python --version`, `poetry --version` |
| Python | `requirements.txt`           | none                                                            | `pip install --user -r requirements.txt`                                   | `python --version`                     |
| Go     | `go.mod`                     | none                                                            | `go mod download`                                                          | `go version`                           |
| Rust   | `Cargo.toml`                 | none                                                            | `cargo fetch`                                                              | `cargo --version`                      |
| Java   | `mvnw` or `pom.xml`          | none                                                            | `./mvnw -B -q dependency:go-offline` or `mvn -B -q dependency:go-offline`  | `java -version`                        |
| Java   | `gradlew` or `build.gradle*` | none                                                            | `./gradlew --no-daemon dependencies` or `gradle --no-daemon dependencies`  | `java -version`                        |

- `<version>` of a package manager comes from `packageManager` of `package.json`, else `latest`.
- A `yarn.lock` that holds a line `__metadata:` is a lock file of yarn 2 or later, and its default version is `stable`. Another `yarn.lock` is a lock file of yarn 1, and its default version is `1.22.22`. The npm package `yarn` ends at 1.x, so the draft installs yarn through corepack.
- A yarn draft sets `COREPACK_HOME=/usr/local/share/corepack` in `containerEnv`, so the user of a `container` instance finds the version that the build prepared.
- A Node stack with no lock file and a Python stack with `pyproject.toml` and no lock file take no setup command. Their checks are `node --version` and `npm --version`, or `python --version`.
- The draft sets `containerEnv` so that every cache and every tool home lies in `/var/lib/kanthord`: `PATH` with `/var/lib/kanthord/.local/bin` first, `GOPATH=/var/lib/kanthord/go` and `CARGO_HOME=/var/lib/kanthord/.cache/cargo`, because the root of a `container` instance is read-only.
- `flake.nix` takes precedence over every stack. A repository with only `flake.nix` counts as detected. It drafts `mcr.microsoft.com/devcontainers/base:bookworm` with the feature `ghcr.io/devcontainers/features/nix:1` and the option `multiUser: false`, the `onCreateCommand` `nix --extra-experimental-features 'nix-command flakes' print-dev-env /etc/kanthord-flake > /etc/kanthord-nix-env.sh` and `containerEnv` `BASH_ENV=/etc/kanthord-nix-env.sh`, so each `bash -c` of a slot loads the development shell. It checks `nix --version`.
- When the workspace holds `flake.nix`, the KanthorD layer copies the whole workspace to `/etc/kanthord-flake/` before the first `onCreateCommand`, so a flake that imports a local file finds it. The copy skips `.git`. The build of a document without `flake.nix` copies nothing.
- A repository with no manifest has no detected source.

### The suite pass proposal

- The Onboarding component proposes [the suite pass record](#the-suite-pass-record). It writes nothing to the repository.
- For every source, the component reads `.kanthord/suite-pass.json` at the base commit with `repositoryFiles.readFilesAtCommit`, in the same SSH read as the environment files. This read is outside `files` of the run, so it does not change the digest of the environment.
- The value `suite_pass` is a [suite pass state](project-service.vocabulary.md#suite-pass-state): `present` when the file exists, else `absent`.
- When the read of a stored source fails with a coded error, `suite_pass` is null and the answer keeps the stored environment. When it fails with an error with no code, the component refuses the request. When the read of another source fails, the component refuses the request.
- A binding with `suite_pass` null gets no proposal.
- Only a binding with the action `pull_request` with `landing: human` gets the proposal. Any other binding gets no proposal. An absent `landing` reads as `human`.
- A human accepts the proposal with a node create from the shipped plan `suite-pass-setup`. The read `project.binding.suite_pass.plan.get` gives the body of `mission.node.create` from the shipped file. The node create records the human as the actor and changes no other node.
- `project.binding.suite_pass.plan.get` at `GET /api/project/:project_id/binding/:binding_id/suite-pass/plan` is a `human` read. It answers `{ filename, content, tasks, reason }` from the shipped file `static/plan/suite-pass-setup.md`. The client adds `expected_mission_version`.
- The read refuses a binding that gets no proposal with 409 `project.suite_pass.not_proposed`. It reads no repository file.
- The CLI leaf `kanthord project environment suite-pass plan <project-id> <binding-id>` calls the read and prints the answer.
- The setup node writes `.kanthord/suite-pass.json`, the `.gitignore` exception, the record steps of the repository and the CI change. With an affected test declaration, it adds `.kanthord/suite-pass.json`, the record steps and the CI workflow file to `gate_files`. Its verification checks the written files.
- The setup node lands with `human`, the `landing` of the binding.

### The universal environment

- The universal environment is the document `static/environment/universal.json` of the `engine` repository. It holds `mcr.microsoft.com/devcontainers/base:bookworm` with the features of Node 24, Python 3.12, Go and Java 21, each at a pinned version.
- It applies only at the `image` target, when no other source exists.

### Environment secrets

- `environment_secret` is a credential platform of the Project Service. Its secret shape is `api_key`, `{ key }`, and it declares `verifiable: false`. The Project component declares the [credential route group](architecture.impl.md#the-credential-route-group-of-a-component) `/api/project/credential`, and `environment_secret` is its only platform.
- The repository binding key `environment_secrets` maps a variable name to a credential name, for example `{ "REGISTRY_AUTH": "registry-auth" }`. A name matches `^[A-Z_][A-Z0-9_]*$`, and a binding holds at most 16 names.
- A credential that is absent, archived or of another platform refuses the write with 400 `project.bindings.repository.environment_secret_invalid` and `details: { binding, variable, credential }`.
- `kanthord project environment secret set <project-id> <binding-id> <variable> --credential <name> --file <path>` creates the credential when it is absent, rotates it when it exists, and writes the binding key.
- A binding-set write without the variable removes it. The credential stays.
- The KanthorD layer mounts each secret into each `onCreateCommand` step with `--secret id=<variable>,src=<file>` and `RUN --mount=type=secret,id=<variable>`. The step exports the variable from the mounted file before the command. The source file has mode `0600` and the run removes it.
- The digest holds the variable names and the revision of each credential, never a value. A rotation is a new digest. A rotation through the route group writes no binding set, so it takes effect at the next computation of the group.
- At the release, the component compares the newest live revision of each credential with the revision of the digest. On a mismatch, it ends the run with no proof file and computes the group again. A secret value in an output tail becomes `[redacted]` before it reaches the proof file or a log.
- The operations are `project.credential.platform_list`, `create`, `list`, `get`, `rotate`, `update_metadata`, `revoke`, `archive`, `verify` and `check`. The route group registers before every route whose path holds `:project_id`. The CLI holds only the leaf `project environment secret set`, and the other operations are API only.
- No secret reaches `devcontainer build`, a feature, a Dockerfile, the proof, an instance or a log. A private-registry install in a checkout runs in the instance, next to the agent, so the docs tell the user to put it into `onCreateCommand`.
- A command must not write a secret to a file of the image, because every `container` instance of the image holds that file. The docs give the form `npm install -g @<scope>/<package> --@<scope>:registry=https://<registry>/ --//<registry>/:_authToken="$<variable>"`, which passes the secret to one command, and they name `npm config set` as the form that leaks.

### The cache volume

- Each group at the `image` target holds one volume `kanthord_cache_<id>`, with `<id>` derived from the owner, the project and the resource identity. It carries the owner label, `io.kanthord.cache_project=<project_id>` and `io.kanthord.cache_resource=<resource_identity>`.
- Each `container` instance of a worker binding that names the group and each proof container mount it at `/var/lib/kanthord/.cache`.
- The KanthorD layer writes `npm_config_cache`, `npm_config_store_dir`, `PIP_CACHE_DIR`, `GOMODCACHE` and `CARGO_HOME` below that path into `ENV`, unless the document sets the variable.
- The volume key is the group and not the digest, so a new digest keeps the cache warm. Garbage collection removes the volume of a group that no current binding holds.
- Garbage collection lists the names with `<runtime> volume ls --filter label=io.kanthord.owner=<owner> --filter label=io.kanthord.cache_project --format '{{.Name}}'`.
- It then reads the labels of all listed volumes from the JSON output of one `<runtime> volume inspect <name>...`. An empty list runs no inspect.
- A volume without a nonempty `io.kanthord.cache_project` or `io.kanthord.cache_resource` label stays.

### The limits of a run

- The `project` section of the configuration holds `environment_build_timeout_ms`, default 1800000, and `environment_memory_mb`, default 4096.
- The layer build, the image check and the proof container take `--memory <environment_memory_mb>m`. `devcontainer build` takes no memory flag.

### The environment trace

- The Tracking Service admits a server trace that names no execution. Each run opens the trace root `project.environment` with the attributes `project.id`, `project.binding.name`, `environment.target`, `environment.source` and `environment.digest`.
- The run adds the child spans `environment.build`, `environment.setup` and `environment.proof`. A failed step ends its span with the status `Error` and `error.type` set to the class.
- The trace decides nothing. The status never reads it.

### The agent `env@1`

- `env@1` is a one-shot agent session that the Onboarding component starts in the server, as the Workbench Service runs a session. It holds no worker, no registration and no claim.
- `env@1` is one declaration of [the agent catalog](agent.impl.md#the-agent-catalog), with the tools `read`, `grep`, `find` and `ls`, no host tool, no overridable field and the prompt `static/prompt/env@1.md`. Its declaration holds `workbench: false`.
- Its provider, its credential and its model come from the agent enablement of `env@1`. The agent page `/agents/env@1` holds that enablement, as for any agent. With no enabled `env@1`, the component starts no session, and the failure stays for the human.
- Custody releases the model credential under [the release for an `env@1` session](custody.impl.md#the-protected-facility).
- The session reads the files of the base-branch head in `environments/run-<session id>/checkout` through read-only tools.
- A `tool_call` hook of the session resolves each path argument of `read`, `grep`, `find` and `ls` with `realpath` against the checkout. A path that is absolute, starts with `~`, holds a `..` segment or resolves outside the checkout, also through a symbolic link, answers a tool error and reads nothing. The session runs on the server host with the server user, so the hook keeps a prompt-injected file from reading a key file or the state directory. It writes only the stored environment of its binding, through the tool `environment_write`.
- `environment_write` validates the document with the rules of [the environment of a repository binding](#the-environment-of-a-repository-binding). It writes it under the service identity of the Project Service as a binding revision.
- The tool `probe` runs one command of a fixed allowlist in a throwaway container as uid 10001, with `--network=none`, `--read-only`, `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--pids-limit 256` and the checkout mounted read-only: `cat /etc/os-release`, `uname -a`, `command -v <word>`, `<word> --version`, `ls <path>`, `dpkg -l` and `apk info`.
- The container takes `<tag>`, else `<tag>-base` of the last digest. With neither, `probe` answers "no image". The command runs as an argument list and never through a shell. It has a limit of 30 seconds and answers at most 4096 bytes of output.
- A `<word>` matches `^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$`. A `<path>` starts with no `-` and holds no `..` segment.
- Each call of `environment_write` is one attempt, a refused call too. The component runs the run of the new digest and answers the outcome, the class and the tail to the session.
- A session ends at a passed proof, after 5 attempts or after 64 tool calls. The sixth `environment_write` answers the reason `attempt_limit`, and it writes nothing and runs nothing. The 65th tool call answers `tool_limit`, and a refused write answers `write_refused`. These reasons are tool answers to the session, not codes of an operation.
- A group holds at most one session at a time. Sessions of different groups run at once and share the queue of [the run](#the-run).
- Only a failure event starts a session: a run that writes a failed proof file, or [the failure of an execution](#the-failure-of-an-execution). A failure inside a session and the end of a session start none.
- The source of the failed digest is `detected`, `universal` or `none`, or `stored` with the last write by `env@1`. The server process holds that mark in memory. After a restart, a stored environment counts as written by a human, and no session starts for it.
- The current binding set still gives the group the target of the failed run or execution. A failure at an old target thus starts no session.
- A session starts while `repairs` of the failed digest is below 3. The component increments `repairs` before the session starts. A new write of the same digest keeps the count, and `project.binding.environment.rebuild` resets it to 0.
- The environment state holds `repairing: true` while a session of the group runs. The stop of the server aborts each session before it cancels the runs.
- The waiting nodes continue when the status is `ready`.

### The instance build before the Onboarding component

The first layer of the build builds the image at the start of a `container` instance, before the Onboarding component exists. These rules hold until the Onboarding component replaces them.

- `EnvironmentImages` of `src/apps/server/environment-image.ts` builds the image synchronously at the start of a `container` instance when the tag is absent. One build runs for each tag.
- DECIDED 2026-10-23 by Aelita, pending Ulrich: a stored environment wins over the repository devcontainer of the other repository bindings of the project. Two stored environments in one project fail the start of the `container` instance with `project.environment.ambiguous`. The `environment` key of a worker binding replaces this rule.
- A failed build logs `worker.pool.environment_image_failed` with the class `build_failed` or `image_invalid`, the tag and the last 4 KiB. The server keeps the failure of a tag for 15 minutes or until the next binding revision. The Onboarding run replaces this code with the proof file.

### The error codes of an environment

| HTTP | Code                                                     | Condition                                                                                                                                               |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `project.environment.invalid`                            | The environment document is no JSON object or holds a wrong type.                                                                                       |
| 400  | `project.environment.key_refused`                        | The environment document holds a refused key, a server variable or a path that leaves the checkout.                                                     |
| log  | `project.environment.key_refused`                        | Before the Onboarding component: a repository devcontainer file at the start of a `container` instance holds a refused key.                             |
| 400  | `project.bindings.worker.environment_required`           | A worker binding that lists a `container` instance omits `environment`, and the project holds two repository bindings or more.                          |
| 400  | `project.bindings.worker.environment_unknown`            | `environment` names no repository binding of the submitted set.                                                                                         |
| 400  | `project.bindings.worker.field_forbidden`                | An external-harness binding holds `environment`.                                                                                                        |
| 400  | `project.bindings.repository.environment_secret_invalid` | An `environment_secrets` entry names an absent, archived or foreign credential, or an invalid variable.                                                 |
| log  | `project.environment.ambiguous`                          | Before the Onboarding component: two repository bindings of the project hold a stored environment.                                                      |
| log  | `worker.pool.environment_image_failed`                   | Before the Onboarding component: the build of the image of a `container` instance failed with `build_failed` or `image_invalid`.                        |
| log  | `project.onboarding.run_started`                         | A run of a group starts. It names the binding, the digest and the target.                                                                               |
| log  | `project.onboarding.run_ended`                           | A run ends. It names the binding, the digest, the target, the status and the class.                                                                     |
| log  | `project.onboarding.run_failed`                          | An error stops a run. It names the binding and the digest. An error of the build or the setup step writes `build_failed` or `setup_failed`.             |
| log  | `project.onboarding.cache_collection_failed`             | The list, the inspect or the removal of a cache volume fails. A removal names the project and the resource identity.                                    |
| log  | `worker.pool.environment_proof_failed`                   | A step of the proof at the `image` target fails. The record of `project.onboarding.run_failed` carries it in `err`, and the run records `setup_failed`. |
| log  | `project.onboarding.read_failed`                         | A read of a group fails with a new reason. It names the project, the binding, the resource identity, the reason and the failure reason.                 |
| log  | `project.onboarding.session_failed`                      | An `env@1` session ends with an error. It names the binding and the digest.                                                                             |
| 409  | `project.environment.run_active`                         | A rebuild of a group with an active run.                                                                                                                |
| 404  | `project.binding.not_found`                              | The binding of an environment route is absent, foreign, removed or no repository binding.                                                               |

## The client identity

The Project Service holds no table of client identities and no secret of a client identity.
[gateway-service.impl.md](gateway-service.impl.md#the-jwt) generates the client identity inside a machine JWT, and its verification asks the Project Service whether the worker binding of that JWT exists and admits the caller.
The JWT names one binding group by `project_id` and `resource_identity`, and no revision.
The answer reads the latest row of that group. It refuses a removed binding, an external-harness binding with `instance_count: 0`, and a token whose `iat` is before the latest tombstone of the group. A native binding with `worker_instances: []` admits only a client identity that holds a live registration of the group.
At every placement, the server derives the client identity of an instance for a binding from `master_key`. The label is `worker/instance-client/<instance_id>/<project_id>/<resource_identity>/<generation>`, under [the instance exchange](worker-service.impl.md#the-instance-exchange). No database holds it. A new binding generation or a new instance revision changes it.

## The binding screen of the dashboard

- The header of the Project page shows the project identity and the creation time. It shows no binding-set version.
- The header of a paused project shows the badge `Paused` and the time of `paused_at`.
- The header holds `Pause` for an active project and `Resume` for a paused project. Each calls its route with no confirmation dialog and reloads the project.
- A list row of a paused project shows the badge `Paused`.
- Each binding row shows the revision of its current row as `(v<revision>)` next to the binding name.
- The form of a worker binding holds a `Tags` field with one tag per line. The row of a worker binding shows one badge for each tag.
- The form of a worker binding of a worker that kanthord hosts holds the multi-select `Instances`. It holds no placement select and no count field. It lists the live instances of the selected worker, each as `<name> · <placement>`. It preselects the only instance when exactly one exists.
- `Add instance` beside `Instances` opens a sheet with the name and the select `Placement`. The sheet creates the instance through `worker.instance.create` before the binding write and adds it to the selection. The `worker` placement shows the link `Add a worker instance on the worker page`, because it needs the key and the copy blocks.
- A refusal 409 `project.bindings.worker.instance_shared` shows "<instance> already serves <binding> of <project>. A container instance serves one binding." under `Instances`.
- The form of an external-harness binding holds the number field `Instance count`.
- The form shows the cross-project notice of [the worker pages](architecture.impl.md#the-worker-pages) when a selected instance serves bindings of another project.
- The form states "A removed instance finishes its execution, then takes no new work of this binding." when the draft removes an instance.
- The row of a worker binding of a worker that kanthord hosts shows `· <instance names>`, for example `· box-coder, coder-1`. A registration row shows `· instance <name>` and the badge `Draining` while the binding no longer lists its instance.
- The "no taker" view of the dashboard applies the match of [The match](scheduler-service.impl.md#the-match): the intent, the tags and the declared node states.
- The form of a repository binding holds three sections. `Repository` holds the connection. `Project policy` holds the base branch, the action and `follows`. `Binding prompts` holds the Binding prompt of each agent.
- `Binding prompts` holds one row for each agent of the catalog: `swe@1`, `re@1` and `env@1`. The section makes no network call.
- A row with a text expands to its Markdown and holds a copy button. A row with no text is inactive.
- The `Edit` dialog of a row writes the draft only, and the Save of the binding stores it. The dialog shows the byte counter against the 32768-byte limit and refuses a text above the limit or with a control character. An empty text removes the Binding prompt of that agent.
- The help of the section states that a change stores a new binding revision, and that a node keeps the old text until `mission node rebind`.
- The help states that the new binding revision makes the Onboarding component clear the mark that the stored environment came from `env@1`.
- The help states that the Binding prompts of the agents are separate texts, and that a rule that relaxes the default standard goes into the prompts of both `swe@1` and `re@1`.
- The binding draft carries `environment` and `environment_secrets` unchanged from the read to the write. The draft of a worker binding carries `environment`.
- The row of a repository binding shows only the connection: the address, the platform, the SSH credential and the credential.
- The SSH credential field is a searchable list of the live `ssh` records. It shows each record as `<name> (v<revision>)` with its fingerprint.
- The SSH credential field holds `New SSH credential`. It opens the `Create SSH key` sheet and selects the new record.
- An empty SSH credential list shows "No credential exists. Use New credential." A filter miss shows "No credential matches."
- The binding sheet prefills `git@github.com:` for the platform `github`.
- When the address host holds no pin and the host is `github.com` or `ssh.github.com`, the sheet calls `repository.host_key.scan` and `repository.host_key.pin`. It shows "Host key pinned from api.github.com" with the fingerprint.
- When another host of the SSH host set of the binding platform holds no pin, for example `gitlab.com`, the sheet shows the scanned fingerprint and a link to the published fingerprints of the provider. It holds `Confirm host key`. Save stays disabled until the pin exists.
- The hint of `host_key_changed` is "The host presented another key. Compare the fingerprint with the published one, then pin again."
- The hint of `identity_unavailable` is "The server cannot load the SSH key. Rotate the key. If the fault stays, read the server log."
- The hint of `key_refused` shows the public key of the selected SSH credential.
- The hint of `host_key_unknown` is "The server does not know the host key of the repository host. Confirm the host key on the server. Then verify again."
- The hint of `repository_not_found` is "The repository host does not find the repository. Check the owner and the name in the address. A deploy key of another repository also gives this result."
- The hint of `host_unreachable` is "The server cannot reach the repository host. Check the host in the address and the network of the server."
- The hint of `address_invalid` is "The address is not valid, or its host is not a host of the platform. Use the form git@<host>:<owner>/<repository>.git."
- The hint of `deadline_exceeded` is "The remote host or service did not answer before the deadline. Verify again. If the failure stays, check the network of the server."
- The hint of `unclassified` is "The check failed for an unknown cause. Verify again. If the failure stays, read the server log."
- A value with no hint shows "The check failed with the reason <value>. Verify again. If the failure stays, read the server log."
- On a verify or a binding check, the hint shows under the `address` entry only. The `ssh_credential` and `credential` entries and the credential Verify show the status badge only.
- The credential field is optional. The form marks a blank credential only when the action is `pull_request`.
- The `Repository` section holds a platform select with `GitHub`, `GitLab` and `Bitbucket`. For a git-only platform, the form hides the credential field and offers no `Open a pull request`.
- The credential field of a repository binding is a searchable list of the live Repository credential records of the binding platform. It reads `repository.credential.list` and hides an archived record. A name outside the list cannot be entered.
- The credential field holds `New credential` and `Rotate`. `New credential` opens the create form of the Repository component and selects the new record after the save. `Rotate` opens the rotation of the selected record. Both keep the binding draft.
- The row of a repository binding holds a Verify icon. It calls `project.binding.verify` and shows one badge for the address, one for the SSH credential and one for the credential.
- Verify and Save of the binding form stay disabled until every required field holds a value. A line above the action row names the missing fields.
- The form of a repository binding holds Verify on the left of its action row. It calls `project.binding.check` with the draft configuration and shows the same three badges. A change of the platform, the address, the SSH credential, the credential or the action resets the badges.
- The row of a repository binding shows the badge `Environment · <status>` with the status value, for example `Environment · failed`, for each status other than `none`, from [the environment list](#the-environment-list) that the project page polls.
- The sheet of a saved repository binding holds the section `Environment`. It shows the source, the target, the status badge, the short digest and the red baseline as one line for each check, for example `pnpm test · exit 1`. The short digest is the first 12 characters of the digest.
- The section names the source with the text of [the environment source](project-service.vocabulary.md#environment-source). A `detected` or `universal` source shows its document read-only and offers `Store as environment`, which opens `Edit environment` with that document.
- The section lists each variable of `environment_secrets` as `<variable> → <credential>`, never a value, with `Remove`. `Remove` writes the binding set without the variable.
- `Set secret` opens a sheet with the variable, the credential name and the secret value in a password field. The send creates the `environment_secret` credential when it is absent, else rotates it, and then writes the binding key through the binding set. The sheet clears the value after each send.
- While `repairing` is true, the section shows "Repairing with env@1 · repair <repairs> of 3". With `repairs` above 0, it shows the fact `Repairs` as "<repairs> of 3".
- A failed environment with no enabled `env@1` shows "Enable env@1 to let KanthorD repair it." and the link `Enable env@1` to `/agents/env@1#enablement`.
- A failed environment shows its class, its command and exit code, the tail in a scrollable block with `Copy`, and the reproduce command with `Copy`.
- The section holds `Run onboarding again`, `Edit environment` and `Copy environment`. `Run onboarding again` calls `project.binding.environment.rebuild`. A success shows the toast "Onboarding of <binding> started.". A 409 `project.environment.run_active` shows an info toast, and another refusal shows an error toast with `Retry`. `Copy environment` copies the `environment` of `project.binding.environment.get` as indented JSON.
- A binding with `suite_pass` `absent` and the proposal shows "Add the suite pass record so that CI skips the test files that already passed." and the action `Add setup node`. The action creates the node of the plan `suite-pass-setup` with `mission.node.create`.
- `Edit environment` opens a sheet with one text field that holds the stored environment as indented JSON. With no stored environment, the field is empty. `Save environment` calls `project.binding.environment.set`. The sheet checks before the send that the text is one JSON object, and it shows "The environment is not a JSON object. Remove the comments and the trailing commas." otherwise, because a `devcontainer.json` file often holds JSONC. A refusal of the server shows its message under the field. After a save, the binding sheet reads its entry again, so a later `Save binding` keeps the new environment.
- The path `/projects/<project>?tab=bindings&environment=<binding name>` opens the sheet of that binding at its `Environment` section.
- The form of a worker binding holds the select `Environment` when its selection holds a `container` instance. It lists the repository bindings of the draft set. With one repository binding, it preselects it on a new binding. With two or more, the form marks the field as required. With none, the select is empty, not required, and shows "Add a repository binding first." The form writes the key only when the selection holds a `container` instance.

## Repository layout, build, test and release

The Project Service source sits under `src/project/` of the `engine` repository.
A test file sits beside its source as `*.test.ts`.
`node --test` runs the tests.
`tsrs -p tsconfig.build.json --checkers 2` builds into `dist/`.
The `kanthord` bin of `package.json` releases it.

## Tests

- A test covers a creation and a rename to a taken project name, and it asserts 409 with the identity of the holder.
- A test covers a project creation whose mission insert fails, and it asserts that no project row remains.
- A test creates a project and asserts a null `paused_at`.
- A test pauses and resumes a project. It asserts `paused_at`, a no-op of a repeated pause and of a repeated resume, 404 for an absent project, and one wakeup after the resume only.
- Tests cover repository coverage and custody suitability; an absent platform key and an HTTPS repository address fail.
- Tests assert `validateEntry` inside the write transaction and refusal when an agent lacks enabled enablement.
- Tests assert that `entriesOfAgent` includes every dependent binding, including bindings without explicit entries.
- A test asserts one SSH read per repository address, its failure code and the resource healthcheck deadline.
- A test covers four address hosts: `ssh.github.com`, a host outside the GitHub SSH host set, `gitlab.com` for platform `gitlab`, and a host that starts with `-`. The `ssh.github.com` address and the `github.com` address of one repository derive the same identity.
- A test covers a binding write with a pinned host, and an unpinned host that refuses with 409. A host outside the host set answers `address_invalid` on the check.
- A test asserts that the repository check names the `ssh` record of the binding in its attribution and no other credential store record.
- A test covers integer instance counts from 0 to 64 of an external-harness binding, invalid counts and the error code. It checks that 0 makes the binding unavailable.
- Tests accept `tags` at 64 bytes and an absent field as `[]`. They refuse a longer tag, an upper-case tag, an empty segment, a repeated tag and a nonlist value with `project.bindings.worker.tags_invalid`.
- Tests refuse a binding-set write that adds an unmatched pair with `project.bindings.worker.node_unmatched` and the node identities. They accept a write that keeps an earlier unmatched pair and adds none.
- A test covers both GitHub actions, their capabilities and their implied expected end states. It refuses more than one action.
- A test covers each of the five changes, and it asserts the revision that each one creates.
- A test covers a disablement that takes effect at the next resolution, and a consumed grant that authorizes no second operation.
- A test covers an omitted name, a name whose resource changed, a set that references a name absent from the submission, and a dependent reference that follows a new identity under its name.
- A test covers a worker change under the same name, and it asserts that the write refuses the change.
- A test covers the reuse of a name after its removal.
- A test covers a stale binding-set version and a submission equal to the stored set.
- A test covers two concurrent writes of one binding set, and it asserts that the second one is refused.
- A test covers the refusal of `placement` on a native binding and on an external-harness binding with `project.bindings.worker.field_forbidden`.
- A test covers each refusal of `worker_instances`: `instances_required`, `instances_invalid`, `instance_unknown`, `instance_worker_mismatch` and `field_forbidden` in both directions. It covers the effective count of `workerBindingOf` and a binding that lists instances of two placements.
- A test covers a second listing of a `container` instance with `project.bindings.worker.instance_shared`, in the same project and in another project.
- A test covers `environment_required` for a binding that lists a `container` instance, and a binding of `server` instances that omits the key with two repository bindings.
- A test covers a removal of an instance from `worker_instances`. It asserts that no registration ends in the write, that the `binding_version` of the removed and the kept `worker` instances increases, and that a server instance keeps running.
- A test covers a removal and a removal by omission of a worker binding with live registrations, and a revision to `instance_count: 0` of an external-harness binding. It asserts the end of every live registration in the transaction of the write, that a failed write ends no registration, and that a lowered count of 1 ends no registration.
- A test covers a revision to `worker_instances: []` of a native worker binding with a live execution. It asserts that the write ends no registration, that the binding gets no new claim, and that the live execution finishes.
- A test covers a reordered JSON property that creates no revision.
- A test covers a resolution of the whole dependency chain, and it asserts the recorded revision of each member.
- A test covers the derivation of a webhook secret, and it asserts that two labels produce two different secrets.
- A test covers a `master_key` that decodes to other than 32 bytes.
- A test covers an execution identity that names another node, a machine identity that names no live registration, and a client identity whose binding group is not the binding group of the claim.
- A test covers a repository binding whose network git read fails. It asserts that the Project Service refuses the write with its error code.
- A test covers a worker binding that is absent, removed or an external-harness binding with `instance_count: 0`, and it asserts that the verification of a machine JWT that names it fails. A second case asserts that a draining client identity of a native binding with `worker_instances: []` passes.
- A test asserts that no log record and no error body holds secret material.

## Open decisions of an epic

- The replacement of `master_key`, which makes every stored ciphertext unreadable and every webhook secret stale, and which no command performs today.
