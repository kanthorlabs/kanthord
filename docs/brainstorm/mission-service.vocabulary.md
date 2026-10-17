---
title: Mission Service Vocabulary
---

# Mission Service Vocabulary

This file holds the values and the examples of the terms that [mission-service.md](mission-service.md) owns.
A product term lives in [overview.vocabulary.md](overview.vocabulary.md).
This file is not a design document, and `mission-service.md` stays the single source of truth.

## bindings of a node

The bindings of a node are the project binding identities in its content.
A plan file names each binding by its name.
The write resolves each identity or name to the latest revision of its binding and checks these counts.
A node names every binding that it uses, and no node takes a binding from the project.
The storage bindings of a node form an ordered list, and an upload uses the first working binding of that list.
A task names no binding.
A new binding kind adds a row.

| Binding kind | `implement` | `examine` |
| ------------ | ----------- | --------- |
| Repository   | 1 or more   | 0 or more |
| Worker       | 0           | 0         |
| Storage      | 0 or more   | 0 or more |

## node content

- Every node and every task has the same five required plan content fields and a plan file name.
- A node also holds its `work` and its `requires` list.
- A name is a nonblank title, not an identity, and is not unique.
- A criterion can hold several checkable statements.
- Identity, revision, state, attempt, priority and edges stay outside content.
- These YAML documents show the plan content of an `examine` node, an `implement` node and a task of that `implement` node, respectively.

```yaml
name: Account recovery
requirement: Let account holders recover access.
criterion: A password reset restores access and rejects expired tokens.
verifications:
  - cd web-repo && npm run e2e -- --api ../api-repo
bindings:
  - api-repo
  - web-repo
work: examine
requires: []
---
name: Add password reset
requirement: Let account holders reset a forgotten password.
criterion: A valid token permits one reset and an expired token permits none.
verifications:
  - npm run e2e
  - npm run test:reset
bindings:
  - api-repo
work: implement
requires: []
---
name: Expire the reset token
requirement: Reject a reset token after its expiry.
criterion: An expired token never changes the password.
verifications:
  - npm run test:token-expiry
  - bash ./scripts/check-expired-token.sh
bindings: []
```

Verification guidance depends on the work of the node.
The service does not validate this guidance.

- `examine` node: end-to-end tests.
- `implement` node: end-to-end and unit tests.
- Task: unit tests and functional checks.

A node with no verification need holds `true`, not an empty list.

## work

The kind of work that a node asks for, which selects the method of its execution.
The set is closed and it holds two values.

- **implement**: The node changes one or more repositories, and its tasks state the final-state requirements of that change.
- **examine**: The node reads zero or more repositories and the outcomes of its direct dependencies, changes no repository and holds no task.

The `implement` node "Add password reset" holds two tasks and names `api-repo`.
The `implement` node "Add the audit log" holds no task, so it is its own single work unit: the agent works from its requirement, and the execution runs its verifications.
The `examine` node "Account recovery" names `api-repo` and `web-repo`, depends on "Add password reset" and "Add recovery codes", and holds no task.
Its execution checks out each base-branch head, runs its verifications and submits its findings as produced evidence.
A human changes the `work` of "Add password reset" while its attempt reads 0.
After the first claim opens attempt 1, a change of its `work` answers `mission.node.work_locked`.

## requires

The list of traits that a worker binding needs to claim a node.
The current worker bindings of a project supply its trait keys, so the term names no closed set.

- Each key follows the form of a [trait](project-service.vocabulary.md#trait) of the Project Service.
- A list holds each key once, and an absent list reads `[]`.
- A malformed key answers `mission.node.content_invalid`.
- A node with `requires: []` matches every worker binding whose worker declares its work and its state.

The node "Add password reset on iOS" holds `requires: [platform.macos]`.
The worker binding `macos-coder` holds `traits: [platform.macos, toolchain.xcode]`, so its instances claim the steps of that node.
The worker binding `linux-coder` holds `traits: []`, so its instances never claim that node.
An import of that node into a project with no worker binding that holds `platform.macos` answers `mission.node.requires_unmatched`.

## priority

The human act that orders a node in the work queue.
A task holds no priority.
A human sets the priority of "Add password reset" to -2, then to 7.
The second act overwrites the value -2, and no Mission record keeps the earlier value, the actor or the time.
Any signed safe integer is valid; absent priority reads 0.

## object evidence

Evidence whose content occupies an object in the bucket of a project's storage binding.
Its address is the object location and its version when the store keeps one.
SHA-256 is optional.

The execution of "Add password reset" produces a 3 GB video of the reset flow.
The video exceeds the 5 MiB inline limit.
Its host component safely opens the video inside the execution workspace.
The component submits the evidence with the video as an `object` asset, uses the presigned PUT, then completes the asset.
The asset names the `atlas-evidence` bucket, its object key, size, media type and storage binding revision identity.
It records the object version when the store returns one.
The answer gives the asset identity and `s3://atlas-evidence/<object key>`.
The reviewer gets a presigned GET through its kanthord component, not a storage credential.
The evidence record and the video stay until a human deletes them.

## pending upload

An `object` asset whose upload no complete published yet.
The term names no closed set.

The component starts the video upload but never completes it.
After one hour, the asset expires and cannot complete, so its evidence stays unpublished.
A human deletes the expired asset with `evidence asset delete`.
The delete removes the video object and the asset row, and published evidence stays unchanged.

## attempt

The overview owns the term.
Write `node attempt` where `evaluation attempt` appears nearby, because the two are different objects.
Write `attempt` alone everywhere else.

Take the `implement` node "Add password reset".
A `tdd@1` instance and a `reviewer@1` instance each execute it using their worker's method.

The import creates the node with no attempt, and its attempt reads 0.

1. A `tdd@1` instance claims the node.
   The first claim opens attempt 1, and Execution 1 starts.
   Attempt 1 requires one external action, a pull request that must merge, from the repository strategy of the binding row that its pinned revision names.
2. The instance executes a RED-GREEN-REFACTOR loop for each task, on a branch, with one commit for each task.
   It writes no record for a task.
3. The instance releases with the evidence of Execution 1, and the execution of the attempt requires no further work.
   Execution 1 ends, and the node reaches `Waiting`.
   Attempt 1 stays open.
4. The readiness condition holds, and a `reviewer@1` instance claims the node.
   Execution 2 starts.
5. Execution 2 publishes a current passing assessment of the tested input.
6. Execution 2 requests the required external action: the Intake Service opens pull request 42, and the Mission Service writes its request evidence.
   Execution 2 releases, and the node reaches `External.Requested`.
7. A human merges the pull request.
8. Delivery admission calls the Intake check, which establishes the expected end state, and the Mission Service sets it on the request evidence.
   The Mission Service writes the landed commit identities as evidence.
   The node reaches `External.Success`.
9. The current passing assessment stands, and the Mission Service writes the successful outcome.
   Attempt 1 closes, and the node reaches `Completed`.

Every record in this example names attempt 1 forever.

A node whose attempt never opened holds no attempt, and its attempt reads 0.
[Attempt](mission-service.md#attempt) owns the acts that open an attempt.
The attempt of the node above reads 1 for every record in the attempt example.
The import condition requires `Pending` or `Available` and an attempt that reads 0.
A task modification reads the state and the attempt of its node.
Attempt identity establishes no currency by itself.

## evaluation attempt

One try at the evaluation of a node.
An evaluation has a durable lifecycle, and one evaluation attempt is one try inside that lifecycle.

Take the evaluation claim in step 4 of the attempt example.

1. A `reviewer@1` instance claims the node.
   Evaluation attempt 1 starts.
2. The reviewer instance becomes unreachable and publishes no assessment.
   Evaluation attempt 1 ends.
3. The evaluation is incomplete.
   The node attempt stays open.
4. A bounded retry resumes the evaluation.
   Evaluation attempt 2 starts.
5. Evaluation attempt 2 publishes the assessment.

One node attempt holds two evaluation attempts.
An evaluation attempt ends while its node attempt stays open.
An evaluation attempt is one reviewer execution and holds no record of its own.

## attempt closure

The act that ends an attempt and every execution and evaluation attempt in flight under it.
The term names no closed set.

Take "Add password reset" while the `tdd@1` instance executes it in Execution 1 under attempt 1.
A human discards the node.
The Mission Service closes attempt 1 by force and ends Execution 1.
It writes the outcome of the node.
The records of attempt 1 remain records of that attempt.

## start point

The branch that the work of an attempt starts from.
The value is `base_branch` or `node_branch`.
The start point says where the work starts, not what the work is.

Take "Add password reset" after a human rejects the work of attempt 1 on `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV`.

1. Attempt 1 records `base_branch`, because every attempt 1 starts from the base branch.
2. A human blocks the node and unblocks it with `start_point: base_branch`.
   Attempt 2 opens and records `base_branch`.
3. The claim of attempt 2 names the node branch `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV-a2`.
   The steps execution starts that branch from the base branch.
4. A later human unblock without a start point opens attempt 3, and attempt 3 records `node_branch`.
   Attempt 3 continues `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV-a2`.

The branch `kanthord/node_01ARZ3NDEKTSV4RRFFQ69G5FAV` and its commits stay unchanged.
The start point of an `examine` attempt has no effect.

## state of a node

The state of a node.
The set is closed and it holds twelve values.

- **Pending**
- **Available**
- **Executing**
- **Waiting**
- **Evaluating**
- **Blocked**
- **Paused**
- **Completed**
- **Discarded**
- **External.Requested**
- **External.Success**
- **External.Failed**

## basis

The assessment that an outcome names as its basis.
The kind of the basis is the kind of the actor of that assessment.
The set is closed and it holds two values.

- **execution assessment**
- **human assessment**, which records a human assertion

## block condition

A block condition is a condition that closes an attempt and reaches `Blocked`.
The set is closed and it holds three values.

- **a current assessment that does not pass**
- **the end state other of a request evidence**
- **a human reason on a paused node**

## asserted result

The result that an outcome asserts, separately from its basis.
The set is closed and it holds three values.

- **success**
- **the results do not meet the criterion or the default standard**
- **nothing is established**

The asserted result of a discard is that nothing is established.

## readiness condition

The condition over the direct dependencies of a node that admits an evaluation claim and the human ready act.
The term names no closed set.
[Readiness condition](mission-service.md#readiness-condition) states the rule.

Take the `implement` node "Add password reset" with no dependency.
The steps execution releases with no further work, and the node reaches `Waiting`.
The readiness condition admits an evaluation claim.

Take the `examine` node "Account recovery" with the direct dependencies "Add password reset" and "Add recovery codes".
"Add password reset" holds `Completed`, and "Add recovery codes" holds `Discarded`.
A discarded node satisfies no dependency, so "Account recovery" stays `Pending` and admits no claim.
A human removes the dependency on "Add recovery codes", and "Account recovery" moves to `Available`.
Its steps execution releases it to `Waiting`, and the readiness condition admits an evaluation claim.

## continuation condition

The condition over the required external actions of the attempt that admits an evaluation claim from `External.Requested`.
The term names no closed set.

Take the `implement` node "Add password reset" with two required external actions: pull request 42 that must merge, and a notification with the landed commit in `#account-recovery` that follows the merge.
Execution 2 opens pull request 42 after the passing assessment and releases, because the notification is not requestable before the merge.
A human merges pull request 42, and delivery admission sets the expected end state with the landed commit `abc123`.
The notification is unrequested and the action that it follows has reached its expected end state, so the continuation condition holds.
A `reviewer@1` instance claims the node from `External.Requested`, and Execution 3 posts the notification with commit `abc123`.

## terminal state

A state that a node never leaves and that opens no further attempt.
The set is closed and it holds two values.

- **Completed**
- **Discarded**

A terminal node is not editable.
No human override reaches a terminal node, and follow-up work is a new node.
An edit writes the WHAT, and a correction writes a new outcome record.

## assessment

The record of one evaluation of one evidence set against the criterion of one node revision.
An assessment weighs the evidence against the criterion of the node revision that it names.
An assessment names seven things.

- the evidence set that it evaluates
- the node revision whose criterion it evaluates
- every immutable dependency outcome record that it weighs
- the actor that performs it
- the tested input of its verifications
- one result
- one required rationale

The [overview](overview.md) gives what an assessment establishes.
That set is closed and it holds three values.

- The results meet the criterion.
- The results do not meet the criterion or the default standard.
- The available evidence establishes neither.

Take the `implement` node "Add password reset" above.
A `reviewer@1` instance evaluates that node, and it writes one assessment.
That assessment names the evidence set of the node and the node revision pinned by the attempt, and its rationale names each task whose criterion is unmet.
It names the reviewer execution as the actor and holds no method field.
An external harness assessment identifies the client identity of the harness worker.
A human writes an assessment only through a human act.
The assessment names the tested input of the verifications of the pinned revision.
Assessments accumulate, so a second assessment of the same node never overwrites the first.

The assessment result follows this order for "Add password reset":

1. `npm run test:reset` fails or does not run.
   The result is `criterion-not-met`; the execution makes no judgement, and the rationale names that verification.
2. Otherwise, the agent judges the criterion.
   The judgement gives `success`, `criterion-not-met` or `undetermined`.
3. kanthord hosts the worker, and the judgement finds a default-standard violation.
   That violation turns `success` into `criterion-not-met`.

Only the first case permits an empty judgement, and no case permits an absent rationale.

## tested input

What the verifications read, named by the assessment that weighs their results.
The term names a closed set of four forms.

- **a repository snapshot**, for a node with one repository binding
- **a list of repository snapshots**, one commit for each repository binding in binding order, for a node with two or more repository bindings
- **the content address of produced evidence**, when no repository supplies the tested input
- **the address of object evidence**, when the verifications read an object that the storage binding holds

The tested input never names the produced evidence that records the verification results.
A later addition to the evidence set changes no earlier tested input.

Take the `implement` node "Add password reset" above.
Its evidence names the head commit of the node branch, so the tested input is that repository snapshot.

Take the `examine` node "Account recovery" that names `api-repo` and `web-repo`.
The reviewer checks out each base-branch head under the binding name in the workspace.
The tested input names `api-repo` at `a41b9c0` and `web-repo` at `9f1c2e7`, one commit per binding.
The end-to-end suite lives in `web-repo`.
The verification runs from the agent root:

```bash
cd web-repo && npm run e2e -- --api ../api-repo
```

An `implement` node that names `api-repo` and `web-repo` holds the same list form, with the head commit of each node branch.

Take an `examine` node that names no repository binding.
Its steps execution submits a report as produced evidence.
The reviewer places that evidence in the workspace, and the tested input is the content address of that report.

## node revision

One immutable snapshot of the whole content of a node.
It covers the plan file name, the name, the requirement, the criterion, the verifications, the bindings, the work, the requires list and the tasks.
A change to the content of a node preserves the identity of that node and creates a node revision.
The term names no closed set.

Take the history of "Add password reset" that reaches attempt 3.
The Mission Service returns its revisions as a list ordered by revision descending.

- **revision 3**
  - reason: add the reset email requirement
  - actor: `ulrich`
  - time: `2026-09-11T10:00:00Z`
- **revision 2**
  - reason: set reset token expiry to 24 hours
  - actor: `ulrich`
  - time: `2026-09-10T15:00:00Z`
- **revision 1**
  - reason: create the node
  - actor: `ulrich`
  - time: `2026-09-09T09:00:00Z`

A `tdd@1` instance claims "Add password reset" under attempt 3, and attempt 3 pins revision 3.
An active attempt keeps the node revision that it pins.
A new node revision authorizes no later attempt by itself.
The identifier of the node stays the same across all three revisions.

## content owner

The node whose node revision holds the content of a node or of a task.
A node is its own content owner.
The content owner of a task is its `implement` node, because the content of a task belongs to the node revision of that node.
The term names no closed set.

Take the task "Write the reset email" of the `implement` node "Add password reset".

- The content owner of "Write the reset email" is "Add password reset".
- A change to "Write the reset email" creates the next revision of "Add password reset".
- An import whose task file of "Write the reset email" names `add-recovery-codes.md` moves the task. The import creates the next revision of both nodes. The content owner becomes "Add recovery codes".

## currency

The property of an assessment that three checks admit.
The set of checks is closed and it holds three members.

- **context**: Context checks the evidence that the assessment names, its criterion, the direct dependencies and the selected dependency outcomes.
  The check never requires equality with the whole evidence set.
- **authority**: Authority checks intervening acts: a block, an unblock, a pause, a resume, a discard, a human override and an attempt closure.
  The authority check determines whether an assessment still affects current state.
- **order**: Order selects the latest execution assessment that the context check and the authority check admit.

An attempt closure never invalidates a completed record.
An attempt closure scopes a record to its own attempt.
A pause and a resume never invalidate a passing assessment by themselves.
An assessment is current only when all three checks admit it.
The record order answers the order check alone.
A `reviewer@1` instance assesses the `examine` node "Account recovery" and names an outcome of its direct dependency "Add password reset".
The context check fails when that assessment names an outcome other than the current outcome of "Add password reset".
That assessment is not current, and it stays in the record.

## dependency

A graph relation that makes its dependent unavailable until the node that it names is `Completed`.
The term names no closed set.
A dependency relates two nodes of one mission, and a task carries no dependency edge.
A dependency is the only edge of the mission graph, and it determines availability.

The node "Add password reset email" depends on "Add password reset".
"Add password reset email" stays `Pending` until "Add password reset" is `Completed`.
A human override of "Add password reset" to `Completed` releases it as well.
A human adds a dependency to "Add password reset email" while no live claim holds it, and the Mission Service reroutes it at once.
The same addition is refused while a `tdd@1` instance executes "Add password reset email", so the human pauses the node first.
A node read names the dependencies of its node in the key `depends_on`, as node identities, and a plan file names them in the key `depends_on`, as plan file names.
The node read of "Add password reset email" holds `depends_on` with the identity of "Add password reset", and its plan file holds `depends_on: [add-password-reset.md]`.

## dependency closure

The set of nodes that the dependencies of a node name, its direct dependencies.
The term names no closed set.
The `examine` node "Account recovery" depends on "Add password reset", and "Add password reset" depends on "Add recovery codes".
The dependency closure of "Account recovery" holds "Add password reset" alone.

## external object

The remote thing that serves one requested external action, and that the `platform` asset of a request evidence addresses.
The term names no closed set.

An external object takes one of many forms, and these five are examples of it.

- pull request 42 that must merge
- document "Password reset checklist" whose every item must carry a check
- issue 117 that must close with the tag `security`
- a reply in the "Account recovery" thread
- a notification in `#account-recovery` that must be posted

## human block

The human block of a paused node.
The term names no closed set.

Take another history of "Add password reset", in which attempt 1 closes on a block.
A human pauses the node while attempt 2 is open.
The human blocks the paused node with the reason "the reset provider is unavailable".
The human unblocks the node into attempt 3.

## request evidence

The evidence record of one requested external action.
It holds the requirement key of the attempt, one `platform` asset that addresses the external object, and at most one end state.
The term names no closed set.

Take the `implement` node "Add password reset".

Example of a landing case:

- node: "Add password reset"
- attempt: 1
- requirement key: `kanthord-repo.pull_request`
- expected end state: `pull_request_merged`
- asset: pull request 42 of `repository:github:kanthorlabs/kanthord`
- end state: expected
- landed commit evidence: `abc123`, with the Mission Service as provenance

Example of an external failure case:

- node: "Add password reset"
- attempt: 2
- requirement key: `kanthord-repo.pull_request`
- asset: pull request 57 of `repository:github:kanthorlabs/kanthord`
- end state: other, because pull request 57 closed without merge

## import

- The snapshot reconciliation that writes the structure and the criterion of each node of a mission.
- An import covers the whole mission.
- An import accepts the Markdown format or the JSON format.

An import carries these effects on a node.

- **create**: A plan file that carries no identifier creates a node when the import condition holds.
- **update**: A plan file that carries an identifier updates that node when the import condition holds.
- **retirement**: A plan file that the import set omits retires its node when the import condition holds.

The import condition holds when the node holds `Pending` or `Available` and its attempt reads 0.

- An import retires no node that holds an attempt.

An import modifies no node that holds an attempt, whatever its state.
A release to `Pending` or `Available` leaves the node with an attempt and its records.
The import condition of a task is the condition of its node.
A task modification requires its node to hold `Pending` or `Available` and its attempt to read 0.
This rule covers a create, an update and a removal of a task.
A modification covers the record of the node and its tasks.
A task move reads the condition on the old node and on the new node.
A dependency edit follows the dependency rule, not the import condition.
A dependency addition requires that no live claim holds the dependent.
A dependency removal requires a dependent that is not terminal.
A human who stops the work of a node discards that node.
The discard closes the attempt, and the closure writes the outcome of the node.
A human who also releases the dependents edits each dependent and removes the dependency.
That edit is a dependency removal, so the dependency rule governs it, not the import condition.
A node that started work stays in the graph, and a discarded node keeps its records.
The Mission Service terminates an import that fails the condition, and that import produces no effect.
A transaction and a lock cover the condition check and the commit together.
One import applies any mix of the three effects, and the import is atomic.
The import set is authoritative.

- An import names the mission version that it expects.

The import and the node API are the two write paths for a node and for a criterion.
The node API updates a node that holds an attempt, and that update carries the human override authority.

- The node API retires one node.

The node API edits no node in a terminal state.
The node API reads no condition of the import when it updates a node.
A human takes responsibility for an edit through the node API.
No execution identity writes a node, and no execution identity writes a criterion.

## import set

- The complete set of nodes that one import carries for the whole mission.
- An import accepts the Markdown format or the JSON format.
- A plan file name is unique inside the import set.
- Each dependency and the `node` key of each task file name a plan file inside that set, never a path or a node outside the set.
- The membership changes with each import, so the term names no closed set.

A human keeps the whole mission plan in Markdown, and one import set holds these six files.

- `account-recovery.md`, an `examine` node that depends on the two `implement` nodes
- `add-password-reset.md`, an `implement` node
- `add-reset-request.md`, a task of that node that holds each verification of the node
- `add-reset-token-expiry.md`, another task of that node
- `add-password-reset-email.md`, another `implement` node, with `add-password-reset.md` as a dependency
- `send-reset-email.md`, a task of that node that holds each verification of the node

- The import resolves the name `add-password-reset.md` inside this set.
- The omission of a file from this set requests a retirement of its node.

Each modification requires `Pending` or `Available` and an attempt that reads 0.
A task modification reads the state and the attempt of its node.
An inadmissible modification aborts the whole import with no effect.
A rewrite of `add-password-reset.md` with no identifier creates a new node, and the unchanged `add-password-reset-email.md` now names that new node, so the import modifies "Add password reset email" and reads its condition.

## plan file name

- The name of the plan file of a node or a task, unique among the node and task plan file names of the nodes of its mission that are not retired.
- An import or a create sets it, and every export writes it unchanged.
- The term names no closed set.
- Two nodes titled "Add tests" hold `add-tests-api.md` and `add-tests-web.md`.
- After the first leaves the plan, the export still writes `add-tests-web.md` for the other.
- A human retires the node `add-recovery-codes.md` and imports a new node with the same file name and no `id`.
- The import creates a new node with that name, and `node list --include-retired` returns both nodes with distinct identities.

## plan file

- The Markdown document that represents one node or one task under the [plan file grammar](mission-service.impl.md#the-plan-file-grammar).
- Its file name is the import-set key and the plan file name of the node or the task.
- The term names no closed set.
- A node file holds `work`, and a task file holds `node`.
- The first example is `add-password-reset.md`, the `implement` node "Add password reset" in the import set above.
- The second example is `add-reset-request.md`, a task of that node.
- The `id` names a known node or task; a new node or task omits it.

```markdown
---
id: node_01ARZ3NDEKTSV4RRFFQ69G5FAV
work: implement
depends_on: []
requires: []
bindings:
  - api-repo
verifications:
  - npm run e2e
  - npm run test:reset
---

# Add password reset

## Requirement

Let account holders reset a forgotten password.

## Criterion

A valid token permits one reset and an expired token permits none.
```

```markdown
---
id: task_01ARZ3NDEKTSV4RRFFQ69G5FB0
node: add-password-reset.md
bindings: []
verifications:
  - npm run e2e
  - npm run test:reset
---

# Add the reset request

## Requirement

Accept a reset request for an account and send one reset token.

## Criterion

A valid token permits one reset.
```

## retirement

The removal of the executable work of a node, with its historical records preserved.
A human retires a node through an import omission or through the node API.
A retirement deletes no node record.
A retirement is final, and no operation reverses it.
A retired node keeps its identity, its plan file name, its revisions and its last state, which is `Pending` or `Available`.
A retirement removes one thing.

- the executable work of its node

A retirement preserves four things.

- the outcomes of that node
- the assessments of that node
- the evidence of that node
- the historical relations of that node

A retirement never reaches a node that holds an attempt.
An import retirement requires the import condition on every node that the retirement modifies.
The condition covers the retired node.
It also covers every dependent whose edges change.
Each check requires `Pending` or `Available` and an attempt that reads 0.
One failed check aborts the whole import with no effect.
The import that retires a node removes every current inbound reference to that node.
A preview confirms every retirement before the import applies.

Take the import set above, and drop the file `add-reset-token-expiry.md`.
That file holds a task, so the import retires no node.
The node of that task holds `Available`, and its attempt reads 0.
The import writes the next revision of "Add password reset" without that task.

A human retires `add-recovery-codes.md`, an `implement` node with two tasks, through the node API.
The retirement set holds that node, and its two tasks leave the work of the mission with it.
`add-recovery-email.md` holds `Pending` and depends on `add-recovery-codes.md`, so the retirement fails until the human forces it.
The forced retirement removes that dependency.
`add-recovery-email.md` moves to `Available` when it has no other unmet dependency.

The human copies the plan file of the retired `add-recovery-codes.md` from git, with its `id`, and imports it.
The import refuses the identifier of a retired node and applies nothing.
The human deletes the `id` line and imports again, and the import creates a new node with the same content.

## retirement set

The nodes that one retirement retires.
For a node API retirement, the set holds the named node.
For an import, the set holds every current node that the import set omits.
The term names no closed set.
When a human retires `add-recovery-codes.md` through the node API, the set holds that node alone.

## delivery admission

Delivery admission is the Mission operation that decides the [disposition](#disposition) and the owed effects of one [inbound event](intake-service.vocabulary.md#inbound-event).
The closed set of admission operations holds delivery admission alone.
The Intake Service submits the inbound event about pull request 42 of "Add password reset" to delivery admission.
Admission calls the Intake check, accepts the event as an observation and sets the expected end state on the request evidence.
A repeat finds that end state set and answers `duplicate`.

## disposition

A disposition is the answer that delivery admission gives for one inbound event.
The closed set holds `accepted as an observation`, `accepted as a human act`, `refused` and `duplicate`.
Delivery admission answers `accepted as an observation` for the merge of pull request 42.

## external input

External input is the decoded business meaning that delivery admission considers.
The closed set holds an observation of an external object, a human act on an existing node and a request for new WHAT.
The closed set of human acts holds an unblock, a pause, a resume, an edit and an override.

## linked human identity

The [human identity](overview.vocabulary.md#human-identity) that an inbound event links to.
The Mission Service invokes the human act on a node under that identity.
The term names no closed set.

An inbound event of the GitHub webhook inbound `inbound_01J9QK3T` links to the account `ulrich`.
Delivery admission invokes the Mission operation under the linked human identity of `ulrich`.
