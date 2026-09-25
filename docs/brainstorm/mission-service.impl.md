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
- An evaluation uses `evaluation_<ulid>`.
- An assessment uses `assessment_<ulid>`.
- An outcome uses `outcome_<ulid>`.
- An external object uses `external_object_<ulid>`.
- An observation uses `observation_<ulid>`.
- [architecture.impl.md](architecture.impl.md#the-identity-and-the-time) declares `mission_<ulid>` and `request_<ulid>`.
- A mission change uses its mission revision as its key within the mission.
- An attempt uses its attempt number as its key within the node. Neither an attempt nor a mission change takes a prefix.
- The Scheduler Service declares the execution identity.

## The node content

- Every node holds all five required plan content fields and a plan file name.
- The same rules apply to an import, a node write and an unblock content change.
- `name` is nonblank text, a title with no identity or uniqueness requirement.
- `requirement` is nonblank text.
- `criterion` is nonblank text that can hold several checkable statements.
- `verifications` is a nonempty ordered list of nonblank bash command strings.
- `bindings` is a list of binding names of the project.

The write resolves each binding name to its identity and checks the rule table.
The node kind determines the column.
A new binding kind adds a row.

| Binding kind | Initiative | Objective | Task |
| --- | --- | --- | --- |
| Repository | 0 | Exactly 1 | 0 |
| Worker | 0 | 0 | 0 |
| Provider account | 0 | 0 | 0 |
| Source | 0 | 0 | 0 |

A missing, blank or nontext `name`, `requirement` or `criterion` answers `mission.node.content_invalid`.
An absent or empty `verifications` list answers `mission.node.verifications_missing`.
A nonlist `verifications` value or a blank or nontext item answers `mission.node.content_invalid`.
A node with no verification need holds an always-successful command such as `true`.
An absent or nonlist `bindings` value, an unresolved name or a rule-table violation answers `mission.node.bindings_invalid`.
The identity, kind, node revision, state, attempt counter, priority and edges stay outside the content.
A task's content belongs to the node revision of its objective.
Test-kind guidance changes no validation rule.

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

- The node row holds `file` with a unique index on `(mission_id, file)`.
- The form is a lower-case name that ends in `.md` with no path separator.
- An import sets `file` from the file name, and `node create` requires it.
- Node reads return `file`, and every export writes it unchanged.
- A node update that changes `file` changes content and creates a node revision.
- A task change creates a node revision of its objective.
- A taken name answers 409 `mission.node.file_conflict`.

## Export and the two formats

- `mission.export` uses `GET /api/mission/:missionId/export?format=markdown|json` with `human` access.
- The JSON answer is `{ missionId, missionRevision, entries: [{ file, id, kind, name, requirement, criterion, verifications, bindings, parent, dependsOn }] }`.
- The Markdown answer is `{ missionId, missionRevision, files: [{ file, content }] }`.
- Each Markdown `content` follows the plan file grammar.
- JSON entries use the same node content and parent and dependency rules as Markdown.
- `parent` and `dependsOn` name plan files in the import set, not node identities.
- An initiative omits `parent`, and a task omits `dependsOn` in both formats.
- Each answer is the exact plan payload that the import of its format accepts.
- The import accepts `format: markdown` with raw `files: { file, content }[]`, which the Mission Service parses.
- The import accepts `format: json` with `entries`.
- The format, reason and apply controls accompany the unchanged plan payload.
- The payload names `missionId` and `missionRevision`; the latter is the expected mission revision for the import.
- An export excludes retired nodes.
- The answer bound is 10 MiB; a larger answer is 413 `mission.export.too_large`.
- An import covers the whole mission and carries no scope.
- Every `parent` and `dependsOn` resolves inside the import set; no boundary reference exists.
- The preview lists every current node that the import set omits as a retirement.
- The apply confirms that exact retirement set with `confirmedRetirements` and checks `previewDigest` at commit.
- The apply also carries `requestId` for request recovery.

## Node API admission

- The node API serves no `node retire` operation.
- A human retires a node through a whole-mission import that omits its plan file, under the import condition.
- `node create` admits an initiative at any time.
- It admits an objective or task under a parent in `Pending`, `Available`, `Executing`, `Blocked` or `Paused`.
- Every other parent state answers `mission.node.create_refused` with the parent state in `details`.
- The refused states are `Waiting`, `Evaluating`, `External.Requested`, `External.Success`, `External.Failed`, `Completed` and `Discarded`.
- The commit rechecks the rule.
- The import keeps the import condition.

## Request records

- The table is `mission_request(mission_id, request_id, kind, payload_digest, result, created_at)`.
- Its primary key is `(mission_id, request_id)`.
- `kind` is `import` or `unblock`.
- The act writes its request row in its own transaction.
- A repeat with the same identifier and digest returns the stored result before the service checks revision or attempt preconditions.
- Another digest answers 409 `mission.request.payload_mismatch`.
- The Mission Service keeps every accepted import request and unblock request for the life of the mission.
- No sweep deletes a row.
- The import result holds the map from file name to node identity.

## The verifications

The execution runs the verifications in list order, one by one, never in parallel.
Each item runs through `bash -c` in the workspace root of the execution.
The run stops at the first nonzero exit.
The machine check records one result `{ command, exitCode }` per item that ran, in list order.
The overall exit code is that of the failed item, or 0 when every item passes.
No result claims that an unrun item ran.
The start refuses a host without bash.
No execution identity infers a verification from prose.

The Mission Service refuses an assessment that asserts success with a failed or unrun verification.
It answers `mission.assessment.verification_failed` for both a task assessment and a reviewer assessment.
Judgement decides success only after every verification of the pinned content passes.

## The revisions

- Every revision and version counter of the server starts at 1.
- Every `version`, `revision` and `expected*Revision` field holds a positive safe integer.
- A count is no revision. The attempt counter starts at 0.
- `gateway.tokenGeneration` keeps its default of 1.
- A mission starts at mission revision 1, and a node starts at node revision 1.
- A node takes its next node revision on every content change.
- These writes increment the mission revision when they change the structure of the mission or the content of a node:
  - import apply
  - node create
  - node update
  - node move
  - dependency add
  - dependency remove
  - criterion set
  - an unblock that carries a change
- These writes leave the mission revision unchanged:
  - priority
  - pause
  - resume
  - block
  - discard
  - mark-ready
  - attempt
  - evidence
  - run output
  - outcome
  - observation
- One write increments once, however many nodes it touches.
- A write with no structure or content change leaves the mission revision unchanged.

## The mission change

- The table is `mission_change(mission_id, mission_revision, actor, reason, created_at, result)`.
- Its primary key is `(mission_id, mission_revision)`.
- The write that increments the mission revision inserts the row in its own transaction.
- `result` holds the node revisions created, the retired node identities, and the edges added and removed.
- `result` uses the canonical JSON of [architecture.impl.md](architecture.impl.md#the-canonical-form-and-the-digest).
- The Mission Service keeps every mission change for the life of the mission. No sweep deletes a row.
- `change list` pages by the shared descending rule of [architecture.impl.md](architecture.impl.md#pagination).
- `change list` and `change get` use the `human` access policy.
- The `NodeChange` answer of a graph write is the stored result of its mission change.

## Operation contracts

- Every Mission route uses the [shared error envelope](gateway-service.impl.md#errors-and-logging) of the Gateway Service.
- Every Mission route uses the [default 30 s timeout](gateway-service.impl.md#cancellation).
- Every Mission route uses the [10 MiB body limit](gateway-service.impl.md#delivery-bytes-and-body-limits).
- A stale expected revision or mission revision answers 409 `mission.revision_conflict` with the current value in `details`.
- An absent node, mission or record answers 404 `mission.not_found`.
- `graph get` answers at most 10 MiB. A larger graph answers 413 `mission.graph.too_large`.
- That error holds the node count and the paged reads `node list` and `edge list` in `details`.

## Tests

- Tests refuse each unknown front matter key and unknown H2 with `mission.import.plan_invalid` and the file name.
- Tests refuse each absent or repeated H1, Requirement section and Criterion section with the same error and file name.
- Tests check front matter delimiters, permitted node kinds and the required nonblank content.
- Tests accept an absent `id` for a new node and preserve a known identity.
- Tests require a parent for objectives and tasks, forbid it on initiatives, and forbid `dependsOn` on tasks.
- Tests reject unresolved parent and dependency names and references outside the import set.
- Tests assert that the file name becomes the import-set key and the node's `file`.
- Tests refuse upper-case names, names without `.md`, and path separators.
- Tests require `file` on create and return it on node reads.
- Tests assert uniqueness within a mission and accept the same name in separate missions.
- A name conflict answers 409 `mission.node.file_conflict` without a partial write.
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
- A test asserts that the node API exposes no retirement operation.
- Tests admit initiative creation at any time.
- Tests cover objective and task creation under each of the twelve parent states.
- Each refused create names `mission.node.create_refused` and the parent state in `details`.
- A race test changes the parent state before commit and asserts that the commit rechecks admission.
- Tests preserve the stricter import condition for import creates.
- Tests commit or roll back each import or unblock and its request row together.
- Tests repeat each request with the same identifier and digest and assert the stored result without a second effect.
- Tests repeat each identifier with another digest and assert 409 `mission.request.payload_mismatch`.
- Tests recover the complete file-name-to-node-identity map after a lost import response.
- Tests retrieve accepted import and unblock requests throughout the life of the mission, after later revisions and terminal states.
- Tests assert that no sweep deletes a request row.

- Tests apply the node-content rules to imports, node writes and unblock content changes for every node kind.
- Tests omit each required field and assert its error code.
- Tests reject blank and nontext values for each text field with `mission.node.content_invalid`.
- Tests accept duplicate titles and a criterion with several checkable statements.
- Tests reject absent and empty verifications with `mission.node.verifications_missing`.
- Tests reject nonlist verifications and blank or nontext items with `mission.node.content_invalid`.
- A test accepts `true` for a node with no verification need.
- Tests resolve project binding names to identities at the write.
- Tests reject absent or nonlist bindings and unknown or foreign-project names with `mission.node.bindings_invalid`.
- Tests cover every cell of the rule table, with each permitted count and a forbidden count.
- Tests reject repeated repository names on an objective because its list requires exactly one entry.
- Tests keep identity, kind, revision, state, attempt counter, priority and edges outside content.
- A test keeps task content inside the objective revision.
- Tests accept verification kinds outside the guidance for each node kind.
- A test runs verifications serially in list order through `bash -c` from the execution workspace root.
- A test uses shell syntax to prove that each item is a full bash command.
- A test stops at the first nonzero exit and records no result for a later item.
- Tests assert each recorded command, its exit code and the overall exit code for success and failure.
- A start test refuses a host without bash.
- Tests refuse success with a failed or unrun item under `mission.assessment.verification_failed` for tasks and reviewers.
- A test permits judgement only after every verification passes; zero exits alone never establish success.

- A test covers prefix validation for each identity. It rejects a bare ULID, a wrong prefix and a noncanonical ULID.
- A test asserts that every revision and version counter starts at 1 and every such field requires a positive safe integer.
- A test asserts that the attempt counter starts at 0 and the default of `gateway.tokenGeneration` stays 1.
- A test asserts one mission revision increment for each graph write, even when the write touches several nodes.
- A test asserts no mission revision increment for each non-graph write and for a write with no structure or content change.
- A test asserts that each content change creates the next node revision.
- A test asserts that the mission change row and its write commit or roll back together.
- A test checks the canonical result, its `NodeChange` answer and its retention for the life of the mission.
- A test asserts that no sweep deletes a mission change row.
- A test checks `change list` and `change get`, the `human` policy and the shared page order.
- A test checks the shared error envelope, the 30 s timeout and the 10 MiB body limit on every Mission route.
- A test asserts 409 `mission.revision_conflict` with the current value for a stale expected revision or mission revision.
- A test asserts 404 `mission.not_found` for an absent node, mission or record.
- A test checks `graph get` at 10 MiB and above that bound.
- It asserts 413 `mission.graph.too_large` above the bound, with the node count and both paged reads in `details`.
