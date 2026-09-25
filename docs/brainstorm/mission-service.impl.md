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
| Storage | 0 | 0 | 0 |

A missing, blank or nontext `name`, `requirement` or `criterion` answers `mission.node.content_invalid`.
An absent or empty `verifications` list answers `mission.node.verifications_missing`.
A nonlist `verifications` value or a blank or nontext item answers `mission.node.content_invalid`.
A node with no verification need holds an always-successful command such as `true`.
An absent or nonlist `bindings` value, an unresolved name or a rule-table violation answers `mission.node.bindings_invalid`.
The identity, kind, node revision, state, attempt counter, priority and edges stay outside the content.
A task's content belongs to the node revision of its objective.
Test-kind guidance changes no validation rule.

## Priority

A human sets the priority of an initiative or an objective only.
A task holds no priority; a priority write on a task answers `mission.node.priority_task`.
The value is any signed safe integer, from -9007199254740991 through 9007199254740991, with no narrower bound.
An absent priority reads 0.
The service answers HTTP 400 with an issue list for a fraction, a nonnumber or an unsafe integer.
The act requires a nonterminal node with no live claim.
The service records the actor and time outside the node revision.
An import carries no priority.

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

## The assessment

An assessment holds one `result` and one required, nonblank `rationale`.
It holds the evidence identities, immutable child outcome identities and tested input.
It holds no `method` field and no separate criterion result.
The actor and evaluation fields identify who judged.
A task assessment has no evaluation identity; its actor is the steps execution of its objective.
A reviewer assessment names its evaluation identity.
An external harness assessment identifies the client identity of its harness worker.
A human writes no assessment.
The execution code, never the agent, runs the verifications before the judgement.

The result follows this order:

1. A failed or unrun verification gives `criterion-not-met`, with no judgement.
   The required rationale names that verification.
2. Otherwise, judgement against the criterion gives `success`, `criterion-not-met` or `undetermined`.
3. For a worker that declares a base prompt, a default-standard violation turns `success` into `criterion-not-met`.

Only the first case permits an empty judgement.
The judgement is absent in that case; the rationale is never absent.
The Mission Service answers `mission.assessment.verification_failed` when an assessment asserts success with a failed or unrun verification.
HTTP 400 with an issue list rejects a method field, an absent or blank rationale, and a result that violates this order.
The execution behaviour follows [worker-service.md](worker-service.md#evaluation-and-required-external-actions).

## Evidence content

Inline evidence holds at most 5 MiB of decoded content.
`ContentBytes` holds `mediaType`, `encoding: "base64"` and canonical base64 `data`.
The produced content address holds the required SHA-256 of those decoded bytes.
The server verifies the hash before it accepts the content.
Larger inline content answers 413 `mission.evidence.too_large`.
The service never truncates evidence.
Without a storage binding, the service accepts only inline evidence content.
Repository evidence remains an address, not an upload of repository content.

## Object evidence

Object evidence uses one presigned-transfer strategy for every placement and every co-location.
The host-local helper serves `evidence upload <path>` inside the execution workspace.
The host component is the server, the `worker` application or the harness extension.
It opens the path safely and refuses any path or symbolic-link escape from that workspace.
The file path is local input, not an evidence address.

1. The component calls `mission.evidence.upload.begin` with execution context, evidence metadata, size, media type and optional SHA-256.
   This operation requires execution access and a live claim for the node or its task.
   The server checks the live claim, the storage binding and the 5 GiB single-object limit.
   It creates a pending record with a server-generated key: `<prefix>/<project>/<mission>/<node>/<attempt>/<evidence id>`.
   The record names the storage binding identity and revision.
   Custody returns a presigned PUT for that key with a lifetime of 1 hour.
   The grant requires a checksum header only when the component supplies a SHA-256.
2. The component sends the bytes directly to the store with that PUT.
   No transfer through the server proxies those bytes.
3. The component calls `mission.evidence.upload.complete` under execution access with the evidence identity and execution context.
   The server checks the live claim, the object size and, when given, the checksum.
   A mismatch prevents publication.
   The server publishes the evidence record only after those checks pass.
   The record holds the object location, version when the store returns one, size, media type and optional SHA-256.
   The answer holds the evidence identity and the `s3://` URI.

A pending upload expires after 1 hour.
An expired pending upload cannot complete.

- kanthord runs no automatic sweep of unpublished upload objects.
- `mission.evidence.pending.list` uses `GET /api/mission/:missionId/evidence/pending` with `human` access, and lists the expired pending uploads of one mission.
- The list uses the shared page contract and descending evidence identity order.
- Each pending row holds `evidenceId`, `missionId`, `nodeId`, `attempt`, `storageBindingId`, `storageBindingRevision`, `location`, `expiresAt` and `cleanedUp`.
- `location` is the server-generated `s3://` object URI; `cleanedUp` starts as `false`.
- `mission.evidence.pending.cleanup` uses `POST /api/mission/:missionId/evidence/pending/cleanup` with `human` access, and cleans up expired pending uploads of one mission.
- Cleanup deletes each object of an expired pending upload through the storage binding of the project.
- It marks each pending row `cleanedUp: true` after the object deletion and keeps the row.
- Cleanup targets only expired pending uploads, never a published evidence record or a published object.
- The answer holds `missionId` and `cleanedUpEvidenceIds`, the evidence identities of the rows that this cleanup marks.

SHA-256 is optional for object evidence.
A component supplies it when it wants; the store verifies it when both sides support it.
kanthord enforces no object immutability.
It records an object version when the store returns one.
A human who disables versioning accepts that choice.
The binding write probes no store capability.

An authorized reader gets a presigned GET through its kanthord component.
The read targets the recorded object version when one exists.
The presigned URL is an API answer, never part of the credential handover or the agent context.
The storage credential stays in server custody.
The MCP server exposes no upload write.
Content removal deletes the object and withdraws kanthord's access; it recalls no downloaded copy.
[Evidence retention](#evidence-retention) governs published content removal.

## Evidence retention

Every evidence record stays for the life of the mission.
Its content stays until a human removes it, whether an outcome names the evidence or not.
kanthord runs no automatic evidence cleanup.

- `mission.evidence.content.remove` uses `DELETE /api/mission/evidence/:evidenceId/content` with `human` access.
- The input holds `force: boolean` and optional `reason: Text`; the CLI defaults `force` to `false`.
- `Text` is nonblank text; its bounds remain open in [HANDOFF](HANDOFF.md#mission-service).
- With `force: false`, the node of the evidence and every ancestor must hold a terminal state.
- A live chain refuses removal with 409 `mission.evidence.remove_node_live`.
- `force: true` skips that check and requires a reason, so a human can remove an exposed credential at once.
- Force without a reason answers HTTP 400 with a validation issue list.
- The reason is optional without force.
- The service removes inline bytes or deletes the object through the storage binding of the project.
- Object removal targets the recorded version when one exists.
- The service keeps the evidence record and marks its content removed.
- Every evidence record carries `removedBy: Actor | null` and `removedReason: Text | null`.
- Both fields are null while the content exists.
- Removal sets `removedBy` to the verified human actor and `removedReason` to the supplied reason, or null without a reason.
- The record keeps no removal time.
- Removal returns the evidence record; `evidence list` and `evidence get` also return both fields.
- A later human or execution content read answers 410 `mission.evidence.content_removed`, with `evidenceId` in `details`.
- That typed failure returns no content or presigned GET.
- Removal admits an outcome reference and changes no effect of that outcome.

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

- Tests accept both signed safe-integer limits, negative values and zero as priority on initiatives and objectives.
- Tests read absent priority as 0 and reject fractions, nonnumbers and unsafe integers.
- Tests reject task priority with `mission.node.priority_task` and refuse a live claim or terminal node.
- Tests keep priority outside content, revision and import, with the actor and time of the human act.
- Tests reject human assessments under execution access.
- Tests answer HTTP 400 for a method field, an absent or blank rationale, or a result that violates the order.
- Tests check task, reviewer and external harness attribution and their evaluation fields.
- Tests check one result and one rationale, with no separate criterion result.
- Tests check each result-order branch and allow an empty judgement only for a failed or unrun verification.
- Tests require the rationale to name that verification and reject success with `mission.assessment.verification_failed`.
- Tests prove that execution code runs verifications before judgement.
- Tests permit judgement only after every verification of the current tested input passes.
- Tests turn success into `criterion-not-met` for a default-standard violation only when the worker declares a base prompt.
- Tests accept inline content at 5 MiB decoded and refuse one byte more with 413 `mission.evidence.too_large`.
- Tests require canonical base64, media type and the correct SHA-256, and assert no truncation.
- Tests refuse object uploads without a storage binding and preserve inline evidence and repository addresses.
- Tests exercise the same begin, direct PUT and complete flow at every placement, with and without co-location.
- Tests refuse paths outside the workspace, symbolic-link escapes and a path replacement race at open.
- Tests check live-claim admission and task ownership at begin and complete.
- Tests accept 5 GiB, refuse larger objects, and assert server-generated keys and the storage binding revision.
- Tests check the 1 hour PUT lifetime and the checksum header only when SHA-256 exists.
- Tests keep a record pending until complete verifies size and optional checksum; mismatches publish no evidence.
- Tests expire pending uploads after 1 hour and refuse completion after expiry.
- Tests preserve location, returned version, size, media type and optional SHA-256, then return identity and `s3://` URI.
- Tests accept stores without versions, enforce no immutability and make no capability probe on a binding write.
- Tests give authorized readers a presigned GET for the recorded version and refuse unauthorized reads.
- Tests keep URLs outside the handover and agent context, and keep storage credentials in server custody.
- Tests expose no MCP upload write.
- Tests assert that removal deletes the object and withdraws access without recall of downloaded copies.
- Tests retain all evidence records for the mission lifetime, with or without outcome references, and run no automatic evidence cleanup.
- Tests run no automatic sweep of unpublished upload objects.
- Tests require human access and one mission for pending upload list and cleanup.
- Tests list only expired pending uploads and keep other missions outside cleanup.
- Tests prove that cleanup never touches published evidence records or published objects.
- Tests delete expired pending objects through the project storage binding, mark their rows cleaned up and keep those rows.
- Tests refuse removal on a live node or ancestor with `mission.evidence.remove_node_live`.
- Tests refuse force without a reason with a validation failure and accept force with a reason on a live chain.
- Tests accept an optional reason without force and require human access for removal.
- Tests remove inline bytes and object content, with the recorded object version when one exists, and keep the evidence record.
- Tests answer `mission.evidence.content_removed` on each later human or execution content read, with no bytes or presigned GET.
- Tests return `removedBy` and `removedReason` from list and get, null before removal and with the recorded values after removal.
- Tests keep no removal time and preserve the effect of every outcome that names removed content.

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
