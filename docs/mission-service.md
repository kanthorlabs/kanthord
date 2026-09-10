---
title: Mission Service
---

# Mission Service

## Scope

This document describes the Mission Service.
It describes the mission graph, the criteria authority, the evidence record and the assessment record.
It describes no mechanism of another service.

## Mission structure and levels

The [overview](overview.md#vocabulary) defines a mission, an initiative, an objective, a task, a run, a worker and landing.
The mission is a directed graph.
A node of that graph is a level.
Containment and dependency are the two edge kinds.
Every task belongs to exactly one objective.
Every objective belongs to exactly one initiative.
An initiative is a root of the graph.
The Mission Service permits a level with no child.

A dependency relates an initiative or an objective, in any combination of the two.
A task carries no dependency edge.
A task is a unit of execution inside a worker.
A task is never a unit of scheduling.
A dependency carries a kind.
A start dependency and a landing dependency are the two kinds.

A start dependency makes its dependent unavailable until the level that it names holds a current successful outcome.
A human override that asserts success satisfies a start dependency.
A start dependency establishes only what the criteria of the level that it names establish.

A landing dependency never makes its dependent unavailable.
A landing dependency delays every repository action in the subtree of its dependent until the level that it names lands.
An observed landing satisfies a landing dependency.
A human override never satisfies a landing dependency.
Preparation, local validation and the successful outcome of a task proceed while a landing dependency waits.
A wait on a landing dependency is never an assessment that does not pass.
A landing dependency gates an operation.
Each harness enforces that gate when a client requests the operation.

A level waits for the levels that its own dependencies name.
A level waits for the levels that the dependencies of its ancestors name.
A dependency propagates to both subtrees.
Every level in the subtree of the dependent waits for every level in the subtree of the named level.
The Mission Service checks that closure for a cycle.
It rejects a write that creates a cycle, at construction and at every update.
A containment edge alone forms no cycle, because containment descends from a parent to a child.
A start dependency and a reverse landing dependency between two levels form a cycle.

An unsatisfied dependency never blocks a level.
A dependency determines availability, and an assessment determines a block.

A level lands when every configured repository action in its subtree reaches its expected end state.
A dependent releases on the observed state, and never on the completion of the local action.
A landing observation is a platform action, and it uses the credential of a repository binding.

An objective names exactly one repository binding of its project.
An initiative names no repository binding.
A task names no repository binding, and a task acts on the repository that its objective names.
Two objectives name the same binding or different bindings.
An objective names any repository binding that its project holds.
A run of an initiative derives its repositories from the objectives of that initiative.
One initiative holds work in many repositories.

The mission holds no branch, no merge and no repository action.
The mission supplies the grouping that a repository strategy uses.

A worker takes an initiative or an objective, and it never takes a task.
A worker executes a model judgement and an end-to-end test.
The mission holds precedence alone.
The mission holds no order over the tasks of an objective.

## Validation criteria and authority

Planning occurs outside kanthord.
A human writes the initiatives, the objectives and the tasks in markdown.
A human decides what the system tests, and which command verifies it.
A human imports that plan into the Mission Service.
A run creates no level, and a run writes no criterion.
The import is the only write path for a level and for a criterion.
Execution authority never grants planning authority.
An execution identity authorizes no import, whatever level that import names.

The Mission Service owns what an import carries, and it owns no syntax.
Markdown is the medium that a human writes a plan in.
The command line interface converts a plan into an import.
The Mission Service writes no plan file.

An import reconciles a snapshot, and the import set is authoritative.
A plan file that carries no identifier creates a level.
A plan file that carries an identifier updates that level.
A plan file that the set omits retires its level.
A dependency names a plan file, and it carries no path.
The import resolves that name inside the import set.
A file name is unique inside the import set.

An import is atomic, and the Mission Service validates the resulting graph.
One import deletes a level and removes every inbound reference to it.
An import declares its scope.
An import names the mission revision that it expects, and a stale snapshot fails that check.
A preview confirms every retirement before the import applies.
The Mission Service rejects an unknown identifier, a duplicate identifier and an identifier of another mission.
An import request key binds to its payload, so a retry is idempotent.
The map of assigned identifiers stays retrievable.

A retirement removes the executable work of its level.
A retirement preserves the outcomes, the assessments, the evidence and the historical relations of that level.
A substantive update of a terminal level returns an error.
A no-op import of a terminal level returns no error.

The Mission Service rejects an import while an entity of the mission works.
An admission gate stops a new claim and lets existing work drain.
The import proceeds after that work drains.

A criteria change preserves the identity of its level and creates a criteria revision.
An attempt pins the criteria revision that it claims under.
An import never retargets an active attempt.
A criteria revision never reopens a level that holds a successful outcome.
That success stands under the revision that establishes it.
An import never unblocks a level, and an import never reopens a level.

An import records the actor that submits it.
That record establishes attribution, and it establishes no authorship and no approval.
A criterion that states human authorship is a claim, and it is not proof.

A verification command belongs to the WHAT, and an import carries it.
The files that the command reads belong to the repository, and they stay mutable.
Attribution and a judgement criterion protect the verification.
An exit status of zero proves that one command returned zero.
It proves nothing about test adequacy, about coverage or about a suppressed failure.

## Evidence

An evidence record carries a content address, a subject, a provenance and a scope.
An evidence record is separate from the content that it addresses.
A content address identifies the accepted bytes, and it establishes nothing about their claims.
Two executions with identical output produce two observations and two records.
A repeated address of unchanged content, with no new observation, creates no evidence.

A commit hash is the preferred address of work that a repository holds.
A commit hash is never required.
A SHA-256 hash addresses content that no repository holds.
Addressed prose is evidence, and a research report and a judgement rationale qualify.
An evaluation determines the strength of that evidence.
A claim that carries no addressed content is not evidence.

The Mission Service stores the content of produced evidence.
It stores the address of repository evidence.
Stored content stays retrievable.
An address resolves while its repository holds the content.

Evidence durability differs by level.
A task commit is an internal check, and it has meaning while its objective runs.
The outcome of an objective represents the outcomes of its tasks after that objective lands.
The system guarantees no resolution of a task commit after that point.
An initiative points at an objective commit, and an objective commit is a landed commit.

The evidence of a level is a set of items, and it holds one item most of the time.
The evaluation of an objective happens after the landing observation of that objective.
That observation retrieves the landed commit identities and appends them to the evidence set.
The set then names the tested snapshot and the landed snapshot.
The criteria determine what each snapshot establishes.

A landing record names the repository action, the expected end state and the platform object.
It names the observed state, the observation time and the commit identities.
An authorized observer writes a landing observation, because that observation happens after the run releases.
A run submits the evidence of its own level and the evidence of the tasks of that level.
Each submission carries a valid execution identity.
A late submission never becomes current because it arrives last.

A machine check binds its result to the snapshot that it ran against.
It binds its result to the pinned criteria revision.
A named snapshot does not prove that the check used it.
That binding is an assertion of the executor, unless a clean isolated checkout establishes it.
An executor report is attributable evidence, and it is not an independently verified check.

Evidence is append-only.
Redaction happens before an artifact receives its address.
An evidence record states that redaction transformed its content.
One exceptional path removes content that holds a credential.
Ingestion is bounded, and it never truncates content silently.
Unassessed evidence, rejected evidence and abandoned evidence each carry a bounded retention.
The retention of outcome-dependent evidence is transitive.
It covers the evidence that supports every child outcome that an assessment weighs.
A correction names what it corrects.

## Evaluation and assessment

The Mission Service performs no evaluation, and it is the record authority.
A worker performs an evaluation.
`reviewer@1` is a worker whose method is evaluation.
`reviewer@1` takes an objective or an initiative, and it never takes a task.

An evaluation is work that the Scheduler dispatches.
A level that needs an evaluation becomes available, and a reviewer worker instance claims it.
A landing observation makes an objective available for review.
An executor requests no evaluation.
A reviewer worker is a worker binding of its project.

The worker that executes a level never writes the assessment of that level.
The Mission Service supplies the criteria and the evidence.
The executing worker never chooses the reviewer, and it never shapes the instructions of the reviewer.
That separation is a separation of duties, and it is not independent verification.
The run of an objective writes the assessment of each task of that objective.
A task assessment carries no separation of duties.
The independent review sits at the level whose outcome persists.

The scope of an evaluation differs by level, and its method follows its criterion.
The evaluation of an objective also weighs the child outcomes and the landing.
A model judgement transcript is evidence of its invocation, and it is not an assessment.
The boundary is authority, and it is not a file format.

An assessment names its evidence set and its criteria revision.
It names every immutable child outcome record that it weighs.
It names the method that it applies and the actor that performs it.

Currency needs three checks.
Context asks whether an assessment matches its evidence, its criteria, the structure and the selected child outcomes.
Authority asks whether an assessment still affects current state after an intervening block, unblock, cancellation or override.
Order selects the latest assessment that those two checks admit.
The record order answers the order check alone.
A changed child outcome invalidates the currency of the assessment of its parent.
That invalidation queues no retry, and it reopens no terminal success.
Assessments accumulate, and the Mission Service overwrites none and deletes none.
An assessment that names a superseded context is never current.

An evaluation has a durable lifecycle, and that lifecycle is independent of execution.
An unreachable reviewer marks an incomplete evaluation.
An incomplete evaluation differs from evidence that establishes no result.
A bounded retry resumes the evaluation.
That retry repeats no execution and no repository action.

## Vocabulary

- **assessment**: The record of one evaluation of one evidence set against one criteria revision.
- **criteria revision**: One version of the criteria of a level.
- **currency**: The property of an assessment that the context check, the authority check and the order check admit.
- **dependency**: A graph relation that controls the availability of a level or the timing of its repository actions.
- **start dependency**: A dependency that makes its dependent unavailable until the level it names holds a current successful outcome.
- **landing dependency**: A dependency that delays the repository actions of its dependent until the level it names lands.
- **landing observation**: The platform action that observes a landing.
- **landing record**: The record of a landing observation.
- **import**: The snapshot reconciliation that writes the structure and the criteria of a mission.
- **import set**: The complete set of levels that one import carries.
- **retirement**: The removal of the executable work of a level, with its historical records preserved.
