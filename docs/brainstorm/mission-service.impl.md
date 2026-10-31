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
- A task uses `task_<ulid>`. No task identity takes the prefix `node_`.
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
- `{ kind: "execution", execution_id, client_id, name }` from the execution record of the claim: `execution_id` follows the identity that the Scheduler Service declares; `client_id` and `name` are the attribution that the claim copied for a registered instance under [scheduler-service.md](scheduler-service.md#claims-and-counts). An external harness assessment identifies its client identity through this form.
- `{ kind: "service", service }` for a service, with `service: "scheduler"` for the loss declaration of the Scheduler Service and `service: "mission"` for the landed-commit evidence of a request.
- No input carries an actor, and an actor field in an input answers HTTP 400 with an issue list.

## The node content

- Every node and every task holds all five required plan content fields and a plan file name.
- The same rules apply to an import, a node write and an unblock content change.
- `intent` is a closed enum in code with the values `implement` and `examine`, and every node holds it.
- `tags` is a list of unique tags under the [tag](project-service.vocabulary.md#tag) form, and an absent list reads `[]`.
- `commit_type` is an optional closed enum in code on the node content: `feat`, `fix`, `docs`, `style`, `refactor`, `test` or `chore`. The service validates it before the write, and the store keeps `null` when it is absent. The worker reads an absent value as `feat` under [Commit attribution](worker-service.impl.md#commit-attribution). A task holds no `commit_type`.
- `name` gives the commit subject of its node or task. A `name` that leaves no subject after the final full stops and spaces are removed answers `mission.node.content_invalid`.
- `tasks` is the list of the tasks of an `implement` node, with zero or more entries on every write path. Each task holds `id`, `filename` and its content. An `examine` node holds an empty list on every write path.
- `name` is nonblank text, a title with no identity or uniqueness requirement.
- `requirement` is nonblank text.
- `criterion` is nonblank text that can hold several checkable statements.
- `verifications` is a nonempty ordered list of nonblank bash command strings.
- `bindings` is a list of binding identities of the project. A read answers the pinned identities, and a node write and an unblock content change take identities. A plan file names each binding by its name.

A node write, and an import that creates a node, resolve each binding identity, or each binding name of a plan file, to the identity of the latest revision of that binding. The write pins that revision and checks the rule table.
An import of an existing nonterminal node keeps a pinned revision with the same name and the same `resource_identity`, unless a removal of that binding follows the pin. An import resolves no binding of a terminal node under [Export and the two formats](#export-and-the-two-formats).
The write accepts the identity of a revision of the current binding of that resource. An identity from before a removal of that binding answers `mission.node.bindings_invalid`, also when a binding of the same resource exists again.
The intent of the node determines the column.
A node names every binding that it uses, and the write takes no binding from the project.
`bindings` keeps the order of the write, and the storage bindings of that order form the upload list of [Object evidence](#object-evidence).
A task names no binding, and a task with a nonempty `bindings` list answers `mission.node.bindings_invalid`.
A new binding kind adds a row.

| Binding kind | `implement` | `examine` |
| ------------ | ----------- | --------- |
| Repository   | 1 or more   | 0 or more |
| Worker       | 0           | 0         |
| Storage      | 0 or more   | 0 or more |

A missing, blank or nontext `name`, `requirement` or `criterion` answers `mission.node.content_invalid`.
An absent or unknown `intent`, a nonlist `tags`, a repeated or malformed tag, a `commit_type` outside its closed set, and a task on an `examine` node answer `mission.node.content_invalid`.
A write that changes `intent` of a node whose attempt reads 1 or more answers 409 `mission.node.intent_locked` with `details: { node_id, attempt }`.
A node write whose node names two repository bindings or more answers 400 `mission.node.environment_mixed` with `details: { bindings }` when a worker binding of the project lists a `container` instance and two of the repository bindings hold different stored `environment` documents, because one `container` instance runs one image. `environmentsMixed(projectId, resourceIdentities)` of the [Project Service](project-service.impl.md#the-gate-collaborations) reads the stored documents of the binding set inside the write transaction, never the records in memory, so the answer does not depend on timing. A binding with no stored environment counts as no environment. Two bindings with one equal document pass. The guard thus misses two bindings whose repository, detected or universal sources differ. Such a node runs the image of the binding that the worker binding names, and the docs of the node content state this limit. The node writes are the node writes of the next paragraph, and the import preview lists the violation for each node file.
A node write that adds an unmatched pair of a node and a claimable state under the [Scheduler Service](scheduler-service.md#match) answers 409 `mission.node.tags_unmatched` with `details: { claims }`. `claims` lists each added pair as `{ node_id, revision, claim }`. The before and after reads compare pairs by `(node_id, claim)` alone, and `revision` is a report field. The node writes are import apply, node create, node update, a rebind, an unblock with a change and a proposal decision.
Each of these writes reads `unmatchedClaims` of the Scheduler Service before and after its change, in its own `BEGIN IMMEDIATE` transaction.
A node write that keeps an existing unmatched pair succeeds.
A node update that names the identity of a task of another node answers `mission.node.content_invalid`.
An absent or empty `verifications` list answers `mission.node.verifications_missing`.
A nonlist `verifications` value or a blank or nontext item answers `mission.node.content_invalid`.
A node with no verification need holds an always-successful command such as `true`.
An absent or nonlist `bindings` value, an unresolved name or a rule-table violation answers `mission.node.bindings_invalid`.
The identity, node revision, state, attempt, priority and edges stay outside the content.
A task's content belongs to the node revision of its node.
Test-kind guidance changes no validation rule.

## Priority

A human sets the priority of a node. A task holds no priority.
The value is any signed safe integer, from -9007199254740991 through 9007199254740991, with no narrower bound.
An absent priority reads 0.
The service answers HTTP 400 with an issue list for a fraction, a nonnumber or an unsafe integer.
The act requires a nonterminal node with no live claim.
A live claim on the node answers 409 `mission.node.claim_live` with `details: { node_id, execution_id }`, and a dependency addition that meets a live claim on the dependent answers the same code.
An import carries no priority.

## The attempt

- `StartPoint` is an enum in code with the values `base_branch` and `node_branch`. The column `mission_attempt.start_point` holds it with no `CHECK` constraint.
- Attempt 1 records `base_branch`, whatever act opens it. An unblock records the value of its optional body field `start_point`, and `node_branch` when the field is absent. The request schema refuses another value with 400 `gateway.request.validation_failed`, and the act writes nothing.
- The `Attempt` read answers `start_point`.
- The claim admission answers `kind`, `project_id`, `attempt` and `node_revision`. It answers no node branch.
- The Scheduler asks for the node branch of an execution through the `MissionBranches` port. `nodeBranchesOf(tx, keys)` answers one branch for each `{ node_id, attempt }` key, in key order.
- The node branch of attempt N is the branch of the latest attempt k <= N that records `base_branch`. `nodeBranchOf(node_id, k)` of the Repository component builds `kanthord/<node id>` for k = 1 and `kanthord/<node id>-a<k>` for a later k.
- The lookup of k is one read of `mission_attempt` for all keys. It selects the attempts that record `base_branch` of the named nodes through the primary key `(node_id, attempt)`. No other index exists for it.
- The column `start_point` is `NOT NULL` with the default `node_branch`, and each insert sets it.

`FrozenAction` is the read shape of a required external action.
The service derives one `FrozenAction` for each configured action of each repository binding row that the pinned revision of the attempt names.

- A `FrozenAction` holds `key`, `binding_id`, `action`, `expected_end_state`, `follows` and `configuration`.
- `action` is `pull_request` or `merge_push` for a repository binding, under the action catalog of [project-service.impl.md](project-service.impl.md).
- `expected_end_state` is `pull_request_merged` for `pull_request` and `base_branch_pushed` for `merge_push`.
- `follows` is the key of the action that this action follows, or null when it follows the passing assessment. It is null while a strategy holds at most one action; the field stays for a later action kind. The Project Service refuses `follows.type = "action_end_state"` in a binding write until a retry-safe claim-source contract exists, because no claim answer carries its claim source. Until then every evaluation claim comes from `Waiting`, a reviewer execution performs the evaluation on every claim, and the continuation claim from `External.Requested` of [worker-service.md](worker-service.md#evaluation-and-required-external-actions) stays unreachable.
- `configuration` holds the operands that the action performer takes from the strategy: `base_branch`. Every other fact of the operation, the address, the platform and the credential, comes from the resolution of the pinned binding revision `binding_id` through the Project Service at the call, under [worker-service.md](worker-service.md#workers-and-templates).
- `binding_id` is the repository binding revision of the action, which the pinned node revision names.
- No action of one binding follows an action of another binding.
- A configured action of another binding kind adds its own `action` value, `expected_end_state` values and `configuration` shape with its design; the service refuses every other value.
- An `examine` node requires no external action, so its set is empty.
- A `FrozenAction` holds the key of the configured action of [project-service.impl.md](project-service.impl.md), and the request evidence of the attempt names that key in `requirement_key`.
- `mission.evidence.request` is the operation of the Worker action performer. It uses `POST /api/mission/node/:node_id/evidence/request` with `client` access under the execution of the live evaluation claim. The invocation chain proves that execution under [architecture.impl.md](architecture.impl.md#the-operation-and-its-two-entry-adapters). It checks the node, the open attempt of the claim, the required external action and its binding.
  Its input holds `execution_id`, `attempt`, `node_revision`, `requirement_key`, `subject` and `address: PlatformAddress`, and it answers `Evidence`. The first three fields must match the proven claim under [Operation contracts](#operation-contracts). The Mission Service writes the address as the one `platform` asset of the request evidence.
  A reuse is a new request evidence of a later attempt whose `platform` asset holds the address of a request evidence of an earlier attempt of the same node and the same action.
  Its dispatch and the recovery of a lost answer stay blocked under the B9 item W2 of [HANDOFF.md](HANDOFF.md#worker-and-project-services).
- A request under a steps claim answers 409 `mission.execution.claim_not_evaluation`, as an assessment does. A `requirement_key` outside the required external actions of the attempt answers 400 `mission.request.requirement_unknown`. An address whose kind does not fit the action, or whose `resource_identity` is not that of the binding of the action, answers 400 `mission.request.address_mismatch` with `details: { requirement_key }`. A `pull_request` request admits a `branch_push` address on the base branch of its binding. The Intake Service answers that address only for a contained snapshot, under the [read-backs](intake-service.impl.md#the-read-backs). That address holds the landed commit, and the check folds it to `pull_request_merged`. A second request for a key of the attempt answers 409 `mission.request.already_requested`.

## Configuration

- The Mission Service owns the section `mission` of the configuration file that [architecture.impl.md](architecture.impl.md#the-sections-of-the-file) rules.
- `mission.consecutive_failure_limit` holds the [consecutive failure limit](mission-service.md#consecutive-failure-limit), as a positive integer in the `nat` format of `convict`, and it defaults to `3`.
- `mission.rework_limit` holds the [rework limit](mission-service.md#rework-limit), as a non-negative integer in the `nat` format of `convict`, and it defaults to `2`. The value `0` turns rework off.
- `mission.further_work_limit` holds the count of consecutive `budget_end` releases of one attempt, as a non-negative integer in the `nat` format of `convict`, and it defaults to `3`. The value `0` turns the limit off.
- `mission.text_max_bytes` holds the upper bound of a `Text` value in UTF-8 bytes, as a positive integer in the `nat` format of `convict`, and it defaults to `32768`.
- The bound applies at a write. A stored value keeps its length after a change of the bound.

## The plan file grammar

- The Mission Service owns the Markdown format and the JSON format of a plan.
- A plan file starts with YAML front matter between `---` delimiters.
- A plan file is a node file or a task file. It holds exactly one of `intent` and `node`.
- The front matter of a node file permits only these keys:
  - `id`: the node identity `node_<ulid>`; absent on a new node.
  - `intent`: `implement` or `examine`; required.
  - `depends_on`: a list of plan file names of node files.
  - `tags`: a list of tags; absent reads `[]`.
  - `commit_type`: one value of the closed set of the node content; absent stays absent.
  - `bindings`: the project binding names under the node content rules, in order. An `implement` node file names one or more repository bindings.
  - `verifications`: the nonempty ordered list of bash commands under the node content rules.
- The front matter of a task file permits only these keys:
  - `id`: the task identity `task_<ulid>`; absent on a new task.
  - `node`: the plan file name of a node file of the import set with `intent: implement`; required.
  - `bindings`: an empty list; another list answers `mission.node.bindings_invalid`.
  - `verifications`: the nonempty ordered list of bash commands under the node content rules.
- A task file refuses `depends_on`, `tags` and `intent`.
- After the front matter, exactly one H1 supplies `name`.
- Exactly one `## Requirement` section supplies `requirement`.
- Exactly one `## Criterion` section supplies `criterion`.
- Each section extends to the next H2 or the end of the file.
- The parser refuses an unknown key, an unknown H2, an absent or repeated section or H1, and an `id` with the prefix of the other file form.
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
- A task change creates a node revision of its node.
- A task holds `filename` in the content of its node. A task plan file name is unique among the node and task plan file names of the current nodes of its mission that are not retired.
- A node write that takes a used node or task plan file name answers 409 `mission.node.filename_conflict`. A proposal decision follows the same rule.
- A taken name answers 409 `mission.node.filename_conflict`.

## The lookup indexes

- `mission_node_mission` is a unique index on `mission_node (mission_id, id)`. The node reads of one mission use it.
- `mission_evidence_node` is a unique index on `mission_evidence (node_id, attempt, id)`. The evidence reads of a node and of an attempt use it.
- `mission_evidence_asset_evidence` is a unique index on `mission_evidence_asset (evidence_id, id)`. The asset reads and the asset delete of an evidence record use it.
- Each lookup index ends with the primary key of its table, so each one is unique.

## Export and the two formats

- `mission.export` uses `GET /api/mission/:mission_id/export?format=markdown|json` with `human` access.
- The JSON answer is `{ mission_id, mission_version, entries: [{ filename, id, intent, node, name, requirement, criterion, verifications, bindings, tags, commit_type, depends_on }] }`. A node entry holds `commit_type` only when the node sets it.
- The Markdown answer is `{ mission_id, mission_version, files: [{ filename, content }] }`.
- Each Markdown `content` follows the plan file grammar.
- JSON entries use the same node content, task and dependency rules as Markdown.
- `node` and `depends_on` name plan files in the import set, not node identities.
- A node entry omits `node`, and a task entry omits `intent`, `tags`, `commit_type` and `depends_on` in both formats.
- Each answer is the exact plan payload that the import of its format accepts.
- The import accepts `format: markdown` with raw `files: { filename, content }[]`, which the Mission Service parses.
- The import accepts `format: json` with `entries`.
- The format, reason and apply controls accompany the unchanged plan payload.
- The payload names `mission_id` and `mission_version`; the latter is the expected mission version for the import.
- An export excludes retired nodes.
- The answer bound is 10 MiB; a larger answer is 413 `mission.export.too_large`.
- An import covers the whole mission and carries no scope.
- Every `node` and `depends_on` resolves inside the import set; no boundary reference exists.
- The preview lists every current node that the import set omits as a retirement.
- The import compares the bindings of a nonterminal node by binding name, so a new binding revision changes no node. The node keeps its pinned binding revision, and [the rebind](#the-rebind) moves it. A name that now names a binding with another `resource_identity` is a change. A pin from before a removal of its binding resolves to the latest revision, so the node changes.
- An import compares no content of a terminal node. A terminal node with an unchanged `filename` is a no-op.
- The import resolves no binding name and no `depends_on` name of a terminal node, and it writes no revision for it. The node keeps its pinned bindings and its dependencies. The import compares a task of a terminal node by its `filename` and its node alone.
- A new `filename` of a terminal node answers 409 `mission.import.terminal_change`. A task that enters, leaves or changes its `filename` in a terminal node answers the same code. An omitted terminal node also answers it. To remove a node that holds an attempt, a human discards it, then keeps its unchanged file in the plan.
- A nonterminal node can name a terminal node in `depends_on`. An import that retires a node keeps the dependency of a terminal dependent on that node.
- The apply confirms that exact retirement set with `confirmed_retirements` and checks `preview_digest` at commit.
- The preview digest covers the mission identity, the mission version, the normalized entries and the sorted `creates`, `updates` and `retirements` sets. A classification change between the preview and the apply, for example after a discard, answers 409 `mission.import.retirement_mismatch`.
- The import result maps each node file name to its node identity and each task file name to its task identity.
- A violation holds `code`, `message`, `filename`, `node_id` and `details`: the error object of the shared envelope plus two locators. `filename` is the submitted file name as a string, so it can name a malformed name; each locator is null when it does not apply.
- The import validates in three stages: the plan files and their content, the resolved graph, then the import condition. A preview reports every violation of the first stage that fails and stops there, because a later stage needs the earlier one; it answers 200 with the list and the digest of the submitted set.
- An apply stops at the first violation and answers the shared envelope with its code and status. An authorization or revision failure is an operation failure on both paths and never a violation.
- The import codes and their apply status are: HTTP 400 for `mission.node.environment_mixed` with `details: { bindings }`, `mission.import.plan_invalid`, `mission.import.mission_mismatch`, `mission.import.unresolved_reference` with `details: { reference, name }`, `mission.import.reference_kind_invalid` with `details: { reference, name }`, `mission.import.duplicate_file`, `mission.import.unknown_id`, `mission.import.duplicate_id`, `mission.import.foreign_id`, `mission.import.retired_id` with `details: { id }`, `mission.import.cycle`, `mission.import.verification_uncovered` with `details: { name, command }`, and the node content codes of [The node content](#the-node-content); HTTP 409 for `mission.import.condition_failed` with `details: { state, attempt }`, `mission.import.terminal_change`, `mission.node.filename_conflict`, `mission.node.tags_unmatched`, `mission.node.state_conflict` and `mission.node.claim_live` for a dependency edit, and, on apply alone, `mission.import.retirement_mismatch`.
- A body `mission_id` that differs from the route is a first-stage violation `mission.import.mission_mismatch`. A `node` name that resolves inside the set to a task file or to a node file with `intent: examine`, and a dependency name that resolves to a task file, are second-stage violations `mission.import.reference_kind_invalid`. A verification of an `implement` node with one or more tasks that equals no verification of a task of that node in the import set is a second-stage violation `mission.import.verification_uncovered`, with the node file as `name` and the verification as `command`.
- A preview reports every unmatched pair that the import adds, and the apply refuses it with `mission.node.tags_unmatched`.
- The preview computes those pairs after the three validation stages pass. It runs the write steps of the apply in a probe transaction and rolls that transaction back.

## Node API admission

- A human retires a node through a whole-mission import that omits its plan file, under the import condition, or through `node retire` under [Node retire](#node-retire).
- Every node API write and every human control on a retired node answers 409 `mission.node.retired` with `details: { node_id }`.
- A node API write that changes a node in a terminal state, or a task whose node holds a terminal state, answers 409 `mission.node.terminal` with `details: { node_id }`.
- A write that names a retired node as a dependency answers 409 `mission.node.retired` with `details: { node_id }` of that node.
- `dependency add` with endpoints in two missions answers 409 `mission.dependency.endpoint_invalid` with `details: { reason, node_id, depends_on_id }`, where `reason` is `cross_mission`.
- `dependency add` and `dependency remove` on a dependent in `Waiting`, `Evaluating`, `External.Requested`, `External.Success` or `External.Failed` answer 409 `mission.node.state_conflict` with the current `state` and `attempt` in `details`.
- `dependency add` on a `Paused` dependent whose open attempt holds a request evidence answers the same code. The rule applies to the node API and to the import.
- A self addition answers 409 `mission.import.cycle` after the endpoint checks. `dependency remove` checks no endpoint pair, and an absent edge is a no-op.
- An import entry with the identifier of a retired node fails with 400 `mission.import.retired_id`.
- An import entry with the identity of a task of a retired node fails with 400 `mission.import.retired_id`. An import entry with the identity of a task that an earlier write removed fails with the same code. The identity of a task that a current node holds stays valid, even when the last revision of a retired node holds it.
- `node create` admits a node at any time.
- The import keeps the import condition.
- A human control whose `expected_state` equals the current state, when that state is outside the states that the control admits, answers 409 `mission.node.control_refused` with `details: { state }`. The CLI page lists the admitted states of each control.
- A human control on a node in a terminal state answers `mission.node.terminal` before it checks `expected_state`, `expected_attempt` or the admitted states. `mission.node.state_conflict` comes next, and `mission.node.control_refused` comes last.

## The verifications

The execution runs the verifications in list order, one by one, never in parallel.
Each item runs through `bash -c` at the agent root of the execution workspace, under the [workspace layout](worker-service.impl.md#workspace).
The run stops at the first failed item.
The verification records one result `{ command, exit_code, signal, timed_out }` per item that the execution started or copied, in list order.
A repeated command on one tested input can copy the first result of that command under [the result copy](worker-service.impl.md#the-result-copy).
`Verification` holds `tested_input` and `results`, and the evidence that records the run holds it in `verification`.
`exit_code` is the exit status or null.
`signal` is the POSIX signal name that ended the process or null.
`timed_out` is true when the deadline of the item ended it; [worker-service.impl.md](worker-service.impl.md#stop-and-budget) fixes that deadline.
Both `exit_code` and `signal` are null for a process that the execution started and could not observe.
An item passes only with `exit_code: 0`; every other result fails, and an item that the execution neither started nor copied has no result.
A run passes when `results` hold one entry per verification and every entry has `exit_code` 0.
No result claims that an unrun item ran. A copied result repeats the result of an earlier run of the same command on the same tested input.
The start refuses a host without bash.
No execution identity infers a verification from prose.

The Mission Service refuses an assessment that asserts success with a failed or unrun verification, and it answers `mission.assessment.verification_failed`.
A success assessment names exactly one evidence whose `verification` covers every required command of the pinned revision, and that run must pass; otherwise the service answers the same code. A named evidence whose `verification` covers only part of the required commands does not count.
For an `implement` node, the `results` of that run hold one entry for each verification of the node and of each current task of the pinned revision; otherwise the service answers the same code.
Judgement decides success only after every verification of the pinned content passes.

## The assessment

An assessment holds one `result` and one required, nonblank `rationale`.
It holds the evidence identities, dependency outcome identities, tested input and node revision.
It holds no `method` field and no separate criterion result.
The actor identifies who judged.
An execution assessment names the execution of its evaluation claim: it stores `execution_id`, and the read derives the `Actor` of the execution form from it.
An external harness assessment identifies the client identity of its harness worker.
A human assessment stores the human `actor`, holds a null `execution_id` and a null `tested_input`, and names no dependency outcome. Its evidence set is optional. The read answers `currency: null` for a human assessment.
A human writes an assessment only through a success override, a discard or a block, and that act writes the assessment and the outcome that names it in one transaction.
Every other rule of this section binds an execution assessment only.
The execution code, never the agent, runs the verifications before the judgement.

The result follows this order:

1. A failed or unrun verification gives `criterion-not-met`, with no judgement.
   The required rationale names that verification.
2. Otherwise, judgement against the criterion gives `success`, `criterion-not-met` or `undetermined`.
3. For a worker that kanthord hosts, a default-standard violation turns `success` into `criterion-not-met`.

Only the first case permits an empty judgement.
The judgement is absent in that case; the rationale is never absent.
The rationale names each default-standard violation. An assessment holds no separate list of findings.
The rationale of an `implement` assessment also names each current task whose criterion is unmet.
The Mission Service answers `mission.assessment.verification_failed` when an assessment asserts success with a failed or unrun verification.
HTTP 400 with an issue list rejects a method field, an absent or blank rationale, and a result that violates this order.
The execution behaviour follows [worker-service.md](worker-service.md#evaluation-and-required-external-actions).

- At acceptance `dependency_outcome_ids` of an `examine` node names the current outcome of each direct dependency, and no other outcome. `dependency_outcome_ids` of an `implement` node is empty. The service refuses every other set with HTTP 400 and an issue list. `evidence_ids` and `dependency_outcome_ids` are duplicate-free sets.
- The read derives `dependency_node_ids` from the nodes of `dependency_outcome_ids`.
- An `undetermined` execution assessment of an `examine` node can hold `proposals`, at most 10. Each proposal holds `dependency_id`, `name`, `requirement`, `criterion` and one `task`, and it names one defect inside a completed dependency. `dependency_id` names a current direct dependency with `intent: implement`. Proposals on an `implement` node or with another result answer HTTP 400 at `proposals`.
- `mission.assessment.submit` takes `cause` with `criterion-not-met` and refuses it with another result. The assessment stores no cause.
- `mission.assessment.submit` takes the optional `gate_files`, a list of `{ binding_id, paths }` with a nonempty `paths`. Each `binding_id` names a repository address of `tested_input`. No `binding_id` repeats, and no path of one entry repeats. Another list answers HTTP 400 with an issue at `gate_files`.
- The service stores the list as canonical JSON in `mission_assessment.gate_files`. A submit without the key and a human assessment store null. The read of an assessment does not show the column.
- The service writes one `mission_proposal` row for each proposal in the transaction that closes the attempt and writes the outcome. A non-current assessment records no proposal.
- `node_revision` of an assessment is the revision that its attempt pins, or the node revision current at the act when a human assessment names attempt 0.
- An assessment that names an evidence with a pending or expired asset answers 409 `mission.assessment.evidence_unpublished`.
- A human delete of an evidence removes its identity from `evidence_ids`, and nothing else changes an assessment.
- The read derives `worker_version` from the worker of the binding row that the execution of the actor pins.
- The service computes the currency of an execution assessment at each read, and it stores no currency.
- Take an execution assessment A of node N and attempt k. `context_matches` is true exactly when all three conditions hold: `node_revision` of A equals the revision that attempt k of N pins; each identity of `evidence_ids` of A names an evidence of N; for an `examine` node, the nodes of `dependency_outcome_ids` of A equal the direct dependencies of N, and each named outcome is the current outcome of its node.
- The current outcome of a node is its outcome with the greatest `sequence`.
- `authority_admits` is true exactly when no human assessment of N and attempt k has a greater `sequence` than A.
- `order_selected` is true exactly when A holds the greatest `sequence` among the execution assessments of N and attempt k that pass the context check and the authority check.
- `current` is true exactly when all three checks admit A. `reasons` holds one named constant text for each failed check.

## The request record

- `requirement_key` of a request evidence holds the key of its `FrozenAction`. The expected end state is `expected_end_state` of that `FrozenAction`: `pull_request_merged` or `base_branch_pushed` for a repository action; a configured action of another binding kind adds its own values with its design.
- `PlatformAddress` holds `kind` and `resource_identity` of the binding, for example `repository:github:kanthorlabs/kanthord`, and never a `binding_id`. A `pull_request` address adds `number`. A `branch_push` address adds `branch` and `commit`, the commit that the Intake Service pushed. The service stores it as RFC 8785 canonical JSON under [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- The Intake check takes the binding and its credential from the pinned `FrozenAction` of the request, and it answers `end_state` and `landed_commits`.
- `end_state` is one of `expected`, `other`, `conflict` and `none`. `expected` establishes the expected end state. `other` establishes another end state. `conflict` and `none` establish no end state.
- The service sets `end_state` of the request evidence to `expected` or `other` once and refuses a later conclusive result for the same request. `none` writes nothing.
- An `expected` result of a repository action holds a nonempty `landed_commits`. The service writes each commit as its own evidence with the provenance `{ kind: "service", service: "mission" }` and the attempt of the request. Delivery admission adds `inbound_event_id`, the identity of the inbound event, to that provenance. Every other result holds an empty list.
- The resolution of a required external action in a read is `unrequested` while the attempt holds no request evidence for it, `unresolved` while its request evidence holds no end state, `expected-end` after `expected` and `other-end` after `other`.
- `end_state` of a pull request check is `other` for an open pull request with a current change request, also when the pull request cannot merge.
- `end_state` of a pull request check is also `conflict` for another open pull request that cannot merge. `conflict` writes no end state. When the node is `External.Requested` in the attempt of the request, `conflict` moves the node to `Available`, and the request stays unresolved for the rework of the same attempt.
- `mission.delivery.admit` is the `service` operation of delivery admission. It writes no record of its own. This contract serves acceptance as an observation. Acceptance as a human act stays under the delivery admission page and the disposition vocabulary, and this contract does not redefine it.
- The input holds `inbound_event_id`, `project_id`, `platform`, `resource`, `event` and `metadata`. The Intake Service fills them from the inbound event and its inbound: `resource` from `configuration`, and `event` as the exact bytes in canonical base64.
- The answer holds `disposition` and `reason`. `disposition` is `accepted_observation`, `refused` or `duplicate`. `reason` is `ambiguous`, `unmatched` or `undecodable` for `refused`, and null otherwise.
- Admission decodes the event first. A decoding with no address answers `undecodable`. Then a read transaction matches the canonical JSON of the address against the `platform` asset of each request evidence of the project. One unresolved match of an open attempt goes to the Intake check. More unresolved matches answer `ambiguous`. No unresolved match answers `duplicate` when a resolved request matches, and `unmatched` otherwise.
- A `branch_push` address selects each unresolved `pull_request` request of the same resource whose frozen `base_branch` equals the pushed branch. The selection runs with an exact match and without one. Each selected request goes to the Intake check, and the commit applies each result. A `none` result writes nothing, and a node with a live claim keeps its request unchanged. A non-empty selection with no exact match answers `accepted_observation`. Automatic detection needs a poll or webhook inbound for the repository.
- The handler calls the Intake check before its commit, because a transaction awaits nothing. A failed check propagates as an operation failure and writes nothing.
- Every answer that carries a disposition returns through the one final `caller.commit`. A `none` result answers `accepted_observation` with a null `reason`. A refusal or a duplicate found at the match of a `branch_push` address still runs the selection, and a non-empty selection answers `accepted_observation`. A duplicate found at the commit still applies the selected results. An ambiguous exact match at the commit applies none. A live claim on the exact request fails the admission with 409 `mission.node.claim_live` and writes no selected result. The event stays `failed` and a human can retry it.
- For an `expected` or `other` result, the commit first reads the checked request evidence. An end state on it answers `duplicate`. Otherwise the commit repeats the match with the same priority and the same refusal and duplicate answers. Another evidence that became the one unresolved match answers 409 `mission.delivery.match_changed`. A live claim on the node answers 409 `mission.node.claim_live` with `details: { node_id, execution_id }`.
- With an exact match, the commit applies the exact request first and then each selected result in the same transaction. The answer is the answer of the exact request. A refusal of the exact request applies no selected result.
- Otherwise the commit sets the end state. An `expected` result of a repository action writes each landed commit as its own evidence with `inbound_event_id` in its provenance, and every other result adds no landed-commit evidence. The same transaction writes the node transition and the attempt closure that the [state transitions](mission-service.md#state-transitions) require, and the commit answers `accepted_observation`.
- The span of the operation holds the disposition and the refusal reason.
- `mission.delivery.unresolved_request.count` is a `service` operation that only the Intake Service calls. Its input holds `project_id` and `resource_identity`. It answers `{ count }`, the count of request evidences of the open attempts of the project that hold no end state and whose `PlatformAddress` names that `resource_identity`. The count covers every address kind. It writes nothing. The service-name check of `mission.delivery.admit` refuses every other caller with 403 `mission.authorization.refused`.
- `mission.node.check` uses `POST /api/mission/node/:node_id/check` with `human` access and names `expected_mission_version`. It calls the Intake check for each request evidence of the open attempt with no end state, commits each result in its own transaction and answers `{ results: { evidence_id, requirement_key, resolution }[], failures: { evidence_id, error }[] }`. A result that establishes an end state on a node with a live claim writes nothing, and its request answers `failures` with `mission.node.claim_live`. A node with no unresolved request answers 409 `mission.node.no_unresolved_request`.
- This record decides no order of contradictory results, no reversal of an accepted platform state and no request for which no end state arrives. The B9 Mission items of [HANDOFF.md](HANDOFF.md#mission-service-1) own the open recovery rules.

## The fix-node proposal

- `mission.proposal.list` uses `GET /api/mission/node/:node_id/proposal` with `human` access, and it answers a page of proposals with an optional `attempt` filter.
- A proposal record holds `approved_at` and `rejected_at`. A proposal is `open` while both are null, `approved` after the approval and `rejected` after the rejection. A decided proposal never changes again.
- RULED 2026-10-29 by Ulrich: a human takes one decision for each assessment. `mission.proposal.decide` uses `POST /api/mission/assessment/:assessment_id/decide` with `human` access. Its body holds `expected_mission_version`, `approved_proposal_ids` and an optional nonblank `reason`.
- `approved_proposal_ids` is a duplicate-free list of 1 to 10 proposal identities. Another list answers 400 `gateway.request.validation_failed` with an issue at `approved_proposal_ids`.
- An unknown assessment answers 404 `mission.record.not_found`.
- An identity that names no proposal of the assessment answers 400 `mission.proposal.assessment_mismatch` with `details: { proposal_ids }`.
- In one transaction, the decision creates one `implement` node for each approved proposal, in the order of `approved_proposal_ids`. Each node holds the one task of its proposal and copies `bindings` and `tags` from the node of `dependency_id`.
- The same transaction adds the dependency of the proposer `examine` node on each new node and reads the unmatched pairs of the Scheduler Service.
- It sets `created_node_id` and `approved_at` of each approved proposal and `rejected_at` of every other open proposal of the assessment.
- It then unblocks the proposer once into a new attempt with the default start point `node_branch`.
- The decision answers `{ created: NodeChange[]; rejected_proposal_ids: string[]; proposer: ControlResult }`. `created` holds one `NodeChange` for each approved proposal, in the order of `approved_proposal_ids`.
- The proposer routes to `Pending` and stays unclaimable until every new node reaches `Completed`, under the dependency rule.
- An assessment with no open proposal answers 409 `mission.proposal.decided` with `details: { assessment_id }`. A repeated decision answers this code.
- A proposer that is not `Blocked` in the attempt of the assessment answers 409 `mission.node.state_conflict`. A new unmatched pair answers 409 `mission.node.tags_unmatched`. A refused decision writes nothing.
- A node unblock, a node discard or a node override of a `Blocked` proposer sets `rejected_at` of every open proposal of the assessment that blocked the proposer, in the same transaction. That is the rejection of every proposal.

## The release admission

- The Mission Service routes a release inside the release transaction of the Scheduler Service, and it checks the release predicate before the terminal write. The node state fixes the kind of the release: `Executing` for a steps release and `Evaluating` for a reviewer release.
- A steps release with `further_work: false` requires a published evidence of the open attempt whose provenance is the releasing execution. For an `implement` node, that evidence holds exactly one `repository` asset for each repository binding of the pinned revision, and no other. For an `examine` node, it holds one `produced` asset.
- A steps release with `further_work: true` carries the checkpoint and push obligation of [worker-service.impl.md](worker-service.impl.md#stop-and-budget), and the service checks no record for it.
- A further-work release whose execution reached its resource budget and passed no new task carries the stop `{ reason: "budget_end", code }`, where `code` is `turns` or `wall_time`. A `budget_end` stop is no failure and does not count toward the consecutive failure limit. A `provider_failed` stop with the code `rate_limited`, `quota_exhausted` or `unavailable` is neutral: it neither counts nor ends the count. When the count of consecutive `budget_end` releases of the attempt reaches `mission.further_work_limit`, the release moves the node to `Paused` for a human.
- A release with a `stop`, from a steps execution or a reviewer execution, checks no record. It routes under the [consecutive failure limit](mission-service.md#consecutive-failure-limit).
- A reviewer release requires a current passing assessment of the attempt and no required external action of the attempt that is eligible and unrequested. An action is eligible under [worker-service.md](worker-service.md#evaluation-and-required-external-actions): it is unrequested in the attempt, and it follows no action or its predecessor reached its expected end state.
- A release that fails the predicate answers 409 `mission.release.obligation_unmet` with `details: { obligation }`, where `obligation` is `evidence`, `assessment` or `request`. The refusal writes no execution row, no node state and no job, and the execution stays `running`.
- The predicate is the same for every harness. The execution code of a worker that kanthord hosts satisfies it before the release, and an external harness meets it through the same check.
- A reviewer release that moves the node to `External.Requested` calls `foldExternalState` on the node in the same transaction. If one required external action holds end state `other`, `foldExternalState` sets `External.Failed`. `closeExternalAttempt` then moves the node to `Blocked`, even when sibling actions are unresolved. If every required external action holds end state `expected`, `foldExternalState` sets `External.Success` and `closeExternalAttempt` moves the node to `Completed`. Otherwise the node stays in `External.Requested`.
- After a reviewer release to `External.Requested`, the service calls `scheduleDeferredCheck`. That function schedules `runDeferredCheck` through `setImmediate`. The deferred check reads the node and its unresolved `pull_request` and `branch_push` evidence in one transaction, then calls `intakeCheck.check` for each. It applies the result with `applyEndState` when no live claim exists. A failed check logs a warning and changes no state.
- At quiescence, the Mission Service starts no new deferred check round and clears the retry timers. A round in flight checks no further request and requests no merge. The drain joins every round in flight. The check and merge calls use the shutdown context of the service, so quiescence does not cancel them. A node that stays in `External.Requested` resumes at the next start.
- Tests release a steps claim on an `implement` node with no evidence, with a produced-only evidence and with an unpublished repository evidence, and assert 409 `mission.release.obligation_unmet` with `obligation: evidence` and no change to the execution, the node and the queue. Tests release a reviewer claim with no assessment and with an eligible unrequested action, and assert `obligation: assessment` and `obligation: request`. A test asserts that a release with `further_work: true` checks no record. A test releases a reviewer claim with a `stop` and no assessment and asserts `Evaluating -> Waiting`.
- Tests in `transitions.test.ts` assert that a reviewer release folds all expected end states to `Completed` and folds an other end state to `Blocked`. They also assert that the deferred check applies `expected`, `other`, `conflict` and `none` correctly for `pull_request` evidence. They assert that it resolves a `branch_push` request, and that a failed deferred check leaves the node unchanged.
- `e2e-delivery-admission.test.ts` E08.11 asserts that a merge admitted after release completes the node through the fold. E08.12 asserts that a pull request merged before release completes the node through the deferred check.

## Evidence content

Inline evidence holds at most 5 MiB of decoded content.
`ContentBytes` holds `media_type`, `encoding: "base64"` and canonical base64 `data`.
The produced content address holds the required SHA-256 of those decoded bytes.
The server verifies the hash before it accepts the content.
Larger inline content answers 413 `mission.evidence.too_large`.
The service never truncates evidence.
A node without a storage binding accepts only inline evidence content.
Repository evidence remains an address, not an upload of repository content.

- An evidence asset holds `kind` and `content`. `content` is the RFC 8785 canonical JSON of the shape that `kind` names: `RepositoryAddress` for `repository`, the produced shape `{ media_type, sha256, data }` for `produced`, `ObjectAddress` for `object` and `PlatformAddress` for `platform`.
- The produced shape holds canonical base64 `data` of at most 5 MiB decoded, and a content read answers `ContentBytes` from it. The service derives `ProducedAddress` and `ObjectAddress` from `content`.
- `mission.evidence.submit` takes the full asset list and writes the evidence row and every asset row in one transaction. No asset joins an evidence later.
- The scope of an evidence is its node and its attempt. The service derives it from `node_id` and `attempt` of the evidence row, and an evidence read answers it as `node_id` and `attempt`. No input carries a scope, and a `scope` field in an input answers HTTP 400 with an issue list.
- A `repository`, `produced` or `platform` asset sets `published_at` at the insert. An `object` asset sets `expired_at` one hour after the submission.
- An asset is published when `published_at` is set, pending while `expired_at` lies after now, and expired otherwise. An evidence is published when every asset of it holds `published_at`.
- `requirement_key` holds only the key of a `FrozenAction`; every other evidence holds no requirement key.
- The [affected test run](worker-service.impl.md#the-affected-test-run) submits a separate evidence with the subject `Affected test results`: one `produced` asset of `application/json`, no `verification` field and no requirement key. Its identity joins `evidence_ids` of the assessment. It covers no verification, so the coverage rule of [the verifications](#the-verifications) does not change.
- An evidence has no natural key. A repeat after a server restart or after the replay window of the Gateway creates a new evidence, and the service accepts that duplicate.

- A repository address holds `binding_id` and `commit`.
- `commit` is the full git object name in lower-case hexadecimal: 40 characters for a SHA-1 repository or 64 characters for a SHA-256 repository, the two object formats of git. An abbreviation, upper-case or a ref name answers HTTP 400 with an issue list.
- The service checks the form alone and never the repository.
- `binding_id` names a repository binding revision of the project in every context.
- An execution evidence of an `implement` node that holds a `repository` asset holds exactly one for each repository binding of the pinned revision, and no other. The check runs at the submit and at the release.
- A landed commit names the repository binding of its request. When a success override supplies a landed commit while the attempt reads 0, it names a repository binding of the node revision current at the act, under [The outcome record](#the-outcome-record).
- A tested input of a node with two or more repository bindings is a list with one address for each repository binding of the pinned revision, in binding order. A node with one repository binding has one address.
- The landed commit of a success override follows the same form and binding rule.
- A repository address whose `binding_id` is not the binding that its context requires, or a landed commit on an `examine` node, answers 400 `mission.evidence.binding_mismatch` with `details: { binding_id }`.
- `media_type` is an RFC 6838 `type/subtype` with no parameter, in ASCII, at most 255 bytes: the two name limits of 127 characters and the separator. A parameter, a missing subtype, a non-ASCII byte or a longer value answers HTTP 400 with an issue list. The service stores the value unchanged and never interprets it.
- A content read of a repository asset answers 409 `mission.evidence.content_repository` with `evidence_id` and the repository address in `details`, after the authorization and the execution bound checks of the read. The failure carries no bytes and no presigned URL. The human and the execution content reads share that mapping.
- A content read of a `platform` asset answers 409 `mission.evidence.content_platform` with `evidence_id` and the address in `details`, after the same checks, and it fetches no external content.

## Object evidence

Object evidence uses one presigned-transfer strategy for every placement and every co-location.
The host-local helper serves `evidence upload <path>` inside the execution workspace.
The host component is the server, the `worker` application or the harness extension.
It opens the path safely and refuses any path or symbolic-link escape from that workspace.
The file path is local input, not an evidence address.

1. The component calls `mission.evidence.submit` with execution context, the evidence metadata and the asset list. An `object` asset declares `media_type`, `size` and an optional `sha256`.
   This operation requires execution access and a live claim for the node.
   The server checks the live claim, the storage bindings of the pinned revision and the 5 GiB single-object limit.
   A node without a storage binding refuses the upload with 409 `mission.evidence.storage_binding_absent`.
   The server selects the binding, and the component never selects one. The grant takes the first storage binding of the pinned revision, in list order, whose latest revision holds `available: true` and that no tombstone removed, that the signing call accepts, and that holds no failed upload check in the open attempt of the node.
   The third step states the failed upload checks: they are the assets of that node and attempt whose `failed_at` is set.
   The grant moves to the next binding when the signing call answers `binding_disabled`, `binding_removed` or a `storage.platform.s3.*` failure. Every other refusal of the signing call stops the upload.
   A node whose storage bindings all fail that rule refuses the upload with 409 `mission.evidence.storage_exhausted`. `details` holds `{ node_id, attempt, bindings }`, and `bindings` lists the storage bindings that hold a failed upload check in the open attempt, in list order.
   503 `mission.evidence.storage_unavailable` answers only when no object storage is wired.
   It creates the evidence and one pending asset for each `object` asset, with a server-generated key: `<prefix>/<project>/<mission>/<node>/<attempt>/<evidence asset id>`.
   The asset pins that storage binding revision in `storage_binding_id` of its `ObjectAddress`.
   The Intake Service signs a presigned PUT for that key with a lifetime of 1 hour through `intake.storage.put`, with the material that custody releases.
   The grant requires a checksum header only when the component supplies a SHA-256.
2. The component sends the bytes directly to the store with that PUT.
   No transfer through the server proxies those bytes.
3. The component calls `mission.evidence.asset.complete` under execution access with the asset identity and execution context.
   The server checks the live claim, and the Intake Service checks the object size and, when given, the checksum through `intake.storage.check`.
   A check that finds a mismatch, finds no object or fails at the store prevents publication, and it records that binding as failed for the open attempt of the node.
   The record is `failed_at` of the asset, which the server sets once in its own transaction. No table of the Mission Service holds a failure apart from the asset.
   The failed bindings of an attempt are the `storage_binding_id` values of the assets of that node and attempt that hold `failed_at`.
   A human delete of the failed asset, or of its evidence, removes that mark, and its binding is grantable again.
   The server then writes one Mission span through the Tracking Service. The operation is `mission.evidence.asset.complete`, the producer is `mission`, the status is `Error`, and the parent is the root span of the execution.
   The attributes are `kanthord.evidence_asset.id`, `kanthord.storage_binding.id` and `error.type`, which holds the code of the check.
   The Tracking Service adds `kanthord.execution.id`, `kanthord.node.id`, `kanthord.project.id` and `kanthord.attempt`, as [the server spans](tracking-service.impl.md#server-spans) state.
   An unknown execution writes no span.
   A refused or failed span write drops the span and leaves `failed_at` in place. No service reads the span to decide.
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

- `mission.evidence.asset.delete` uses `DELETE /api/mission/evidence/asset/:asset_id` with `human` access. It deletes one asset and keeps the evidence row, even with zero assets.
- `mission.evidence.delete` uses `DELETE /api/mission/evidence/:evidence_id` with `human` access. It deletes every asset of the evidence, then the evidence row. It removes the evidence identity from every `evidence_ids` set of an assessment and of an outcome.
- Both inputs hold `expected_mission_version`, `force: boolean` and an optional `reason: Text`; the CLI defaults `force` to `false`.
- `Text` is nonblank text; its bounds remain open in [HANDOFF](HANDOFF.md#mission-service).
- With `force: false`, the node of the evidence and every direct `examine` dependent of that node must hold a terminal state.
- A nonterminal node of that set refuses the delete with 409 `mission.evidence.remove_node_live`.
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
- An outcome stores no revision and no attempt. The read derives `node_revision` and `attempt` from the assessment that the outcome names.
- The dependency read of an `examine` execution resolves a direct dependency to the `node_revision` of its current outcome.
- An execution submission always names an attempt of 1 or more, because a claim exists only under an open attempt.
- An omitted `attempt` filter selects every authorized record of the node.
  `--attempt <n>` selects the records of attempt n.
  `--attempt 0` selects the records that the service writes while the attempt reads 0.
- Every transition into `Blocked` writes an outcome, so the blocked read always returns one.
  For a node blocked while its attempt reads 0, the read returns that outcome with no request evidence.
- An outcome stores no closing event. The read derives `closing_event` in this order:
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
- `execution cleared-assessment get` answers the assessment that the outcome of the cleared attempt names, the cause that [The unblock](mission-service.md#the-unblock) requires the next execution to read. It answers 404 `mission.record.not_found` when no unblock opened the claimed attempt.
- `execution rework-assessment get` answers the execution assessment with the greatest `sequence` among the assessments of the claimed attempt whose result is `criterion-not-met`. It answers 404 `mission.record.not_found` when the claimed attempt holds no such assessment.
  After a block and an unblock while the attempt reads 0, the first claim opens attempt 1.
  The execution of that claim is the opener of that attempt.
- A discard or a success override that meets a requested external action of the open attempt with no end state answers 409 `mission.node.action_unresolved` with `details: { requirement_keys }`, because a node reaches a terminal state only when no external action of its open attempt is unresolved.
- A human control checks `expected_state` and `expected_attempt` against the current state and attempt.
  A mismatch answers 409 `mission.node.state_conflict`, with the current `state` and `attempt` in `details`.
  An `Unblock` whose `blocked_attempt` differs from the current attempt answers the same code.
- The service records the acceptance order of the outcomes of one node, from 1 with no gap.
  The current outcome of a node in an attempt is its outcome of that attempt that the service accepted last.
  The current outcome of a node is its outcome that the service accepted last.
  Neither `created_at` nor the outcome identity decides that order.
- Every outcome names an assessment in `assessment_id`. The kind of the basis is the kind of the actor of that assessment.
- The context of the basis is the assessment that it names: its node revision, the evidence that it names, the dependency set of the dependency outcomes that it names and those dependency outcomes.
- The assessment changes only when a human delete removes an evidence identity from it, and the closure copies nothing, so a dependency change after the acceptance never enters the context.
- An outcome changes only when a human delete removes an evidence identity from its `evidence_ids`.
- `evidence_ids` of an outcome holds the evidence that its assessment does not hold: the landed-commit evidence of the attempt and the landed commit of a success override. The read answers the union of that set and `evidence_ids` of the assessment.
- The required external actions derive from the pinned revision of the attempt, so the outcome repeats none.

## The node read

- A node read holds `depends_on`: the node identities that the dependency edges of the node name, as a duplicate-free list in ascending order.
- `depends_on` of a node read holds node identities. `depends_on` of a plan file holds plan file names.
- A node read and `node list` answer `intent` and `tags` at the revision that the open attempt pins, else at the current revision. `node list` filters by `intent`.
- A node read answers `tasks: TaskContent[]` of that revision. The `Tasks (<count>)` section of the node card reads it.
- No operation reads the [dependency closure](mission-service.md#mission-structure-and-nodes) of one node.
  The closure of a node is `depends_on` of its node read. The state of each member comes from its own node read.

## Node ready

- `mission.node.ready` uses `POST /api/mission/node/:node_id/ready` with `human` access.
- `node ready` requires `expected_state: Available` and an `expected_attempt` equal to the attempt of the node.
  A mismatch answers 409 `mission.node.state_conflict`.
- When the attempt reads 0, the readiness condition reads no attempt-scoped record.
- A node that is not ready answers 409 `mission.node.not_ready`. A resume with `target: Waiting` answers the same code under [Node resume](#node-resume).
  Its `details` hold `unsatisfied_ids: NodeId[]`.
  `unsatisfied_ids` names the dependencies of the closure that are not `Completed`.
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

- `mission.node.resume` uses `POST /api/mission/node/:node_id/resume` with `human` access.
- Its input is `Resume`: every field of `HumanAct`, plus the required `target`, which is `Available` or `Waiting`.
- `node resume` requires `expected_state: Paused` and an `expected_attempt` equal to the attempt of the node.
  A mismatch answers 409 `mission.node.state_conflict`.
- The external action records of the attempt take precedence over the target, under [the state transitions](mission-service.md#state-transitions).
  A resume that they route to `External.Failed`, `External.Success` or `External.Requested` does not read the target.
- `target: Waiting` requires the readiness condition.
  A node that is not ready answers 409 `mission.node.not_ready` with the `details` of [Node ready](#node-ready).
  The refusal changes no state and writes no job.
- `target: Available` moves the node to `Available` when the dependency closure holds, and to `Pending` when it does not hold.
- A resume with `target: Waiting` opens the attempt when the node holds none, as the ready act does. Every other resume opens no attempt. A resume resets no loss count.
- The answer is `ControlResult` with the node in the selected state and the open attempt.

## Node override

- `mission.node.override` uses `POST /api/mission/node/:node_id/override` with `human` access.
- The request `Override` holds every field of `HumanAct`, a required `result` and an optional `landed_commit`.
- The closed set of `result` is `success`. A failure override waits for the B9 items of the Mission Service.
- `landed_commit` is admitted only with `result: success`.
- The server writes the actor, the time, the human assessment and the outcome record.

## The forced archive revocation

- The Mission Service offers `revokeForInstanceArchive(tx, executionId)` to the Worker Service through its `contract.ts`. `worker.instance.archive` with `force: true` calls it inside its transaction for the live execution of the instance, under [worker-service.impl.md](worker-service.impl.md#the-instance-record).
- The method reads the node of the execution. A steps claim moves the node `Executing -> Available`, and an evaluation claim moves it `Evaluating -> Waiting`.
- The attempt stays open. The transition writes no outcome, no assessment and no stop.
- The method calls the revocation of the Scheduler in the same transaction with the revoke cause `human`. The revocation sets `ended_at`, counts no loss and no failure, and sets no hold.
- The revocation neither counts nor ends the consecutive failure count of the node.
- The transaction inserts the job when the node is claimable, with no `available_at`.
- An execution that is no longer live answers null with no change, so a release that commits first wins.
- The method records the revoked claim in an `ExecutionEnds` through `endLiveClaim`, as every human act that revokes a live execution does. It answers that `ExecutionEnds` to the Worker transaction.
- After the commit, the Worker Service hands that `ExecutionEnds` to the Mission collaboration `reportExecutionEnds(ends)`. The method runs `reportEnds`, so the Scheduler reports `executionRevoked` after the commit on the path of every other revocation.
- The archive is a Worker act, so the Mission Service writes no act trace for it. The execution trace records `revoked` with the cause `human.intervention`.

## The act trace

Each human act on a node writes one [act trace](tracking-service.vocabulary.md#act-trace) after its commit, through `serverTraceSpan` of [the server spans](tracking-service.impl.md#server-spans) with the producer `mission`. The trace names the project, the node and the attempt of the node after the act. A node with no attempt gives the trace a null attempt.

- The acts are `mission.node.pause`, `mission.node.resume`, `mission.node.ready`, `mission.node.block`, `mission.node.unblock`, `mission.node.discard`, `mission.node.override`, `mission.proposal.decide` and `mission.evidence.delete`. The operation of the root span is the operation identity of the act.
- The act trace of `mission.evidence.delete` names the node of the evidence and holds `kanthord.evidence.id`. Its two node states are equal when the delete changes no state. It is the Tracking span of the delete that [evidence retention](#evidence-retention) names.
- The root span starts and ends at the time of the act, with the status `Ok`.
- It holds `kanthord.project.id`, `kanthord.node.id`, `kanthord.attempt`, `kanthord.node.state.from`, `kanthord.node.state.to` and `kanthord.mission.version` of the act. A null attempt omits `kanthord.attempt`. `mission.proposal.decide` names the proposer, and `kanthord.node.state.from` is `Blocked`.
- The reason of the act is the telemetry text `reason` of the root span, with the text identity `<root_span_id>:reason`. An act with no reason holds no text.
- An act that revokes a live execution links its root span to the root span of that execution.
- An override to `Completed` writes `kanthord.node.lead_time_ms` on its act trace: the time from the first `Available` of the node to the override.
- That act hands the revoke cause `human` to the [revocation](scheduler-service.impl.md#the-execution-trace).
- `mission.assessment.submit` hands the revoke cause `assessment` and the states of its transition to the revocation of the reviewer execution. A `criterion-not-met` submit also hands its rework `cause` to the revocation.
- At the rework limit, it also hands the rework count and `mission.rework_limit`.
- A current `criterion-not-met` submit with a cause of the category `plan` hands the transition rule `plan_defect` with no count and no limit. The Mission Service stores no cause. The cause reaches the Tracking Service only.
- A refused act writes no act trace. A lost act trace changes no state, and no service reads it.

## The import trace

Each import apply writes one trace through `serverTraceSpan` of [the server spans](tracking-service.impl.md#server-spans) with the producer `mission`. The trace names the project and no node, and it holds a null attempt.

- The operation of the root span is `mission.import`. The root span starts and ends at the time of the apply.
- The root span holds `kanthord.project.id`, `kanthord.mission.id`, `kanthord.mission.version.from`, `kanthord.mission.version.to`, `kanthord.import.creates`, `kanthord.import.updates`, `kanthord.import.retirements`, `kanthord.import.removed_edges` and `kanthord.human.username`, the account of the actor.
- The four `kanthord.import.*` counts are the counts of the `creates`, `updates`, `retirements` and `removed_edges` sets of the plan check.
- An applied import has the status `Ok`. `kanthord.mission.version.to` is the mission version after the commit.
- A refused apply has the status `Error`. `error.type` holds the error code. `kanthord.import.violation_codes` holds the distinct violation codes, sorted, at most 128. `kanthord.mission.version.to` equals `kanthord.mission.version.from`.
- A refused apply is an apply that answers an error code after the plan check, for example a violation code or `mission.import.retirement_mismatch`. Any other failure writes no trace.
- The reason of the apply is the telemetry text `reason` of the root span.
- A preview writes no trace. An apply that fails before the plan check, for example with a stale mission version, writes no trace.
- A failed trace write never fails the import. A lost import trace changes no state, and no service reads it.

## The rebind

- `mission.node.rebind` is a `unary` mutation under the `human` access policy. Its input holds the binding revision identity, a reason, the expected mission version and an optional node identity. Without a node identity the act covers every node of the mission.
- The target revision belongs to the same binding as the revision that the node pins, and it is no tombstone and no disabled revision.
- An absent target revision, or a target revision of another project, answers 404 `mission.binding.not_found`. A tombstone answers 409 `mission.binding.removed`, and a disabled revision answers 409 `mission.binding.disabled`.
- The target is a later revision of the same binding. A named node that pins neither an earlier revision of that binding nor the target answers 409 `mission.binding.mismatch` with `details: { node_id, binding_id }`. A pin from before a removal of that binding is not an earlier revision of it. A mission rebind leaves a node with such a pin unchanged and does not list it in `skipped`. A node that already pins the target is a no-op, and an act with no rebound node leaves the mission version unchanged.
- A named retired node answers 409 `mission.node.retired`, and a named terminal node answers 409 `mission.node.terminal`.
- The act inserts a node revision for each rebound node, and increments `mission_mission.version` once.
- The answer is the `NodeChange` of the act and `skipped`, a list of `{ node, condition }` where `condition` is `terminal` or `retired`, for a mission rebind.
- A rebind revision holds `change.write: node.rebind`, `changed_fields: ["bindings"]`, the unchanged task snapshot of an `implement` node and `change.tasks: []`.
- Tests rebind a node that is not terminal and not retired, keep the pinned node revision of an open attempt, report the skipped terminal and retired nodes of a mission rebind, and refuse a revision of another binding, a pin from before a removal, a tombstone and a disabled revision.

- The Mission Service offers `liveNodesPinning(tx, bindingId)` to the Project Service through its `contract.ts`. It answers every node that is not terminal and not retired when its current revision or the node revision of its open attempt pins the binding revision. A rebind keeps the node revision of an open attempt, so the node keeps the old pin until that attempt ends.
- The Mission Service offers `currentNodePins(tx, projectId, bindingIds)` to the Project Service through its `contract.ts`. It answers `{ node_id, binding_id }` for each node of the project that is not terminal and not retired, when its current revision pins one of the binding revisions. The node revision of an open attempt does not count. The Project Service lists [stale pins](project-service.impl.md#stale-pins) from it.
- The Mission Service offers `claimFacts(tx, nodeId)` and `claimFactsOf(tx, projectId)` to the Scheduler Service through its `contract.ts`. `claimFacts` answers `intent` and `tags` at the revision that the open attempt pins, else at the current revision. `claimFactsOf` answers each node that is not terminal and not retired, at its current revision and at the revision that its open attempt pins. Neither writes a record.

## Node retire

- `mission.node.retire.preview` uses `GET /api/mission/node/:node_id/retire/preview?force=true|false` with `human` access. It changes no state and stores no receipt. `force` defaults to false.
- `mission.node.retire` uses `POST /api/mission/node/:node_id/retire` with `human` access.
- The retirement set is the named node. Its tasks leave the work of the mission with it.
- A checked node that fails `Pending` or `Available` with attempt 0 answers 409 `mission.node.retire_refused` with `details: { node_id, state, attempt }` of the first failed node.
- A dependency on a node of the set from a nonterminal dependent outside the set answers 409 `mission.node.retire_has_dependents` with `details: { dependents: NodeId[] }` when `force` is false.
- With `force: true`, the retirement removes each such dependency and moves each freed dependent between `Pending` and `Available` in the same transaction. A dependency from a terminal dependent stays.
- A forced retirement that removes a dependency of a dependent in `Waiting`, `Evaluating` or an `External.*` state, or of a `Paused` dependent whose open attempt holds a request evidence, answers 409 `mission.node.state_conflict` with `details: { node_id, state, attempt }` of that dependent.
- Preview and apply answer the same refusals.
- The preview answers `RetirePreview`: `node_id`, `force`, `mission_version`, `retired_node_ids`, `removed_edges`, `preview_digest`. The digest is the SHA-256 of the canonical JSON of the other five fields, under [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- The apply request `Retire` holds `expected_mission_version`, `force`, `preview_digest` and `reason`. A stale mission version answers 409 `mission.version.conflict`. A digest that differs from the digest that the service computes at commit answers 409 `mission.node.retire_mismatch`.
- One transaction rechecks every condition, sets `retired_at` on every node of the set and removes current inbound references except terminal dependents' historical dependencies.
- That transaction deletes the job of every node of the retirement set through the Scheduler Service public delete.
- It increments the mission version once.
- The answer is `NodeChange`.
- A retirement deletes no row. A retired node keeps its identity, `filename`, its revisions and its last state.

## The revisions

- Every revision and version counter of the server starts at 1.
- Every `version`, `revision`, `expected*Version` and `expected*Revision` field holds a positive safe integer.
- A count is no revision. The attempt starts at 0.
- `gateway.auth.version` keeps its default of 1.
- A mission starts at mission version 1, and a node starts at node revision 1.
- A node takes its next node revision on every content change.
- These writes increment the mission version when they change the structure of the mission or the content of a node:
  - import apply
  - node create
  - node update
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
- Every `human` write that changes a node, its edges or its state names `expected_mission_version`: import apply, node create, node update, node retire, node rebind, dependency add, dependency remove, criterion set, unblock with or without a change, priority, pause, resume, block, ready, override, discard, node check, evidence asset delete and evidence delete.
- A human control checks the mission version and leaves it unchanged, except an unblock that carries a change.
- A `client` write of an execution names no mission version, because it works under the pin of its attempt.
- Every node revision holds `change`.
- `change.write` is the write path: `import`, `node.create`, `node.update`, `node.rebind`, `criterion.set` or `unblock`.
- An import that moves a task between two nodes that it does not retire changes the content of both nodes. Each node takes a node revision with `write: import`.
- An import writes no node revision on a node that it retires. The last revision of that node holds its tasks.
- When a task moves out of a node that the import retires, the new node takes a node revision with a `moved-in` task change. The import writes no `moved-out` on the retired node.
- `change.previous_revision` is the previous revision, or null on revision 1.
- `change.changed_fields` lists the content fields whose value differs from the previous revision: `filename`, `name`, `requirement`, `criterion`, `verifications`, `bindings`, `intent`, `tags`, `commit_type` and `tasks`.
- `change.tasks` lists `{ id, change, changed_fields }` for each task whose content changed, with `change` one of `created`, `updated`, `moved-in`, `moved-out` and `retired`. `moved-out` and `retired` carry an empty `changed_fields`. A `retired` task change removes the task from the content of its node. An import that omits a task of a node that it does not retire writes it. A node update that drops the task also writes it.
- The result of the change is the `content` of the same record.

## The graph write answer

- An operation whose answer holds `NodeChange` computes it at the commit. The mission keeps no history of changes.
- `NodeChange` holds the new mission version, the node revisions created, the retired node identities, and the edges added and removed.
- It also holds `open_attempts_unchanged`, one `{ node_id, attempt }` for each content owner of the change that holds an open attempt at the commit, so the answer states that the revision reaches the next attempt and not the open one.
- A write with no structure or content change answers the current mission version with empty arrays.
- A node revision keeps its own actor, reason and time, including the node revision that a task removal inserts. No record keeps the actor, the reason or the time of a dependency edit, or the actor and the reason of a retirement. `retired_at` keeps the time of every retirement.

## The mission screen of the dashboard

- The Mission tab always offers Import, because an import updates the nodes that it names and creates the others.
- A successful apply closes the import sheet. A toast confirms the import with the new mission version and the count of new nodes.
- An `implement` node card ends with a `Tasks (<count>)` section. Each task is a row that opens the node sheet of its node. A card without a task shows no section.
- The Mission tab offers `Export JSON` and `Export Markdown`. `Export Markdown` downloads one zip archive `<project name>-mission-v<mission version>.zip` that holds each plan file under its `filename`.
- The node sheet of an `examine` node shows the section `Fix proposals`. Each proposal shows the badge `open`, `approved` or `rejected`. An approved proposal links to its fix node.
- While the proposer is `Blocked` in the attempt of an assessment with open proposals, the section `Fix proposals` and the Overview decision item of the proposer each offer one `Decide` action. No proposal row holds its own approve action.
- `Decide` opens one dialog. The dialog lists each open proposal of the assessment with a checkbox and holds the optional reason. It states "Checked proposals become fix nodes. Unchecked proposals become rejected. A decision cannot be undone."
- The confirm stays disabled until the human checks one proposal or more. Its reason reads "Check one proposal or more. To reject every proposal, use Unblock or Discard." The confirm sends `mission.proposal.decide`.

## Authorization integration

- The Mission Service supplies the authorization function of the [protected facility](custody.impl.md#the-protected-facility) for a `FrozenAction`, a request evidence, an evidence asset and the presigned PUT of a new asset. The Mission Service authorizes the presigned PUT inside `mission.evidence.submit`, before the asset row exists: it checks the live claim and the storage binding of the pinned revision, refuses an asset identity that an asset row holds, and derives the object key from the claim and the asset identity that the submission allocates.
- For an execution identity, it follows the live claim through the Scheduler Service to the node, the open attempt and the `FrozenAction` or the evidence. It resolves the pinned binding revision through the Project Service.
- For `github.pull_request_merge`, the authorization checks the request evidence of `merge_evidence_id`. That evidence belongs to the same attempt, names the same action key as the `FrozenAction`, holds a `pull_request` address kind, and has no end state. The action is a `pull_request` with `landing: kanthord`. The `merge_address` field of the action facts carries that address.
- `gateFilesOf` reads the paths of one binding from `gate_files` of the current assessment of the attempt. Each entry of `actions` of `ActionContext` and the `ActionFacts` hold these paths in `gate_files`.
- A merge of a `pull_request` action, or a `merge_push` action, answers `gate_file_changed` when its binding holds a changed gate file in the current assessment.
- For a human identity, it follows the evidence asset to its storage binding revision.
- It takes no association from the caller.
- A broken chain answers 403 `mission.authorization.refused` with `details: { reason }`, where `reason` is `claim_not_live`, `node_mismatch`, `attempt_closed`, `binding_disabled`, `binding_removed`, `service_mismatch` or `gate_file_changed`.
- A `service` operation of the Mission Service authorizes its caller by name. `mission.delivery.admit` admits only the Intake Service, and the authorization of a request evidence for `intake.action.check` admits only the Mission Service. Another service identity answers `service_mismatch`.
- The authorization of an evidence asset maps the caller to a reason. A `check` or an `execution_get` from a human or a service identity, or from a client with no live claim, answers `claim_not_live`.
- A `get` or a `delete` admits only a human. A service identity answers `service_mismatch`, and a client identity answers `node_mismatch`.
- The presigned PUT answers `node_mismatch` for an asset identity that an asset row holds.
- A `check` admits only a pending asset of the claim attempt. A published asset answers `node_mismatch`.
- A repeat of `mission.evidence.asset.complete` for a published asset answers the recorded result and calls no check.
- A second call whose check runs after the first call commits answers 403 `node_mismatch`. The asset keeps the version of the first call.
- A repeat with the same idempotency key replays the recorded answer.

## Operation contracts

- Every Mission route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging) of the Gateway Service.
- Every Mission route uses the [default 30 s timeout](gateway-service.impl.md#cancellation).
- Every Mission route uses the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits).
- `Text` is a nonblank JSON string of at most `mission.text_max_bytes` UTF-8 bytes. A larger value answers HTTP 400 with an issue list. The rule applies to every text field of a node and to every item of `verifications`.
- A stale expected revision answers 409 `mission.revision.conflict` with the current value in `details`. A stale expected mission version answers 409 `mission.version.conflict` with the current value in `details`.
- An absent mission answers 404 `mission.mission.not_found`. An absent node answers 404 `mission.node.not_found`. An absent record answers 404 `mission.record.not_found`.
- An execution submission whose route node, `execution_id`, `attempt` or `node_revision` differs from the proven claim answers 409 `mission.execution.context_mismatch` with `details: { field }`. An assessment or a request under a steps claim answers 409 `mission.execution.claim_not_evaluation`. An execution-scoped revision read above the pinned revision answers 404 `mission.execution.revision_above_pin`.
- `graph get` answers at most 10 MiB. A larger graph answers 413 `mission.graph.too_large`.
- That error holds the node count and the paged reads `node list` and `edge list` in `details`.

## Tests

- Tests accept a `Text` value of `mission.text_max_bytes` UTF-8 bytes and refuse one byte more, for every text field and list item, under the default and under a configured bound.

- Tests call `revokeForInstanceArchive` for a live steps claim and a live evaluation claim. They assert `Executing -> Available` and `Evaluating -> Waiting`, an open attempt, an unchanged consecutive failure count, a job with no `available_at`, and no change for an execution that ended first. A test hands the answered `ExecutionEnds` to `reportExecutionEnds` and asserts the execution trace `revoked` with the revoke cause `human` and no act trace.

- Tests list every open attempt of a changed content owner in `open_attempts_unchanged`, and answer a no-op write with the current mission version, empty arrays, no mission version increment and no graph or content change.

- Tests record the dependency set on the assessment at acceptance, copy it into the outcome context at closure, and keep it unchanged after a later dependency change or revision.
- Tests accept 40 and 64 lower-case hexadecimal commits, refuse abbreviations, upper-case and ref names, and refuse a binding that the pinned revision does not name in each admission context. For a success override while the attempt reads 0, they check the revision current at the act.
- Tests write `implement` on every revision with the write path, the previous revision and the exact changed fields, list task changes on an `implement` node revision, and revise both nodes on a task move.
- Tests retire an `implement` node through an import and keep its tasks in its last revision. Tests move a task out of a node that an import retires. They assert `moved-in` on the new node and no new revision of the retired node.
- Tests return every violation of the failing stage with its code, locators and a malformed file name, stop an apply at the first violation with the envelope and its status, and keep an authorization failure an operation failure.
- Tests accept `type/subtype` at 255 bytes and refuse a parameter, a longer value, a missing subtype and a non-ASCII byte.
- Tests record a signal name with a null exit code, a timed-out item with `timed_out: true`, a started process with neither fact and no result for an unstarted item, and they fail a run whose `results` miss a verification.
- Tests create a second evidence for a repeated submission after a restart, and refuse a `complete` of an expired asset with `mission.evidence.upload_expired`.
- Tests answer `mission.evidence.content_repository` with the address on a human and an execution content read of repository evidence, and refuse an unauthorized read before that answer.

- Tests derive the human, execution and service actors from the verified caller, reject an actor in any input, and keep the copied client identity after deregistration.
- Tests derive the key, binding revision, action, expected end state, a null predecessor and the base branch from the binding row that the pinned revision names, keep them after a strategy change without a rebind, and resolve the pinned binding revision for the credential.
- Tests fold `expected`, `other` and `none` into `External.Success`, `External.Failed` and an unresolved request, set `end_state` once and refuse a second conclusive result, and write one landed-commit evidence for each commit of an `expected` repository result.
- Tests run `node check` on each unresolved request, commit each result alone, answer `failures` for a failed check, and refuse a node with no unresolved request with `mission.node.no_unresolved_request`. Under a live claim, a `none` result answers `unresolved`, and a conclusive result answers `failures` with `mission.node.claim_live` and writes nothing.

- Tests write `attempt: 0` for an override, a discard and a block while the attempt reads 0.
  They also write `attempt: 0` for the landed-commit evidence of a success override on such a node.
  They keep the attempt at 0.
- Tests return the block outcome from the blocked read while the attempt reads 0.
  They return no request evidence.
- Tests block and unblock a node while its attempt reads 0, then claim attempt 1.
  They assert 404 from `execution cleared-outcome get` and the execution as `opened_by` of attempt 1.
- Tests answer 409 `mission.node.state_conflict` for each precondition mismatch of a human control and of an unblock.
- Tests resolve a direct dependency with an attempt-0 outcome to the revision current at the act.
- Tests derive each closing event of the outcome record, also after a forced delete of a request evidence.
- Tests store only the landed-commit evidence and the override landed commit in `evidence_ids` of an outcome, and answer the union with the assessment set on the read.
- Tests write a human assessment and its outcome in one transaction for an override, a discard and a block, and keep every human assessment out of the order check.
- Tests admit `node ready` on an `examine` node whose attempt reads 0 and whose direct dependencies are all `Completed`.
  They also admit an `implement` node whose attempt reads 0, with or without current tasks.
  They open attempt 1 with the pinned revision.
  They reach `Waiting` with a job in the same transaction.
- Tests refuse a state or attempt mismatch of `node ready` with `mission.node.state_conflict`.

- Tests accept both signed safe-integer limits, negative values and zero as priority on a node.
- Tests read absent priority as 0 and reject fractions, nonnumbers and unsafe integers.
- Tests refuse a priority act on a node with a live claim and on a terminal node.
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
- Tests turn success into `criterion-not-met` for a default-standard violation only when kanthord hosts the worker.
- Tests check that the scope of each evidence read equals the node and the attempt of its record, and refuse a `scope` field in an evidence submission and in a request with HTTP 400 and an issue list.
- Tests accept inline content at 5 MiB decoded and refuse one byte more with 413 `mission.evidence.too_large`.
- Tests require canonical base64, media type and the correct SHA-256, and assert no truncation.
- Tests refuse object uploads of a node without a storage binding and preserve inline evidence and repository addresses.
- Tests exercise the same submit, direct PUT and asset complete flow at every placement, with and without co-location.
- Tests refuse paths outside the workspace, symbolic-link escapes and a path replacement race at open.
- Tests check live-claim admission at submit and complete.
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
- Tests refuse both deletes on a live node or a live direct `examine` dependent with `mission.evidence.remove_node_live`.
- Tests refuse force without a reason with a validation failure and accept force with a reason on a live chain.
- Tests accept an optional reason without force and require human access for both deletes.
- Tests delete the content first and the row after it, delete an object at its recorded version, keep the evidence row after an asset delete, and remove the evidence identity from every `evidence_ids` set after an evidence delete.
- Tests answer 404 `mission.record.not_found` on a read of a deleted asset, with no bytes or presigned GET.
- Tests refuse a request delete without force with `mission.evidence.request_force_required`, refuse the asset delete of a request with `mission.evidence.request_asset_refused`, and hold the node after a forced delete of a request of the open attempt.
- Tests store no remover, reason or time, and preserve the effect of every outcome that named deleted content.

- Tests refuse each unknown front matter key and unknown H2 with `mission.import.plan_invalid` and the file name.
- Tests refuse each absent or repeated H1, Requirement section and Criterion section with the same error and file name.
- Tests check front matter delimiters, the permitted `intent` values and the required nonblank content.
- Tests accept an absent `id` for a new node or task and preserve a known identity.
- Tests require exactly one of `intent` and `node` in each file, and refuse `depends_on`, `tags` and `intent` in a task file.
- Tests refuse a `node` key that names a task file or an `examine` node with `mission.import.reference_kind_invalid`.
- Tests reject unresolved `node` and dependency names and references outside the import set.
- Tests refuse a self-dependency and a dependency cycle of two or more nodes through dependency add and import with `mission.import.cycle`.
- Tests refuse a change of `intent` on a node whose attempt reads 1 or more with `mission.node.intent_locked`.
- Tests refuse a node write that adds an unmatched pair with `mission.node.tags_unmatched`, and accept a write that keeps an existing unmatched pair.
- Tests refuse a node write and a proposal decision that take a used node or task plan file name with `mission.node.filename_conflict`, and export and import both formats with every task file name unchanged.
- Tests decide two of three open proposals of one assessment and assert two created nodes with their dependencies, one rejected proposal and one unblock of the proposer. They assert that a repeated decision answers `mission.proposal.decided`, that a stale proposer answers `mission.node.state_conflict`, that an unknown assessment answers `mission.record.not_found`, and that each refusal writes nothing.
- Tests run a node unblock, a node discard and a node override of a `Blocked` proposer with two open proposals, and assert `rejected_at` on both proposals after each act.
- Tests refuse a node update that names a task of another node with `mission.node.content_invalid`, refuse a nonempty task `bindings` list with `mission.node.bindings_invalid`, and refuse the identity of a removed task with `mission.import.retired_id`.
- Tests refuse a task identity of a retired node with `mission.import.retired_id`. They accept a task that moved out of that node in the import that retired it.
- Tests refuse a dependency add and a dependency remove on a dependent in `Waiting`, `Evaluating` and each `External.*` state with `mission.node.state_conflict`.
- Tests refuse a dependency add through the node API and through the import on a `Paused` dependent whose open attempt holds a request evidence with `mission.node.state_conflict`, and accept it on a `Paused` dependent with no request evidence.
- Tests refuse a forced retirement that removes a dependency of a dependent in `Waiting`, `Evaluating`, each `External.*` state or that `Paused` case with `mission.node.state_conflict`, and write nothing.
- Tests assert that the file name becomes the import-set key and the node's `filename`.
- Tests refuse upper-case names, names without `.md`, and path separators.
- Tests require `filename` on create and return it on node reads.
- Tests assert uniqueness among nodes that are not retired within a mission and accept the same name in separate missions.
- A name conflict answers 409 `mission.node.filename_conflict` without a partial write.
- Tests commit one import that retires a node and creates a node with the same `filename`, and assert both rows with distinct identities.
- Tests assert 409 `mission.node.filename_conflict` when two nodes that are not retired hold one `filename`.
- Tests assert that a name change creates a node revision, also for a task of the node.
- Tests assert that each export excludes retired nodes and preserves each plan file name.
- Tests export and import both formats unchanged, with identical node identities, content, edges and revisions.
- Tests include terminal nodes in unchanged export-import cycles and assert a no-op.
- Tests re-import the export of a mission with a `Completed` node and one new plan file. The binding of that node has a new revision, a new name or a removal. They assert a no-op for that node, keep its pinned binding revision and create the new node. They assert a change for a nonterminal node with a pin from before a removal of its binding.
- Tests import an edited plan file and an edited task file of a `Completed` node. They assert a no-op and no new revision.
- Tests refuse a new `filename`, a task change and a retirement of a `Completed` node with `mission.import.terminal_change`.
- Tests assert human-only access and both exact export answer shapes.
- Tests accept an export at 10 MiB and assert 413 `mission.export.too_large` above that bound.
- Tests import raw Markdown through the Mission Service parser and JSON through the same node validation rules.
- Tests reject an import scope field and list every omitted current node as a retirement.
- Tests accept an empty import set only when every retirement satisfies the import condition.
- Tests reject an inexact retirement confirmation or stale preview digest without an effect.
- Tests assert that a node API retirement set holds the named node alone.
- Tests assert that `Executing`, `Waiting`, `Evaluating`, `Blocked`, `Paused`, `Completed`, `Discarded`, each `External.*` state, and an attempt of 1 or more answer `mission.node.retire_refused`.
- Tests assert that an import that removes a task reads the import condition of its node.
- Tests assert that a nonterminal dependent outside the set answers `mission.node.retire_has_dependents` without `force`.
- Tests assert that `force` removes the dependency and moves each freed dependent between `Pending` and `Available`.
- Tests assert that a terminal dependent keeps its dependency.
- Tests assert that preview changes no state and answers the same refusals.
- Tests assert that a stale mission version and a changed digest refuse the apply with no effect.
- Tests preview an edit of a `Pending` node, discard the node, and refuse the apply with `mission.import.retirement_mismatch`.
- Tests assert that one retirement increments the mission version once.
- Tests assert that an import entry with a retired identifier fails with `mission.import.retired_id` and applies nothing.
- Tests refuse an `implement` node verification that no task of the node holds with the exact text with `mission.import.verification_uncovered`, and the apply writes nothing. Tests accept an `implement` node with no task on every write path.
- Tests refuse an `implement` node with no repository binding with `mission.node.bindings_invalid`, accept an `examine` node with zero, one and two repository bindings, and take no binding from the project.
- Tests refuse an `implement` evidence that misses a repository binding or names another binding with `mission.evidence.binding_mismatch`, at the submit and at the release, and accept one asset for each of two bindings.
- Tests write a tested input list in binding order for a node with two repository bindings.
- Tests skip a disabled storage binding, a removed storage binding, a binding that the signing call refuses and a binding with a failed upload check in the open attempt. Tests try every binding again in the next attempt.
- Tests record a failed upload check for a mismatch, for a missing object and for a store failure.
- Tests answer 409 `mission.evidence.storage_exhausted` when no binding is left in the attempt.
- Tests assert that a failed check sets `failed_at` once and writes one Mission span with the three attributes.
- Tests assert that a human delete of the failed asset, or of its evidence, makes the binding grantable again.
- Tests keep 503 `mission.evidence.storage_unavailable` when no object storage is wired.
- Tests read and delete each asset through the binding that it pins.
- Tests admit a `branch_push` address on the base branch of the binding on a `pull_request` request. They fold it to `pull_request_merged` with that landed commit.
- Tests answer the import preview with the unmatched pairs of the probe transaction, and leave no write after the preview.
- Tests answer `tasks` on the node read at the pinned revision, else at the current revision.
- Tests assert `mission.node.retired` for each node API write and each human control on a retired node.
- Tests assert `mission.node.retired` for a dependency add on a retired node.
- Tests assert that a retirement deletes the job of every node of the set in its transaction.
- Tests assert that a loss or a release with a `stop` below `mission.consecutive_failure_limit` returns the node to `Available` or `Waiting` with a job, that the loss or the stop that reaches it moves the node to `Paused` with no job, no outcome and the attempt open, that lost and stopped executions count together, that a release with no stop ends the count, that an advancing `provider_failed` stop neither counts nor ends the count, and that a resume after the limit grants one more try.
- Tests resume a paused node with `target: Waiting` to `Waiting` with an evaluation job when the readiness condition holds, opening attempt 1 when the attempt reads 0, and refuse it with `mission.node.not_ready` otherwise, with `unsatisfied_ids` when the closure does not hold. They resume with `target: Available` to `Available` or `Pending` by the closure, and they assert that a requested external action takes precedence over the target.
- Tests assert that an unblock opens the next attempt with the human as `opened_by`, and that an unblock while the attempt reads 0 opens none.
- Tests assert that an unblock with `start_point: base_branch` opens an attempt that records it, that an unblock without the field records `node_branch`, and that another value answers 400 and writes nothing.
- Tests assert that attempt 1 records `base_branch` when a claim, a ready act or a resume to `Waiting` opens it, and that a proposal decision records `node_branch`.
- Tests assert that `nodeBranchesOf` answers `kanthord/<node id>` before the first restart, and `kanthord/<node id>-a<k>` for restart attempt k and for each later attempt that continues it. A steps claim and an evaluation claim of one attempt answer the same value.
- Tests assert that `attempt get` and `attempt list` answer `start_point`.
- Tests assert that, after a restart, an event for the pull request of the earlier node branch answers `duplicate` or `unmatched` and changes no state.
- Tests assert that a current `criterion-not-met` execution assessment below `mission.rework_limit` moves the node to `Available` with a job, ends the claim, keeps the attempt open and writes no outcome. They assert `Blocked` with an outcome at the limit, at once for `undetermined` and below the limit when the attempt holds a request evidence. They assert `Blocked` with an outcome and the transition rule `plan_defect` for a `plan` cause. They assert it below the limit, at the limit and with a request evidence. A stale assessment with a `plan` cause changes no state and writes no outcome. They assert that the next attempt counts from zero, and that `execution rework-assessment get` answers the latest `criterion-not-met` assessment of the claimed attempt or 404.
- Tests assert that every claimable node holds exactly one job and that no other node holds one, after a release, an accepted observation, a dependency terminal transition, a dependency edit and a retirement.
- Tests assert that a retired node row stays readable with its identity, `filename`, revisions and last state, and `node list` returns it only with `include_retired`.
- Tests admit node creation at any time.
- Tests preserve the stricter import condition for import creates.

- Tests apply the node-content rules to imports, node writes and unblock content changes for each intent and for a task.
- Tests omit each required field and assert its error code.
- Tests reject blank and nontext values for each text field with `mission.node.content_invalid`.
- Tests accept duplicate titles and a criterion with several checkable statements.
- Tests reject absent and empty verifications with `mission.node.verifications_missing`.
- Tests reject nonlist verifications and blank or nontext items with `mission.node.content_invalid`.
- A test accepts `true` for a node with no verification need.
- Tests resolve project binding identities, and the binding names of a plan file, to the identities of their latest revisions at a node write and at an import that creates a node.
- Tests reject absent or nonlist bindings and unknown or foreign-project identities and names with `mission.node.bindings_invalid`.
- Tests cover every cell of the rule table, with each permitted count and a forbidden count.
- Tests reject a repeated binding name in the `bindings` of one node.
- Tests keep identity, revision, state, attempt, priority and edges outside content.
- Tests answer `depends_on` on the node read after a dependency add, a dependency remove, an import and a forced retirement.
- A test keeps task content inside the node revision, and a test mints each task identity as `task_<ulid>`.
- Tests accept verification kinds outside the guidance for each intent.
- A test runs verifications serially in list order through `bash -c` from the agent root of the execution workspace.
- A test uses shell syntax to prove that each item is a full bash command.
- A test stops at the first nonzero exit and records no result for a later item.
- Tests assert each recorded command, its exit code and the overall exit code for success and failure.
- A start test refuses a host without bash.
- Tests refuse success with a failed or unrun item under `mission.assessment.verification_failed`.
- Tests refuse the success of an `implement` node whose verification `results` miss a verification of the node or of a current task under `mission.assessment.verification_failed`.
- A test permits judgement only after every verification passes; zero exits alone never establish success.

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that every revision and version counter starts at 1 and every such field requires a positive safe integer.
- A test asserts that the attempt starts at 0 and the default of `gateway.auth.version` stays 1.
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
- A test covers a node with a `merge_push` request that the deferred check resolves, alongside two `pull_request` sibling requests. A merged pull request from a later admission resolves one sibling. The sibling in conflict returns its node to `Available`.

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
| local | `cli.mission.execution.dependency.list.invalid_execution_id`            | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.dependency.outcome.list.invalid_execution_id`    | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.dependency.evidence.list.invalid_execution_id`   | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.execution.cleared_outcome.get.invalid_execution_id`        | The `<execution-id>` argument is not a canonical `execution_<ulid>` identity.  |
| local | `cli.mission.node.check.invalid_node_id`                                | The `<node-id>` argument is not a canonical `node_<ulid>` identity.            |
