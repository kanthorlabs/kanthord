---
title: Mission Service Vocabulary
---

# Mission Service Vocabulary

This file holds the values and the examples of the terms that [mission-service.md](viewer.html?p=mission-service.md) owns.
A product term lives in [overview.vocabulary.md](viewer.html?p=overview.vocabulary.md).
A term that names a closed set lists every value of that set.
Every other term carries a concrete example.
This file is not a design document, and `mission-service.md` stays the single source of truth.

## attempt

One try at a node.
Write `node attempt` where `evaluation attempt` appears nearby, because the two are different objects.
Write `attempt` alone everywhere else.

Take the objective "Add password reset".
A `tdd@1` instance and a `reviewer@1` instance each execute it using their worker's method.

The import creates the objective with no attempt, and its attempt counter reads 0.

1. A `tdd@1` instance claims the objective.
   The first claim opens attempt 1, and Execution 1 starts.
2. The instance executes a RED-GREEN-REFACTOR loop for each task, on a branch, with one commit for each task.
   It writes each task assessment and task outcome.
3. The instance releases with the evidence of Execution 1, and the execution of the attempt requires no further work.
   Execution 1 ends, and the node reaches `Waiting`.
   Attempt 1 stays open.
4. The readiness condition holds, and a `reviewer@1` instance claims the objective.
   Execution 2 starts.
5. Execution 2 publishes a current passing assessment of the tested snapshot.
6. An accepted fact establishes the request for the required external action: opening a pull request.
   The node reaches `External.Requested`.
7. A human merges the pull request.
8. An observer establishes the expected end state and records the landing.
   The observation appends the landed commit identities to the evidence set.
   The node reaches `External.Success`.
9. The current passing assessment stands, and the Mission Service writes the successful outcome.
   Attempt 1 closes, and the node reaches `Completed`.

Every record in this example names attempt 1 forever.

## attempt counter

The per-node ordinal that names which attempt a record belongs to.
A node that starts no work holds no attempt, and its attempt counter reads 0.
The first claim opens attempt 1, and a human unblock opens the next attempt.
The counter of the objective above reads 1 for every record in the attempt example.
The import condition requires `Pending` or `Available` and an attempt counter that reads 0.
A task modification reads the state and the attempt counter of its objective.
Attempt identity is a necessary eligibility check of a task outcome in objective readiness.
The task outcome belongs to the open attempt of the objective.
Attempt identity establishes no currency by itself.

## evaluation attempt

One try at the evaluation of a node.
An evaluation has a durable lifecycle, and one evaluation attempt is one try inside that lifecycle.

Take the reviewer claim in step 4 of the attempt example.

1. A `reviewer@1` instance claims the objective.
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

## attempt closure

The act that ends an attempt and every execution and evaluation attempt in flight under it.
The term names no closed set.

Take "Add password reset" while the `tdd@1` instance executes it in Execution 1 under attempt 1.
A human discards the objective.
The Mission Service closes attempt 1 by force and ends Execution 1.
It writes the outcome and the task outcomes that do not exist, with the closing event as the stopping reason.
The records of attempt 1 remain records of that attempt.

## state of a node

The state of an initiative or an objective.
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

The assessment or human assertion that an outcome names as its basis.
The set is closed and it holds two values.

- **assessment**
- **human assertion**

## block condition

A block condition is a condition that closes an attempt and reaches `Blocked`.
The set is closed and it holds three values.

- **a current assessment that does not pass**
- **an `External.Failed` observation**
- **a human reason on a paused node**

## asserted result

The result that an outcome asserts, separately from its stopping reason.
The set is closed and it holds three values.

- **success**
- **the results do not meet the criteria**
- **nothing is established**

The asserted result of a discard is that nothing is established.

## stopping reason

The reason that an outcome records for the ending, separately from its asserted result.
The term names no closed set.

A human discards "Add password reset" because the project no longer requires password authentication.
The outcome names the human discard as the closing event and the removal of that requirement as the stopping reason.
Its basis names the human assertion, and its asserted result is that nothing is established.

## readiness condition

The condition over current task outcomes, current objective terminal states and outstanding external actions that admits a reviewer claim.
The term names no closed set.

For an objective, every current task holds a current outcome of the open attempt of that objective.
The condition reads the existence of a current child outcome, and never its result.
For an initiative, every current objective holds a terminal state.
The condition reads the current children of the node, and a retirement removes a node from that set.
No required external action of the node is outstanding.
An action is outstanding when the open attempt requests it and no accepted observation establishes its expected end state.
An unrequested action is never outstanding.

Take the objective "Add password reset" with the tasks "Add reset token expiry" and "Add reset email".
The objective reaches `Waiting`, and both tasks hold current outcomes of its open attempt.
The outcome of "Add reset email" states that its results do not meet its criteria.
No required external action of the objective is outstanding.
The readiness condition admits a reviewer claim.

Take the initiative "Account recovery" with the objectives "Add password reset" and "Add recovery codes".
The initiative reaches `Waiting`.
"Add password reset" holds `Completed`, and "Add recovery codes" holds `Discarded`.
Both current objectives hold terminal states, and the initiative configures no external action.
The readiness condition admits a reviewer claim.

## unblock record

The record of one human unblock.
The term names no closed set.
An unblock record names six things.

- the node
- the attempt that it clears
- the attempt that it opens
- the node revision that it pins
- the actor
- the time

Take the history in which attempt 2 of "Add password reset" closes on a block.

- node: "Add password reset"
- attempt cleared: 2
- attempt opened: 3
- node revision pinned: 3
- actor: `ulrich`
- time: `2026-09-11T10:15:00Z`

## terminal state

A state that a node never leaves and that opens no further attempt.
The set is closed and it holds two values.

- **Completed**
- **Discarded**

A terminal node is not editable.
A human override corrects the recorded result of a terminal node, and the node keeps its terminal state.
An edit writes the WHAT, and a correction writes a new outcome record.

## assessment

The record of one evaluation of one evidence set against the criteria of one node revision.
An assessment weighs the evidence against the criteria of the node revision that it names.
An assessment names five things.

- the evidence set that it evaluates
- the node revision whose criteria it evaluates
- every immutable child outcome record that it weighs
- the method that it applies
- the actor that performs it

The [overview](viewer.html?p=overview.md) gives what an assessment establishes.
That set is closed and it holds three values.

- The results meet the validation criteria.
- The results do not meet the validation criteria.
- The available evidence establishes neither.

Take the objective "Add password reset" above.
A `reviewer@1` instance evaluates that objective, and it writes one assessment.
That assessment names the evidence set of the objective, the node revision pinned by the attempt, and the outcome record of each task.
It names the evaluation method, and it names the reviewer instance as the actor.
Assessments accumulate, so a second assessment of the same objective never overwrites the first.

## node revision

One version of the whole content of a node.
It covers the goal, the steps, the validation criteria and every structured field of the node.
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
  - reason: create the objective
  - actor: `ulrich`
  - time: `2026-09-09T09:00:00Z`

A `tdd@1` instance claims "Add password reset" under attempt 3, and attempt 3 pins revision 3.
An active attempt keeps the node revision that it pins.
A new node revision authorizes no later attempt by itself.
The identifier of the objective stays the same across all three revisions.

## currency

The property of an assessment that three checks admit.
The set of checks is closed and it holds three members.

- **context**: Context checks the evidence that the assessment names, its criteria, the structure and the selected child outcomes.
  The check never requires equality with the whole evidence set.
- **authority**: Authority checks intervening acts: a block, an unblock, a pause, a resume, a discard, a human override and an attempt closure.
  The authority check determines whether an assessment still affects current state.
- **order**: Order selects the latest assessment that the context check and the authority check admit.

An attempt closure never invalidates a completed record.
An attempt closure scopes a record to its own attempt.
A pause and a resume never invalidate a passing assessment by themselves.
An assessment is current only when all three checks admit it.
The record order answers the order check alone.
A `reviewer@1` instance writes one assessment of "Add password reset".
A new outcome record of one task then fails the context check of that assessment.
That assessment is not current, and it stays in the record.

## edge kind

The kind of an edge of the mission graph.
The set is closed and it holds two values.

- **containment**: Every task belongs to exactly one objective.
  Every objective belongs to exactly one initiative.
  An initiative is a root of the graph.
- **dependency**: A dependency relates an initiative or an objective.
  The dependency entry below gives its own two kinds.

Containment descends from a parent to a child, so a containment edge alone forms no cycle.
An edge kind is not a dependency kind.
The two sets are different.

## dependency

A graph relation that controls the availability of a node or the timing of its repository actions.
A dependency carries a kind.
The set of kinds is closed and it holds two values.

- **start dependency**: A start dependency makes its dependent unavailable until the node that it names holds a current successful outcome.
  A human override that asserts success satisfies it.
  It establishes only what the criteria of the named node establish.
- **landing dependency**: A landing dependency never makes its dependent unavailable.
  It delays every repository action in the subtree of its dependent until the node that it names lands.
  An observed landing satisfies it, and a human override never satisfies it.
  Preparation, local validation and the successful outcome of a task proceed while it waits.

Nothing else is a dependency kind.
A dependency relates an initiative or an objective, and a task carries no dependency edge.
A start dependency determines availability, and a landing dependency gates an operation.

Take a second objective "Add password reset email" that depends on "Add password reset".

- Under a start dependency, "Add password reset email" stays unavailable until "Add password reset" holds a current successful outcome.
- Under a landing dependency, "Add password reset email" stays available.
  Its repository actions wait for the merge of "Add password reset".
  Another dependency of that objective still makes it unavailable.

## external object

The representation of one requested external action and the remote thing that serves it.
The term names no closed set.

An external object takes one of many forms, and these four are examples of it.

- pull request 42 that must merge
- document "Password reset checklist" whose every item must carry a check
- issue 117 that must close with the tag `security`
- a reply in the "Account recovery" thread

## human block

The human block of a paused node.
The term names no closed set.

Take another history of "Add password reset", in which attempt 1 closes on a block.
A human pauses the objective while attempt 2 is open.
The human blocks the paused objective with the reason "the reset provider is unavailable".
The human unblocks the objective into attempt 3.

## landing observation

The platform action that observes a landing.
It happens after the execution releases, so an authorized observer writes it.
It uses the credential of a repository binding.
The term names no closed set.

Continue step 6 through step 9 of the attempt example.

- A current passing assessment stands, and an accepted fact establishes the request to open the pull request of "Add password reset".
- A human merges that pull request.
- The observer performs the platform action, and it observes the merged state.
- The observation retrieves the landed commit identities and appends them to the evidence set.
- The Mission Service writes the successful outcome, and the objective reaches `Completed`.

## observation record

The record of one accepted observation of one external action.
The term names no closed set.
An observation record is one kind.
It names eight things.

- the node
- the attempt
- the external action
- the expected end state
- the external object
- the observed state
- the observation time
- the authorized observer that writes it

A landing record is the landing case of an observation record.
It adds the commit identities.

Take the objective "Add password reset".

Example of a landing case:

- node: "Add password reset"
- attempt: 1
- external action: open a pull request
- expected end state: merged pull request
- external object: pull request 42
- observed state: merged
- observation time: `2026-09-11T11:00:00Z`
- authorized observer: the authorized observer of the repository binding
- commit identities: `abc123`

Example of an external failure case:

- node: "Add password reset"
- attempt: 2
- external action: open a pull request
- expected end state: merged pull request
- external object: pull request 57
- observed state: closed without merge
- observation time: `2026-09-12T11:00:00Z`
- authorized observer: the authorized observer of the repository binding

## landing record

The landing case of an observation record.
A landing record adds the commit identities.
The landing record above names pull request 42 and commit `abc123`.

## import

The snapshot reconciliation that writes the structure and the criteria of a mission.
An import carries these effects on a node.

- **create**: A plan file that carries no identifier creates a node when the import condition holds.
- **update**: A plan file that carries an identifier updates that node when the import condition holds.
- **retirement**: A plan file that the import set omits retires its node when the import condition holds.

The import condition holds when the node holds `Pending` or `Available` and its attempt counter reads 0.
Neither write path deletes a node that holds an attempt.
The delete condition is the same on both write paths, so the attempt counter of the node reads 0.
An import modifies no node that holds an attempt, whatever its state.
A release to `Pending` or `Available` leaves the node with an attempt and its records.
A create reads the condition on the parent whose child set changes.
The import condition of a task is the condition of its objective.
A task modification requires its objective to hold `Pending` or `Available` and its attempt counter to read 0.
This rule covers a create, an update and a delete of a task.
A modification covers the record of the node, its parent link, its dependency edges and its child set.
A containment move reads the condition on the moved node, the old parent and the new parent.
A dependency edit reads the condition on the dependent node, and never on the node that the dependency names.
A human who stops the work of a node discards that node.
The discard closes the attempt, and the closure writes the outcome and the task outcomes that it owes.
A human who also releases the dependents edits each dependent and removes the dependency.
That edit is a modification of the dependent, so the import condition governs it.
A node that started work stays in the graph, and a discarded node keeps its records.
The Mission Service terminates an import that fails the condition, and that import produces no effect.
A transaction and a lock cover the condition check and the commit together.
One import applies any mix of the three effects, and the import is atomic.
The import set is authoritative.
An import declares its scope, and it names the mission revision that it expects.
The import and the node API are the two write paths for a node and for a criterion.
The node API updates a node that holds an attempt, and that update carries the human override authority.
The node API deletes no node that holds an attempt.
The node API edits no node in a terminal state.
The node API reads no condition of the import when it updates a node.
A human takes responsibility for an edit through the node API.
No execution identity writes a node, and no execution identity writes a criterion.

## import set

The complete set of nodes that one import carries.
A file name is unique inside the import set, and a dependency names a plan file.
The import resolves that name inside the import set, and that dependency carries no path.
The membership changes with each import, so the term names no closed set.

A human keeps the plan of the initiative in markdown, and one import set holds these three files.

- `add-password-reset.md`, the objective
- `add-reset-token-expiry.md`, a task of that objective
- `add-password-reset-email.md`, an objective that names `add-password-reset.md` as a start dependency

The import resolves the name `add-password-reset.md` inside this set.
The omission of a file from this set requests a retirement of its node within the declared scope.
Each modification requires `Pending` or `Available` and an attempt counter that reads 0.
A task modification reads the state and the attempt counter of its objective.
An inadmissible modification aborts the whole import with no effect.

## request identifier

The identifier that a caller gives one request and that binds to the payload of that request.
The term names no closed set.

The command line interface imports the plan of "Account recovery" with request identifier `import-7f3a`.
The connection drops after the Mission Service accepts the import.
The retry with `import-7f3a` returns the accepted result, and no second import applies.
A retry with `import-7f3a` and a changed import set is refused.
The unblock of "Add password reset" carries its own request identifier, and a repeated unblock with that identifier costs no second attempt.

## retirement

The removal of the executable work of a node, with its historical records preserved.
A retirement removes one thing.

- the executable work of its node

A retirement preserves four things.

- the outcomes of that node
- the assessments of that node
- the evidence of that node
- the historical relations of that node

A retirement never reaches a node that holds an attempt.
A retirement requires the import condition on every node that the deletion modifies.
The condition covers the retired node and the parent whose child set changes.
It also covers every dependent whose edges change.
Each check requires `Pending` or `Available` and an attempt counter that reads 0.
The import condition of a task is the condition of its objective.
A task modification requires its objective to hold `Pending` or `Available` and its attempt counter to read 0.
This rule covers a create, an update and a delete of a task.
One failed check aborts the whole import with no effect.
The import that retires a node removes every current inbound reference to that node.
A retirement removes the node from the current child set that the readiness condition reads.
A preview confirms every retirement before the import applies.

Take the import set above, and drop the file `add-reset-token-expiry.md`.
The objective of that task holds `Available`, and its attempt counter reads 0.
The next import retires that task when the import condition holds.
The assessment and the evidence of that task stay retrievable.
