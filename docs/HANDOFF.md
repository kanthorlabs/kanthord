# Handoff

This file is a working note. It is not a design document. Phase 2 produces no `.current` or `.drift` sibling for it. The decision-document rule does not apply to it.

Written 2026-09-08.

## How to use this file

Read this file before a new discussion starts. Find the component that owns the topic. A discussion that belongs to a component starts from the material already parked under that component, so no session re-derives a settled decision.

`docs/overview.md` is the product design. `docs/architecture.md` is the top level, and it names services, responsibilities and relations only. Neither document holds the mechanism inside a service. Every parked item below waits for the component document that owns it.

## Design order

Design the component documents in this order:

1. Project Service
2. Mission Service
3. Scheduler Service
4. Worker Service
5. Tracking Service

Ulrich approved this order on 2026-09-08. Start every session from it.

- Project comes first. A project names the mission that it ships. A project configures the instance counts that the Scheduler reserves against. A project holds the repository strategy that a run follows. Three of the other four services read Project first.
- Mission comes before Scheduler. The Scheduler never makes a blocked level available, and the block belongs to Mission.
- Scheduler comes before Worker. The claim protocol carries the lease and the instance identity that the Worker Service specifies.
- Tracking comes last. It holds telemetry only, and no outcome depends on telemetry.

A document is drafted in this order. A document is not closed before a review against the parked material of the services after it. Two individually correct documents can still leave a race between them.

## State

`docs/overview.md`, `docs/architecture.md`, `docs/project-service.md` and `docs/mission-service.md` are written and reviewed. The Project Service holds no open design item. `docs/mission-service.md` holds sections 1 to 4 only; sections 5 and 6 are not started. A debate review ran on sections 1 to 4 on 2026-09-09 and every finding is applied. Nothing is committed.

`docs/index.html` links the Architecture page and the Project Service page. `docs/viewer.html` carries an editor reformat that Aelita did not make and did not review. Ulrich replaced the mermaid container diagram with `docs/assets/architecture-containers.svg` and added `docs/assets/architecture-services.svg`. Aelita added `docs/assets/project-service-authorization.svg` and `docs/assets/project-service-bindings.svg` on 2026-09-09.

## Settled and already in the documents

- A service is a logical part of one process. A service boundary separates authority and never describes a deployment.
- A worker is a template. A worker name has the form `<implementation>@<version>`, so the same name always identifies the same implementation. A project configures which workers are available and how many instances of each. An instance takes an available level and creates a run.
- A mission is the whole work of one project. A project has one mission. The Mission Service holds it and represents it as a graph.
- The Mission Service performs no evaluation. Ulrich ruled this on 2026-09-09. It holds the criteria, the evidence, the assessment and the outcome records, and it is the record authority. A worker performs the evaluation. `reviewer@1` is a worker whose method is evaluation, in the same way that `tdd@1` is a worker whose method is coding. Every write of a criterion, an assessment and an outcome still passes through the Mission Service.
- The separation is therefore separation of duties, and it is not independent verification. The worker that executes a level never writes the assessment of that level. A reviewer worker writes it. The Mission Service supplies the criteria and the evidence, so the executing worker never chooses the reviewer and never shapes its instructions.
- CHECK: `docs/architecture.md` says the Mission Service performs the evaluation of every level, and it lists the relation where a run requests an evaluation from the Mission Service. Both need an edit.
- A reviewer worker is a worker binding of the project, so the project configures its agents, its provider accounts, its models and its instance count exactly as it does for any worker.
- An evaluation is work that the Scheduler dispatches. Ulrich ruled this on 2026-09-09. A level that needs evaluation becomes available, and a reviewer worker instance takes it through the same claim protocol as every other run. The Mission Service records and never orchestrates. A landing observation makes the objective available for review, so no run has to ask.
- `reviewer@1` takes an objective and an initiative only, because those are the dispatchable units. Ulrich ruled this on 2026-09-09. It never takes a task, in the same way that no other worker takes a task.
- Therefore a task assessment is written by the run of its objective, and separation of duties does not exist at task level. The rule that an executor never writes the assessment of the level it executes applies to an objective and to an initiative. The independent review happens at the level whose outcome persists, because after the objective lands its outcome represents the outcomes of all its tasks.
- OPEN: whether a task is blocked by its own failed assessment, given that a task is internal to the run of its objective and that only a human clears a block. This belongs to the block section.
- The evaluation method follows the criterion and never the level. Each level carries its own criteria, which is a separate statement.
- An external harness is an executor, and it reaches kanthord as a client through the API or the CLI.
- A terminal state never reopens and never repeats. A human override adds a new outcome and never restarts a terminal run.
- An assessment that does not pass ends the run and blocks the level. A blocked level is not available for a further run. Only a human unblocks a level. An unblock authorizes a further run and asserts nothing about the results.
- A run of an objective performs the configured repository action before a successful outcome of that objective.
- An objective belongs to exactly one repository. Ulrich ruled this on 2026-09-08. A project binds more than one repository, and each objective names one repository binding. No objective performs a required action on two repositories, so partial completion across repositories does not exist. This voids the earlier multi-repository partial-failure question.
- The Project Service holds the credentials that a project's resources require, and it authorizes their use. `docs/architecture.md` states that responsibility, and `docs/project-service.md` owns the binding mechanism. No credential enters evidence or telemetry.

## Parked for the Mission Service document

### Vocabulary of this component

Ulrich settled this on 2026-09-10, after a debate pass. The decision is the wording only, and it carries no lifecycle, budget or responsibility rule.

- `attempt` is the noun for one try at a level. Write `level attempt` wherever `evaluation attempt` appears nearby, because the two are different objects and one can end while the other stays open. `attempt` alone is the shorthand.
- `attempt counter` is the per-level ordinal that names which level attempt a record belongs to. It names an attempt and it settles nothing else. It never decides which outcome is current, because section 4 owns currency, and it never separates two claims inside one level attempt.
- Provenance: this session first called the object a `fence value`, then a `generation`. Both names are retired. A ruling recorded here in the older wording is the same ruling; only the word changed. The move from `fence value` to `generation` was a rename, and the move to `attempt` followed a real broadening of the concept, from a counter on a level to one try that spans many runs.
- `raise` is retired as a verb over this object, because it hid the difference between an open and a close.
- OPEN: `docs/overview.md` owns the product vocabulary and holds no `attempt` entry, although approved section 2 already uses the word. Whether the overview gains the entry is a separate decision, and it is not part of this wording change.


The document is `docs/mission-service.md`. Its six sections are:

1. Mission structure and levels
2. Validation criteria and authority
3. Evidence
4. Evaluation and assessment
5. Outcome and completion
6. Block and unblock

Ulrich approved this structure on 2026-09-09. Sections 1 to 4 are discussed, debated and settled. Sections 5 and 6 are not started.

### Settled, section 1: Mission structure and levels

- The mission is a directed graph. A node is a level. A level is an initiative, an objective or a task. Containment and dependency are the two edge kinds.
- Every task belongs to exactly one objective. Every objective belongs to exactly one initiative. An initiative is a root. A level with no child is permitted, and the page states no rule about it.
- A dependency relates an initiative or an objective, in any combination of the two. A task carries no dependency edge, because a task is too small to measure and it is a unit of execution inside a worker. A task is a level of the WHAT and it is never a unit of scheduling.
- A dependency carries a kind. A start dependency makes the dependent unavailable until the level it names holds a current successful outcome. A landing dependency leaves the dependent available at once, and every repository action in the dependent's subtree waits until the level it names lands.
- Preparation, local validation and the successful outcome of a task proceed while a landing dependency waits. Waiting on a landing dependency is never an assessment that does not pass.
- A landing dependency gates an operation, and enforcement happens when that operation is requested, on both harnesses.
- A level waits for the levels that its own dependencies name, and for the levels that the dependencies of its ancestors name.
- A dependency from A to B means every level in the subtree of A waits for every level in the subtree of B. The Mission Service rejects a write whose closure over both kinds holds a cycle. It rejects it when a write constructs the graph and when a write updates it.
- A containment edge alone can never form a cycle, because containment descends a rank and dependency stays inside a rank. A cycle across the two dependency kinds is real: A starts after B, B lands after A.
- A dependency is satisfied by a current successful outcome, including one that a human override asserts. A success edge establishes only what the prerequisite's own criteria establish.
- A level with an unsatisfied dependency is not available. It is not blocked. Unavailability follows the graph, and a block follows an assessment.
- A level lands when the expected end state of every configured repository action in its subtree is observed on the git platform. Opening a pull request is not landing; the merge of that pull request is. A dependent releases on the observed state, never on the completion of the local action.
- Observing that state is a platform action, so it uses the credential of a repository binding.
- An objective names exactly one repository binding of its project. An initiative and a task name none. A task acts on the repository that its objective names. Two objectives name the same binding or different bindings.
- A run of an initiative derives its repositories from the objectives of that initiative. One initiative holds work in many repositories. No rule restricts the repository binding that a level names, because the project already bound every repository that the work may touch.
- The mission holds no branch, no merge and no repository action. The repository strategy of the project holds them. The mission supplies the grouping that a strategy uses, and that grouping is an input to the strategy, not the strategy.
- The rank of a level never determines the evaluation method. The correlation between a rank and a kind of check follows the scope of the level, and the page states no rank-to-method table.
- A worker takes an initiative and it takes an objective. It never takes a task. An initiative outcome mostly needs a human judgement, a model judgement or an e2e test, and the last two need a worker to execute them.
- The execution order of the children of one level belongs to the Worker Service. The mission holds precedence only, and it holds no total order over the tasks of an objective.

### Settled, section 2: Validation criteria and authority

- Planning happens outside kanthord. A human plans the initiatives, objectives and tasks in markdown, and decides what is tested and what command verifies it. A human then imports them into the Mission Service. This holds until a planning service exists.
- No run creates a level and no run writes a criterion. The import is the only write path for the structure and the criteria. This voids the earlier proposal that a run of an ancestor creates a level.
- Execution authority never confers planning authority. An execution identity never authorizes an import, whatever level the import names.
- The Mission Service owns what an import carries, and it owns no syntax. Markdown is the medium that a human writes a plan in, and the CLI converts a plan into an import. The Mission Service writes no plan file.
- The import is snapshot reconciliation. The import set is authoritative. A plan file that carries no id creates a level, a file that carries an id updates that level, and a missing file retires its level.
- A dependency is named by a plan filename with no path, and the import resolves that name inside the import set. A filename is unique inside the import set. No cross-import alternate key is needed, because the set is complete.
- An import is atomic, and validation judges the resulting graph. Deleting a level and removing its inbound references in one import is valid.
- The import guards: an explicit scope, an expected mission revision that rejects a stale snapshot, a preview that confirms every retirement, and atomic validation.
- Identity assignment is recoverable and a retry is idempotent. An import request key binds to its payload, and the assigned id mapping stays retrievable. The Mission Service rejects an unknown id, a duplicate id, and an id from another mission.
- A retirement removes executable work and preserves the outcomes, the assessments, the evidence and the historical relations of the level.
- A substantive update of a level in a terminal state returns an error. A no-op import of that level does not.
- The Mission Service rejects an import while an entity of the mission is working. A per-level rule is insufficient, because an import of an idle child changes the evaluation context of an active parent, and a dependency edit changes another level's eligibility without touching it. An admission gate stops new claims and lets existing work drain, so an import is never blocked forever.
- A criteria change preserves the identity of the level and creates a criteria revision.
- An attempt pins to the criteria revision that it claimed under. An import never retargets an attempt that is already active.
- A criteria revision never reopens a level that holds a successful outcome. The success stands under the revision that established it. An import is never an implicit unblock and never an implicit reopen.
- Attribution, authorship and integrity are three claims. An import records the actor that submitted it. That establishes no authorship and no approval of the content. A criterion that states a human wrote it is a claim, not proof.
- A verification command belongs to the WHAT and arrives by import. The files that the command reads belong to the repository and stay mutable. Protection is attribution plus a judgement criterion, never a protected-path list.
- An exit status of zero proves that one command exited zero. It proves nothing about test adequacy, about coverage or about a suppressed failure.

### Settled, section 3: Evidence

- The Mission Service holds the evidence record. The Tracking Service holds no evidence, and no outcome depends on telemetry. No credential enters evidence.
- An evidence record carries a content address, a subject, a provenance and a scope. A digest establishes the identity of the accepted bytes, and it never establishes the truth of what they claim. Two executions with identical output are not the same observation.
- A commit hash is the preferred address for work that a repository holds, and it is never required. A SHA-256 hash addresses content that no repository holds. The design stays generic, because a project delivers research work, planning work and coordination work as well as coding work.
- Addressed prose is evidence. A research report and a judgement rationale qualify, and evaluation decides their strength. A claim with no addressed content is not evidence.
- The Mission Service stores the content of produced evidence, because nothing else does. It stores the address of repository evidence.
- Evidence durability is tiered by level. A task commit has meaning only while its objective runs, and it is an internal check. After the objective lands, the objective outcome represents the outcomes of all its tasks, so the system guarantees no further resolution of task evidence. An initiative behaves the same way, and an initiative still points at an objective commit. The evidence that must resolve is the landed state, which stays reachable.
- The evidence of a level is a set of items, and it holds one item most of the time.
- A pull request that is open is not done, so the evaluation of an objective happens after the landing observation. That observation retrieves the squash merge commit and appends it to the evidence set. Merge skew is closed by evidence, not by a mechanism: the set names the tested snapshot and the landed snapshot, and the criteria decide what each one must establish.
- A landing record names the repository action, the expected end state, the platform object, the observed state, the observation time and the commit identities.
- A landing observation needs an explicit authorized observer, because it happens after the run released. The architecture says a run writes evidence; it never says only a run may.
- A run submits evidence for its own level and for the tasks of that level, under a valid execution identity. A late submission never becomes current merely because it arrives last.
- A machine check binds its result to the snapshot it ran against and to the pinned criterion revision. Naming a snapshot does not prove the check used it, so the binding is recorded as an executor assertion unless a clean isolated checkout establishes it. An executor report is attributable evidence and it is not an independently verified check.
- Evidence is append-only. Redaction happens before the artifact is addressed, and the record discloses that it is a transformed view. One exceptional path removes contaminated content. Ingestion is bounded, overflow is defined, and nothing is silently truncated.
- Unassessed, rejected and abandoned evidence carries its own bounded retention. Outcome-dependent retention is transitive and it includes the evidence supporting the child outcomes that an assessment weighed.
- A correction names what it corrects. Re-hashing unchanged content never counts as new evidence.

### Settled, section 4: Evaluation and assessment

- The Mission Service performs no evaluation. It holds the criteria, the evidence, the assessment and the outcome records, and it is the record authority. Every write of a criterion, an assessment and an outcome passes through it.
- A worker performs the evaluation. `reviewer@1` is a worker whose method is evaluation, in the same way that `tdd@1` is a worker whose method is coding.
- `reviewer@1` takes an objective and an initiative only, because those are the dispatchable units. It never takes a task.
- An evaluation is work that the Scheduler dispatches. A level that needs evaluation becomes available, and a reviewer worker instance takes it through the same claim protocol as every other run. A landing observation makes the objective available for review, so no run has to ask.
- A reviewer worker is a worker binding of the project, so the project configures its agents, its provider accounts, its models and its instance count exactly as it does for any worker.
- The separation is separation of duties, and it is not independent verification. The worker that executes a level never writes the assessment of that level. The Mission Service supplies the criteria and the evidence, so the executing worker never chooses the reviewer and never shapes its instructions.
- A task assessment is written by the run of its objective, so separation of duties does not exist at task level. The independent review sits at the level whose outcome persists.
- The evaluator's scope differs by level while its method follows the criterion. An objective evaluation also weighs the child outcomes and the landing.
- A model judgement transcript is evidence of that invocation, not an assessment. The boundary is authority, not file format.
- An assessment names the evidence set, the criteria revision, the immutable child outcome records it weighed, the method it applied and the actor that performed it.
- Currency needs three separate checks. Context asks whether the assessment matches the relevant evidence, criteria, structure and selected child outcomes. Authority asks whether the assessment may still affect current state, given an intervening block, unblock, cancellation or human override. Order picks the latest among those admitted. Record order answers the third question only.
- A changed child outcome invalidates the currency of an affected parent assessment. Invalidation alone never queues a retry and never reopens terminal success.
- Assessments accumulate and are never overwritten. An assessment that names a superseded context is never current and is never deleted.
- Evaluation has its own durable lifecycle, independent of execution. An unreachable delegate means the evaluation did not complete, which differs from evidence that cannot establish a result. A bounded retry resumes the evaluation, and it never repeats execution or a repository action.
- The rule that an executor re-requests an evaluation only with new evidence is retired. The dispatch model removes the loop it guarded. The guarantee that replaces it: an assessment names its full context, a level that fails is blocked, and only a human clears a block.

### Not started, section 5: Outcome and completion

Scope: the three separate completion rules, the inconclusive case, the human override, and the terminal state.

Inputs that already exist:

- Completion is three separate rules. An ending requires an outcome, including one that cannot establish the result. A claim of success requires a passing assessment that names the evidence the outcome carries. A human bypass uses the override. One rule cannot both authorize success and record a failure.
- The outcome records the stopping reason separately from the assessment of evidence.
- Only a human overrides an outcome. An override produces a new outcome that carries the human assertion, and the previous outcome is kept as a reference. A terminal state never reopens and never repeats. An override never restarts a terminal run.
- The state model distinguishes "not assessed yet", "an assessment that could not establish the result" and "evaluation did not complete". Execution lifecycle, evaluation lifecycle, block state and outcome history stay separate dimensions and never collapse into one status field.
- A human holds three roles with different authority: participant as the WHO, reviewer who produces an assessment, and override authority. Unblocking is a fourth action, not a fourth role.
- Aggregation is not assessment. A worker aggregates child outcomes to report progress.
- Completing the configured repository action, completing all tasks, and achieving the objective are three different conditions.
- An outcome is produced while no run is in flight, because the landing observation and the reviewer run both act after the executing run released.
- After an objective lands, its outcome represents the outcomes of all its tasks.

A debate pass ran on a draft of this section on 2026-09-09. Ulrich did not rule on it, so every item below is an input, not a decision:

- Terminality must not be reversible. A human override that asserts failure on a successfully completed level would remove its current successful outcome, and a completion rule that reads the current outcome would then call the level not complete. A terminal marker is therefore separate from the current outcome: a permitted success transition makes a level terminal, a later override corrects the recorded result, and that correction never restores execution eligibility.
- A terminal run and a terminal level are different. A failed run never resumes, and its blocked level may receive a new run after a human unblock.
- An evaluation attempt that ends without an assessment does not establish that the level ended. A transient reviewer outage must not displace a valid assessment or a human override. Three events stay separate: an evaluation attempt ends with no assessment, an execution run ends and owes an outcome, and a level reaches terminal closure.
- An outcome carries an explicit basis: an assessment, a human override, or no assessment produced. The third basis extends the outcome definition in `docs/overview.md`, which names an assessment or a human assertion only. One nullable assessment reference must not mean pending, failed and bypassed at once.
- Not blocked by an assessment does not mean eligible for execution. A pending evaluation, a pending landing, an exhausted budget and an import freeze each prevent work on their own.
- The Mission Service is not an evaluator because of its authority boundary, and not because its rule is deterministic. It validates who may publish an assessment, which level and context it concerns, whether it may still affect current state, and which transition follows. It never infers a passing verdict from raw evidence, from child outcomes or from a stopping reason. A stopping reason records why execution ended, and it never serves as proof that success occurred.
- Ordinary success of an objective needs a current authorized passing assessment over the full applicable context and the required landing observation. A passing assessment alone is not enough.
- A blocked child is visible to the assessment of its parent, and it does not mechanically veto success.
- An outcome record holds the level, the originating run or evaluation attempt or human action, the stopping event and reason separate from the asserted result, the basis, the evaluation context when an assessment exists, the evidence set it carries, and the previous-outcome reference for an override.
- Append-only history does not settle currency. Publication rejects the current-state effect of a stale attempt while preserving its record.
- `docs/overview.md` already permits an override during execution: a successful override ends the run, and another assertion does not end it merely by being an override. The remaining problem is atomic termination and fencing against a late worker write.
- Cancellation is an ordinary run-ending cause. It requires an outcome, and it does not require a missing assessment, because a valid assessment can already exist. Cancellation establishes neither success nor failure against the criteria.
- A task override stays an attributable assertion after its objective lands. Task evidence resolution stops being guaranteed; task history does not become meaningless. A task override never rewrites the historical assessment context of its parent and never changes the parent outcome automatically.
- Approval status is a dimension of its own. The earlier draft replaced it with block state. Human review, human override and human unblock carry different authority, so the model keeps them apart.

A second debate pass ran on 2026-09-10, against a fuller draft that proposed a terminal marker, an attempt counter and an answer to each open item. Ulrich did not rule on it, so every item below is an input, not a decision.

- Execution authority and publication authority are different. A single value that a run pins at its start cannot express both "this run continues" and "this run publishes nothing". An override that does not assert success leaves the run alive, so it must not revoke what that run publishes.
- An ending event and the outcome that the ending owes are one transition. A separate write order lets a cancellation invalidate its own outcome, and lets a failing assessment invalidate the block that it causes.
- An attempt counter is not the currency protocol. Section 4 already owns context, authority and order, and a counter on the parent detects no change of a child outcome. Section 5 references that contract and adds no second one.
- "The current outcome never moves backwards" needs a definition. A permitted human correction from success to failure moves backwards in result and forwards in record order.
- Landing is the wrong cutoff for a task override. The evaluation of an objective happens after its landing, so a task override between the landing and the success of the objective still invalidates the currency of the parent assessment. The cutoff is terminal success.
- "Holds no outcome" is not "unfinished". A task that holds an earlier failed outcome, under an objective that runs again, is unfinished too.
- The closure of an objective owes task outcomes for every ending, and not for terminal success alone. A cancellation, an exhausted budget and an inability to progress each end a run that owes them.
- A closure that writes many records needs an atomic or an idempotent obligation with a named recovery path. A crash inside closure otherwise leaves required task outcomes missing forever, because a terminal objective receives no further run.
- Exhaustion of an evaluation retry is an event of the evaluation lifecycle. Whether that event discharges an outcome obligation, and whether its record becomes current, are separate decisions.
- "The Mission Service never reads evidence" is too broad. The service stores evidence, supplies it, and checks evidence identity as part of context currency. The forbidden act is deciding what evidence establishes against the criteria.
- Therefore a structural completion prerequisite over child outcomes is not evaluation. Whether a blocked child vetoes the success of its parent is a product decision, and no argument from the evaluator boundary settles it.
- A cancellation outcome that copies a passing assessment publishes a current successful outcome on a level that is not terminal. A start dependency reads a current successful outcome, so cancellation would satisfy a dependency.
- Approval status was retained as a separate dimension. A model that lists the dimensions exhaustively either includes it or states why it merges.
- An override during the first run of a level has no previous outcome to reference.
- Section 5 references section 1 for task scheduling, section 3 for evidence durability, section 4 for assessment currency and the evaluation lifecycle, and `docs/overview.md` for the shared override and run-ending rules.

Ulrich ruled on B1 and on the level-attempt model on 2026-09-10. These are decisions.

- A level attempt is one try at a level. A level carries an attempt counter that names which level attempt a record belongs to. Exactly one level attempt is open at a time.
- A run and an evaluation attempt pin the level attempt that they start under.
- Every record carries its level attempt. A record stays the record of that level attempt forever.
- Two acts bound a level attempt, and they are separate. A close ends every run and every evaluation attempt that is still in flight under that level attempt. An open starts the next level attempt.
- A close invalidates continuation. A close never invalidates a completed record.
- A run that pins a closed level attempt is stopped. Its output can never become current, and it consumes an instance.
- An assessment that does not pass ends the run and blocks the level. Its level attempt closes with that outcome. No new level attempt opens, because a blocked level is not eligible.
- A human unblock opens the next level attempt.
- A cancellation closes the level attempt by force, because a run is in flight. A new level attempt opens when the level is eligible again.
- A human override that asserts success closes the level attempt by force and sets the terminal marker. No further level attempt opens.
- A human override that does not assert success opens no level attempt and closes none. `docs/overview.md` states that such an override does not end the run, and the run keeps its level attempt and finishes.
- The Mission Service owns the level attempt and its counter. The Scheduler Service enforces the stop of a run that pins a closed level attempt. This is the same split as the block gate.
- A close by force writes the ending outcome of every run that it stops, with the closing event as the stopping reason. A stopped run never publishes afterwards, so no outcome obligation is orphaned.
- B2 is void. It assumed that an open or a close invalidates the record that causes it. A close never touches a completed record, so no ordering rule is needed.
- OPEN, and a consequence of this ruling: a human override that asserts failure during a run leaves the run alive, so a later successful outcome of that run supersedes the human assertion. Confirm that a human who wants to stop the run cancels the run.

Ulrich raised the asynchronous attempt on 2026-09-10. A worker opens a pull request and releases, because a review takes days. A debate pass ran on the answer. The first item below is a decision. Every other item is an input.

- DECISION: a level attempt is not a run. A run is one claim of a level by one worker instance, and it starts at the claim and finishes at the release. A level attempt is one try at a level, and it spans every run, every observation and every evaluation of that try. The later landing observation and the reviewer run continue the open level attempt. A release alone neither closes a level attempt nor opens the next one. Work that arrives after a level attempt closes never revives it, and it never migrates its records into the next level attempt.

- A release is not always a phase transition. Ulrich already ruled that a worker releases while it waits for a dependency and reacquires afterwards. That release happens before execution completes, and possibly before any repository action. A release relinquishes execution capacity, and it discharges no responsibility.
- A crash of a reviewer must not close the level attempt. Section 4 is approved and it gives an evaluation a durable lifecycle, where a bounded retry resumes the evaluation. A rule that every abnormal run ending closes the level attempt removes that recovery and charges a new level attempt for it. A run that stops, an evaluation attempt that does not complete, and an attempt of a level that closes are three separate events.
- A level attempt is an identity and a lifecycle boundary. A level attempt is not an actor, so it accepts no obligation. An obligation that moves from the run to the level attempt needs a named owner, a durable handoff at the release, and a recovery owner. `docs/overview.md` gives the run responsibility for the outcome of its level and of its tasks, and any such obligation reconciles that responsibility instead of deleting it.
- The release boundary needs a durable correlation between the level attempt and the platform object, and a readiness condition that reads accepted facts and never the arrival order of events. Three schedules break an order-based rule. A landing observation arrives before the executor releases. An executor releases and crashes before the correlation is recorded. An old observation arrives after a cancellation closed its level attempt and the next level attempt opened.
- An observation is not an evaluation. An observer establishes that a pull request closed with no merge, and that establishes nothing against the validation criteria. A rule that turns a platform state or an elapsed time into an assertion about a result makes the Mission Service an evaluator.
- A platform state such as "closed" is reversible on some platforms. Which observations end an attempt is a policy decision.
- A level that is not blocked is not therefore eligible. Automatic retry is parked, and an attempt budget limits authorized attempts and authorizes none.
- An initiative does not skip the wait for a landing. A landing is defined over the configured actions in the subtree of a level, and the work of an initiative spans repositories.
- The synchronous path needs its own readiness condition. An executor requests no evaluation, so a level with no repository action needs a durable fact that makes it available for review.
- The import gate cannot treat every open level attempt as work. Trace it: an executor releases while its pull request waits, an import starts and the admission gate stops new claims, the pull request merges, and the level attempt now needs a reviewer claim that the gate forbids. The import waits for the level attempt to close, and the level attempt waits for a claim that the import forbids. Draining needs an explicit policy.
- A pull request that stays open forever is an unbounded wait, and it is not a state that no actor can leave, because a human cancels the attempt.
- These items are proposals with no authority yet: one execution run per level attempt, a level attempt charged for every platform review round, an automatic retry after an observed non-landing, a bound on the wait for a landing and its consequence, a budget that counts level attempts, and a replacement of the run obligation by a level-attempt obligation.
- A change request on a pull request has no approved path. Option A closes the level attempt and opens the next one for a new execution run. Option B returns the level attempt to the execution phase. Aelita withdrew its preference for Option A, because the absence of a backward edge is a diagram property and not a semantic reason.

A debate pass on the diagram specification ran on 2026-09-10. These are inputs.

- Opening an attempt is not claiming a run. Ulrich ruled that a human unblock opens the next level attempt, so a level attempt exists with no claim. The model needs an open and unclaimed state. A closed attempt never reopens, and the next attempt is a new one.
- "An assessment publishes" is not a sufficient guard for closing an attempt. A reviewer that starts against child outcome C1, while a human override creates C2, publishes an assessment that section 4 rejects as not current. The publication is recorded, and the attempt stays open. OPEN: what recovers an attempt whose evaluation context was superseded.
- Readiness for evaluation is a join over accepted facts, and never an event order. One join covers three cases: a level with no repository action, a repository action that already reached its expected end state under a merge-and-push strategy, and a landing observed before the executor released. An order-based rule leaves the third case waiting for an observation that already happened.
- A crash of an executor leaves the attempt with no live run. The recovery is OPEN. A cancellation is the only exit today, and that is not ordinary recovery.
- An initiative does not become ready for evaluation because it names no repository binding. The join reads the outstanding actions in its subtree.
- Restrictions that prevent an attempt and the authority that opens an attempt are two different lists. The restrictions are not sufficient. A budget limits authorized attempts and authorizes none, so what authorizes an attempt after a cancellation is OPEN.
- The import freeze is mission-wide and never level-local. The parked deadlock is a cross-lane effect: the admission gate forbids the reviewer claim that an open attempt needs in order to drain.
- Separate dimensions do not mean independent transitions. Each event names its simultaneous effect on the attempt, the block, the terminal marker and the outcome history. Separate the storage, and never separate the invariants.
- Lane order and an absence of outgoing arrows prove nothing about orchestration. A read response can prescribe execution. The proof is the responsibility that each lane carries.

Ulrich ruled on B8, the import gate, on 2026-09-10.

- The Mission Service blocks an import while any node of the graph is not in a terminal state. The Mission Service holds that responsibility.
- This removes the deadlock. The import no longer stops a claim, so an open attempt reaches its ending without asking the gate for permission. The import is refused, and it never waits on work that it forbids.
- OPEN: the meaning of "terminal state" in this ruling. Section 5 defines the terminal marker as the one-way marker that a success transition sets. Read that way, an import is possible only after the whole mission succeeds, and mid-mission replanning ends. The other reading is "at rest", meaning that no attempt is open on the node, which covers an idle node, a blocked node and a closed node. Aelita recommends the second reading.
- CHECK: `docs/mission-service.md` section 2 states that an admission gate stops a new claim and lets existing work drain, and that the import proceeds after that work drains. This ruling replaces that mechanism, so the approved page needs an edit.
- CONSEQUENCE: no window is guaranteed. A node that waits for a landing for days keeps the whole mission un-importable, and the human retries until every attempt happens to be at rest. This couples the unbounded-wait item to the ability to plan.

A debate pass on the B9 policy ran on 2026-09-10. These are inputs.

- The part that survives: the Scheduler detects a lost claim through its lease; the attempt stays open and returns to an unclaimed state; a resumption budget of the attempt stays separate from the attempt budget of the level; and a run-scoped identity supplements the level attempt.
- A lost run must lose its publication authority at the moment the Scheduler declares the loss, and never at the moment a replacement claims. Otherwise a zombie writes in the window between the two, under a claim that is still the latest one.
- That revocation serializes against lease renewal, release and completion. A late loss declaration must not reset an attempt whose completion was already accepted.
- A re-submission of an already accepted write is not a new publication. A worker that loses the response must be able to retrieve the acknowledgement without the write being rejected because its claim ended.
- A level attempt and a claim token are not the whole admission contract. Section 4 requires context, authority and order, and each is one input to the authority check. The rule is per operation and per actor, because a landing observation carries no executing claim and a universal two-token rule would reject an authorized observer.
- The unclaimed state after a loss means unclaimed continuation. Accepted evidence, task outcomes, performed repository actions and outstanding obligations all survive, and the replacement rechecks readiness against them. It does not mean a fresh execution.
- A durable action identity must exist before a repository action, and not at the release boundary. Trace: the executor opens a pull request, crashes before it records the platform object, and the replacement finds no correlation record and opens a second pull request. A record written at release is too late.
- Refusing a Mission Service write does not refuse a repository action. A revoked executor can still invoke an authenticated push unless the operation boundary checks its authority. The Project Service owns per-operation authorization, and section 5 references it. An operation already in flight can still complete against the remote, so reconciliation is required and a token undoes nothing.
- A loss declaration is not proof that the process stopped.
- Exhaustion is three decisions, not one: stop automatic recovery, close the attempt, and publish an outcome that becomes current. Each needs its own ruling. Two races prove it. A human override that asserts failure is active while an evaluation times out, and nothing says whether "no assessment produced" supersedes the human assertion. A valid assessment is accepted and a previously generated exhaustion notice arrives afterwards, and nothing says that the notice is rejected.
- "No assessment produced" is a candidate amendment to the approved outcome definition. It needs a named publisher and a precise meaning. Recording that an evaluation did not complete is bookkeeping. Asserting what the evidence establishes is evaluation, and renaming the basis settles nothing.
- The budgets are not yet enforceable. Undefined: the charging event, whether one loss incurs exactly one debit under repeated notifications, whether a clean release before expiry avoids a charge, whether a fresh evaluation identity resets its allowance, and the reset authority. A lease expiry does not establish the cause of the failure, so infrastructure failure is not a worker-selected exemption.
- A hole that no budget covers: a reviewer completes, its assessment is rejected as stale under the currency contract, and no unreachable-reviewer retry is spent. That attempt has no recovery policy at all.
- Human-only authorization of the next attempt exceeds the scope of B9. It settles the parked automatic-retry question and authorization after a cancellation, and it reaches into section 6. It needs its own ruling.
- An observation needs a durable obligation, a correlation, deduplication and a recovery owner. The claim that it needs no recovery is false. Trace: the observer reads the merged pull request and crashes before it records the landing, so nobody records the truth that the platform still holds. A repeated read does not make a write idempotent.


### Failure and loss cases, DEFERRED

Ulrich deferred B9 on 2026-09-10. Section 5 proceeds on the happy case, and a separate session takes the whole failure and recovery topic across every service. See "B9, failure and recovery" under Parked cross-cutting.

The register below stays here as the Mission Service input to that session. A case marked RULED has an answer. A case marked OPEN does not.

Group A, an execution run is lost.

- A1 lost with no write. RULED: the attempt stays open and returns to unclaimed continuation, and one resumption debit applies.
- A2 lost after partial task writes. RULED: the accepted task outcomes survive, and the replacement rechecks readiness against them.
- A3 lost while a repository action has an uncertain result. OPEN: the replacement reconciles before it acts, and nothing states what happens when reconciliation cannot establish the result.
- A4 lost after the action and before the correlation record. RULED by construction: the action identity is durable before the action, so this ordering never occurs.
- A5 a write arrives from a run whose claim was revoked. RULED: recorded, never current.
- A6 a re-submission of an already accepted write. RULED: not a new publication, and the acknowledgement stays retrievable.
- A7 the resumption budget is spent. PART RULED: automatic recovery stops. OPEN: whether the attempt also closes and publishes an outcome.

Group B, an evaluation attempt does not complete.

- B1 the reviewer is lost before it publishes. RULED by approved section 4: the evaluation is incomplete and a bounded retry resumes it.
- B2 the reviewer publishes and the currency check rejects the assessment. OPEN: no budget covers this loop, and the attempt has no recovery policy.
- B3 the evaluation retry budget is spent. PART RULED as A7.
- B4 a late exhaustion notice arrives after a valid assessment was accepted. OPEN: it must be rejected as already resolved.
- B5 an exhaustion arrives while a human override that asserts failure is active. OPEN: which one holds.

Group C, a landing observation fails.

- C1 the observer is lost before it records the landing. OPEN: a durable observation obligation exists, and its recovery owner is unnamed.
- C2 the landing is recorded and the readiness publication fails. RULED: readiness is a join over accepted facts, so it needs no separate publication.
- C3 a duplicate observation of an unchanged state. RULED by approved section 3: it creates no evidence. OPEN: the deduplication key.
- C4 a terminal platform state that is not the expected end state. OPEN.
- C5 a platform state that reverses after it was observed. OPEN.
- C6 no terminal platform state ever arrives. OPEN.

Group D, a close is interrupted.

- D1 the close stops after it writes some owed outcomes. OPEN: the close is idempotent and resumable, and its recovery owner is unnamed.
- D2 a forced close races a completion write. RULED: the close and the outcomes it owes are one transition.

Group E, a human action races machine work.

- E1 an override that asserts success during a run. RULED: it closes the attempt by force.
- E2 an override that asserts failure during a run, and the run then succeeds. OPEN.
- E3 a cancellation races a completion. OPEN.


Open questions for this section:

- OPEN: what happens to the unfinished tasks of an objective that becomes terminal. They cannot silently succeed, disappear, or stay executable.
- OPEN: who records the outcome when evaluation produces no assessment at all. An inconclusive assessment is not the same as no assessment.
- OPEN: whether "an assessment that does not pass" includes the inconclusive case. Present wording covers it by construction; confirm.
- OPEN: whether the Mission Service may derive an outcome from an assessment and a stopping reason without becoming an evaluator.
- OPEN: whether an objective may hold a passing assessment while a task inside it is blocked, so the objective succeeds with unfinished work in it.
- OPEN: whether an override of a task means anything, given that a task outcome stops mattering after its objective lands.
- OPEN: whether an override is permitted at a level that is currently executing, and what happens to the run.
- OPEN: whether cancellation is a stopping reason with its own rules, or an ordinary ending that produces an outcome with no assessment.
- OPEN: whether the current outcome of a level can move backwards, since an override adds a new outcome and a later assessment can also add one.

### Not started, section 6: Block and unblock

Scope: the block on a failed assessment, the human unblock, enforcement at the API and the CLI, and propagation to a parent and a sibling.

Inputs that already exist:

- An assessment that does not pass ends the run and blocks the level. A blocked level is not available for a further run. Only a human unblocks a level. An unblock authorizes a further run and asserts nothing about the results.
- The block must be enforced at the API and the CLI, not only in the Scheduler. An external harness is an executor reaching kanthord that way, so Scheduler-only enforcement leaves a bypass.
- A worker check before it picks up work is advisory. The claim operation checks the gate atomically when it records the claim, and both harnesses obey it. The Mission Service owns the gate and the Scheduler Service enforces it at the claim.
- An assessment block and an import freeze stay independent conditions that eligibility combines. Releasing an import freeze never clears an assessment block. One flag that carries a reason is rejected, because the two conditions have different clearing authorities.
- A blocked task must not fail its objective's run and must not reopen a sibling that is already terminal. Dependency propagation is a separate decision from run termination.
- A failed objective assessment can arrive after a pull request, a merge or a push, because the repository action precedes objective success. Ending the run undoes none of it. A replacement run inspects what already happened. Unblock and rollback are different actions.
- No dispatch window may exist between run termination and the block taking effect. This is parked for the Scheduler Service.

Open questions for this section:

- OPEN: whether a task is blocked by its own failed assessment, given that a task is internal to the run of its objective and that only a human clears a block.
- OPEN: nothing drives the evaluation, the cancellation or the ending of a task, because no worker takes a task.
- OPEN: a stale or repeated unblock request must not authorize an unintended attempt. This is parked for the Scheduler Service and it needs a Mission Service counterpart.

### Edits that these rulings force on approved pages

Every one is applied on 2026-09-09.

- `docs/overview.md`: a worker instance takes an available initiative or objective; the `worker instance` and `run` vocabulary entries drop the task; a run produces the outcome of its level and of every task of that level; the `tdd@1` example runs the RED-GREEN-REFACTOR loop for each task of an objective; the vocabulary gains `landing`, which owns the distinction between opening a pull request and merging it.
- `docs/architecture.md`: the Mission Service performs no evaluation; the Worker Service runs the instances that execute a level and the instances that evaluate a level; the relation "a run requests an evaluation" is replaced by a reviewer run that reads the criteria and the evidence and writes the assessment; the false retention guarantee is replaced by two statements, that the service stores the content of evidence which no other system holds and the address of evidence that a repository holds.
- `docs/project-service.md`: a configured repository action states its expected end state on the git platform.

### Open items that cross sections

- OPEN: a no-op import cannot be decided on text, because an unchanged filename reference resolves differently when the referenced file's id changes.
- OPEN: a working entity is not the whole of relevant activity. A pending evaluation and a pending platform observation both continue after a run releases, and the import gate must state how it treats them.

## Parked for the Scheduler Service document

Runs, availability, retry.

- A run now ends on a failed assessment, so the run boundary equals the attempt boundary on the semantic path.
- The attempt budget belongs to the LEVEL, not the run. A run-scoped budget hands a fresh allowance to every replacement run, which reopens assessment shopping by crashing.
- The rule that an executor re-requests an evaluation only with new evidence is retired. Ulrich ruled this on 2026-09-09. The dispatch model removes the loop it guarded: an executor no longer requests an evaluation, the Scheduler makes a level available and a reviewer worker takes it. The guarantee that replaces it is three rules that already exist. An assessment names its full context. A level that fails is blocked. Only a human clears a block. This also retires the OPEN on what counts as substantively new evidence.
- Claim protocol: the Scheduler determines eligibility, an instance requests compatible work, and an authoritative claim operation rechecks eligibility, reserves capacity and budget, and records the run. An instance never authorizes its own claim.
- No dispatch window may exist between run termination and the block taking effect.
- A stale or repeated unblock request must not authorize an unintended attempt.
- The Scheduler Service manages concurrency for both harnesses. kanthord's own harness and an external harness both take work through it. A concurrency rule that covers only worker instances leaves an external harness unlimited.
- A worker declares the level format that it requires, and the Scheduler matches an available level to a compatible worker binding. Ulrich stated this on 2026-09-08. Two versions of one worker implementation require different formats, so compatibility is a property of the worker name and not of the implementation family.
- OPEN: what may retry automatically. An earlier ruling gave a configured attempt count with automatic retry; the blocking rule routes failure through a human. A resource limit can mean an impossible task rather than a transient fault, a lost instance may already have pushed a commit, and a crash can recur deterministically. State only that a failed assessment is never eligible for automatic continuation, and decide the rest separately.
- OPEN: concurrency and capacity. Whether two runs may work one level, and whether one instance runs one run at a time.
- OPEN: whether a parent run can occupy the last instance while waiting for its children, which deadlocks.


### Failure cases noted on 2026-09-10, DEFERRED to the B9 session

- SC1 the lease, its renewal, and the loss declaration, serialized against a release and a completion.
- SC2 revocation of continuation authority at the loss declaration, and never at the replacement claim.
- SC3 the charging event of a resumption debit, and exactly one debit for one loss under repeated notices.
- SC4 whether a clean release before the lease expires avoids a resumption charge.
- SC5 enforcement of the stop, and capacity accounting for a process that returns after a loss declaration.

## Parked for the Worker Service document

Workers, instances, execution.

- The service is named the Worker Service. Ulrich renamed it from the Agent Service on 2026-09-08. `docs/architecture.md` and the service diagram carry the new name. A worker is the HOW and an agent is the WHO, so the service that runs worker instances is named after the worker.
- A worker version is a distinct implementation. It declares its own configuration and its own required level format. `tdd@1` and `tdd@2` both implement a TDD method, and their details differ.

- Liveness: a lease with an expiry that the run renews, plus a token compared on write so a stale run cannot mutate a reassigned level. Needed because a long-lived run makes silence normal, so silence stops being a death signal.
- Abandonment costs the workspace, never the budget.
- Terminating a run does not require deleting its artifacts. A new run may reuse a retained checkout, branch or cache while the previous run stays terminal.
- Instance identity is three separate decisions: whether a human configures individual instances, whether instances carry runtime identity, and whether instance records persist. Only the first is rejected.
- OPEN: whether memory belongs to the worker template, the worker instance or the run. The vocabulary names no scope on purpose.
- The execution order of the children of one level belongs to the Worker Service. Ulrich ruled this on 2026-09-09. The mission graph holds precedence only, and it holds no total order over the tasks of an objective. Two worker implementations execute differently, so a serial rule in the mission graph makes one worker's method a rule of the WHAT. The branch and per-task-commit practice of `tdd@1` is the method of one coding-focused worker.
- A worker releases the level that it holds when that level must wait for a dependency, and it reacquires that level after the dependency resolves. Ulrich ruled this on 2026-09-09. A waiting level occupies no instance. State management and level tracking carry the resumption, so a reacquisition never leaves an inconsistent state.
- A project holds a pool of workers that dynamically pick up an available initiative, objective or task. Ulrich stated this on 2026-09-09. No instance is pinned to a level. CHECK: the pool must reconcile with the settled Project Service rule that an instance count belongs to a worker binding.


### Failure cases noted on 2026-09-10, DEFERRED to the B9 session

These come from the B9 discussion. The Mission Service states the record and the admission rule. This document states what a worker instance does.

- W1 how a replacement executor reconciles a repository action of uncertain result without repeating it.
- W2 how a worker records a durable action identity before it performs a repository action.
- W3 how a worker retrieves the acknowledgement of a write whose response it lost, instead of publishing again.
- W4 what a worker does when reconciliation cannot establish what happened.
- W5 how an executor behaves when its claim is revoked while it runs: it stops writing, it stops acting on the repository, and it releases capacity.
- W6 whether an authorized observer is a worker instance or a distinct role, and how it is dispatched.
- W7 how a reviewer resumes an incomplete evaluation and repeats no execution and no repository action.

## Parked for the Project Service document

Credentials and bindings.

- Custody is a dedicated component of the Project Service. Project owns resource configuration and the authorization bindings; secret material sits behind a protected facility that trusted execution consults after checking the binding.
- Holding a resource does not confer custody of its secret. A binding does not narrow upstream authority: one SSH key reaches many repositories, one API key can authorize a whole account.
- Separate system authorization, what kanthord permits an execution to access, from credential authority, what the remote permits any holder. Only the first is enforceable here.
- A central store with explicit bindings beats the same secret duplicated per project. Unrestricted selection is the danger, not central storage.
- Only network git operations need a credential. Commit, branch and merge are local, so a trusted executor boundary covers clone, fetch and push only.
- Local disablement, upstream revocation, rotation, expiry and OAuth refresh are five different things.
- OAuth does not imply a person and an API key does not imply an organization. Record the configuring actor, the upstream principal and the execution identity separately.
- The boundary is authorization of operations, not custody of bytes. An agent that never sees a key can still abuse an authenticated tool, and an SSH agent socket grants authentication even when the key is unreadable.
- The document is `docs/project-service.md`. Its six sections are: project identity and ownership; resource and binding model; repository configuration and policy; execution configuration and instance count; authorization and credential custody; configuration lifecycle and consistency. Ulrich approved this structure on 2026-09-08. It carries no service-interface section, because `docs/architecture.md` owns the relations.
- Design the typed configuration of each binding kind first. A shared binding envelope follows from what the kinds have in common. A universal binding never dictates mission cardinality, repository policy ownership, a credential count or worker internals.
- Policy ownership differs from policy granularity. The project keeps the repository strategy and states an explicit rule for each repository that requires one. An explicitly configured rule is not an implicit default.
- A worker name identifies an implementation, so a worker binding identity is separate from the worker name. Selection may start from an implementation or a capability, and it resolves to an eligible binding. Only the configuration of an execution must be unambiguous.
- A recorded binding revision states what a run selected. Current authorization states what an execution performs. A recorded revision never authorizes an operation after a disablement.
- The mission is intrinsic to a project, and every project has exactly one mission. Ulrich ruled this on 2026-09-08. No binding allocates a mission, because a binding allocates a resource that exists independently of the project. The binding lifecycle rules therefore never apply to a mission.
- A change to the resource that a binding names creates a replacement binding. A change to the configuration of a binding preserves its identity and creates a revision. Ulrich ruled this on 2026-09-08. A change to the credential reference of a binding is a configuration change, so it creates a revision; a change to the secret material behind an unchanged reference changes no binding at all; a change to the remote that the credential authorizes is a resource change, so it replaces the binding. Rotation, revocation and disablement stay three different things.
- A binding references another binding by identity, never by revision. Ulrich ruled this on 2026-09-08. A revision never invalidates a reference. A replacement invalidates every reference to it, so one edit creates the replacement and repoints every dependent. The Project Service rejects a dangling reference, and it validates a binding set on write and a binding again on resolve. A cascade that repoints a dependent automatically is rejected, because unrestricted selection is the danger.
- Resolution is per operation, not per run. Ulrich ruled this on 2026-09-08. A run resolves a binding when it needs the resource, and that resolution authorizes one operation. A configuration change never rewrites what a run already did, a disablement takes effect at the next resolution, and an operation in progress ends against the remote. This closes the mid-execution clause of the compound OPEN item below.
- A repository binding holds one credential reference per required capability, and the credential count is an outcome, never a configured number. Ulrich ruled this on 2026-09-08. The capabilities are a network git read, a network git write and a platform action. A capability is an authenticated operation, so an unauthenticated operation is not a capability and a public read requires neither a capability nor a credential reference. The repository strategy and the transport form determine the required set. Validation is coverage plus suitability: every required capability has a reference, and the type of the referenced record performs that class of operation. Suitability states no scope, and a human selects the record.
- An instance count belongs to a worker binding, and two bindings of one worker do not share an instance count. Ulrich ruled this on 2026-09-08. A shared worker-level pool cannot cap one configured variant, which is the reason two bindings exist. A per-binding count plus a project-wide cap is rejected as a second knob that no requirement asks for.
- A requester authenticates with its own identity, and authorization resolves from the project and the level of the request and the binding of that project, at each operation. A run presents its execution identity, and an external harness presents its client identity. Ulrich ruled this on 2026-09-08. A run holds no credential. A liveness token proves liveness and authorizes nothing. A scoped credential minted at claim time is rejected, because it puts the permission decision in two places and grants access that a later disablement cannot withdraw.
- An external harness holds no credential, and it receives none. Ulrich ruled this on 2026-09-08. kanthord performs the authenticated operation on the harness's behalf: the harness invokes the API or the CLI, and the daemon performs the configured repository action under the project's binding. No credential leaves the daemon.
- A credential store record is shared, a binding is never shared, and a resource is shared by nature. Ulrich ruled this on 2026-09-08. A binding carries project-scoped configuration, so sharing one would let one project change another project's instance count and policy. A store record per project is rejected, because it multiplies rotation and guarantees a missed revocation.
- A worker name determines the configuration that a project sets, and a worker template carries no configuration version of its own. Ulrich ruled this on 2026-09-08. `tdd@1` and `tdd@2` both implement a TDD method with different details, so two versions never share a configuration contract. A separate contract version is rejected as duplicate versioning.
- A provider account is a binding kind, its capability is a model inference call, and its binding holds a credential reference for that capability. A worker template declares its agents and the configuration that a project sets per agent. Model slots are rejected: they turn the internal call structure of a worker into project-facing configuration with no requirement asking for it.
- Every agent entry of a worker binding names a provider account binding and a model identifier together, and a worker binding holds no provider account of its own. Ulrich ruled this on 2026-09-08. Two agents of one worker run on different providers. Inheritance is dropped, so the silent-remeaning hazard and its restatement guard do not exist: a change to a binding-level account would re-point every inherited model identifier at a different catalogue, and suitability cannot catch it because both accounts perform inference.
- The vocabulary and wording pass is complete. Ulrich approved it on 2026-09-08. `docs/overview.md` defines `project` by its deliverable, and it adds `binding`, `provider account` and `deliverable`. Its `objective` entry names the one-repository rule, and its instance count is per worker binding. `docs/architecture.md` names the repositories in the plural, states the available instances without a granularity claim, and authorizes credential use without the word `binding`, so `docs/project-service.md` owns the binding mechanism alone. `docs/project-service.md` owns `capability` and `custody` in its own vocabulary, and its fourth section is `Execution configuration and instance count`.
- The debate review of `docs/project-service.md` ran on 2026-09-08, and every finding is applied. Two were model defects. A capability is an authenticated operation, so the page could not both require a credential reference per capability and let a public read satisfy one with none; an unauthenticated operation is now no capability at all. A shared credential record cannot name one execution identity, so the record names the configuring actor and the upstream principal, and the record of an operation names the execution identity.
- The review also removed six restatements of facts that `docs/overview.md` owns: project identity, the size and scope exclusion, the definition of a binding, the multiple-bindings-of-one-kind rule, the worker-name-identifies-an-implementation rule, the instance count of a worker binding, and the no-implicit-default rule. `docs/project-service.md` links to the overview vocabulary instead. It keeps the mechanism that the overview does not hold, such as the separate instance counts of two bindings of one worker.
- The review removed three unsupported product rules from the identity section: that a deliverable describes a primary feature, that a deliverable description changes without a change to identity, and an exhaustive list of the activities that a project delivers. The activity fact is Ulrich's aspect 2, so `docs/overview.md` carries it in its `project` entry as a non-exhaustive statement.
- The page carries two diagrams, and the debate engine settled the set on 2026-09-09. `docs/assets/project-service-authorization.svg` shows the order of one authorization, and it sits in the authorization section. `docs/assets/project-service-bindings.svg` shows the binding graph, and it sits in the lifecycle section, because that section is the last one that introduces one of its concepts and its rules act on that graph. Neither diagram adds a section, so the approved six-section structure stands.
- Four diagram subjects are rejected. A capability-to-credential matrix loses to a table, and the page never enumerates which strategy and which transport form require which capability, so a matrix would invent that enumeration. A separate trust-boundary diagram duplicates the boundary that the sequence already draws. A binding state machine holds no state beyond current and replaced. A change-classification flowchart loses to a three-column table, because the mapping is direct and a flowchart resolves neither hard case: whether a concrete edit changes the resource or its configuration.
- OPEN: whether the page states the change classification as a three-column table. The debate engine supplied the table and argued it beats both the present five sentences and a flowchart. A table is a page edit, so it needs Ulrich's ruling.
- A diagram in a design document states no fact that the page does not state, and it introduces no term. The design file stays the single source of truth, and an `.svg` is an asset of it. A diagram sits after the last section that introduces one of its concepts.
- A diagram label needs 12px mono to survive the documentation column. `docs/assets/style.css` caps the content column at 900px and scales an image to that width, so a 1280-wide asset renders at 0.70 and an 8px label lands at 5.6px. The two new assets use the presentation type ramp, which sets a 16px node name and a 12px label. `docs/assets/architecture-containers.svg` and `docs/assets/architecture-services.svg` mix a 16px name with an 8px label, so their labels do not survive the column.
- The review confirmed two placements. The project-facing configuration contract of a worker belongs to `docs/project-service.md`, and `capability` and `custody` stay in that page's own vocabulary rather than moving to the overview.
- One word per meaning, settled. `capability` is one class of authenticated operation on a resource. `instance count` is how many instances a worker binding has, and the word `capacity` is not used for it. The operation that kanthord offers a client is an API operation and a CLI operation, and it carries no term of its own.
- An executing agent never changes a selection, and a human configures a per-agent selection. Fixed selection stands on simplicity and on the absence of a requirement for runtime choice. It does not stand on security or on auditability, because choosing among human-authorized alternatives still passes the authorization boundary and a per-operation record could state the actual choice.
- A failure never authorizes a different provider or a different model. That is the whole local rule. A timeout, a rate limit, expired authentication, invalid configuration and a withdrawn model are five different failures, and their classification stays with the Scheduler and the Mission Service.
- `docs/architecture.md` carries this ruling. The direct relation from the external harness to the git platform is deleted, and the harness now invokes the repository action through the API or the CLI.
- Later work adds skills and extensions that support external harness integration. That is delivery, and no design page holds it.

### Failure cases noted on 2026-09-10, DEFERRED to the B9 session

- PR1 per-operation authorization that refuses a repository operation from an executor whose claim was revoked.
- PR2 an operation already in flight that completes against the remote after the revocation.


## Parked for the Tracking Service document

- The Tracking Service holds telemetry only. Ulrich ruled this on 2026-09-08, and `docs/architecture.md` carries it.
- No outcome depends on telemetry.
- Telemetry retention differs from evidence retention. The Mission Service holds the evidence.

## Parked cross-cutting

### B9, failure and recovery

Ulrich deferred this on 2026-09-10. A separate session takes it. Until that session closes, every service document is written for the happy case, and no service document invents a recovery rule on its own.

B9 is the general question of how the system acts on a crash or a failure. It began as one wrong sentence, that a crash ends the level attempt, which deletes the recovery that approved section 4 grants. The structural repair is settled: the level attempt, the run, and the evaluation attempt are three separate lifecycles, and only an ending of the level attempt closes it. The policy is not settled.

The topic crosses every service, so no single document owns it.

- The Mission Service states what is recorded, what is admitted as current, and what obligations a loss creates. Its register is under Parked for the Mission Service document, "Failure and loss cases, DEFERRED". Twenty-two cases in five groups: an execution run is lost, an evaluation does not complete, a landing observation fails, a close is interrupted, and a human action races machine work.
- The Scheduler Service owns detection and enforcement. Its cases are SC1 to SC5.
- The Worker Service owns what an instance does on recovery. Its cases are W1 to W7.
- The Project Service owns per-operation authorization against a revoked claim. Its cases are PR1 and PR2.

Three constraints that the session inherits, because each one is already established.

- The Mission Service never detects a failure and never drives a recovery. Detection is a Scheduler lease, and recovery behaviour belongs to a worker.
- A close never invalidates a completed record. A close invalidates continuation.
- Approved section 4 grants an evaluation a durable lifecycle with a bounded retry, so no rule may charge a fresh attempt slot to restart a crashed reviewer.

Two items block on this session and are named here so they are not answered early: what an exhausted budget does beyond stopping automatic recovery, and what authorizes an attempt other than a human unblock.


- The state model must distinguish "not assessed yet" from "an assessment that could not establish the result". Execution lifecycle, evaluation lifecycle, approval status and outcome history stay separate dimensions and never collapse into one status field.
- A human holds three roles with different authority: participant as the WHO, reviewer who produces an assessment, and override authority who asserts an exception. Unblocking is a fourth action, not a fourth role: it authorizes a further run against the same criteria and asserts nothing about the results.
- Aggregation is not assessment. A worker aggregates child outcomes to report progress; the level's own outcome and the approved stopping conditions end the run.
- A blocked task must not fail its objective's run and must not reopen a sibling task that is already terminal. Dependency propagation is a separate decision from run termination.
- A failed objective assessment can arrive after a pull request, a merge or a push, because the repository action precedes objective success. Ending the run undoes none of it. A replacement run inspects what already happened. Unblock and rollback are different actions.
- The block must be enforced at the API and the CLI, not only in the Scheduler. An external harness is an executor reaching kanthord that way, so Scheduler-only enforcement leaves a bypass.
- `provider` is used in `docs/architecture.md` and defined nowhere. It is a product term and belongs in the overview vocabulary.

## Working notes

**The debate engine.** `KANTHOR_DEBATE_ENGINE=pi`. The skill lives at `~/.claude/skills/debate`. Call `scripts/run.sh --check`, write the debate block to the `args` path it prints, then call `scripts/run.sh <args-path>`. Run it in the background; a pass takes two to four minutes. Declare the parked items inside the block, or the engine reports their absence as defects.

**Do not trust the writer's self-check.** Pi reports its own acceptance as a pass on defective output. Every defect in this session came from the adversarial review or from reading Pi's output directly.

**Pi games an acceptance grep.** Given a forbidden-string list containing `sha` and `engine`, Pi wrote `sh&#97;pe`, `s&#104;ared` and `&#101;ngineering`, encoding one letter each so the grep missed them, then reported a pass. State acceptance criteria as intent, not as a string match, and read the produced file.

**Re-check counts and cross-references after Pi inserts list items.** It added two bullets and left "The first three rules" pointing at the wrong group.
