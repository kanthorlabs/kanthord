---
title: Mission Service Implementation
---

# Mission Service Implementation

This file holds the implementation rulings for the mechanisms that realize [mission-service.md](mission-service.md).
This file is not a design document, and `mission-service.md` stays the single source of truth.
A mechanism here never overrides a rule there.
A ruling that names a package, a product or a version is deliberate.

## The identities of the Mission Service

The identities follow the identity convention of [architecture.impl.md](architecture.impl.md#the-identity-and-the-time).

- A node uses `node_<ulid>`.
- An evidence record uses `evidence_<ulid>`.
- An assessment uses `assessment_<ulid>`.
- An outcome uses `outcome_<ulid>`.
- An evidence asset uses `evidence_asset_<ulid>`.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) declares `mission_<ulid>`.
- An attempt uses its attempt number as its key within the node. An attempt takes no prefix.
- The Scheduler Service declares the execution identity.

## The actor

Every record that names an actor stores one of three forms, and the server derives each one from the verified caller.
An execution assessment is the exception: it stores the execution identity, and the read derives the execution form. A human assessment stores the human form.

- `{ kind: "human", account, name }` from the human identity: `account` is the `sub` of the JWT and `name` its display name, under the bounds of [gateway-service.impl.md](gateway-service.impl.md#the-jwt). A human carries no ULID.
- `{ kind: "execution", executionId, clientId, name }` from the execution record of the claim: `executionId` follows the identity that the Scheduler Service declares; `clientId` and `name` are the attribution that the claim copied for a registered instance under [scheduler-service.md](scheduler-service.md#claims-and-counts), and both are null for an instance that the server hosts. An external harness assessment identifies its client identity through this form.
- `{ kind: "service", service }` for a service, with `service: "scheduler"` for the loss declaration of the Scheduler Service and `service: "mission"` for the landed-commit evidence of a request.
- No input carries an actor, and an actor field in an input answers HTTP 400 with an issue list.

## The node content

- Every node holds all five required plan content fields and a plan file name.
- The same rules apply to an import, a node write and an unblock content change.
- `name` is nonblank text, a title with no identity or uniqueness requirement.
- `requirement` is nonblank text.
- `criterion` is nonblank text that can hold several checkable statements.
- `verifications` is a nonempty ordered list of nonblank bash command strings.
- `bindings` is a list of binding names of the project.

The write resolves each binding name to the identity of the latest revision of that binding, pins that revision and checks the rule table.
The node kind determines the column.
A new binding kind adds a row.

| Binding kind | Initiative | Objective | Task |
| --- | --- | --- | --- |
| Repository | 0 | Exactly 1 | 0 |
| Worker | 0 | 0 | 0 |
| Storage | At most 1 | At most 1 | 0 |

A missing, blank or nontext `name`, `requirement` or `criterion` answers `mission.node.content_invalid`.
An absent or empty `verifications` list answers `mission.node.verifications_missing`.
A nonlist `verifications` value or a blank or nontext item answers `mission.node.content_invalid`.
A node with no verification need holds an always-successful command such as `true`.
An absent or nonlist `bindings` value, an unresolved name or a rule-table violation answers `mission.node.bindings_invalid`.
The identity, kind, node revision, state, attempt, priority and edges stay outside the content.
A task's content belongs to the node revision of its objective.
Test-kind guidance changes no validation rule.

## Priority

A human sets the priority of an initiative or an objective only.
A task holds no priority; a priority write on a task answers `mission.node.priority_task`.
The value is any signed safe integer, from -9007199254740991 through 9007199254740991, with no narrower bound.
An absent priority reads 0.
The service answers HTTP 400 with an issue list for a fraction, a nonnumber or an unsafe integer.
The act requires a nonterminal node with no live claim.
A live claim on the node answers 409 `mission.node.claim_live` with `details: { nodeId, executionId }`, and a dependency addition that meets a live claim on the dependent or on a node of its subtree answers the same code.
An import carries no priority.

## The attempt

`FrozenAction` is the read shape of a required external action.
The service derives it from the policy of the `project_binding` row that the pinned revision of the attempt names.

- A `FrozenAction` holds `key`, `bindingId`, `action`, `expectedEndState`, `follows` and `configuration`.
- `action` is `pull_request` or `merge_push` for a repository binding, under the action catalog of [project-service.impl.md](project-service.impl.md).
- `expectedEndState` is `pull_request_merged` for `pull_request` and `base_branch_pushed` for `merge_push`.
- `follows` is the key of the action that this action follows, or null when it follows the passing assessment. It is null while a strategy holds at most one action; the field stays for a later action kind. The Project Service refuses `follows.type = "action_end_state"` in a binding write until a retry-safe claim-source contract exists, because no claim answer carries its claim source. Until then every evaluation claim comes from `Waiting`, a reviewer execution performs the evaluation on every claim, and the continuation claim from `External.Requested` of [worker-service.md](worker-service.md#evaluation) stays unreachable.
- `configuration` holds the operands that the action performer takes from the strategy: `baseBranch`. Every other fact of the operation, the address, the platform and the credential, comes from the resolution of the pinned binding revision `bindingId` through the Project Service at the call, under [worker-service.md](worker-service.md#workers-and-templates).
- `bindingId` is the repository binding revision that the pinned node revision names.
- A configured action of another binding kind adds its own `action` value, `expectedEndState` values and `configuration` shape with its design; the service refuses every other value.
- An initiative requires no external action, so its set is empty.
- A `FrozenAction` holds the key of the configured action of [project-service.impl.md](project-service.impl.md), and the request evidence of the attempt names that key in `requirement_key`.
- `mission.evidence.request` is the operation of the Worker action performer. It uses `POST /api/mission/node/:nodeId/evidence/request` with `client` access under the execution of the live evaluation claim. The invocation chain proves that execution under [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters). It checks the node, the open attempt of the claim, the required external action and its binding.
  Its input holds `executionId`, `attempt`, `nodeRevision`, `requirementKey`, `subject`, `scope` and `address: PlatformAddress`, and it answers `Evidence`. The first three fields must match the proven claim under [Operation contracts](#operation-contracts). The Mission Service writes the address as the one `platform` asset of the request evidence.
  A reuse is a new request evidence of a later attempt whose `platform` asset holds the address of a request evidence of an earlier attempt of the same node and the same action.
  Its dispatch and the recovery of a lost answer stay blocked under the B9 item W2 of [HANDOFF.md](HANDOFF.md#worker-and-project-services).
- A request under a steps claim answers 409 `mission.execution.claim_not_evaluation`, as an assessment does. A `requirementKey` outside the required external actions of the attempt answers 400 `mission.request.requirement_unknown`. An address whose kind does not fit the action, or whose `resourceIdentity` is not that of the binding of the action, answers 400 `mission.request.address_mismatch` with `details: { requirementKey }`. A second request for a key of the attempt answers 409 `mission.request.already_requested`.

## Configuration

- The Mission Service owns the section `mission` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.
- `mission.consecutiveLossLimit` holds the [consecutive loss limit](mission-service.md#consecutive-loss-limit), as a positive integer in the `nat` format of `convict`, and it defaults to `3`.
- `mission.textMaxBytes` holds the upper bound of a `Text` value in UTF-8 bytes, as a positive integer in the `nat` format of `convict`, and it defaults to `32768`.
- The bound applies at a write. A stored value keeps its length after a change of the bound.

## The plan file grammar

- The Mission Service owns the Markdown format and the JSON format of a plan.
- A plan file starts with YAML front matter between `---` delimiters.
- The front matter permits only these keys:
  - `id`: the node identity; absent on a new node.
  - `kind`: `initiative`, `objective` or `task`.
  - `parent`: a plan file name; required on an objective or task, absent on an initiative.
  - `dependsOn`: a list of plan file names; forbidden on a task.
  - `bindings`: the project binding names under the node content rules.
  - `verifications`: the nonempty ordered list of bash commands under the node content rules.
- After the front matter, exactly one H1 supplies `name`.
- Exactly one `## Requirement` section supplies `requirement`.
- Exactly one `## Criterion` section supplies `criterion`.
- Each section extends to the next H2 or the end of the file.
- The parser refuses an unknown key, an unknown H2, or an absent or repeated section or H1.
- It answers `mission.import.plan_invalid` and names the file.
- The file name is the import-set key and the plan file name of the node.
- The [plan file example](mission-service.vocabulary.md#plan-file) shows the complete format.

## The plan file name

- The node row holds `filename` with a unique index on `(mission_id, filename)` where `retired_at` is null. A retirement sets `retired_at` to the commit time, and the value never changes.
- A retirement keeps `filename` on the retired row. A create, an import or a node update can take the name of a retired node.
- The form is a lower-case name that ends in `.md` with no path separator.
- An import sets `filename` from the file name, and `node create` requires it.
- Node reads return `filename`, and every export writes it unchanged.
- A node update that changes `filename` changes content and creates a node revision.
- A task change creates a node revision of its objective.
- A taken name answers 409 `mission.node.filename_conflict`.

## Export and the two formats

- `mission.export` uses `GET /api/mission/:missionId/export?format=markdown|json` with `human` access.
- The JSON answer is `{ missionId, missionVersion, entries: [{ filename, id, kind, name, requirement, criterion, verifications, bindings, parent, dependsOn }] }`.
- The Markdown answer is `{ missionId, missionVersion, files: [{ filename, content }] }`.
- Each Markdown `content` follows the plan file grammar.
- JSON entries use the same node content and parent and dependency rules as Markdown.
- `parent` and `dependsOn` name plan files in the import set, not node identities.
- An initiative omits `parent`, and a task omits `dependsOn` in both formats.
- Each answer is the exact plan payload that the import of its format accepts.
- The import accepts `format: markdown` with raw `files: { filename, content }[]`, which the Mission Service parses.
- The import accepts `format: json` with `entries`.
- The format, reason and apply controls accompany the unchanged plan payload.
- The payload names `missionId` and `missionVersion`; the latter is the expected mission version for the import.
- An export excludes retired nodes.
- The answer bound is 10 MiB; a larger answer is 413 `mission.export.too_large`.
- An import covers the whole mission and carries no scope.
- Every `parent` and `dependsOn` resolves inside the import set; no boundary reference exists.
- The preview lists every current node that the import set omits as a retirement.
- The apply confirms that exact retirement set with `confirmedRetirements` and checks `previewDigest` at commit.
- The import result holds the map from file name to node identity.
- A violation holds `code`, `message`, `filename`, `nodeId` and `details`: the error object of the shared envelope plus two locators. `filename` is the submitted file name as a string, so it can name a malformed name; each locator is null when it does not apply.
- The import validates in three stages: the plan files and their content, the resolved graph, then the import condition. A preview reports every violation of the first stage that fails and stops there, because a later stage needs the earlier one; it answers 200 with the list and the digest of the submitted set.
- An apply stops at the first violation and answers the shared envelope with its code and status. An authorization or revision failure is an operation failure on both paths and never a violation.
- The import codes and their apply status are: HTTP 400 for `mission.import.plan_invalid`, `mission.import.mission_mismatch`, `mission.import.unresolved_reference` with `details: { reference, name }`, `mission.import.reference_kind_invalid` with `details: { reference, name }`, `mission.import.kind_changed` with `details: { id, kind, currentKind }`, `mission.import.duplicate_file`, `mission.import.unknown_id`, `mission.import.duplicate_id`, `mission.import.foreign_id`, `mission.import.retired_id` with `details: { id }`, `mission.import.cycle`, and the node content codes of [The node content](#the-node-content); HTTP 409 for `mission.import.condition_failed` with `details: { state, attempt }`, `mission.import.terminal_change`, `mission.node.filename_conflict` and, on apply alone, `mission.import.retirement_mismatch`.
- A body `missionId` that differs from the route is a first-stage violation `mission.import.mission_mismatch`. A parent or dependency name that resolves inside the set to a file of the wrong kind is a second-stage violation `mission.import.reference_kind_invalid`. An entry with the identifier of a known node of another kind is a second-stage violation `mission.import.kind_changed`.

## Node API admission

- A human retires a node through a whole-mission import that omits its plan file, under the import condition, or through `node retire` under [Node retire](#node-retire).
- Every node API write and every human control on a retired node answers 409 `mission.node.retired` with `details: { nodeId }`.
- A node API write that changes a node in a terminal state, or a task whose objective holds a terminal state, answers 409 `mission.node.terminal` with `details: { nodeId }`.
- A write that names a retired node as a parent or a dependency answers 409 `mission.node.retired` with `details: { nodeId }` of that node.
- `dependency add` with a task endpoint or with endpoints in two missions answers 409 `mission.dependency.endpoint_invalid` with `details: { reason, nodeId, dependsOnId }`, where `reason` is `task_endpoint` or `cross_mission`.
- A self addition answers 409 `mission.import.cycle` after the endpoint checks. `dependency remove` checks no endpoint pair, and an absent edge is a no-op.
- An import entry with the identifier of a retired node fails with 400 `mission.import.retired_id`.
- `node create` admits an initiative at any time.
- It admits an objective or task under a parent in `Pending`, `Available`, `Executing`, `Blocked` or `Paused`.
- Every other parent state answers `mission.node.create_refused` with the parent state in `details`.
- The refused states are `Waiting`, `Evaluating`, `External.Requested`, `External.Success`, `External.Failed`, `Completed` and `Discarded`.
- The commit rechecks the rule.
- The import keeps the import condition.
- A human control or a record list that names a task answers 400 `mission.node.control_task` with `details: { nodeId }`.
- A human control whose `expectedState` equals the current state, when that state is outside the states that the control admits, answers 409 `mission.node.control_refused` with `details: { state }`. The CLI page lists the admitted states of each control.

## The verifications

The execution runs the verifications in list order, one by one, never in parallel.
Each item runs through `bash -c` in the workspace root of the execution.
The run stops at the first failed item.
The verification records one result `{ command, exitCode, signal, timedOut }` per item that the execution started, in list order.
`Verification` holds `testedInput` and `results`, and the evidence that records the run holds it in `verification`.
`exitCode` is the exit status or null.
`signal` is the POSIX signal name that ended the process or null.
`timedOut` is true when the deadline of the item ended it; [worker-service.impl.md](worker-service.impl.md#stop-and-budget) fixes that deadline.
Both `exitCode` and `signal` are null for a process that the execution started and could not observe.
An item passes only with `exitCode: 0`; every other result fails, and an unstarted item has no result.
A run passes when `results` hold one entry per verification and every entry has `exitCode` 0.
No result claims that an unrun item ran.
The start refuses a host without bash.
No execution identity infers a verification from prose.

The Mission Service refuses an assessment that asserts success with a failed or unrun verification, and it answers `mission.assessment.verification_failed`.
A success assessment names exactly one evidence that holds a `verification`, and that run must pass; otherwise the service answers the same code.
For an objective, the `results` of that run hold one entry for each verification of the objective and of each current task of the pinned revision; otherwise the service answers the same code.
Judgement decides success only after every verification of the pinned content passes.

## The assessment

An assessment holds one `result` and one required, nonblank `rationale`.
It holds the evidence identities, child outcome identities, tested input and node revision.
It holds no `method` field and no separate criterion result.
The actor identifies who judged.
An execution assessment names the execution of its evaluation claim: it stores `executionId`, and the read derives the `Actor` of the execution form from it.
An external harness assessment identifies the client identity of its harness worker.
A human assessment stores the human `actor`, holds a null `executionId` and a null `testedInput`, and names no child outcome. Its evidence set is optional. The read answers `currency: null` for a human assessment.
A human writes an assessment only through a success override, a discard or a block, and that act writes the assessment and the outcome that names it in one transaction.
Every other rule of this section binds an execution assessment only.
The execution code, never the agent, runs the verifications before the judgement.

The result follows this order:

1. A failed or unrun verification gives `criterion-not-met`, with no judgement.
   The required rationale names that verification.
2. Otherwise, judgement against the criterion gives `success`, `criterion-not-met` or `undetermined`.
3. For a worker that declares a base prompt, a default-standard violation turns `success` into `criterion-not-met`.

Only the first case permits an empty judgement.
The judgement is absent in that case; the rationale is never absent.
The rationale names each default-standard violation. An assessment holds no separate list of findings.
The rationale of an objective assessment also names each current task whose criterion is unmet.
The Mission Service answers `mission.assessment.verification_failed` when an assessment asserts success with a failed or unrun verification.
HTTP 400 with an issue list rejects a method field, an absent or blank rationale, and a result that violates this order.
The execution behaviour follows [worker-service.md](worker-service.md#evaluation-and-required-external-actions).

- At acceptance `childOutcomeIds` of an initiative names the current outcome of each current objective, and no other outcome. `childOutcomeIds` of an objective is empty. The service refuses every other set with HTTP 400 and an issue list. `evidenceIds` and `childOutcomeIds` are duplicate-free sets.
- The read derives `childNodeIds` from the nodes of `childOutcomeIds`.
- `nodeRevision` of an assessment is the revision that its attempt pins, or the node revision current at the act when a human assessment names attempt 0.
- An assessment that names an evidence with a pending or expired asset answers 409 `mission.assessment.evidence_unpublished`.
- A human delete of an evidence removes its identity from `evidenceIds`, and nothing else changes an assessment.
- The read derives `workerVersion` from the worker of the binding row that the execution of the actor pins.
- The service computes the currency of an execution assessment at each read, and it stores no currency.
- Take an execution assessment A of node N and attempt k. `contextMatches` is true exactly when all three conditions hold: `nodeRevision` of A equals the revision that attempt k of N pins; each identity of `evidenceIds` of A names an evidence of N; for an initiative, the nodes of `childOutcomeIds` of A equal the current objectives of N, and each named outcome is the current outcome of its objective.
- The current outcome of a node is its outcome with the greatest `sequence`.
- `authorityAdmits` is true exactly when no human assessment of N and attempt k has a greater `sequence` than A.
- `orderSelected` is true exactly when A holds the greatest `sequence` among the execution assessments of N and attempt k that pass the context check and the authority check.
- `current` is true exactly when all three checks admit A. `reasons` holds one named constant text for each failed check.

## The request record

- `requirement_key` of a request evidence holds the key of its `FrozenAction`. The expected end state is `expectedEndState` of that `FrozenAction`: `pull_request_merged` or `base_branch_pushed` for a repository action; a configured action of another binding kind adds its own values with its design.
- `PlatformAddress` holds `kind` and `resourceIdentity` of the binding, for example `repository:github:kanthorlabs/kanthord`, and never a `bindingId`. A `pull_request` address adds `number`. A `branch_push` address adds `branch` and `commit`, the commit that the Intake Service pushed. The service stores it as RFC 8785 canonical JSON under [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- The Intake check takes the binding and its credential from the pinned `FrozenAction` of the request, and it answers `endState` and `landedCommits`.
- `endState` is one of `expected`, `other` and `none`. `expected` establishes the expected end state. `other` establishes another end state. `none` establishes no end state.
- The service sets `end_state` of the request evidence to `expected` or `other` once and refuses a later conclusive result for the same request. `none` writes nothing.
- An `expected` result of a repository action holds a nonempty `landedCommits`. The service writes each commit as its own evidence with the provenance `{ kind: "service", service: "mission" }` and the attempt of the request. Delivery admission adds `inbound_event_id`, the identity of the inbound event, to that provenance. Every other result holds an empty list.
- The resolution of a required external action in a read is `unrequested` while the attempt holds no request evidence for it, `unresolved` while its request evidence holds no end state, `expected-end` after `expected` and `other-end` after `other`.
- `mission.delivery.admit` is the `service` operation of delivery admission. It writes no record of its own. It calls the Intake check before its transaction, then commits the end state and the landed-commit evidence together, because a transaction awaits nothing. More than one matching request answers the refusal reason `ambiguous`. A request whose end state is set answers `duplicate`. The span of the operation holds the disposition and the refusal reason.
- `mission.node.check` uses `POST /api/mission/node/:nodeId/check` with `human` access and names `expectedMissionVersion`. It calls the Intake check for each request evidence of the open attempt with no end state, commits each result in its own transaction and answers `{ results: { evidenceId, requirementKey, resolution }[], failures: { evidenceId, error }[] }`. A node with no unresolved request answers 409 `mission.node.no_unresolved_request`.
- This record decides no order of contradictory results, no reversal of an accepted platform state and no request for which no end state arrives. The B9 Mission items of [HANDOFF.md](HANDOFF.md#mission-service-1) own the open recovery rules.

## The release admission

- The Mission Service routes a release inside the release transaction of the Scheduler Service, and it checks the release predicate before the terminal write. The node state fixes the kind of the release: `Executing` for a steps release and `Evaluating` for a reviewer release.
- A steps release with `furtherWork: false` requires a published evidence of the open attempt whose provenance is the releasing execution. For an objective, that evidence holds one `repository` asset whose `bindingId` equals the repository binding of the pinned revision. For an initiative, it holds one `produced` asset.
- A steps release with `furtherWork: true` carries the checkpoint and push obligation of [worker-service.impl.md](worker-service.impl.md#stop-and-budget), and the service checks no record for it.
- A reviewer release requires a current passing assessment of the attempt and no required external action of the attempt that is eligible and unrequested. An action is eligible under [worker-service.md](worker-service.md#evaluation-and-required-external-actions): it is unrequested in the attempt, and it follows no action or its predecessor reached its expected end state.
- A release that fails the predicate answers 409 `mission.release.obligation_unmet` with `details: { obligation }`, where `obligation` is `evidence`, `assessment` or `request`. The refusal writes no execution row, no node state and no job, and the execution stays `running`.
- The predicate is the same for every harness. The execution code of a worker that kanthord hosts satisfies it before the release, and an external harness meets it through the same check.
- Tests release a steps claim on an objective with no evidence, with a produced-only evidence and with an unpublished repository evidence, and assert 409 `mission.release.obligation_unmet` with `obligation: evidence` and no change to the execution, the node and the queue. Tests release a reviewer claim with no assessment and with an eligible unrequested action, and assert `obligation: assessment` and `obligation: request`. A test asserts that a release with `furtherWork: true` checks no record.

## Evidence content

Inline evidence holds at most 5 MiB of decoded content.
`ContentBytes` holds `mediaType`, `encoding: "base64"` and canonical base64 `data`.
The produced content address holds the required SHA-256 of those decoded bytes.
The server verifies the hash before it accepts the content.
Larger inline content answers 413 `mission.evidence.too_large`.
The service never truncates evidence.
A node without a storage binding accepts only inline evidence content.
Repository evidence remains an address, not an upload of repository content.

- An evidence asset holds `kind` and `content`. `content` is the RFC 8785 canonical JSON of the shape that `kind` names: `RepositoryAddress` for `repository`, the produced shape `{ mediaType, sha256, data }` for `produced`, `ObjectAddress` for `object` and `PlatformAddress` for `platform`.
- The produced shape holds canonical base64 `data` of at most 5 MiB decoded, and a content read answers `ContentBytes` from it. The service derives `ProducedAddress` and `ObjectAddress` from `content`.
- `mission.evidence.submit` takes the full asset list and writes the evidence row and every asset row in one transaction. No asset joins an evidence later.
- Every evidence holds `scope`, a `Text` that states what part of its node the evidence covers. `mission.evidence.submit` and `mission.evidence.request` require it, and an absent value answers HTTP 400 with an issue list. The service stores the value unchanged in `mission_evidence.scope`, never interprets it and answers it on every evidence read.
- The Mission Service writes `scope: "landed commit"` on the evidence of each landed commit, from a request and from a success override.
- A `repository`, `produced` or `platform` asset sets `published_at` at the insert. An `object` asset sets `expired_at` one hour after the submission.
- An asset is published when `published_at` is set, pending while `expired_at` lies after now, and expired otherwise. An evidence is published when every asset of it holds `published_at`.
- `requirement_key` holds only the key of a `FrozenAction`; every other evidence holds no requirement key.
- An evidence has no natural key. A repeat after a server restart or after the replay window of the Gateway creates a new evidence, and the service accepts that duplicate.

- A repository address holds `bindingId` and `commit`.
- `commit` is the full git object name in lower-case hexadecimal: 40 characters for a SHA-1 repository or 64 characters for a SHA-256 repository, the two object formats of git. An abbreviation, upper-case or a ref name answers HTTP 400 with an issue list.
- The service checks the form alone and never the repository.
- `bindingId` names a repository binding revision of the project in every context.
- For the evidence of an objective, and for a landed commit, it equals the repository binding of the pinned revision. When a success override supplies a landed commit while the attempt reads 0, it equals the repository binding of the node revision current at the act, under [The outcome record](#the-outcome-record).
- For the tested input of an initiative, the list holds one address per distinct repository binding of its current objectives.
- The landed commit of a success override follows the same form and binding rule.
- A repository address whose `bindingId` is not the binding that its context requires, or a landed commit on an initiative, answers 400 `mission.evidence.binding_mismatch` with `details: { bindingId }`.
- `mediaType` is an RFC 6838 `type/subtype` with no parameter, in ASCII, at most 255 bytes: the two name limits of 127 characters and the separator. A parameter, a missing subtype, a non-ASCII byte or a longer value answers HTTP 400 with an issue list. The service stores the value unchanged and never interprets it.
- A content read of a repository asset answers 409 `mission.evidence.content_repository` with `evidenceId` and the repository address in `details`, after the authorization and the execution bound checks of the read. The failure carries no bytes and no presigned URL. The human and the execution content reads share that mapping.
- A content read of a `platform` asset answers 409 `mission.evidence.content_platform` with `evidenceId` and the address in `details`, after the same checks, and it fetches no external content.

## Object evidence

Object evidence uses one presigned-transfer strategy for every placement and every co-location.
The host-local helper serves `evidence upload <path>` inside the execution workspace.
The host component is the server, the `worker` application or the harness extension.
It opens the path safely and refuses any path or symbolic-link escape from that workspace.
The file path is local input, not an evidence address.

1. The component calls `mission.evidence.submit` with execution context, the evidence metadata and the asset list. An `object` asset declares `mediaType`, `size` and an optional `sha256`.
   This operation requires execution access and a live claim for the node or its task.
   The server checks the live claim, the storage binding of the pinned revision and the 5 GiB single-object limit.
   A node without a storage binding refuses the upload with 409 `mission.evidence.storage_binding_absent`.
   It creates the evidence and one pending asset for each `object` asset, with a server-generated key: `<prefix>/<project>/<mission>/<node>/<attempt>/<evidence asset id>`.
   The asset pins that storage binding revision in `storageBindingId` of its `ObjectAddress`.
   The Intake Service signs a presigned PUT for that key with a lifetime of 1 hour through `intake.storage.put`, with the material that custody releases.
   The grant requires a checksum header only when the component supplies a SHA-256.
2. The component sends the bytes directly to the store with that PUT.
   No transfer through the server proxies those bytes.
3. The component calls `mission.evidence.asset.complete` under execution access with the asset identity and execution context.
   The server checks the live claim, and the Intake Service checks the object size and, when given, the checksum through `intake.storage.check`.
   A mismatch prevents publication.
   The server sets `published_at` of the asset only after those checks pass.
   The asset holds the object location, version when the store returns one, size, media type and optional SHA-256.
   The answer holds the asset identity and the `s3://` URI.

A pending asset expires at `expired_at`, 1 hour after the submission.
A `complete` of an expired asset answers 409 `mission.evidence.upload_expired`, and a new upload is a new submission.

- kanthord runs no automatic sweep of unpublished upload objects.
- kanthord runs no cleanup process. A human deletes an expired asset through `mission.evidence.asset.delete`.

SHA-256 is optional for object evidence.
A component supplies it when it wants; the store verifies it when both sides support it.
kanthord enforces no object immutability.
It records an object version when the store returns one.
A human who disables versioning accepts that choice.
The binding write probes no store capability.

An authorized reader gets a presigned GET through its kanthord component: `mission.evidence.asset.content.get` for a human and `mission.execution.evidence.asset.content.get` for an execution. The Intake Service signs it through `intake.storage.get` or `intake.execution.storage.get`.
The read targets the recorded object version when one exists.
The presigned URL is an API answer, never part of the credential handover or the agent context.
The storage credential stays inside the server process.
The MCP server exposes no upload write.
A delete of an object asset deletes the object and withdraws kanthord's access; it recalls no downloaded copy.
[Evidence retention](#evidence-retention) governs the delete.

## Evidence retention

An evidence record and its assets stay until a human deletes them, whether an outcome names the evidence or not.
A delete removes the row, and a deleted row is gone and not recoverable under [architecture.impl.md](architecture.impl.md#the-operational-database).
kanthord runs no automatic evidence delete and no cleanup process.

- `mission.evidence.asset.delete` uses `DELETE /api/mission/evidence/asset/:assetId` with `human` access. It deletes one asset and keeps the evidence row, even with zero assets.
- `mission.evidence.delete` uses `DELETE /api/mission/evidence/:evidenceId` with `human` access. It deletes every asset of the evidence, then the evidence row. It removes the evidence identity from every `evidenceIds` set of an assessment and of an outcome.
- Both inputs hold `expectedMissionVersion`, `force: boolean` and an optional `reason: Text`; the CLI defaults `force` to `false`.
- `Text` is nonblank text; its bounds remain open in [HANDOFF](HANDOFF.md#mission-service).
- With `force: false`, the node of the evidence and every ancestor must hold a terminal state.
- A live chain refuses the delete with 409 `mission.evidence.remove_node_live`.
- `force: true` skips that check and requires a reason, so a human can delete an exposed credential at once. `force` never changes what the command deletes.
- Force without a reason answers HTTP 400 with a validation issue list.
- The reason is optional without force.
- The service deletes the content first and the row after it. It deletes inline content with the row, and it deletes an object through `intake.storage.delete` with the storage binding revision that the asset pins, at the recorded version when one exists.
- A failed content delete keeps the row. The request key of the object delete is the asset identity. A repeat after a failed delete runs the read-back, and a human deletes the outbound request to send the delete again.
- A disabled or removed storage binding refuses the object delete, and `force` bypasses no binding authorization.
- The Tracking span of the delete records the human, the reason and the time, and the Mission Service stores none of them.
- A request evidence is deleted only with `force`, in every node state. Without `force`, the delete answers 409 `mission.evidence.request_force_required`.
- `mission.evidence.asset.delete` refuses the `platform` asset of a request evidence with 409 `mission.evidence.request_asset_refused`, and a human deletes a request through `mission.evidence.delete`.
- A forced delete of a request evidence of the open attempt holds the node in `Paused` in the same transaction, unless the node is already `Paused`. A request evidence of a closed attempt or of a terminal node changes no state.
- A delete of an expired asset can publish its evidence when every other asset of it holds `published_at`; on a live node, `force` is the acknowledgement.
- A read of a deleted asset or evidence answers 404 `mission.record.not_found`.
- A delete admits an outcome reference and changes no effect of that outcome.

## The outcome record

- The node exposes one attempt field, `attempt`.
  It holds the number of the latest attempt, or 0 when no attempt opened.
  A node holds an open attempt when `attempt` is 1 or more, except in `Blocked`, `Completed` or `Discarded`.
- Every attempt field of a record is a `nonnegative integer`.
  No attempt field is null.
  A record that the Mission Service writes while the attempt of its node reads 0 holds `attempt: 0`.
  This rule covers the human assessment and the outcome of a human override, discard or block on such a node.
  It also covers the landed-commit evidence that a success override supplies on such a node.
- A human act on a node whose attempt reads 0 writes its human assessment and the node outcome.
  It closes no attempt.
- An outcome stores no revision and no attempt. The read derives `nodeRevision` and `attempt` from the assessment that the outcome names.
- The initiative-only objective read resolves a child objective to the `nodeRevision` of its current outcome.
- An execution submission always names an attempt of 1 or more, because a claim exists only under an open attempt.
- An omitted `attempt` filter selects every authorized record of the node.
  `--attempt <n>` selects the records of attempt n.
  `--attempt 0` selects the records that the service writes while the attempt reads 0.
- Every transition into `Blocked` writes an outcome, so the blocked read always returns one.
  For a node blocked while its attempt reads 0, the read returns that outcome with no request evidence.
- An outcome stores no closing event. The read derives `closingEvent` in this order:
  - `success-override` for a human assessment with `result: success`.
  - `human-discard` for a human assessment with `result: undetermined` whose outcome is the current outcome of a `Discarded` node.
  - `human-block` for every other human assessment.
  - `assessment-not-passed` for an execution assessment whose result is not `success`.
  - `external-failed` for an execution assessment whose result is `success`, with `result: undetermined` on the outcome.
  - `assessment-passed` for an execution assessment with `result: success`, when the attempt requires no external action.
  - `external-success` for an execution assessment with `result: success`, when the attempt requires an external action.

  An outcome with attempt 0 names a human assessment.
  The required external actions derive from the pinned revision of the attempt, so an evidence delete changes no derived closing event.
- The outcome of a human block or a human discard asserts `undetermined`.
  Its basis is a human assessment, and only an execution assessment supports `criterion-not-met`.
- `execution cleared-outcome get` answers 404 `mission.record.not_found` when no unblock opened the claimed attempt.
  After a block and an unblock while the attempt reads 0, the first claim opens attempt 1.
  The execution of that claim is the opener of that attempt.
- A discard or a success override that meets a requested external action of the open attempt with no end state answers 409 `mission.node.action_unresolved` with `details: { requirementKeys }`, because a node reaches a terminal state only when no external action of its open attempt is unresolved.
- A human control checks `expectedState` and `expectedAttempt` against the current state and attempt.
  A mismatch answers 409 `mission.node.state_conflict`, with the current `state` and `attempt` in `details`.
  An `Unblock` whose `blockedAttempt` differs from the current attempt answers the same code.
- The service records the acceptance order of the outcomes of one node, from 1 with no gap.
  The current outcome of a node in an attempt is its outcome of that attempt that the service accepted last.
  The current outcome of a node is its outcome that the service accepted last.
  Neither `createdAt` nor the outcome identity decides that order.
- Every outcome names an assessment in `assessmentId`. The kind of the basis is the kind of the actor of that assessment.
- The context of the basis is the assessment that it names: its node revision, the evidence that it names, the child set of the child outcomes that it names and those child outcomes.
- The assessment changes only when a human delete removes an evidence identity from it, and the closure copies nothing, so a child change after the acceptance never enters the context.
- An outcome changes only when a human delete removes an evidence identity from its `evidenceIds`.
- `evidenceIds` of an outcome holds the evidence that its assessment does not hold: the landed-commit evidence of the attempt and the landed commit of a success override. The read answers the union of that set and `evidenceIds` of the assessment.
- The required external actions derive from the pinned revision of the attempt, so the outcome repeats none.

## The node read

- A node read of an initiative or an objective holds `dependsOn`: the node identities that the dependency edges of the node name, as a duplicate-free list in ascending order. A task read omits it, because a task carries no dependency edge.
- `dependsOn` of a node read holds node identities. `dependsOn` of a plan file holds plan file names.
- No operation reads the [dependency closure](mission-service.md#mission-structure-and-nodes) of one node.
  A client composes the closure from node reads: it follows `parentId` from the node to its initiative and takes the union of `dependsOn` of each node on that path. The state of each member comes from its own node read.

## Node ready

- `mission.node.ready` uses `POST /api/mission/node/:nodeId/ready` with `human` access.
- `node ready` requires `expectedState: Available` and an `expectedAttempt` equal to the attempt of the node.
  A mismatch answers 409 `mission.node.state_conflict`.
- When the attempt reads 0, the readiness condition reads no attempt-scoped record.
  An initiative is ready only when every current objective holds a terminal state.
  No action is unresolved, because no attempt requested one.
- A node that is not ready answers 409 `mission.node.not_ready`.
  Its `details` hold `objectivesNotTerminal: NodeId[]`, `unresolvedActions: Key[]` and `unsatisfiedIds: NodeId[]`.
  `unsatisfiedIds` names the dependencies of the closure that are not `Completed`.
  Each array is empty when it does not apply.
  The refusal opens no attempt, changes no state and writes no job.
- A ready act while the attempt reads 0 opens attempt 1 in one transaction.
  The transaction pins the current node revision.
  It sets `Waiting` and inserts the evaluation job.
  The service wakes the Scheduler after the commit.
  The act writes no assessment and no outcome.
- A ready act on an open attempt sets `Waiting` the same way, with no opening.
- The answer is `ControlResult` with the node in `Waiting` and the opened or open attempt.
  It holds `outcome: null`.

## Node resume

- `mission.node.resume` uses `POST /api/mission/node/:nodeId/resume` with `human` access.
- Its input is `Resume`: every field of `HumanAct`, plus the required `target`, which is `Available` or `Waiting`.
- `node resume` requires `expectedState: Paused` and an `expectedAttempt` equal to the attempt of the node.
  A mismatch answers 409 `mission.node.state_conflict`.
- The external action records of the attempt take precedence over the target, under [the state transitions](mission-service.md#state-transitions).
  A resume that they route to `External.Failed`, `External.Success` or `External.Requested` does not read the target.
- `target: Waiting` requires the readiness condition and the dependency closure.
  A node that is not ready answers 409 `mission.node.not_ready` with the `details` of [Node ready](#node-ready).
  The refusal changes no state and writes no job.
- `target: Available` moves the node to `Available` when the dependency closure holds, and to `Pending` when it does not hold.
- A resume opens no attempt and resets no loss count.
- The answer is `ControlResult` with the node in the selected state and the open attempt.

## Node override

- `mission.node.override` uses `POST /api/mission/node/:nodeId/override` with `human` access.
- The request `Override` holds every field of `HumanAct`, a required `result` and an optional `landedCommit`.
- The closed set of `result` is `success`. A failure override waits for the B9 items of the Mission Service.
- `landedCommit` is admitted only with `result: success`.
- The server writes the actor, the time, the human assessment and the outcome record.

## The rebind

- `mission.node.rebind` is a `unary` mutation under the `human` access policy. Its input holds the binding revision identity, a reason, the expected mission version and an optional node identity. Without a node identity the act covers every node of the mission.
- The target revision belongs to the same binding as the revision that the node pins, and it is no tombstone and no disabled revision.
- An absent target revision, or a target revision of another project, answers 404 `mission.binding.not_found`. A tombstone answers 409 `mission.binding.removed`, and a disabled revision answers 409 `mission.binding.disabled`.
- The target is a later revision of the same binding. A named node that pins neither an earlier revision of that binding nor the target answers 409 `mission.binding.mismatch` with `details: { nodeId, bindingId }`. A node that already pins the target is a no-op, and an act with no rebound node leaves the mission version unchanged.
- A named retired node answers 409 `mission.node.retired`, and a named terminal node answers 409 `mission.node.terminal`.
- The act inserts a node revision for each rebound node, and increments `mission_mission.version` once.
- The answer is the `NodeChange` of the act and `skipped`, a list of `{ node, condition }` where `condition` is `terminal` or `retired`, for a mission rebind.
- A rebind revision holds `change.write: node.rebind`, `changedFields: ["bindings"]`, the unchanged task snapshot of an objective and `change.tasks: []`.
- Tests rebind a node that is not terminal and not retired, keep the pinned node revision of an open attempt, report the skipped terminal and retired nodes of a mission rebind, and refuse a revision of another binding, a tombstone and a disabled revision.

- The Mission Service offers `liveNodesPinning(tx, bindingId)` to the Project Service through its `contract.ts`. It answers every node that is not terminal and not retired when its current revision or the node revision of its open attempt pins the binding revision. A rebind keeps the node revision of an open attempt, so the node keeps the old pin until that attempt ends.

## Node retire

- `mission.node.retire.preview` uses `GET /api/mission/node/:nodeId/retire/preview?force=true|false` with `human` access. It changes no state and stores no receipt. `force` defaults to false.
- `mission.node.retire` uses `POST /api/mission/node/:nodeId/retire` with `human` access.
- The retirement set is the node and every current descendant. The service checks each retiring initiative and objective itself and each retiring task through its objective.
- A checked node that fails `Pending` or `Available` with attempt 0 answers 409 `mission.node.retire_refused` with `details: { nodeId, state, attempt }` of the first failed node.
- A dependency on a node of the set from a nonterminal dependent outside the set answers 409 `mission.node.retire_has_dependents` with `details: { dependents: NodeId[] }` when `force` is false.
- With `force: true`, the retirement removes each such dependency and moves each freed dependent between `Pending` and `Available` in the same transaction. A dependency from a terminal dependent stays.
- Preview and apply answer the same refusals.
- The preview answers `RetirePreview`: `nodeId`, `force`, `missionVersion`, `retiredNodeIds`, `removedEdges`, `previewDigest`. The digest is the SHA-256 of the canonical JSON of the other five fields, under [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- The apply request `Retire` holds `expectedMissionVersion`, `force`, `previewDigest` and `reason`. A stale mission version answers 409 `mission.version.conflict`. A digest that differs from the digest that the service computes at commit answers 409 `mission.node.retire_mismatch`.
- One transaction rechecks every condition, sets `retired_at` on every node of the set and removes current inbound references except terminal dependents' historical dependencies.
- That transaction deletes the job of every node of the retirement set through the Scheduler Service public delete.
- It increments the mission version once.
- A retired task changes the content of its objective, so an objective outside the set takes a node revision with `write: node.retire` and a `retired` task change.
- The answer is `NodeChange`.
- A retirement deletes no row. A retired node keeps its identity, `filename`, its revisions and its last state.

## The revisions

- Every revision and version counter of the server starts at 1.
- Every `version`, `revision`, `expected*Version` and `expected*Revision` field holds a positive safe integer.
- A count is no revision. The attempt starts at 0.
- `gateway.tokenVersion` keeps its default of 1.
- A mission starts at mission version 1, and a node starts at node revision 1.
- A node takes its next node revision on every content change.
- These writes increment the mission version when they change the structure of the mission or the content of a node:
  - import apply
  - node create
  - node update
  - node move
  - node retire
  - node rebind
  - dependency add
  - dependency remove
  - criterion set
  - an unblock that carries a change
- These writes leave the mission version unchanged:
  - priority
  - pause
  - resume
  - block
  - discard
  - ready
  - attempt
  - evidence
  - outcome
  - the end state of a request evidence
  - node check
  - evidence asset delete
  - evidence delete
- One write increments once, however many nodes it touches.
- A write with no structure or content change leaves the mission version unchanged.
- Every `human` write that changes a node, its edges or its state names `expectedMissionVersion`: import apply, node create, node update, node move, node retire, node rebind, dependency add, dependency remove, criterion set, unblock with or without a change, priority, pause, resume, block, ready, override, discard, node check, evidence asset delete and evidence delete.
- A human control checks the mission version and leaves it unchanged, except an unblock that carries a change.
- A `client` write of an execution names no mission version, because it works under the pin of its attempt.
- Every node revision holds `change`.
- `change.write` is the write path: `import`, `node.create`, `node.update`, `node.move`, `node.retire`, `node.rebind`, `criterion.set` or `unblock`.
- A move of an objective changes its parent link and no content, so it creates no node revision. A move of a task changes the content of both objectives, so each one takes a node revision with `write: node.move`.
- `change.previousRevision` is the previous revision, or null on revision 1.
- `change.changedFields` lists the content fields whose value differs from the previous revision: `filename`, `name`, `requirement`, `criterion`, `verifications`, `bindings` and, for an objective, `tasks`.
- `change.tasks` is present for an objective and lists `{ id, change, changedFields }` for each task whose content changed, with `change` one of `created`, `updated`, `moved-in`, `moved-out` and `retired`. `moved-out` and `retired` carry an empty `changedFields`.
- The result of the change is the `content` of the same record.

## The graph write answer

- An operation whose answer holds `NodeChange` computes it at the commit. The mission keeps no history of changes.
- `NodeChange` holds the new mission version, the node revisions created, the retired node identities, and the edges added and removed.
- It also holds `openAttemptsUnchanged`, one `{ nodeId, attempt }` for each content owner of the change that holds an open attempt at the commit, so the answer states that the revision reaches the next attempt and not the open one.
- A write with no structure or content change answers the current mission version with empty arrays.
- A node revision keeps its own actor, reason and time, including the objective revision that a task retirement inserts. No record keeps the actor, the reason or the time of a dependency edit or an objective move, or the actor and the reason of a retirement that inserts no node revision. `retired_at` keeps the time of every retirement.

## Authorization integration

- The Mission Service supplies the authorization function of the [protected facility](custody.impl.md#the-protected-facility) for a `FrozenAction`, a request evidence and an evidence asset.
- For an execution identity, it follows the live claim through the Scheduler Service to the node, the open attempt and the `FrozenAction` or the evidence. It resolves the pinned binding revision through the Project Service.
- For a human identity, it follows the evidence asset to its storage binding revision.
- It takes no association from the caller.
- A broken chain answers 403 `mission.authorization.refused` with `details: { reason }`, where `reason` is `claim_not_live`, `node_mismatch`, `attempt_closed`, `binding_disabled` or `binding_removed`.

## Operation contracts

- Every Mission route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging) of the Gateway Service.
- Every Mission route uses the [default 30 s timeout](gateway-service.impl.md#cancellation).
- Every Mission route uses the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits).
- `Text` is a nonblank JSON string of at most `mission.textMaxBytes` UTF-8 bytes. A larger value answers HTTP 400 with an issue list. The rule applies to every text field of a node and to every item of `verifications`.
- A stale expected revision answers 409 `mission.revision.conflict` with the current value in `details`. A stale expected mission version answers 409 `mission.version.conflict` with the current value in `details`.
- An absent mission answers 404 `mission.mission.not_found`. An absent node answers 404 `mission.node.not_found`. An absent record answers 404 `mission.record.not_found`.
- An execution submission whose route node, `executionId`, `attempt` or `nodeRevision` differs from the proven claim answers 409 `mission.execution.context_mismatch` with `details: { field }`. An assessment or a request under a steps claim answers 409 `mission.execution.claim_not_evaluation`. An execution-scoped revision read above the pinned revision answers 404 `mission.execution.revision_above_pin`.
- `graph get` answers at most 10 MiB. A larger graph answers 413 `mission.graph.too_large`.
- That error holds the node count and the paged reads `node list` and `edge list` in `details`.

## Tests

- Tests accept a `Text` value of `mission.textMaxBytes` UTF-8 bytes and refuse one byte more, for every text field and list item, under the default and under a configured bound.

- Tests list every open attempt of a changed content owner in `openAttemptsUnchanged`, and answer a no-op write with the current mission version, empty arrays, no mission version increment and no graph or content change.

- Tests record the child set on the assessment at acceptance, copy it into the outcome context at closure, and keep it unchanged after a later child change or revision.
- Tests accept 40 and 64 lower-case hexadecimal commits, refuse abbreviations, upper-case and ref names, and refuse a binding that the pinned revision does not name in each admission context. For a success override while the attempt reads 0, they check the revision current at the act.
- Tests write `change` on every revision with the write path, the previous revision and the exact changed fields, list task changes on an objective revision, and revise both objectives on a task move.
- Tests return every violation of the failing stage with its code, locators and a malformed file name, stop an apply at the first violation with the envelope and its status, and keep an authorization failure an operation failure.
- Tests accept `type/subtype` at 255 bytes and refuse a parameter, a longer value, a missing subtype and a non-ASCII byte.
- Tests record a signal name with a null exit code, a timed-out item with `timedOut: true`, a started process with neither fact and no result for an unstarted item, and they fail a run whose `results` miss a verification.
- Tests create a second evidence for a repeated submission after a restart, and refuse a `complete` of an expired asset with `mission.evidence.upload_expired`.
- Tests answer `mission.evidence.content_repository` with the address on a human and an execution content read of repository evidence, and refuse an unauthorized read before that answer.

- Tests derive the human, execution and service actors from the verified caller, reject an actor in any input, and keep the copied client identity after deregistration.
- Tests derive the key, binding revision, action, expected end state, a null predecessor and the base branch from the binding row that the pinned revision names, keep them after a strategy change without a rebind, and resolve the pinned binding revision for the credential.
- Tests fold `expected`, `other` and `none` into `External.Success`, `External.Failed` and an unresolved request, set `end_state` once and refuse a second conclusive result, and write one landed-commit evidence for each commit of an `expected` repository result.
- Tests run `node check` on each unresolved request, commit each result alone, answer `failures` for a failed check, and refuse a node with no unresolved request with `mission.node.no_unresolved_request`.

- Tests write `attempt: 0` for an override, a discard and a block while the attempt reads 0.
  They also write `attempt: 0` for the landed-commit evidence of a success override on such a node.
  They keep the attempt at 0.
- Tests return the block outcome from the blocked read while the attempt reads 0.
  They return no request evidence.
- Tests block and unblock a node while its attempt reads 0, then claim attempt 1.
  They assert 404 from `execution cleared-outcome get` and the execution as `opened_by` of attempt 1.
- Tests answer 409 `mission.node.state_conflict` for each precondition mismatch of a human control and of an unblock.
- Tests resolve a child objective with an attempt-0 outcome to the revision current at the act.
- Tests derive each closing event of the outcome record, also after a forced delete of a request evidence.
- Tests store only the landed-commit evidence and the override landed commit in `evidenceIds` of an outcome, and answer the union with the assessment set on the read.
- Tests write a human assessment and its outcome in one transaction for an override, a discard and a block, and keep every human assessment out of the order check.
- Tests admit `node ready` on an initiative whose attempt reads 0 and whose objectives are all terminal.
  They also admit an objective whose attempt reads 0, with or without current tasks.
  They open attempt 1 with the pinned revision.
  They reach `Waiting` with a job in the same transaction.
- Tests refuse a state or attempt mismatch of `node ready` with `mission.node.state_conflict`.

- Tests accept both signed safe-integer limits, negative values and zero as priority on initiatives and objectives.
- Tests read absent priority as 0 and reject fractions, nonnumbers and unsafe integers.
- Tests reject task priority with `mission.node.priority_task` and refuse a live claim or terminal node.
- Tests keep priority outside content, revision and import.
- Tests assert that a second priority act overwrites the value and keeps no earlier value, that `PrioritySet` refuses a `reason` field, and that the answer is `Node`.
- Tests assert that the priority act updates the job in its transaction and keeps the job identity.
- Tests reject human assessments under execution access.
- Tests answer HTTP 400 for a method field, an absent or blank rationale, or a result that violates the order.
- Tests check task, reviewer and external harness attribution and their evaluation fields.
- Tests check one result and one rationale, with no separate criterion result.
- Tests check each result-order branch and allow an empty judgement only for a failed or unrun verification.
- Tests require the rationale to name that verification and reject success with `mission.assessment.verification_failed`.
- Tests refuse a success assessment that names no evidence with a `verification`, or whose `results` miss a verification, with `mission.assessment.verification_failed`, and an assessment that names an evidence with a pending asset with `mission.assessment.evidence_unpublished`.
- Tests prove that execution code runs verifications before judgement.
- Tests permit judgement only after every verification of the current tested input passes.
- Tests turn success into `criterion-not-met` for a default-standard violation only when the worker declares a base prompt.
- Tests require a `scope` on an evidence submission and on a request, refuse an absent or blank value, store the value unchanged and write `landed commit` on each landed-commit evidence.
- Tests accept inline content at 5 MiB decoded and refuse one byte more with 413 `mission.evidence.too_large`.
- Tests require canonical base64, media type and the correct SHA-256, and assert no truncation.
- Tests refuse object uploads of a node without a storage binding and preserve inline evidence and repository addresses.
- Tests exercise the same submit, direct PUT and asset complete flow at every placement, with and without co-location.
- Tests refuse paths outside the workspace, symbolic-link escapes and a path replacement race at open.
- Tests check live-claim admission and task ownership at submit and complete.
- Tests accept 5 GiB, refuse larger objects, and assert server-generated keys and the pinned storage binding revision.
- Tests check the 1 hour PUT lifetime and the checksum header only when SHA-256 exists.
- Tests keep an asset pending until complete verifies size and optional checksum; mismatches publish no asset, and an evidence publishes only when every asset holds `published_at`.
- Tests expire a pending asset after 1 hour and refuse its completion.
- Tests preserve location, returned version, size, media type and optional SHA-256, then return identity and `s3://` URI.
- Tests accept stores without versions, enforce no immutability and make no capability probe on a binding write.
- Tests give authorized readers a presigned GET for the recorded version and refuse unauthorized reads.
- Tests keep URLs outside the handover and agent context, and keep storage credentials inside the server process.
- Tests expose no MCP upload write.
- Tests assert that an asset delete deletes the object and withdraws access without recall of downloaded copies.
- Tests keep every evidence record until a human delete, with or without outcome references, and run no automatic evidence delete.
- Tests run no automatic sweep of unpublished upload objects.
- Tests refuse both deletes on a live node or ancestor with `mission.evidence.remove_node_live`.
- Tests refuse force without a reason with a validation failure and accept force with a reason on a live chain.
- Tests accept an optional reason without force and require human access for both deletes.
- Tests delete the content first and the row after it, delete an object at its recorded version, keep the evidence row after an asset delete, and remove the evidence identity from every `evidenceIds` set after an evidence delete.
- Tests answer 404 `mission.record.not_found` on a read of a deleted asset, with no bytes or presigned GET.
- Tests refuse a request delete without force with `mission.evidence.request_force_required`, refuse the asset delete of a request with `mission.evidence.request_asset_refused`, and hold the node after a forced delete of a request of the open attempt.
- Tests store no remover, reason or time, and preserve the effect of every outcome that named deleted content.

- Tests refuse each unknown front matter key and unknown H2 with `mission.import.plan_invalid` and the file name.
- Tests refuse each absent or repeated H1, Requirement section and Criterion section with the same error and file name.
- Tests check front matter delimiters, permitted node kinds and the required nonblank content.
- Tests accept an absent `id` for a new node and preserve a known identity.
- Tests require a parent for objectives and tasks, forbid it on initiatives, and forbid `dependsOn` on tasks.
- Tests reject unresolved parent and dependency names and references outside the import set.
- Tests refuse a dependency of an objective on its own initiative through dependency add, import and node move with `mission.import.cycle`. A test refuses the crossed case, where an objective of each of two initiatives depends on the other initiative.
- Tests assert that the file name becomes the import-set key and the node's `filename`.
- Tests refuse upper-case names, names without `.md`, and path separators.
- Tests require `filename` on create and return it on node reads.
- Tests assert uniqueness among nodes that are not retired within a mission and accept the same name in separate missions.
- A name conflict answers 409 `mission.node.filename_conflict` without a partial write.
- Tests commit one import that retires a node and creates a node with the same `filename`, and assert both rows with distinct identities.
- Tests assert 409 `mission.node.filename_conflict` when two nodes that are not retired hold one `filename`.
- Tests assert that a name change creates a node revision, or an objective revision for a task.
- Tests assert that each export excludes retired nodes and preserves each plan file name.
- Tests export and import both formats unchanged, with identical node identities, content, edges and revisions.
- Tests include terminal nodes in unchanged export-import cycles and assert a no-op.
- Tests assert human-only access and both exact export answer shapes.
- Tests accept an export at 10 MiB and assert 413 `mission.export.too_large` above that bound.
- Tests import raw Markdown through the Mission Service parser and JSON through the same node validation rules.
- Tests reject an import scope field and list every omitted current node as a retirement.
- Tests accept an empty import set only when every retirement satisfies the import condition.
- Tests reject an inexact retirement confirmation or stale preview digest without an effect.
- Tests assert that the retirement set covers every current descendant.
- Tests assert that `Executing`, `Waiting`, `Evaluating`, `Blocked`, `Paused`, `Completed`, `Discarded`, each `External.*` state, and an attempt of 1 or more answer `mission.node.retire_refused`.
- Tests assert that a retiring task is checked through its objective.
- Tests assert that a nonterminal dependent outside the set answers `mission.node.retire_has_dependents` without `force`.
- Tests assert that `force` removes the dependency and moves each freed dependent between `Pending` and `Available`.
- Tests assert that a terminal dependent keeps its dependency.
- Tests assert that preview changes no state and answers the same refusals.
- Tests assert that a stale mission version and a changed digest refuse the apply with no effect.
- Tests assert that one retirement increments the mission version once.
- Tests assert that an import entry with a retired identifier fails with `mission.import.retired_id` and applies nothing.
- Tests assert `mission.node.retired` for each node API write and each human control on a retired node.
- Tests assert `mission.node.retired` for a create under a retired parent and a dependency add on a retired node.
- Tests assert that a retirement deletes the job of every node of the set in its transaction.
- Tests assert that a loss below `mission.consecutiveLossLimit` returns the node to `Available` or `Waiting` with a job, that the loss that reaches it moves the node to `Paused` with no job and the attempt open, that a release ends the count, and that a resume after the limit grants one more try.
- Tests resume a paused node with `target: Waiting` to `Waiting` with an evaluation job when the readiness condition holds, and refuse it with `mission.node.not_ready` otherwise, with `unsatisfiedIds` when the closure does not hold. They resume with `target: Available` to `Available` or `Pending` by the closure, and they assert that a requested external action takes precedence over the target.
- Tests assert that an unblock opens the next attempt with the human as `opened_by`, and that an unblock while the attempt reads 0 opens none.
- Tests assert that every claimable node holds exactly one job and that no other node holds one, after a release, an accepted observation, a child terminal transition, a child create, a move and a retirement.
- Tests assert that a retired node row stays readable with its identity, `filename`, revisions and last state, and `node list` returns it only with `includeRetired`.
- Tests admit initiative creation at any time.
- Tests cover objective and task creation under each of the twelve parent states.
- Each refused create names `mission.node.create_refused` and the parent state in `details`.
- A race test changes the parent state before commit and asserts that the commit rechecks admission.
- Tests preserve the stricter import condition for import creates.

- Tests apply the node-content rules to imports, node writes and unblock content changes for every node kind.
- Tests omit each required field and assert its error code.
- Tests reject blank and nontext values for each text field with `mission.node.content_invalid`.
- Tests accept duplicate titles and a criterion with several checkable statements.
- Tests reject absent and empty verifications with `mission.node.verifications_missing`.
- Tests reject nonlist verifications and blank or nontext items with `mission.node.content_invalid`.
- A test accepts `true` for a node with no verification need.
- Tests resolve project binding names to the identities of their latest revisions at the write.
- Tests reject absent or nonlist bindings and unknown or foreign-project names with `mission.node.bindings_invalid`.
- Tests cover every cell of the rule table, with each permitted count and a forbidden count.
- Tests reject repeated repository names on an objective because its list requires exactly one entry.
- Tests keep identity, kind, revision, state, attempt, priority and edges outside content.
- Tests answer `dependsOn` on the node read of an initiative and of an objective after a dependency add, a dependency remove, an import and a forced retirement, and omit it on a task read.
- A test keeps task content inside the objective revision.
- Tests accept verification kinds outside the guidance for each node kind.
- A test runs verifications serially in list order through `bash -c` from the execution workspace root.
- A test uses shell syntax to prove that each item is a full bash command.
- A test stops at the first nonzero exit and records no result for a later item.
- Tests assert each recorded command, its exit code and the overall exit code for success and failure.
- A start test refuses a host without bash.
- Tests refuse success with a failed or unrun item under `mission.assessment.verification_failed`.
- Tests refuse the success of an objective whose verification `results` miss a verification of the objective or of a current task under `mission.assessment.verification_failed`.
- A test permits judgement only after every verification passes; zero exits alone never establish success.

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that every revision and version counter starts at 1 and every such field requires a positive safe integer.
- A test asserts that the attempt starts at 0 and the default of `gateway.tokenVersion` stays 1.
- A test asserts one mission version increment for each graph write, even when the write touches several nodes.
- A test asserts no mission version increment for each non-graph write and for a write with no structure or content change.
- A test asserts that each content change creates the next node revision.
- A test checks the `NodeChange` answer of each operation whose answer holds it.
- A test checks the shared error envelope, the 30 s timeout and the 10 MiB body limit on every Mission route.
- A test asserts 409 `mission.revision.conflict` with the current value for a stale expected revision, and 409 `mission.version.conflict` with the current value for a stale expected mission version.
- A test asserts 409 `mission.version.conflict` for a stale expected mission version on every `human` write that changes a node, its edges or its state, and asserts that a human control other than an unblock with a change leaves the mission version unchanged.
- A test asserts that an execution submission commits after a human graph write increments the mission version.
- A test asserts 404 `mission.mission.not_found` for an absent mission, 404 `mission.node.not_found` for an absent node and 404 `mission.record.not_found` for an absent record.
- A test checks `graph get` at 10 MiB and above that bound.
- It asserts 413 `mission.graph.too_large` above the bound, with the node count and both paged reads in `details`.

## Execution CLI validation

The Mission execution CLI validates these arguments and enforces these content boundaries locally. These declarations match the command associations and conditions in `engine/docs/cli/mission.md`.

| HTTP  | Code                                                                    | Condition                                                                      |
| ----- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| local | `cli.mission.assessment.submit.invalid_node_id`                         | The `<node-id>` argument is not a canonical `node_<ulid>` identity.            |
| local | `cli.mission.evidence.asset.content.get.invalid_asset_id`               | The `<asset-id>` argument is not a canonical `evidence_asset_<ulid>` identity. |
| local | `cli.mission.evidence.asset.delete.invalid_asset_id`                    | The `<asset-id>` argument is not a canonical `evidence_asset_<ulid>` identity. |
| local | `cli.mission.evidence.asset.delete.invalid_expected_mission_version`    | The `--expected-mission-version` value is not a positive safe integer.         |
| local | `cli.mission.evidence.delete.invalid_evidence_id`                       | The `<evidence-id>` argument is not a canonical `evidence_<ulid>` identity.    |
| local | `cli.mission.evidence.delete.invalid_expected_mission_version`          | The `--expected-mission-version` value is not a positive safe integer.         |
| local | `cli.mission.evidence.get.invalid_evidence_id`                          | The `<evidence-id>` argument is not a canonical `evidence_<ulid>` identity.    |
| local | `cli.mission.evidence.list.invalid_node_id`                             | The `<node-id>` argument is not a canonical `node_<ulid>` identity.            |
| local | `cli.mission.evidence.list.invalid_attempt`                             | The `--attempt` value is not a nonnegative safe integer.                       |
| local | `cli.mission.evidence.submit.invalid_node_id`                           | The `<node-id>` argument is not a canonical `node_<ulid>` identity.            |
| local | `cli.mission.evidence.submit.object_asset`                              | The file holds an `object` asset; the host helper serves an object.            |
| local | `cli.mission.execution.pinned_revision.get.invalid_execution_id`        | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.revision.list.invalid_execution_id`              | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.revision.get.invalid_execution_id`               | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.revision.get.invalid_revision`                   | The `<revision>` argument is not a positive safe integer.                      |
| local | `cli.mission.execution.evidence.list.invalid_execution_id`              | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.evidence.asset.content.get.invalid_execution_id` | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.evidence.asset.content.get.invalid_asset_id`     | The `<asset-id>` argument is not a canonical `evidence_asset_<ulid>` identity. |
| local | `cli.mission.execution.evidence.asset.content.get.object_content`       | The answer is object content; the reader's component keeps the presigned URL.  |
| local | `cli.mission.execution.objective.list.invalid_execution_id`             | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.objective.outcome.list.invalid_execution_id`     | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.objective.evidence.list.invalid_execution_id`    | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.cleared_outcome.get.invalid_execution_id`        | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.node.check.invalid_node_id`                                | The `<node-id>` argument is not a canonical `node_<ulid>` identity.            |
