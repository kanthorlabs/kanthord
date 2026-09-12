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

- Project comes first. A project names the mission that it ships. A project configures the instance counts that the Scheduler reserves against. A project holds the repository strategy that an execution follows. Three of the other four services read Project first.
- Mission comes before Scheduler. The Scheduler never makes a blocked node available, and the block belongs to Mission.
- Scheduler comes before Worker. The claim protocol carries the lease and the instance identity that the Worker Service specifies.
- Tracking comes last. It holds telemetry only, and no outcome depends on telemetry.

A document is drafted in this order. A document is not closed before a review against the parked material of the services after it. Two individually correct documents can still leave a race between them.

## State

`docs/overview.md`, `docs/architecture.md`, `docs/project-service.md` and `docs/mission-service.md` are written and reviewed. The Project Service holds no open design item. `docs/mission-service.md` holds sections 1 to 6, and the design set is complete. A debate review ran on sections 1 to 4 on 2026-09-09 and every finding is applied.

Section 6, Block and unblock, is written on 2026-09-11. It states the block, the human block, the unblock, the enforcement and the read of the blocked nodes of a mission. The rulings of that day widen the criteria revision into the node revision, which versions the whole content of a node, make the unblock one atomic act that names the attempt it clears and the revision it expects, and add the external object, which represents one requested external action and which no rule of the Mission Service reads. The register below holds every ruling, and two items of the successful-outcome rule stay open.

Section 5, Outcome and completion, is written on 2026-09-10, and it holds no open design item. One forced edit stays open, and the register below names it. It states the twelve states of a node, the 48 transitions with the effect of each one on the attempt and the record that it writes, the attempt model whose counter reads 0 before the first claim, the readiness condition of a reviewer claim, the successful outcome, the outcome record with its two bases, the task-outcome obligation, the synchronisation of a node state with an external request, the resume precedence of a paused node, and the boundary of the section. Two mermaid diagrams carry the internal case and the external segment.

The same day settled the import gate and the write paths. An import creates, updates and deletes a node whose state is `Pending` or `Available` and whose attempt counter reads 0. The condition of a task is the condition of its objective. The Mission Service terminates an import that fails the condition, under a transaction and a lock, and that import produces no effect. The node API is the second write path, it carries the human override authority, it updates a node that holds an attempt, it deletes no such node, and it edits no terminal node.

Every edit that these rulings force is applied. `docs/mission-service.md` carries the order of the evaluation and the external request, the repaired authority check of currency, the repaired readiness condition and the two write paths. `docs/overview.md` carries the widened basis of an outcome and the repaired execution-ending causes. `docs/mission-service.vocabulary.md` and `docs/overview.vocabulary.md` match their pages.

O4 is closed, and the B8 import gate is superseded by the per-node condition. The register below keeps every ruling of 2026-09-10 as the record of how each rule reached the page.

`docs/index.html` links the Architecture page and the Project Service page. `docs/viewer.html` carries an editor reformat that Aelita did not make and did not review. Ulrich replaced the mermaid container diagram with `docs/assets/architecture-containers.svg` and added `docs/assets/architecture-services.svg`. Aelita added `docs/assets/project-service-authorization.svg` and `docs/assets/project-service-bindings.svg` on 2026-09-09.

## Settled and already in the documents

- A service is a logical part of one process. A service boundary separates authority and never describes a deployment.
- A worker is a template. A worker name has the form `<implementation>@<version>`, so the same name always identifies the same implementation. A project configures which workers are available and how many instances of each. An instance executes an available node and produces an execution object that represents the state of the work that it holds.
- A mission is the whole work of one project. A project has one mission. The Mission Service holds it and represents it as a graph.
- The Mission Service performs no evaluation. Ulrich ruled this on 2026-09-09. It holds the criteria, the evidence, the assessment and the outcome records, and it is the record authority. A worker performs the evaluation. `reviewer@1` is a worker whose method is evaluation, in the same way that `tdd@1` is a worker whose method is coding. Every write of a criterion, an assessment and an outcome still passes through the Mission Service.
- The separation is therefore separation of duties, and it is not independent verification. The worker that executes a node's steps never writes the assessment of that node. A reviewer worker writes it. The Mission Service supplies the criteria and the evidence, so the executing worker never chooses the reviewer and never shapes its instructions.
- CHECK: `docs/architecture.md` says the Mission Service performs the evaluation of every node, and it lists the relation where an execution requests an evaluation from the Mission Service. Both need an edit.
- A reviewer worker is a worker binding of the project, so the project configures its agents, its provider accounts, its models and its instance count exactly as it does for any worker.
- An evaluation is work that the Scheduler dispatches. Ulrich ruled this on 2026-09-09. A node that needs evaluation becomes available, and a reviewer worker instance takes it through the same claim protocol as every other execution. The Mission Service records and never orchestrates. A landing observation makes the objective available for review, so no execution has to ask.
- `reviewer@1` takes an objective and an initiative only, because those are the dispatchable units. Ulrich ruled this on 2026-09-09. It never takes a task, in the same way that no other worker takes a task.
- Therefore a task assessment is written by the execution of its objective, and separation of duties does not exist at task node. The rule that an executor never writes the assessment of the node whose steps it executes applies to an objective and to an initiative. The independent review happens at the node whose outcome persists, because after the objective lands its outcome represents the outcomes of all its tasks.
- OPEN: whether a task is blocked by its own failed assessment, given that a task is internal to the execution of its objective and that only a human clears a block. This belongs to the block section.
- The evaluation method follows the criterion and never the node. Each node carries its own criteria, which is a separate statement.
- An external harness is an executor, and it reaches kanthord as a client through the API or the CLI.
- A terminal state never reopens and never repeats. A human override adds a new outcome and never restarts a terminal execution.
- An assessment that does not pass ends the execution and blocks the node. A blocked node is not available for a further execution. Only a human unblocks a node. An unblock authorizes a further execution and asserts nothing about the results.
- An execution of an objective performs the configured repository action before a successful outcome of that objective.
- An objective belongs to exactly one repository. Ulrich ruled this on 2026-09-08. A project binds more than one repository, and each objective names one repository binding. No objective performs a required action on two repositories, so partial completion across repositories does not exist. This voids the earlier multi-repository partial-failure question.
- The Project Service holds the credentials that a project's resources require, and it authorizes their use. `docs/architecture.md` states that responsibility, and `docs/project-service.md` owns the binding mechanism. No credential enters evidence or telemetry.

## Parked for the Mission Service document

### Vocabulary of this component

Ulrich settled this on 2026-09-10, after a debate pass. The decision is the wording only, and it carries no lifecycle, budget or responsibility rule.

- `attempt` is the noun for one try at a node. Write `node attempt` wherever `evaluation attempt` appears nearby, because the two are different objects and one can end while the other stays open. `attempt` alone is the shorthand.
- `attempt counter` is the per-node ordinal that names which node attempt a record belongs to. It names an attempt and it settles nothing else. It never decides which outcome is current, because section 4 owns currency, and it never separates two claims inside one node attempt.
- Provenance: this session first called the object a `fence value`, then a `generation`. Both names are retired. A ruling recorded here in the older wording is the same ruling; only the word changed. The move from `fence value` to `generation` was a rename, and the move to `attempt` followed a real broadening of the concept, from a counter on a node to one try that spans many executions.
- `raise` is retired as a verb over this object, because it hid the difference between an open and a close.
- OPEN: `docs/overview.md` owns the product vocabulary and holds no `attempt` entry, although approved section 2 already uses the word. Whether the overview gains the entry is a separate decision, and it is not part of this wording change.


The document is `docs/mission-service.md`. Its six sections are:

1. Mission structure and nodes
2. Validation criteria and authority
3. Evidence
4. Evaluation and assessment
5. Outcome and completion
6. Block and unblock

Ulrich approved this structure on 2026-09-09. Every section is discussed, debated, settled and written.

### Settled, section 1: Mission structure and nodes

- The mission is a directed graph. A node is an initiative, an objective or a task. Containment and dependency are the two edge kinds.
- Every task belongs to exactly one objective. Every objective belongs to exactly one initiative. An initiative is a root. A node with no child is permitted, and the page states no rule about it.
- A dependency relates an initiative or an objective, in any combination of the two. A task carries no dependency edge, because a task is too small to measure and it is a unit of execution inside a worker. A task is a node of the WHAT and it is never a unit of scheduling.
- A dependency carries a kind. A start dependency makes the dependent unavailable until the node it names holds a current successful outcome. A landing dependency leaves the dependent available at once, and every repository action in the dependent's subtree waits until the node it names lands.
- Preparation, local validation and the successful outcome of a task proceed while a landing dependency waits. Waiting on a landing dependency is never an assessment that does not pass.
- A landing dependency gates an operation, and enforcement happens when that operation is requested, on both harnesses.
- A node waits for the nodes that its own dependencies name, and for the nodes that the dependencies of its ancestors name.
- A dependency from A to B means every node in the subtree of A waits for every node in the subtree of B. The Mission Service rejects a write whose closure over both kinds holds a cycle. It rejects it when a write constructs the graph and when a write updates it.
- A containment edge alone can never form a cycle, because containment descends a rank and dependency stays inside a rank. A cycle across the two dependency kinds is real: A starts after B, B lands after A.
- A dependency is satisfied by a current successful outcome, including one that a human override asserts. A success edge establishes only what the prerequisite's own criteria establish.
- A node with an unsatisfied dependency is not available. It is not blocked. Unavailability follows the graph, and a block follows an assessment.
- A node lands when the expected end state of every configured repository action in its subtree is observed on the git platform. Opening a pull request is not landing; the merge of that pull request is. A dependent releases on the observed state, never on the completion of the local action.
- Observing that state is a platform action, so it uses the credential of a repository binding.
- An objective names exactly one repository binding of its project. An initiative and a task name none. A task acts on the repository that its objective names. Two objectives name the same binding or different bindings.
- An execution of an initiative derives its repositories from the objectives of that initiative. One initiative holds work in many repositories. No rule restricts the repository binding that a node names, because the project already bound every repository that the work may touch.
- The mission holds no branch, no merge and no repository action. The repository strategy of the project holds them. The mission supplies the grouping that a strategy uses, and that grouping is an input to the strategy, not the strategy.
- The rank of a node never determines the evaluation method. The correlation between a rank and a kind of check follows the scope of the node, and the page states no rank-to-method table.
- A worker takes an initiative and it takes an objective. It never takes a task. An initiative outcome mostly needs a human judgement, a model judgement or an e2e test, and the last two need a worker to execute them.
- The execution order of the children of one node belongs to the Worker Service. The mission holds precedence only, and it holds no total order over the tasks of an objective.

### Settled, section 2: Validation criteria and authority

- Planning happens outside kanthord. A human plans the initiatives, objectives and tasks in markdown, and decides what is tested and what command verifies it. A human then imports them into the Mission Service. This holds until a planning service exists.
- No execution creates a node and no execution writes a criterion. The import is the only write path for the structure and the criteria. This voids the earlier proposal that an execution of an ancestor creates a node.
- Execution authority never confers planning authority. An execution identity never authorizes an import, whatever node the import names.
- The Mission Service owns what an import carries, and it owns no syntax. Markdown is the medium that a human writes a plan in, and the CLI converts a plan into an import. The Mission Service writes no plan file.
- The import is snapshot reconciliation. The import set is authoritative. A plan file that carries no id creates a node, a file that carries an id updates that node, and a missing file retires its node.
- A dependency is named by a plan filename with no path, and the import resolves that name inside the import set. A filename is unique inside the import set. No cross-import alternate key is needed, because the set is complete.
- An import is atomic, and validation judges the resulting graph. Deleting a node and removing its inbound references in one import is valid.
- The import guards: an explicit scope, an expected mission revision that rejects a stale snapshot, a preview that confirms every retirement, and atomic validation.
- Identity assignment is recoverable and a retry is idempotent. An import request key binds to its payload, and the assigned id mapping stays retrievable. The Mission Service rejects an unknown id, a duplicate id, and an id from another mission.
- A retirement removes executable work and preserves the outcomes, the assessments, the evidence and the historical relations of the node.
- A substantive update of a node in a terminal state returns an error. A no-op import of that node does not.
- The Mission Service rejects an import while an entity of the mission is working. A per-node rule is insufficient, because an import of an idle child changes the evaluation context of an active parent, and a dependency edit changes another node's eligibility without touching it. An admission gate stops new claims and lets existing work drain, so an import is never blocked forever.
- A criteria change preserves the identity of the node and creates a criteria revision.
- An attempt pins to the criteria revision that it claimed under. An import never retargets an attempt that is already active.
- A criteria revision never reopens a node that holds a successful outcome. The success stands under the revision that established it. An import is never an implicit unblock and never an implicit reopen.
- Attribution, authorship and integrity are three claims. An import records the actor that submitted it. That establishes no authorship and no approval of the content. A criterion that states a human wrote it is a claim, not proof.
- A verification command belongs to the WHAT and arrives by import. The files that the command reads belong to the repository and stay mutable. Protection is attribution plus a judgement criterion, never a protected-path list.
- An exit status of zero proves that one command exited zero. It proves nothing about test adequacy, about coverage or about a suppressed failure.

### Settled, section 3: Evidence

- The Mission Service holds the evidence record. The Tracking Service holds no evidence, and no outcome depends on telemetry. No credential enters evidence.
- An evidence record carries a content address, a subject, a provenance and a scope. A digest establishes the identity of the accepted bytes, and it never establishes the truth of what they claim. Two executions with identical output are not the same observation.
- A commit hash is the preferred address for work that a repository holds, and it is never required. A SHA-256 hash addresses content that no repository holds. The design stays generic, because a project delivers research work, planning work and coordination work as well as coding work.
- Addressed prose is evidence. A research report and a judgement rationale qualify, and evaluation decides their strength. A claim with no addressed content is not evidence.
- The Mission Service stores the content of produced evidence, because nothing else does. It stores the address of repository evidence.
- Evidence durability is tiered by node. A task commit has meaning only while a worker instance executes its objective, and it is an internal check. After the objective lands, the objective outcome represents the outcomes of all its tasks, so the system guarantees no further resolution of task evidence. An initiative behaves the same way, and an initiative still points at an objective commit. The evidence that must resolve is the landed state, which stays reachable.
- The evidence of a node is a set of items, and it holds one item most of the time.
- A pull request that is open is not done, so the evaluation of an objective happens after the landing observation. That observation retrieves the squash merge commit and appends it to the evidence set. Merge skew is closed by evidence, not by a mechanism: the set names the tested snapshot and the landed snapshot, and the criteria decide what each one must establish.
- A landing record names the repository action, the expected end state, the platform object, the observed state, the observation time and the commit identities.
- A landing observation needs an explicit authorized observer, because it happens after the execution released. The architecture says an execution writes evidence; it never says only an execution may.
- An execution submits evidence for its own node and for the tasks of that node, under a valid execution identity. A late submission never becomes current merely because it arrives last.
- A machine check binds its result to the snapshot it ran against and to the pinned criterion revision. Naming a snapshot does not prove the check used it, so the binding is recorded as an executor assertion unless a clean isolated checkout establishes it. An executor report is attributable evidence and it is not an independently verified check.
- Evidence is append-only. Redaction happens before the artifact is addressed, and the record discloses that it is a transformed view. One exceptional path removes contaminated content. Ingestion is bounded, overflow is defined, and nothing is silently truncated.
- Unassessed, rejected and abandoned evidence carries its own bounded retention. Outcome-dependent retention is transitive and it includes the evidence supporting the child outcomes that an assessment weighed.
- A correction names what it corrects. Re-hashing unchanged content never counts as new evidence.

### Settled, section 4: Evaluation and assessment

- The Mission Service performs no evaluation. It holds the criteria, the evidence, the assessment and the outcome records, and it is the record authority. Every write of a criterion, an assessment and an outcome passes through it.
- A worker performs the evaluation. `reviewer@1` is a worker whose method is evaluation, in the same way that `tdd@1` is a worker whose method is coding.
- `reviewer@1` takes an objective and an initiative only, because those are the dispatchable units. It never takes a task.
- An evaluation is work that the Scheduler dispatches. A node that needs evaluation becomes available, and a reviewer worker instance takes it through the same claim protocol as every other execution. A landing observation makes the objective available for review, so no execution has to ask.
- A reviewer worker is a worker binding of the project, so the project configures its agents, its provider accounts, its models and its instance count exactly as it does for any worker.
- The separation is separation of duties, and it is not independent verification. The worker that executes a node's steps never writes the assessment of that node. The Mission Service supplies the criteria and the evidence, so the executing worker never chooses the reviewer and never shapes its instructions.
- A task assessment is written by the execution of its objective, so separation of duties does not exist at task node. The independent review sits at the node whose outcome persists.
- The evaluator's scope differs by node while its method follows the criterion. An objective evaluation also weighs the child outcomes and the landing.
- A model judgement transcript is evidence of that invocation, not an assessment. The boundary is authority, not file format.
- An assessment names the evidence set, the criteria revision, the immutable child outcome records it weighed, the method it applied and the actor that performed it.
- Currency needs three separate checks. Context asks whether the assessment matches the relevant evidence, criteria, structure and selected child outcomes. Authority asks whether the assessment may still affect current state, given an intervening block, unblock, cancellation or human override. Order picks the latest among those admitted. Record order answers the third question only.
- A changed child outcome invalidates the currency of an affected parent assessment. Invalidation alone never queues a retry and never reopens terminal success.
- Assessments accumulate and are never overwritten. An assessment that names a superseded context is never current and is never deleted.
- Evaluation has its own durable lifecycle, independent of execution. An unreachable delegate means the evaluation did not complete, which differs from evidence that cannot establish a result. A bounded retry resumes the evaluation, and it never repeats execution or a repository action.
- The rule that an executor re-requests an evaluation only with new evidence is retired. The dispatch model removes the loop it guarded. The guarantee that replaces it: an assessment names its full context, a node that fails is blocked, and only a human clears a block.

### Written, section 5: Outcome and completion

Scope: the three separate completion rules, the inconclusive case, the human override, and the terminal state.

Inputs that already exist:

- Completion is three separate rules. An ending requires an outcome, including one that cannot establish the result. A claim of success requires a passing assessment that names the evidence the outcome carries. A human bypass uses the override. One rule cannot both authorize success and record a failure.
- The outcome records the stopping reason separately from the assessment of evidence.
- Only a human overrides an outcome. An override produces a new outcome that carries the human assertion, and the previous outcome is kept as a reference. A terminal state never reopens and never repeats. An override never restarts a terminal execution.
- The state model distinguishes "not assessed yet", "an assessment that could not establish the result" and "evaluation did not complete". Execution lifecycle, evaluation lifecycle, block state and outcome history stay separate dimensions and never collapse into one status field.
- A human holds three roles with different authority: participant as the WHO, reviewer who produces an assessment, and override authority. Unblocking is a fourth action, not a fourth role.
- Aggregation is not assessment. A worker aggregates child outcomes to report progress.
- Completing the configured repository action, completing all tasks, and achieving the objective are three different conditions.
- An outcome is produced while no execution is in flight, because the landing observation and the reviewer execution both act after the execution that performs the node's steps released.
- After an objective lands, its outcome represents the outcomes of all its tasks.

A debate pass ran on a draft of this section on 2026-09-09. Ulrich did not rule on it, so every item below is an input, not a decision:

- Terminality must not be reversible. A human override that asserts failure on a successfully completed node would remove its current successful outcome, and a completion rule that reads the current outcome would then call the node not complete. A terminal marker is therefore separate from the current outcome: a permitted success transition makes a node terminal, a later override corrects the recorded result, and that correction never restores execution eligibility.
- A terminal execution and a terminal node are different. A failed execution never resumes, and its blocked node may receive a new execution after a human unblock.
- An evaluation attempt that ends without an assessment does not establish that the node ended. A transient reviewer outage must not displace a valid assessment or a human override. Three events stay separate: an evaluation attempt ends with no assessment, an execution that performs the node's steps ends and owes an outcome, and a node reaches terminal closure.
- An outcome carries an explicit basis: an assessment, a human override, or no assessment produced. The third basis extends the outcome definition in `docs/overview.md`, which names an assessment or a human assertion only. One nullable assessment reference must not mean pending, failed and bypassed at once.
- Not blocked by an assessment does not mean eligible for execution. A pending evaluation, a pending landing, an exhausted budget and an import freeze each prevent work on their own.
- The Mission Service is not an evaluator because of its authority boundary, and not because its rule is deterministic. It validates who may publish an assessment, which node and context it concerns, whether it may still affect current state, and which transition follows. It never infers a passing verdict from raw evidence, from child outcomes or from a stopping reason. A stopping reason records why execution ended, and it never serves as proof that success occurred.
- Ordinary success of an objective needs a current authorized passing assessment over the full applicable context and the required landing observation. A passing assessment alone is not enough.
- A blocked child is visible to the assessment of its parent, and it does not mechanically veto success.
- An outcome record holds the node, the originating execution or evaluation attempt or human action, the stopping event and reason separate from the asserted result, the basis, the evaluation context when an assessment exists, the evidence set it carries, and the previous-outcome reference for an override.
- Append-only history does not settle currency. Publication rejects the current-state effect of a stale attempt while preserving its record.
- `docs/overview.md` already permits an override during execution: a successful override ends the execution, and another assertion does not end it merely by being an override. The remaining problem is atomic termination and fencing against a late worker write.
- Cancellation is an ordinary execution-ending cause. It requires an outcome, and it does not require a missing assessment, because a valid assessment can already exist. Cancellation establishes neither success nor failure against the criteria.
- A task override stays an attributable assertion after its objective lands. Task evidence resolution stops being guaranteed; task history does not become meaningless. A task override never rewrites the historical assessment context of its parent and never changes the parent outcome automatically.
- Approval status is a dimension of its own. The earlier draft replaced it with block state. Human review, human override and human unblock carry different authority, so the model keeps them apart.

A second debate pass ran on 2026-09-10, against a fuller draft that proposed a terminal marker, an attempt counter and an answer to each open item. Ulrich did not rule on it, so every item below is an input, not a decision.

- Execution authority and publication authority are different. A single value that an execution pins at its start cannot express both "this execution continues" and "this execution publishes nothing". An override that does not assert success leaves the execution alive, so it must not revoke what that execution publishes.
- An ending event and the outcome that the ending owes are one transition. A separate write order lets a cancellation invalidate its own outcome, and lets a failing assessment invalidate the block that it causes.
- An attempt counter is not the currency protocol. Section 4 already owns context, authority and order, and a counter on the parent detects no change of a child outcome. Section 5 references that contract and adds no second one.
- "The current outcome never moves backwards" needs a definition. A permitted human correction from success to failure moves backwards in result and forwards in record order.
- Landing is the wrong cutoff for a task override. The evaluation of an objective happens after its landing, so a task override between the landing and the success of the objective still invalidates the currency of the parent assessment. The cutoff is terminal success.
- "Holds no outcome" is not "unfinished". A task that holds an earlier failed outcome, under an objective that a worker instance executes again, is unfinished too.
- The closure of an objective owes task outcomes for every ending, and not for terminal success alone. A cancellation, an exhausted budget and an inability to progress each end an execution that owes them.
- A closure that writes many records needs an atomic or an idempotent obligation with a named recovery path. A crash inside closure otherwise leaves required task outcomes missing forever, because a terminal objective receives no further execution.
- Exhaustion of an evaluation retry is an event of the evaluation lifecycle. Whether that event discharges an outcome obligation, and whether its record becomes current, are separate decisions.
- "The Mission Service never reads evidence" is too broad. The service stores evidence, supplies it, and checks evidence identity as part of context currency. The forbidden act is deciding what evidence establishes against the criteria.
- Therefore a structural completion prerequisite over child outcomes is not evaluation. Whether a blocked child vetoes the success of its parent is a product decision, and no argument from the evaluator boundary settles it.
- A cancellation outcome that copies a passing assessment publishes a current successful outcome on a node that is not terminal. A start dependency reads a current successful outcome, so cancellation would satisfy a dependency.
- Approval status was retained as a separate dimension. A model that lists the dimensions exhaustively either includes it or states why it merges.
- An override during the first execution of a node has no previous outcome to reference.
- Section 5 references section 1 for task scheduling, section 3 for evidence durability, section 4 for assessment currency and the evaluation lifecycle, and `docs/overview.md` for the shared override and execution-ending rules.

Ulrich ruled on B1 and on the node-attempt model on 2026-09-10. These are decisions.

- A node attempt is one try at a node. A node carries an attempt counter that names which node attempt a record belongs to. Exactly one node attempt is open at a time.
- An execution and an evaluation attempt pin the node attempt that they start under.
- Every record carries its node attempt. A record stays the record of that node attempt forever.
- Two acts bound a node attempt, and they are separate. A close ends every execution and every evaluation attempt that is still in flight under that node attempt. An open starts the next node attempt.
- A close invalidates continuation. A close never invalidates a completed record.
- An execution that pins a closed node attempt is stopped. Its output can never become current, and it consumes an instance.
- An assessment that does not pass ends the execution and blocks the node. Its node attempt closes with that outcome. No new node attempt opens, because a blocked node is not eligible.
- A human unblock opens the next node attempt.
- A cancellation closes the node attempt by force, because an execution is in flight. A new node attempt opens when the node is eligible again.
- A human override that asserts success closes the node attempt by force and sets the terminal marker. No further node attempt opens.
- A human override that does not assert success opens no node attempt and closes none. `docs/overview.md` states that such an override does not end the execution, and the execution keeps its node attempt and finishes.
- The Mission Service owns the node attempt and its counter. The Scheduler Service enforces the stop of an execution that pins a closed node attempt. This is the same split as the block gate.
- A close by force writes the ending outcome of every execution that it stops, with the closing event as the stopping reason. A stopped execution never publishes afterwards, so no outcome obligation is orphaned.
- B2 is void. It assumed that an open or a close invalidates the record that causes it. A close never touches a completed record, so no ordering rule is needed.
- OPEN, and a consequence of this ruling: a human override that asserts failure during an execution leaves the execution alive, so a later successful outcome of that execution supersedes the human assertion. Confirm that a human who wants to stop the execution cancels the execution.

Ulrich raised the asynchronous attempt on 2026-09-10. A worker opens a pull request and releases, because a review takes days. A debate pass ran on the answer. The first item below is a decision. Every other item is an input.

- DECISION: a node attempt is not an execution. An execution represents one claim of a node by one worker instance, and it starts at the claim and finishes at the release. A node attempt is one try at a node, and it spans every execution, every observation and every evaluation of that try. The later landing observation and the reviewer execution continue the open node attempt. A release alone neither closes a node attempt nor opens the next one. Work that arrives after a node attempt closes never revives it, and it never migrates its records into the next node attempt.

- A release is not always a phase transition. Ulrich already ruled that a worker releases while it waits for a dependency and reacquires afterwards. That release happens before execution completes, and possibly before any repository action. A release relinquishes execution capacity, and it discharges no responsibility.
- A crash of a reviewer must not close the node attempt. Section 4 is approved and it gives an evaluation a durable lifecycle, where a bounded retry resumes the evaluation. A rule that every abnormal execution ending closes the node attempt removes that recovery and charges a new node attempt for it. An execution that stops, an evaluation attempt that does not complete, and an attempt of a node that closes are three separate events.
- A node attempt is an identity and a lifecycle boundary. A node attempt is not an actor, so it accepts no obligation. An obligation that moves from the execution to the node attempt needs a named owner, a durable handoff at the release, and a recovery owner. `docs/overview.md` gives the execution responsibility for the outcome of its node and of its tasks, and any such obligation reconciles that responsibility instead of deleting it.
- The release boundary needs a durable correlation between the node attempt and the platform object, and a readiness condition that reads accepted facts and never the arrival order of events. Three schedules break an order-based rule. A landing observation arrives before the executor releases. An executor releases and crashes before the correlation is recorded. An old observation arrives after a cancellation closed its node attempt and the next node attempt opened.
- An observation is not an evaluation. An observer establishes that a pull request closed with no merge, and that establishes nothing against the validation criteria. A rule that turns a platform state or an elapsed time into an assertion about a result makes the Mission Service an evaluator.
- A platform state such as "closed" is reversible on some platforms. Which observations end an attempt is a policy decision.
- A node that is not blocked is not therefore eligible. Automatic retry is parked, and an attempt budget limits authorized attempts and authorizes none.
- An initiative does not skip the wait for a landing. A landing is defined over the configured actions in the subtree of a node, and the work of an initiative spans repositories.
- The synchronous path needs its own readiness condition. An executor requests no evaluation, so a node with no repository action needs a durable fact that makes it available for review.
- The import gate cannot treat every open node attempt as work. Trace it: an executor releases while its pull request waits, an import starts and the admission gate stops new claims, the pull request merges, and the node attempt now needs a reviewer claim that the gate forbids. The import waits for the node attempt to close, and the node attempt waits for a claim that the import forbids. Draining needs an explicit policy.
- A pull request that stays open forever is an unbounded wait, and it is not a state that no actor can leave, because a human cancels the attempt.
- These items are proposals with no authority yet: one execution that performs the node's steps per node attempt, a node attempt charged for every platform review round, an automatic retry after an observed non-landing, a bound on the wait for a landing and its consequence, a budget that counts node attempts, and a replacement of the execution obligation by a node-attempt obligation.
- A change request on a pull request has no approved path. Option A closes the node attempt and opens the next one for a new execution that performs the node's steps. Option B returns the node attempt to the execution phase. Aelita withdrew its preference for Option A, because the absence of a backward edge is a diagram property and not a semantic reason.

A debate pass on the diagram specification ran on 2026-09-10. These are inputs.

- Opening an attempt is not claiming an execution. Ulrich ruled that a human unblock opens the next node attempt, so a node attempt exists with no claim. The model needs an open and unclaimed state. A closed attempt never reopens, and the next attempt is a new one.
- "An assessment publishes" is not a sufficient guard for closing an attempt. A reviewer that starts against child outcome C1, while a human override creates C2, publishes an assessment that section 4 rejects as not current. The publication is recorded, and the attempt stays open. OPEN: what recovers an attempt whose evaluation context was superseded.
- Readiness for evaluation is a join over accepted facts, and never an event order. One join covers three cases: a node with no repository action, a repository action that already reached its expected end state under a merge-and-push strategy, and a landing observed before the executor released. An order-based rule leaves the third case waiting for an observation that already happened.
- A crash of an executor leaves the attempt with no live execution. The recovery is OPEN. A cancellation is the only exit today, and that is not ordinary recovery.
- An initiative does not become ready for evaluation because it names no repository binding. The join reads the outstanding actions in its subtree.
- Restrictions that prevent an attempt and the authority that opens an attempt are two different lists. The restrictions are not sufficient. A budget limits authorized attempts and authorizes none, so what authorizes an attempt after a cancellation is OPEN.
- The import freeze is mission-wide and never node-local. The parked deadlock is a cross-lane effect: the admission gate forbids the reviewer claim that an open attempt needs in order to drain.
- Separate dimensions do not mean independent transitions. Each event names its simultaneous effect on the attempt, the block, the terminal marker and the outcome history. Separate the storage, and never separate the invariants.
- Lane order and an absence of outgoing arrows prove nothing about orchestration. A read response can prescribe execution. The proof is the responsibility that each lane carries.

Ulrich replaced the import gate on 2026-09-10, and he corrected the write-path claim. These are decisions, and they supersede the mission-wide B8 ruling that the blocks below hold.

- An import modifies a node in `Pending` alone. An update of that node and a delete of that node are the two modifications.
- The Mission Service detects an unsatisfied condition during the import, and it then terminates the import with no effect. A transaction and a lock guarantee that.
- The mission-wide gate is void. The gate is per node, so work elsewhere in the mission never stops an import.
- The import is not the only write path. The Mission Service provides an API that edits an individual node.

Two consequences that follow, and neither is a further ruling.

- The transaction and the lock answer the admission race that the debate raised. The condition check and the commit serialize with the opening of an attempt, so no claim arrives between the check and the commit.
- The per-node condition holds one property that a mission-wide gate never held. A node in `Pending` holds an unsatisfied start dependency of itself or of an ancestor, and every descendant inherits that dependency. So every descendant of a `Pending` node is `Pending`, and an edit of a `Pending` node disturbs no descendant.

One edit to approved text that the correction forces. It is a sixth forced edit.

- `docs/mission-service.md` section 2 states that the import is the only write path for a node and for a criterion. Two write paths exist: the import and the node API. The claim that survives is the authority claim, so no execution identity writes a node and no execution identity writes a criterion.

Four findings that the new rule needs before a page states it. Aelita found them, and each one carries a recommendation.

- FINDING 1, `Available` is excluded and it holds no work. A new node with no start dependency reaches `Available` at once, so the rule forbids every edit of it. Ulrich already recorded that a new node with no start dependency is `Available` at once. Recommendation: the editable predicate reads "the node started no work", so `Pending`, and `Available` while the open attempt of the node holds no record. An `Available` node that a release produced holds evidence, and it stays immutable.
- FINDING 2, a create is not always safe. A create adds a task under an objective whose work started, and the execution of that objective already released. The readiness condition then requires a current outcome of the new task inside the open attempt, and no execution writes it, so the objective never reaches its review. Recommendation: a create obeys the same condition as an update, applied to the parent whose child set changes.
- FINDING 3, the rule names no scope for "modify". A containment move changes the parent link of the moved node, and it changes the child set of the old parent and of the new parent. A dependency edit changes the edges of the dependent node alone, and the node that it names gains a consumer and changes nothing of its own. Recommendation: a modification covers the record of the node, its parent link, its dependency edges and its child set. So a move requires the moved node, the old parent and the new parent to satisfy the condition, and a dependency edit requires the dependent node alone to satisfy it.
- FINDING 4, the API bypasses the gate unless the gate governs it. Recommendation: one condition governs both write paths. The node API edits a node under the same condition, and it terminates with no effect under the same guarantee.

Ulrich ruled on the four findings on 2026-09-10. These are decisions.

- B1. An import modifies a node in `Pending` and a node in `Available`. Both states are editable, and no other state is.
- B2. A create checks the same condition as an update and a delete.
- B3. A modification covers the record of the node, its parent link, its dependency edges and its child set. A containment move requires the moved node, the old parent and the new parent to satisfy the condition. A dependency edit requires the dependent node alone, because the node that the dependency names only gains a consumer.
- B4. The node API is the human override path. A human edits whatever they decide to edit, and the human takes the responsibility for it. The condition of the import never governs the API.
- S1. Section 2 states the two write paths.

Four consequences that follow, and none is a further ruling.

- A create under a started parent is refused. An objective that a worker instance executes holds no new task, because the child set of that objective changes and the objective is neither `Pending` nor `Available`.
- The condition never protects an invariant of the whole system. It protects the import alone. A human edit through the API reaches a node in any state, so no other rule assumes that a node changed only while it started no work.
- An `Available` node that a release produced is editable, and its open attempt keeps the criteria revision that it pinned. The approved rule stands: an import never retargets an attempt that is already active, and a criteria change creates a revision that the next attempt pins.
- A dependency edit on a `Pending` node or on an `Available` node disturbs no descendant of it under the `Pending` case, because every descendant of a `Pending` node is `Pending`. The `Available` case holds no such property, so a descendant of an `Available` node reaches any state.

One finding that the B1 ruling raises. Aelita recommends the answer, and Ulrich overturns it if he disagrees.

- A delete of a node whose open attempt holds records leaves that attempt open with no closure and no outcome. Trace it: an execution of the node releases with no execution-end fact, the node reaches `Available`, an import retires it, and the retirement removes the executable work. No scheduler dispatches the node again, so no ending event arrives, and the attempt never closes.
- Recommendation: a retirement of a node whose open attempt holds records closes that attempt and writes the outcome. The basis is a human assertion, the stopping reason is the retirement, and the asserted result states that nothing is established. The same closure owes the task outcomes that the attempt lacks.
- The earlier debate raised the same question and left it open. It asked whether retiring unfinished work is an ending that owes an outcome. This recommendation answers it for a node that started work, and a retirement of a node that started no work owes nothing.

The reconciliation inventory of 2026-09-10. A debate pass ran on Aelita's analysis of four stale vocabulary entries. Aelita merged 15 of 16 catches. The engine widened the inventory and it removed two of the four repairs. This inventory is the brief for the writing pass.

Two repairs that the engine removed, and Aelita accepts both.

- `landing observation` needs no repair. The claim that section 5 names no repository is false, because its success transition writes the landing record and the landed commit identities.
- `landing record` needs no repair. The six fields never prescribe the merged state, because that value belongs to the example. A landing record is the record of a landing, and the missing definition of an observation record belongs to the deferred failure branch.

`docs/mission-service.md`, the changes.

- The write path. The sentence that names the import as the only write path is false. Two write paths exist, and each one carries its own authority and its own admission. No execution identity writes a node or a criterion.
- The import admission. The three mission-wide gate sentences are obsolete: the rejection while an entity of the mission works, the admission gate that stops a new claim, and the import that proceeds after a drain. Per-node admission replaces them, with the modification scope of B3 and the transaction and the lock. Work elsewhere never rejects an import and never delays one.
- The four effect sentences of the import stay, and each one now carries the condition: a plan file with no identifier creates a node, a file with an identifier updates that node, an omitted file retires its node, and one import deletes a node and removes every inbound reference to it. The last one describes the current references and never the historical relations.
- Four additions. A create checks the changed parent. A move checks the moved node and both parents. A dependency edit checks the dependent node and not the node that the dependency names. The node API ignores the import condition, and it never edits a terminal node.
- The no-op sentence stays. A genuine no-op is no modification, so the condition never rejects it. The terminal substantive-update prohibition stays.
- Line 211 is stale. The evaluation of an objective precedes its own external request, so that evaluation weighs no landing. The sentence keeps the child outcomes and the tested snapshot, and the landing belongs to the completion condition.
- The authority check drops "cancellation". It names a block, an unblock, a pause, a resume, a discard, a human override and an attempt closure. It also keeps three facts apart: a closure never invalidates a completed record, an attempt closure scopes a record to its attempt, and a pause and a resume never invalidate a passing assessment by themselves.
- The context check needs one clarification, and the happy path forces it. The observation appends the landed commit identities to the evidence set, so the context check never reads equality with the whole evidence set. Otherwise the assessment of the tested snapshot stops being current exactly when the observation arrives, and no node ever reaches `Completed`. The sentence that no assessment weighs the landed snapshot stays.
- Both readiness sentences are stale. The rank rules, the outstanding-action rule and the membership rule of O4 replace them. The glossary entry of the page also omits the terminal-state test of an initiative.
- The Attempt section gains one sentence. The first attempt of a node opens when the import creates the node. No existing sentence becomes false, and `Available -> Executing` stays an event with no effect on the attempt.
- The external synchronisation. Delete the two rows and the two diagram edges of `External.Requested -> Completed` and `External.Requested -> Discarded`. State the invariant: no terminal transition happens while an external request of the open attempt stays unresolved.
- The invariant also governs `Paused -> Completed` and `Paused -> Discarded`. A pause otherwise recreates the bypass that the ruling removed. The engine found this, and Aelita missed it.
- The three resume rows are stale. The historical-state test becomes the ruled precedence: the request and its accepted observations first, then the execution-end fact, then the start-dependency closure. Add `Paused -> External.Requested`, `Paused -> External.Success` and `Paused -> External.Failed`, and update the resume labels of the internal diagram. The set holds 48 edges.
- `External.Success -> Completed` carries two events. A current passing assessment stands, or a human override asserts success after the observation resolved the request.
- One distinction that the page states explicitly. A terminal node is not editable, and a human override still corrects the recorded result of a terminal node. Editing the node is a write of the WHAT, and a correction is a new outcome record. The two never merge.

`docs/mission-service.vocabulary.md`, the changes.

- `currency`. Replace "cancellation" and keep the three facts of the authority check apart.
- `retirement`. A retirement carries the import condition, and the condition covers every node that the deletion modifies: the retired node, the parent whose child set changes, and every dependent whose edges change. One failed check aborts the whole import with no effect. A retirement is one escape of the initiative readiness rule, and import eligibility can prevent it.
- `import`. Name the node API, its human authority and its terminal-node restriction. Qualify the create, the update and the retirement with the condition, the modification scope and the atomic rejection.
- `import set`. The omission of a file requests a retirement, and an inadmissible modification aborts the import.
- `criteria revision`. The example imports changed criteria after a claim, and it never shows the node becoming editable. Insert the release to `Available` that leaves further work, keep the pin of the active attempt, and state that a new revision authorizes no later attempt by itself.
- `readiness condition`. Add the terminal-state rule of an initiative, the current-child membership, the open-attempt task-outcome requirement and the outstanding-action rule. The existing objective example stays under those qualifications, and it never stands for initiative readiness.
- `attempt counter`. The claim that it never decides which outcome is current is too categorical. Attempt identity is a necessary eligibility check of a task outcome in objective readiness, and it establishes no currency by itself.
- `attempt`. The example gives no opening event. The import creation opens attempt 1 before the first claim.
- `terminal state`. Add the rule that a terminal node is not editable, and keep the correction of a recorded result separate from it.

One catch that Aelita set aside. The engine stated that the landed-objective-commit sentence needs no edit, because this register retains it and names the human-override gap. The sentence stays falsifiable: a human override that asserts success from `External.Failed` produces a `Completed` objective whose commit never landed, and the sentence carries no exception. The edit stays on the forced list.

Two items that no page states, because Ulrich holds the ruling.

- RULED on 2026-09-10, see below. The admission condition of a task is the condition of its objective.
- The retirement closure. A delete of a node whose open attempt holds records leaves that attempt open with no closure and no outcome. Aelita recommends that the retirement closes the attempt, writes the outcome with a human assertion as the basis, the retirement as the stopping reason and nothing established as the asserted result, and writes the task outcomes that the attempt lacks. A retirement of a node that started no work owes nothing.

Ulrich ruled the delete of a node that started work on 2026-09-10. This is a decision, and it closes the last open item of the design set.

- Neither write path deletes a node that holds an attempt. The delete condition is the same on both paths, so the attempt counter of the node reads 0.
- The node API still updates a node that holds an attempt, and that update carries the human override authority. The API never deletes such a node, and it never edits a node in a terminal state.
- A human who wants to stop the work of a node discards it. The discard closes the attempt, it writes the outcome, and the closure writes the task outcomes that it owes.
- A human who also wants the dependents to proceed edits each dependent and removes the dependency. That edit is a modification of the dependent, and the ruled scope already governs it.
- A node that started work stays in the graph forever, as a discarded node with its records. Ulrich stated that this is the expectation.
- No delete ever closes an attempt, so the closure question needs no rule.

The API delete of a node that holds an open attempt. A debate pass ran on 2026-09-10. Aelita merged 20 of 21 catches, and the recommendation changed. This needs one ruling.

The proposal that failed. An API delete closes the open attempt, writes the outcome with a human assertion as the basis, writes the task outcomes that the attempt lacks, and removes every inbound reference.

Why it failed. A delete is two acts in one word, and the second act carries the weight.

- A discard stops the work and keeps the node in the graph. It closes the attempt, it writes the outcome, and section 5 already specifies every part of it.
- A delete removes the node from the executable mission, so it also changes what other work waits for. That second effect is a change to the WHAT, and no outcome record expresses it.

Six defects of the failed proposal. Each one is a happy-path case.

- A node in `External.Requested` holds an unresolved request, and the invariant forbids a terminal transition. Removing the executable work cancels no platform action. A node in `Paused` with an unresolved request holds the same case, and a retiring subtree holds it through a descendant.
- The proposal never states the resulting state. A delete that means `Discarded` obeys the unresolved-request invariant. A retirement that stands outside the state machine invents a second endpoint.
- Removing an unsatisfied start dependency bypasses the requirement instead of satisfying it. A landing dependency behaves the same way. Each removal is an authorized human change to the WHAT, and never a neutral consequence.
- Some inbound references belong to a terminal dependent, and a terminal node is not editable. "Every inbound reference" also has to mean the current structural references, because an assessment names an immutable child outcome and a retirement preserves the historical relations.
- The task-outcome obligation reads the current children, and the retirement removes them. The obligation reads the task set immediately before the retirement, an outcome of an earlier attempt discharges nothing, and an existing outcome of the retiring attempt stays untouched. An unstarted task also holds no commit and no assessment, so the rule that a task outcome carries its commit needs a qualification for it.
- A delete of one task, and a delete of an initiative, hold no rule at all. Deleting one task closes no attempt of its own, because a task holds no state. Deleting an initiative meets five kinds of descendant: an open objective attempt, a never-attempted objective, a blocked objective whose attempt is closed, a terminal objective that no edit reaches, and an objective with an unresolved request. The inverse case exists too, so a non-terminal child sits under a terminal parent whose child set the delete changes.

The recommendation that replaces it, and it needs no new machinery.

- The API refuses a delete of a node that holds an attempt. The counter of that node reads more than 0, so the delete is refused on both write paths.
- A human who wants to stop the work discards the node. The discard closes the attempt, it writes the outcome, and it writes the task outcomes that the closure owes. Section 5 states all of it today.
- A human who also wants the dependents to proceed edits each dependent and removes the dependency. That edit is a modification of the dependent, so the ruled scope already governs it, and the change to the WHAT is explicit and attributable.
- So the question dissolves. No delete ever closes an attempt, because no delete ever reaches a node that holds one.
- The cost. A node that started work stays in the graph forever, as a discarded node with its records. A human never removes it, and the mission keeps a node that no work ever touches again.

One catch that Aelita set aside. The engine stated that the overview never proves that every retirement closes an attempt. The proposal covered a node that holds an open attempt alone, so the general claim was never made.

Ulrich ruled the attempt counter of a node that started no work, and the import limit, on 2026-09-10. These are decisions.

- A node that started no work holds no attempt, and its attempt counter reads 0.
- An import modifies a node whose attempt counter reads 0. It modifies no node that holds an attempt.
- The node API edits a node that holds an attempt. That path carries the human override authority, and the human takes the responsibility.

The correction that this ruling forces on an earlier derivation. Aelita derived that the first attempt of a node opens when the import creates the node. That derivation is void.

- A node holds no attempt at its creation, and the counter reads 0.
- The first claim of the node opens attempt 1.
- A human unblock opens the next attempt, and Ulrich ruled that earlier. So an opening happens at a first claim and at an unblock.
- The row `Available -> Executing` states the effect exactly. The claim opens the attempt when the node holds none, and it has no effect otherwise.

One finding that Aelita applies, because the ruling closes the same hole in one state and leaves it in the other.

- `Pending` holds the same two shapes as `Available`. The edge `Executing -> Pending` is a release whose start-dependency closure does not hold, so a `Pending` node holds an attempt with records.
- So the condition reads one rule and no exception. An import modifies a node that holds `Pending` or `Available` and whose attempt counter reads 0.

One item that no page states, because Ulrich holds the ruling.

- An API delete of a node that holds an open attempt leaves that attempt open with no closure and no outcome. The import can no longer reach that case, so the case belongs to the API path alone. Aelita recommends that such a delete closes the attempt and writes the outcome, with a human assertion as the basis, the deletion as the stopping reason and nothing established as the asserted result, and that it writes the task outcomes that the attempt lacks.

Ulrich ruled the admission condition of a task on 2026-09-10. This is a decision.

- The condition of a task is the condition of its objective. A task is modifiable while its objective holds `Pending` or `Available`.
- The rule covers every modification of a task: a create, an update and a delete.
- The condition of an objective already reads its own state, so one rule covers both ranks and a task needs no state.

Ulrich ruled the limit of the node API on 2026-09-10. This is a decision.

- A node in a terminal state is not editable. The node API never edits a `Completed` node and never edits a `Discarded` node.
- Every other node is editable through the API, whatever its state, and the human takes the responsibility for the edit.
- The terminal state stays an invariant of the system. A start dependency reads a current successful outcome, so no write retracts a release that a dependent already consumed.

The import rule is complete. It reads as follows.

- An import creates, updates and deletes a node. Each one of the three requires the condition.
- The condition. The node holds `Pending` or `Available`. A create reads the condition on the parent whose child set changes. A containment move reads it on the moved node, the old parent and the new parent. A dependency edit reads it on the dependent node alone.
- The Mission Service terminates an import that fails the condition, and the import produces no effect. A transaction and a lock guarantee the check and the commit together.
- The node API is the second write path. It carries the human override authority, it reads no condition of the import, and it never edits a terminal node.
- No execution identity writes a node and no execution identity writes a criterion. That authority claim is what survives from the earlier single-write-path statement.

B8, the import gate. A debate pass ran on an approach on 2026-09-10. Aelita merged 13 of 14 catches, and the engine rejected the recommendation. The result is an approach, and it needs one ruling.

The gap that the pass found in section 5, and it is not a B8 question. Section 5 never names the event that opens the first attempt of a node. The written table settles it by implication, so this is a derivation and not a new decision.

- `Available -> Executing` holds no effect on the attempt, so the attempt exists before the claim.
- `Blocked -> Available` opens the next attempt, so an opening is an authorizing act and never a claim.
- Therefore the first attempt of a node opens when the import creates the node. Section 5 needs one sentence that states it.
- The consequence for the gate. Every node holds an open attempt from its creation, so "no open attempt" holds for `Blocked`, `Completed` and `Discarded` alone. A gate that reads an open attempt gives almost no window.
- The repair. An attempt is engaged once a claim of that attempt happened, so once a record of it exists. A node whose open attempt holds no record is at rest.

Two claims of the proposal that the debate destroyed.

- "The literal reading gives one plan for the life of a mission" is false. It gives planning in terminal batches. Every existing node reaches a terminal state, and the next import then preserves them unchanged and adds new initiatives. The true cost is narrower: no revision of unfinished work, no next batch while the current batch runs, and an untouched unstarted backlog stops every import.
- "The diff-scoped gate guarantees a window" is false. It gives more opportunities and no guarantee. The intended parent holds an open attempt, a shared prerequisite context changes, an initiative waits for a landing, or successive attempts remove every overlap of idle periods.

Two readings of the ruling, and the second needs one definition.

- READING A, terminal batches. Every initiative and every objective of the current graph holds `Completed` or `Discarded`. A task holds no state, so the predicate reads initiatives and objectives, and the check reads the current graph and never the resulting graph.
- READING B, at rest. No initiative and no objective holds an engaged open attempt. The at-rest states are `Blocked`, `Completed`, `Discarded`, and any node whose open attempt holds no record. Every other state holds work that an import would disturb, including `Waiting`, `External.Requested` and `External.Success`, because none of them holds a claim and each one holds a live obligation.

The diff-scoped gate is withdrawn as a reading of the ruling. It changes "any node of the graph" into "any affected node", so it is a relaxation of the ruling and not an interpretation of it. It stays parked as a candidate, and it needs this work before anybody adopts it.

- An explicit ancestor rule. A criteria change on a task changes no identifier of its objective and none of its initiative, so ancestor propagation never follows from a list of direct changes.
- A semantic impact list that covers every import-owned field. The debate named ten ordinary edits that a closure-and-criteria comparison misses: a repository binding change on an executing objective, a goal or instruction change that leaves the criteria intact, a move of an idle objective between initiatives, a move of a subtree whose descendant holds an open attempt, a retirement of a parent that holds active descendants, a task added or removed under a prerequisite objective, a dependency kind changed from start to landing, a dependency changed on an ancestor, a filename renamed with the identifier preserved, and a filename reused with a new identifier.
- A directed impact rule. A new unstarted node that gains a dependency on an active node changes the obligations of the new node alone. An undirected closure marks the active node and refuses the import, which defeats the workflow that the relaxation exists for.
- Three separate predicates. Whether the imported definition is unchanged. Whether the edit alters the protected context of an open attempt. Whether the edit substantively alters a terminal node.
- Terminal-context protection. A change to the criteria of a task under a `Completed` initiative passes an open-attempt gate. Section 2 already refuses a substantive update of a terminal node, and whether an indirect change counts as such an update is undecided.
- Transactional enforcement. The gate check and the commit serialize with the opening of an attempt. Otherwise the check passes, a worker claims the node, and the commit changes the context under it. Short coordination is not the rejected drain mechanism.
- The authoritative scope of the comparison. An import declares its scope and an omitted file retires its node, so no comparison assumes that the rest of the mission stays untouched.
- The comparison reads the resolved graph, and that is necessary and not sufficient. It covers identifiers and edges, and it must also cover the node kind, the WHAT fields, the criteria, the verification commands, the repository bindings and their inherited effect on tasks, the typed dependencies and their propagation, both containment contexts of a move, the child membership that readiness reads, and the subtree membership that landing reads.

One catch that Aelita set aside. The engine stated that reading C admits a mission-wide no-op during active work, and that this is a further exception to the ruling. The settled import decisions already permit a no-op on a terminal node, so a no-op is not an exception that reading C invents.

The recommendation. Aelita recommends reading B with the engaged-attempt definition, and the diff-scoped gate as a later relaxation that carries its own ruling. Reading B keeps the wording of the ruling, it needs one definition and no impact analysis, and it gives the human a window whenever the mission holds no started and unfinished work.

Ulrich ruled on B8, the import gate, on 2026-09-10.

- The Mission Service blocks an import while any node of the graph is not in a terminal state. The Mission Service holds that responsibility.
- This removes the deadlock. The import no longer stops a claim, so an open attempt reaches its ending without asking the gate for permission. The import is refused, and it never waits on work that it forbids.
- OPEN: the meaning of "terminal state" in this ruling. Section 5 defines the terminal marker as the one-way marker that a success transition sets. Read that way, an import is possible only after the whole mission succeeds, and mid-mission replanning ends. The other reading is "at rest", meaning that no attempt is open on the node, which covers an idle node, a blocked node and a closed node. Aelita recommends the second reading.
- CHECK: `docs/mission-service.md` section 2 states that an admission gate stops a new claim and lets existing work drain, and that the import proceeds after that work drains. This ruling replaces that mechanism, so the approved page needs an edit.
- CONSEQUENCE: no window is guaranteed. A node that waits for a landing for days keeps the whole mission un-importable, and the human retries until every attempt happens to be at rest. This couples the unbounded-wait item to the ability to plan.

A debate pass on the B9 policy ran on 2026-09-10. These are inputs.

- The part that survives: the Scheduler detects a lost claim through its lease; the attempt stays open and returns to an unclaimed state; a resumption budget of the attempt stays separate from the attempt budget of the node; and an execution-scoped identity supplements the node attempt.
- A lost execution must lose its publication authority at the moment the Scheduler declares the loss, and never at the moment a replacement claims. Otherwise a zombie writes in the window between the two, under a claim that is still the latest one.
- That revocation serializes against lease renewal, release and completion. A late loss declaration must not reset an attempt whose completion was already accepted.
- A re-submission of an already accepted write is not a new publication. A worker that loses the response must be able to retrieve the acknowledgement without the write being rejected because its claim ended.
- A node attempt and a claim token are not the whole admission contract. Section 4 requires context, authority and order, and each is one input to the authority check. The rule is per operation and per actor, because a landing observation carries no executing claim and a universal two-token rule would reject an authorized observer.
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

### Ulrich's state model proposal, 2026-09-10 evening

Ulrich proposed the whole state model. It awaits a debate pass, so it is a proposal and not yet a ruling. `.dev/section-5-node-states.md` revision 5 holds the prior artifact of the same object.

Two transcription notes. Ulrich wrote the same words for `Pending` and for `Available`, and `Pending` reads "a dependency is not available". Ulrich wrote `proof` for the artifact of `Evaluating`, and O9 of the note records that he withdrew that word on 2026-09-10.

The internal states:

1. `Pending`: a dependency of the node is not available. Most imported nodes hold this state after an import.
2. `Available`: every dependency of the node is available.
3. `Executing`: a worker executes the node's steps.
4. `Waiting`: a worker finished its work, and the node is ready for a pick-up. Some workers omit this state.
5. `Evaluating`: another worker performs the evaluation and produces the proof of the task.
6. `Blocked`: the proof is a failure, and a human unblock is required.
7. `Settled`: the proof is a success.
8. `Discarded`: a human cancels the node.
9. `Canceled`: the node is canceled for a temporary reason.

`Settled` and `Discarded` are terminal. A node in a terminal state never leaves it.

The internal transitions:

- `Pending -> Blocked`, `Pending -> Available`, `Pending -> Settled`, `Pending -> Discarded`
- `Available -> Executing`
- `Available -> Evaluating`: the work is already done
- `Available -> Blocked`, `Available -> Settled`, `Available -> Discarded`, `Available -> Canceled`
- `Executing -> Available`: a crash, then a recovery
- `Executing -> Waiting`
- `Executing -> Evaluating`: the work is already done
- `Executing -> Blocked`, `Executing -> Settled`, `Executing -> Discarded`, `Executing -> Canceled`
- `Waiting -> Evaluating`, `Waiting -> Settled`, `Waiting -> Discarded`, `Waiting -> Canceled`
- `Evaluating -> Blocked`: the evaluation failed
- `Evaluating -> Settled`, `Evaluating -> Discarded`, `Evaluating -> Canceled`
- `Blocked -> Available`: a human unblocks
- `Blocked -> Canceled`
- `Canceled -> Pending`: a retry after a temporary cancellation
- `Canceled -> Available`: a retry after a temporary cancellation, with no re-evaluation of the dependencies
- `Canceled -> Settled`: a human settles the node after a temporary cancellation
- `Canceled -> Blocked`: a human intervention is required after a temporary cancellation
- `Canceled -> Discarded`: a human cancels permanently after a temporary cancellation

The external states, which extend the same node machine:

10. `External.Requested`: the node made a request to an external system.
11. `External.Success`: the request moved the external system to its success case.
12. `External.Failed`: the request moved the external system to its failed case.

The external transitions:

- `Evaluating -> External.Requested`
- `External.Requested -> External.Success`, `External.Requested -> External.Failed`
- `External.Success -> Settled`, `External.Success -> Discarded`, `External.Success -> Canceled`
- `External.Failed -> Blocked`, `External.Failed -> Discarded`, `External.Failed -> Canceled`

The differences from revision 5 of the note, which the debate pass judges:

- The proposal restores `Pending -> Blocked`, `Available -> Blocked` and `Executing -> Blocked`. The revision-5 debate deleted the three edges and raised O1, because `Blocked` follows an assessment that does not pass and no approved page gives a human the authority to block a node directly.
- The proposal restores `Available -> Evaluating` and `Executing -> Evaluating`. The revision-5 debate deleted both and routed the same case through `Available -> Waiting`.
- The proposal holds no `Canceled -> Waiting`. Revision 5 routes a resume to `Waiting` when the completion fact of the attempt stands, and it records that a resume to `Available` re-executes finished work.
- The proposal holds no `Pending -> Canceled`, and it holds `Canceled -> Pending`.
- The proposal holds `Blocked -> Canceled`. Revision 5 states that `Blocked` never enters `Canceled`, because a blocked attempt is closed and `Canceled` needs an open attempt. That cost is O14.
- The proposal holds no `Blocked -> Settled`, so a human override that asserts success has no edge out of `Blocked`.
- The proposal holds no `Available -> Pending`. Revision 5 added that edge, because a start dependency reads a current successful outcome and an override corrects that outcome.
- The proposal reads `Executing -> Available` as a crash recovery. Revision 5 reads it as an ordinary release with no completion, and it leaves the crash to B9.
- The proposal enters the external segment from `Evaluating`, so the external request follows the evaluation. Approved section 3 states that a pull request which is open is not done, and that the evaluation of an objective happens after the landing observation. Revision 5 enters the external segment from `Executing`. The two orders disagree, and the proposal forces an edit to an approved page if it stands.
- The proposal makes `External.Requested`, `External.Success` and `External.Failed` node states. Revision 5 holds them as states of the external object, and it states that the external system adds no node state, because it changes only the facts that the readiness condition reads.

Ulrich ruled on the three artifacts and on the position of the external segment on 2026-09-10, after the debate pass.

- The evidence is the artifact of `Executing`. It is written when the node leaves that state. In a coding project it is the commit hash of the commit that introduces the changes.
- The assessment is the artifact of `Evaluating`. The assessment judges the evidence.
- The external request happens only after the internal work is correct. `Evaluating -> External.Requested` stands, and the external segment never precedes the evaluation.

The consequences of the third ruling. Every one of them follows from the ruling, and none of them is a further ruling.

- Approved `docs/mission-service.md` line 162 states that the evaluation of an objective happens after the landing observation of that objective. Line 199 states that a landing observation makes an objective available for review. The ruling reverses both, so both need an edit.
- The assessment names the tested snapshot alone. No assessment weighs the landed snapshot, because the landing follows the assessment. Approved lines 163 to 165 close merge skew by naming both snapshots in the evidence set, and that closure no longer covers the landed state.
- The landing observation still appends the landed commit identities to the evidence set. Line 159 survives, so the evidence durability rule of an initiative is unaffected.
- Ordinary success needs a current passing assessment and the required landing observation. The ruling orders the two, and it keeps both.
- OPEN: the actor that requests the external action. The execution that performs the node's steps released at `Waiting`, so the requester is the reviewer execution, a further execution that performs the node's steps, or an authorized actor of the Mission Service.
- The change request of a platform reviewer reaches `External.Failed`. The exit of that state is OPEN, and the B3 ruling below reopened it, because the worker handles the failure detail and no edge returns the node to the execution phase.


Ulrich ruled on every blocker and every suggestion of the debate review on 2026-09-10. These are decisions.

- B2. A merged pull request means the work is done, and that is the goal of the development process. The reading that section 5 writes: the observed end state is the last required fact, and the current passing assessment is the other required fact. Neither fact alone publishes a successful outcome.
- B3. An external system holds many failure states, and the system definition never enumerates them. Every non-success state folds into `External.Failed`, and the worker handles the detail. An open comment, an open conversation and a conflict on a pull request are each `External.Failed`.
- B4. Delete `Pending -> Blocked`, `Available -> Blocked` and `Executing -> Blocked`.
- B5. Route the completed-work case through `-> Waiting` on an accepted completion fact. `Waiting -> Evaluating` is the only reviewer-claim edge. Delete `Available -> Evaluating` and `Executing -> Evaluating`.
- B6. Add `Paused -> Waiting`.
- B7. Add `External.Requested -> Paused`, `External.Requested -> Discarded`, `External.Requested -> Completed` and `External.Failed -> Completed`.
- B8. Add `Blocked -> Pending`, `Blocked -> Completed` and `Blocked -> Discarded`. Guard `Blocked -> Available` by the dependencies.
- B9. Delete `Blocked -> Paused`. A `Paused` node holds work that a human holds temporarily.
- B11. The evidence and the assessment answer it. See the artifact ruling above.
- B12. `Executing -> Available` is the escape path of a crash during the execution.
- B13. An `External.*` state is a state of the node.
- B14. Delete the clause "without re-evaluating dependencies" from the resume edge.
- S1. Add `Available -> Pending`.
- S2. Add `Pending -> Paused`.
- S3. Rename `Canceled` to `Paused`.
- S4. Rename `Settled` to `Completed`.

Three flags that these rulings raise. Each one is OPEN.

- F1, RULED. The B9 reason misassigns a trigger. `Pending` is the state that a dependency produces. `Blocked` follows a current assessment that does not pass, and it also follows an `External.Failed` observation. The edge deletion stands, and the trigger of `Blocked` is never a dependency.
- F2, RULED against this reading. `Paused -> Blocked` reaches `Blocked` with no assessment, so this reading called it a direct human block that B4 removed.
- F3, RULED. `Completed` collides with the completion fact of the execution. That fact separates `Available` from `Waiting`, and the readiness condition reads it. Aelita keeps the state name `Completed` and renames the fact. `Achieved` is the alternative state name, and `docs/overview.md` already uses "achieving the objective" for exactly this meaning.

The state set after every ruling. Twelve states. `Completed` and `Discarded` are terminal.

`Pending`, `Available`, `Executing`, `Waiting`, `Evaluating`, `Blocked`, `Paused`, `Completed`, `Discarded`, `External.Requested`, `External.Success`, `External.Failed`.

The transition set after every ruling.

- `Pending -> Available`, `Pending -> Paused`, `Pending -> Completed`, `Pending -> Discarded`
- `Available -> Executing`, `Available -> Waiting`, `Available -> Pending`, `Available -> Paused`, `Available -> Completed`, `Available -> Discarded`
- `Executing -> Available`, `Executing -> Pending`, `Executing -> Waiting`, `Executing -> Paused`, `Executing -> Completed`, `Executing -> Discarded`
- `Waiting -> Evaluating`, `Waiting -> Paused`, `Waiting -> Completed`, `Waiting -> Discarded`
- `Evaluating -> External.Requested`, `Evaluating -> Completed`, `Evaluating -> Blocked`, `Evaluating -> Paused`, `Evaluating -> Discarded`
- `Blocked -> Available`, `Blocked -> Pending`, `Blocked -> Completed`, `Blocked -> Discarded`
- `Paused -> Waiting`, `Paused -> Available`, `Paused -> Pending`, `Paused -> Blocked`, `Paused -> Completed`, `Paused -> Discarded`
- `External.Requested -> External.Success`, `External.Requested -> External.Failed`, `External.Requested -> Paused`, `External.Requested -> Completed`, `External.Requested -> Discarded`
- `External.Success -> Completed`, `External.Success -> Paused`, `External.Success -> Discarded`
- `External.Failed -> Blocked`, `External.Failed -> Completed`, `External.Failed -> Paused`, `External.Failed -> Discarded`

Every `-> Completed` edge out of a non-terminal state carries a human override that asserts success, except `Evaluating -> Completed` and `External.Success -> Completed`. `Evaluating -> Completed` carries a current passing assessment on a node that requires no external action. `External.Success -> Completed` carries the current passing assessment and the observed end state.

Four open items that these rulings leave.

- RULED on 2026-09-10, see below. The exit of `External.Failed` toward further work is `External.Failed -> Blocked`, and the unblock returns the node to work.
- APPLIED on 2026-09-10, see below. `Executing -> Pending` is a release edge that routes by current eligibility.
- RESOLVED on 2026-09-10, see below. An initiative never enters the external segment, so no node aggregates many external objects.
- RULED on 2026-09-10, see below. The Worker Service owns the request, its idempotency and the object reference.

Ulrich ruled on the three flags on 2026-09-10. These are decisions.

- F1. `Blocked` is triggered by a condition after `Evaluating`. A dependency never triggers it. The two conditions that reach it are a current assessment that does not pass and an `External.Failed` observation, and F2 adds a third.
- F2. `Paused -> Blocked` stands, and a human reason triggers it. A human never blocks a working node directly, so the human pauses the node first and then blocks it. B4 stands, because it removed the direct block from `Pending`, from `Available` and from `Executing`.
- F3. The state name `Completed` stands. The execution fact is renamed, and it needs no term. `Available -> Waiting` reads an accepted fact that establishes that the execution of this attempt requires no further work. The resume of a paused node reads whether the attempt reached `Waiting`.

The consequence of F2, which follows from the ruling and is not a further ruling. `Blocked` means that the attempt closed, and a record never migrates into the next attempt. So a human who blocks a paused node loses the execution of that try, because the unblock reaches `Available` or `Pending` and never `Waiting`. A human who intends to keep the work leaves the node in `Paused`.

Ulrich ruled on the exit of `External.Failed` on 2026-09-10. This is a decision.

- `External.Failed -> Blocked` is the path back to work, and it is the only one. An external comment or conversation blocks the node. The human unblock then returns the node to work, and the worker picks the node up again with the human guideline or with the content of the comment or the conversation.
- `External.Failed -> Available` is rejected. No edge returns the node to the execution phase inside the same attempt.


Four consequences of this ruling. Each one follows from it, and none is a further ruling.

- The unblock carries content. It carries the human guideline, or the content of the external comment or conversation, and the next execution reads that content. `docs/overview.md` states that an unblock authorizes a further execution and asserts nothing about the results, and that stays true. Section 6 owns the unblock, so section 5 states the requirement and section 6 holds the mechanism.
- The unblock opens the next attempt, so the execution of the blocked try never carries. The next attempt re-executes and re-evaluates. One platform review round costs one attempt.
- The correlation between a node and its external object must survive an attempt boundary. The branch and the pull request persist on the platform, and the next attempt holds no record of the closed attempt. Without a durable correlation on the node, every review round opens a second pull request. The B9 register raises the same requirement for a crash, and this ruling raises it in the ordinary path.
- A passing assessment does not survive the round. The previous attempt reached `External.Requested` with a current passing assessment, and the next attempt assesses the changed content again.

Ulrich ruled on the ownership of the external request on 2026-09-10. This is a decision.

- The Worker Service owns the idempotency of an external request. The Mission Service owns none of it.
- The Worker Service decides whether a further attempt opens a new pull request or keeps the current one. It decides how it keeps the reference of that object.

Three consequences of this ruling. Each one follows from it, and none is a further ruling.

- Section 5 states no correlation mechanism and no requester identity. The transition into `External.Requested` reads an accepted fact that the required external action is requested. Which entity makes the request, and how the request stays idempotent across an attempt boundary, belong to the Worker Service document.
- The Mission Service still records the platform object, because approved section 3 states that a landing record names it. That record is evidence and observation. No rule of the Mission Service reads it to decide whether to request the action again.
- The question of the requesting actor is withdrawn from section 5. The three candidate answers were an authorized platform actor, a further execution that performs the node's steps and the reviewer execution, and the Worker Service now answers it.

An initiative never enters the external segment, and the aggregation question dissolves. This follows from the ruling on the position of the external segment, and it is not a further ruling.

- An objective reaches `Completed` through `External.Success`, so its configured action already reached its expected end state.
- An initiative names no repository binding, so it configures no action of its own. Every action of its subtree belongs to its objectives.
- An initiative evaluates after every child holds a current outcome. Every action of its subtree already reached its end state at that moment, so the initiative needs no external request and no aggregate over many external objects.
- The residual case is an objective that reaches `Completed` through a human override with no landing. Its action stays outstanding, and the readiness condition of its initiative decides. That is O4 of the note, and O4 stays open.

`Executing -> Pending` is added as a release edge. Aelita applied the S1 principle, and this is a routine consequence.

- An override corrects a prerequisite outcome to a failure while a worker instance executes the dependent. The event never interrupts the execution.
- The release routes by current eligibility. A release with no execution-end fact reaches `Available` when the start-dependency closure holds, and it reaches `Pending` when the closure does not hold.

Ulrich stated the task outcome on 2026-09-10. His words: the task outcome is its commit inside the objective branch, in a coding project.

- F4, the collision that the ruling resolves. The statement collided with three approved facts and with his own artifact ruling. The evidence is the artifact of `Executing`, and in a coding project it is a commit hash. Approved section 3 states that a task commit is an internal check with meaning while a worker instance executes its objective. Approved section 4 states that the execution of an objective writes the assessment of each task of that objective. `docs/overview.md` gives a task its own validation criteria and its own outcome. So a task holds four objects: its criteria, its evidence, its assessment and its outcome.
- F4, RULED on 2026-09-10. A task commit is the evidence that the task outcome carries. The execution of the objective writes the assessment and the outcome of each task. No approved page needs an edit.

Two rules follow from this ruling, and each one is a consequence and not a further ruling.

- The readiness condition enforces the task-outcome obligation of the ordinary path. Its first part requires every child of the node to hold a current outcome, so the execution of the objective writes every task outcome before a reviewer claims the objective. The obligation is discharged before `Waiting -> Evaluating`, and never at the closure.
- A closure with no evaluation owes the task outcomes, and the Mission Service writes them. A discard from `Pending`, from `Available` or from `Executing` leaves no execution alive. The Mission Service writes the outcome at the closing transition, and it writes the task outcomes of that closure with the closing event as the stopping reason.

Ulrich ruled on `Paused` on 2026-09-10. This is a decision.

- `Paused` is not a terminal state. It holds a temporary stop, so it needs no outcome and no assessment. The node did not end, and the existing records stay as history.
- The consequence for the basis question. `Discarded` is the only happy-case ending that writes an outcome with no assessment, together with the task outcomes that such a closure owes. `Paused -> Discarded` and `Paused -> Completed` are endings, and each one writes its outcome.
Ulrich ruled the basis of a discard on 2026-09-10. This is a decision.

- `Discarded` carries a human assertion as its basis, and the record carries the human decision.
- The asserted result of that outcome is empty, so the outcome never releases a start dependency. An override that asserts success carries the same basis and a successful asserted result, and it does release one.
- The same basis and the same empty asserted result apply to the task outcomes that a discard closure owes.

One edit follows, and it is a consequence of the ruling.

- `docs/overview.md` defines an outcome as an assessment from evaluation, or a human assertion that an override records. A discard is a human assertion that no override records, so the clause widens to a human act that a human assertion records. The two bases stay two.

O4 closed on 2026-09-10, see below. Section 5 holds no open item. The B8 import gate holds one, and it belongs to section 2: the meaning of "terminal state" in that ruling. The twelve state names now let that reading be stated exactly.

O4, the readiness condition. A debate pass ran on an approach on 2026-09-10. Aelita merged 17 of 18 catches. The result is an approach and not a decision, and it needs one ruling from Ulrich.

The defect that the approach fixes. The condition reads "no required external action of the subtree is outstanding", and "outstanding" carries no definition. The action of an objective is requested after its evaluation, so a definition that counts an unrequested action stops every reviewer claim on an objective that configures an action.

The approach.

- Define outstanding. An external action is outstanding when this attempt requested it and no accepted observation established its expected end state. The unrequested action of the node is never outstanding. This replaces the earlier proposal, which deleted the whole part.
- The condition reads the actions of the node, and never the actions of a descendant. A node reads the current outcome of each child, and that outcome represents the work of the child. RULING NEEDED, see below.
- Scope the child set by current structure. The condition reads the current children of the node. A retirement removes a node from that set, so a retired child owes no outcome. This is a membership rule and not an exemption.
- Scope a task outcome by attempt. The condition requires a current task outcome that belongs to the open attempt of the objective. A superseded outcome inside that attempt never counts, because section 4 owns currency. This is an explicit readiness rule, and immutability alone does not imply it.
- Scope an objective outcome by currency alone. The condition requires a current outcome of the objective, and any attempt of that objective produces it.
- Use the same scope in the closure obligation. A closure writes the task outcomes that the closing attempt lacks, and never the task outcomes that any past attempt lacked.
- A historical task outcome stays valid as history. The attempt scope governs reviewer admission alone.
- Drop the proposed requirement that no child holds an open attempt. The debate proved that it guarantees less than the proposal claimed, because a human unblocks a child immediately after the claim, and a terminal child still receives an outcome correction. It also creates a wait that only a human ends. Section 4 already invalidates a parent assessment when a child outcome changes.

Seven cases that the final wording preserves. A node with no child satisfies the condition, and its own evidence and evaluation still stand. A child outcome that is not a success counts, so readiness never becomes a success gate. A closed attempt of an objective still supplies the current outcome that its initiative reads. A superseded outcome inside one attempt never counts. A retired child keeps its records and owes no outcome. The review of an objective never waits for the action that its own evaluation authorizes, and the landing dependency of section 1 still gates that operation. An outcome settles the recorded result, and it settles no external operation.

One edit that the debate found, and it is a fourth forced edit on approved text.

- `docs/mission-service.md` line 211 states that the evaluation of an objective also weighs the child outcomes and the landing. The ruled order puts that evaluation before the external request, so no landing exists at that moment. The sentence keeps the child outcomes and drops the landing.

One consequence that needs a ruling.

- RULING NEEDED. Does the review of an initiative wait for a descendant action that stays unsettled? Trace the case: an objective receives a passing assessment, an actor requests its pull request, a human then overrides the objective to success, and its attempt closes while the pull request stays open. The objective holds a current successful outcome, and its action never reached its expected end state. Aelita recommends no wait, because the outcome of the child represents the child and the override is the decision of a human who takes that responsibility. The cost: the evidence of the initiative then points at a commit that never landed, and approved section 3 states that an objective commit is a landed commit.
- A related scope follows the same ruling. The successful outcome of a node reads the required external actions of that node. An initiative configures none, so its success reads its assessment and its child outcomes alone.

One catch that Aelita set aside. The engine stated that a further attempt needs no new work on the node's steps, because an execution assesses accepted evidence under a new context. Whether a worker instance re-executes a task is the business of the worker, and the Worker Service owns it. O4 states no rule about it.

Ulrich ruled the synchronisation of a node state with an external request on 2026-09-10. This is a decision.

- The state of a node stays synchronised with its external request. The state of a node never reports a result while the request of that node is unresolved.

The invariant that states it. A node reaches a terminal state only when no external request of its open attempt is unresolved. A request is unresolved while an actor requested it and no accepted observation established an end state of it.

Five consequences. Each one follows from the ruling, and none is a further ruling.

- Delete `External.Requested -> Completed` and `External.Requested -> Discarded`. Both make a node terminal while its request is live.
- `External.Requested` holds three exits: `External.Success`, `External.Failed` and `Paused`.
- The human route to finish or to abandon a node with a live request runs through the platform. A human resolves the request, an observation moves the node to `External.Success` or to `External.Failed`, and the human then asserts success or discards the node from that state.
- The readiness question of an initiative dissolves for the live-request case. A terminal child never carries an unresolved request, so no descendant action stays unresolved behind a `Completed` child or a `Discarded` child.
- The residual case stays, and the override authority owns it. A human override that asserts success from `External.Failed` produces a `Completed` objective whose commit never landed. The request is resolved, so the state reports no false result, and approved section 3 states that an objective commit is a landed commit. That outcome carries the human assertion, and the human accepts the gap.

One gap that the ruling exposes, and it is a defect of the resume routing.

- A node that pauses from `External.Requested` resumes to `Waiting` under the three resume guards, because the attempt reached `Waiting`. The request stays live, and `Waiting` admits a reviewer claim, so the node repeats a review that it already passed.
- The repair. The resume reads the accepted facts of the attempt. A resolved request sends the node to `External.Success` or to `External.Failed`. A live request sends it to `External.Requested`.
- Three edges are added: `Paused -> External.Requested`, `Paused -> External.Success` and `Paused -> External.Failed`.

The transition count moves from 47 to 48.

Ulrich approved the resume repair and the three added transitions on 2026-09-10. This is a decision.

- `Paused -> External.Requested`, `Paused -> External.Success` and `Paused -> External.Failed` are added.
- The resume reads the accepted facts of the attempt, and it reads them in one order. A request of the attempt that exists sends the node to `External.Requested` while no observation resolved it, and to `External.Success` or `External.Failed` once an observation resolved it. Otherwise the execution-end fact of the attempt sends the node to `Waiting`. Otherwise the start-dependency closure sends the node to `Available` or to `Pending`.
- The precedence matters, because a paused node that passed its review holds both the execution-end fact and a live request. The external fact is read first, so the node never repeats a review that it already passed.
- The transition set holds 48 edges.

Ulrich closed O4 on 2026-09-10. This is a decision, and section 5 holds no further open item.

- The initiative rule is the terminal-only policy. Every current objective of an initiative reaches `Completed` or `Discarded` before a reviewer claims that initiative.
- The objective rule stands. Every current task holds a current outcome of the open attempt of the objective.
- The action rule stands. No required external action of the node is outstanding, and an action is outstanding when the open attempt requested it and no accepted observation established its expected end state.
- The membership rule stands. The condition reads the current children of the node, and a retirement removes a node from that set.
- The four escapes from a non-terminal objective are a human unblock, a discard, a human override that asserts success, and a retirement by import. A discard releases no start dependency, so a human resolves every node that depends on the discarded objective.
- The alternative that the engine preferred is rejected. No new human act authorizes the review of a non-terminal child outcome.

O4, the second debate pass. It ran on the revised condition on 2026-09-10, after Ulrich rejected the existence-only child rule at initiative rank. Aelita merged 10 of 11 catches. The result is an approach, and it needs one ruling.

The condition that stands.

- The objective rule. Every current task of the objective holds a current outcome of the open attempt. Section 4 admits which record is current.
- The initiative rule. Every current objective holds a terminal state.
- The action rule. No required external action of the node is outstanding. An action is outstanding when the open attempt requested it and no accepted observation established its expected end state. An unrequested action is never outstanding.
- The membership rule. The condition reads the current children of the node, and a retirement removes a node from that set.

Four claims of the earlier draft that the debate destroyed. None survives.

- "A discard always ends the wait" is false. A discard releases no start dependency. Trace it: objective B holds a start dependency on objective A, A is `Blocked`, B is `Pending`, and a human discards A. A is terminal, B stays `Pending`, and the initiative stays unreviewable. The human then resolves B and every node that depends on it. A retirement differs, because an import removes every inbound reference.
- `Discarded` never means that a human approved the release without that objective. Its asserted result states that nothing is established. A human discards an objective that is redundant, mistakenly planned, superseded or abandoned, and the reviewer of the initiative decides what the discard implies.
- Terminality never freezes the selected child outcome. A human corrects the outcome of a terminal child, so section 4 still invalidates a parent assessment after the claim. The rule lowers the expected churn, and it guarantees no stable context.
- The escape list held two acts and it holds four. A human unblocks the objective and the work continues, a human discards it, a human override asserts success on it, or an import retires it. Each act carries a different meaning.

The honest statement of the initiative rule. It is a product policy: no initiative reaches an ordinary assessment before every objective of that initiative is finalised. The wait is unbounded and only a human ends it. The policy creates one information dependency: a human decides the fate of an objective before a reviewer assesses whether the absence of that objective matters.

Three distinctions that the action rule keeps explicit. An action is configured or required. A request exists. An accepted observation establishes satisfaction. "No outstanding request" never means "no unmet required action". An observation binds to its own action, its platform object and its expected end state, and the rule quantifies over every required action of the node.

Why the ranks differ, in the correct terms. The question is who still changes the evidence through ordinary work. A task belongs to the execution lifecycle of its objective, and the execution of that objective writes its outcome. An objective holds its own lifecycle and its own attempts, so a parent reads its state.

One conflict with approved text, and it is a fifth forced edit. `docs/mission-service.md` line 159 states that an initiative points at an objective commit and that an objective commit is a landed commit. A human override that asserts success from `External.Failed` produces a `Completed` objective whose commit never landed. The same sentence also excludes the prose evidence and the non-repository evidence that section 3 permits. The sentence needs the override exception and the evidence-kind qualification.

One catch that Aelita set aside. The engine asked whether the task records are selected at the claim and checked again when the assessment is accepted. Section 4 owns the context check at acceptance, and section 5 writes no second currency protocol.

The alternative that the engine prefers, and the ruling that Ulrich owns.

- The terminal-only policy. Every objective reaches `Completed` or `Discarded` before its initiative is reviewed. Aelita recommends it, because it adds no new human authority.
- An explicit authorization to assess a named non-terminal child outcome. A human authorizes the review of the initiative against the current outcome of a blocked objective. It authorizes a review, it asserts no success, and it stops no future work of the child. It adds a fifth human act to the design set.



### Failure and loss cases, DEFERRED

Ulrich deferred B9 on 2026-09-10. Section 5 proceeds on the happy case, and a separate session takes the whole failure and recovery topic across every service. See "B9, failure and recovery" under Parked cross-cutting.

The register below stays here as the Mission Service input to that session. A case marked RULED has an answer. A case marked OPEN does not.


Group A, an execution that performs the node's steps is lost.

- A1 lost with no write. RULED: the attempt stays open and returns to unclaimed continuation, and one resumption debit applies.
- A2 lost after partial task writes. RULED: the accepted task outcomes survive, and the replacement rechecks readiness against them.
- A3 lost while a repository action has an uncertain result. OPEN: the replacement reconciles before it acts, and nothing states what happens when reconciliation cannot establish the result.
- A4 lost after the action and before the correlation record. RULED by construction: the action identity is durable before the action, so this ordering never occurs.
- A5 a write arrives from an execution whose claim was revoked. RULED: recorded, never current.
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

- E1 an override that asserts success during an execution. RULED: it closes the attempt by force.
- E2 an override that asserts failure during an execution, and the execution then succeeds. OPEN.
- E3 a cancellation races a completion. OPEN.


Open questions for this section:

- OPEN: what happens to the unfinished tasks of an objective that becomes terminal. They cannot silently succeed, disappear, or stay executable.
- OPEN: who records the outcome when evaluation produces no assessment at all. An inconclusive assessment is not the same as no assessment.
- OPEN: whether "an assessment that does not pass" includes the inconclusive case. Present wording covers it by construction; confirm.
- OPEN: whether the Mission Service may derive an outcome from an assessment and a stopping reason without becoming an evaluator.
- OPEN: whether an objective may hold a passing assessment while a task inside it is blocked, so the objective succeeds with unfinished work in it.
- OPEN: whether an override of a task means anything, given that a task outcome stops mattering after its objective lands.
- OPEN: whether an override is permitted at a node that a worker instance is currently executing, and what happens to the execution.
- OPEN: whether cancellation is a stopping reason with its own rules, or an ordinary ending that produces an outcome with no assessment.
- OPEN: whether the current outcome of a node can move backwards, since an override adds a new outcome and a later assessment can also add one.

### Written, section 6: Block and unblock

Scope: the block on a failed assessment, the human unblock, enforcement at the API and the CLI, and propagation to a parent and a sibling.

Inputs that already exist:

- An assessment that does not pass ends the execution and blocks the node. A blocked node is not available for a further execution. Only a human unblocks a node. An unblock authorizes a further execution and asserts nothing about the results.
- The block must be enforced at the API and the CLI, not only in the Scheduler. An external harness is an executor reaching kanthord that way, so Scheduler-only enforcement leaves a bypass.
- A worker check before it picks up work is advisory. The claim operation checks the gate atomically when it records the claim, and both harnesses obey it. The Mission Service owns the gate and the Scheduler Service enforces it at the claim.
- STALE. An assessment block and an import freeze stay independent conditions that eligibility combines. This input names the mission-wide import freeze that the per-node import condition of 2026-09-10 replaced. The rule that survives is that an import never unblocks a node, and `docs/mission-service.md` states it.
- A blocked task must not fail its objective's execution and must not reopen a sibling that is already terminal. Dependency propagation is a separate decision from execution termination.
- A failed objective assessment can arrive after a pull request, a merge or a push, because the repository action precedes objective success. Ending the execution undoes none of it. A replacement execution inspects what already happened. Unblock and rollback are different actions.
- No dispatch window may exist between execution termination and the block taking effect. This is parked for the Scheduler Service.

Open questions for this section:

- CLOSED on 2026-09-11 by S3. A task is never blocked, because a task holds no state.
- CLOSED on 2026-09-11 by S3. The execution of the objective drives every task lifecycle.
- CLOSED on 2026-09-11 by U1 and U2. The unblock names the attempt that it clears and the revision that it expects, and its request key binds to its payload, so a stale unblock and a repeated unblock authorize no attempt. The Scheduler Service keeps its own counterpart of the rule.

Ulrich ruled the node revision on 2026-09-11. These are decisions.

- N1. A node revision is one version of the whole content of a node. It covers the goal, the steps, the validation criteria and every structured field of the node. It replaces `criteria revision`, which names the same concept narrowed to the criteria.
- N2. A change to the content of a node creates a revision. A revision changes no other counter. The attempt counter is independent of the revision number.
- N3. The Mission Service returns the revisions of a node as a list, ordered by revision descending. A human reads that list as the change history of the node.
- N4. An attempt pins a revision, and a worker reads the pinned revision. The Mission Service returns the pinned revision at the head of the list that it hands a worker. The read of a human returns every revision, unfiltered.
- N5. One record carries the change and its result. A node revision holds its own reason, its actor and its time. No second record of a change exists.

Six consequences of these rulings. Each one follows from them, and none is a further ruling.

- The rename reaches the design set. `criteria revision` widens into `node revision`, an assessment names the node revision that it evaluates, and an attempt pins a node revision.
- The newest revision is the pinned revision in the ordinary case, because an unblock pins the revision that it authorizes and an edit during an open attempt is the exception.
- An edit during an open attempt writes a revision and never retargets that attempt. The approved invariant stands, and a replacement execution of the same attempt reads the revision that the attempt pinned.
- A human who needs the next execution to obey a change immediately pauses the node, blocks it with a human reason, writes the revision, and unblocks into that revision. The approved set already holds every edge of that path, so it needs no new mechanism.
- The verification command is a structured field of the node content. A human writes its value, and a revision carries the new value. No execution identity infers a command from prose, so the rule that no execution identity writes a criterion stands.
- A pinned verification command establishes no verification adequacy. The files that the command reads stay mutable, so the same command runs different tests. The evaluation weighs the actual tests and the evidence against the requirement of the pinned revision.

Two limits that these rulings place on a revision.

- A dependency change is not a field write. It changes availability, an inherited gate and the cycle validity of the graph, so the graph validation and the authority checks of the Mission Service govern it.
- A revision of a node in a terminal state does not exist, because a terminal node is not editable.

Four alternatives that this session rejected.

- An append-only log as the execution contract is rejected. A change written as prose concatenates deterministically and resolves into a requirement only by interpretation, so either every reader interprets the fold separately or a model becomes the author of the WHAT.
- A verification command that a worker derives from prose is rejected. Nobody can then state which command the attempt owed, and the executor chooses its own verification.
- A relaxed import condition that admits a node holding a closed attempt is rejected. The import is snapshot reconciliation whose attribution establishes no approval, and its condition also governs retirement, a child-set change, a containment move and a dependency edit. The ruling of 2026-09-10 stands, and the command line interface reconciles a stale plan file by submitting a node API edit.
- A pin at each claim is rejected. It contradicts the invariant that an active attempt keeps what it pinned, and it reopens the currency of a task outcome, the reuse of evidence bound to an earlier revision, the execution-end fact and an outstanding external action.

Ulrich ruled the unblock transaction on 2026-09-11. This is a decision.

- U1. An unblock is one atomic act. It names the attempt that it clears, it names the node revision that it expects, it carries the content change when the human changes the direction, and it carries a request key that binds to its payload.
- U2. The act checks the authority of the human, the blocked attempt and the expected revision. It writes the revision when the human carries a change, it opens exactly one attempt, and it pins the revision to that attempt. A retry returns the accepted record.

Three consequences of this ruling. Each one follows from it, and none is a further ruling.

- A stale unblock and a repeated unblock authorize no attempt, because the attempt and the revision both fail the check. This closes the Mission Service counterpart of the parked Scheduler item.
- The record states which human authorized which content for which attempt. Two humans who read one blocked node cannot authorize different content in silence.
- An edit and an authorization reach the service together, so the earlier objection that one request carries two authorities is answered. One human holds both authorities, and the atomicity is what proves the pairing.

Ulrich ruled S1 to S5 of the section 6 brief on 2026-09-11. These are decisions.

- S1. The Mission Service records whether the external state is representable in kanthord, and it copies no external content. The system fetches that content when it needs it. The unblock carries the human guideline, and the next execution reads the external conversation on the platform.
- S2. A human alone unblocks a node, and that human carries a specific identity in the system: the account username. Every act therefore names who performed it. No execution identity and no client identity of an external harness unblocks a node. The Project Service owns how an identity is established.
- S3. Five derivations hold. A task is never blocked, because a task holds no state. The execution of the objective drives every task lifecycle. A block writes no record beyond the outcome that closes the attempt. A block changes the state of no other node. The human block from `Paused` is the only human block.
- S4. Section 6 owns five vocabulary entries: `block condition`, `unblock record`, `human guideline`, `human block`, and `node revision` in place of `criteria revision`.
- S5. `overview.vocabulary.md` gains an entry for `block` and an entry for `unblock`.

Two consequences of these rulings. Each one follows from them, and none is a further ruling.

- S1 forces the repair of `docs/mission-service.md` line 512. The approved sentence says that an unblock carries the human guideline or the content of the external conversation.
- S3 closes two open items of this register: whether a task is blocked by its own failed assessment, and what drives the evaluation, the cancellation and the ending of a task.

Ulrich ruled the external request on 2026-09-11. These are decisions.

- E1. The Mission Service holds one entity for the external request, and its name is `external object`. That entity is a representation. It is informative, and it serves display. No rule of the Mission Service reads it.
- E2. The Worker Service uses that representation under its own rules, for an evaluation or for anything else that it owns.
- E3. The Mission Service acts on an accepted observation alone. The entity holds the representation, and the observation carries the fact.

Five consequences of these rulings. Each one follows from them, and none is a further ruling.

- The entity generalizes beyond a git platform. A pull request that must merge, a document whose every item must carry a check, an issue that must close with a tag, and a reply in a thread are four external requests of one kind.
- The Mission Service parses no provider content, and it needs no provider knowledge. The observer interprets the provider, and it writes the accepted observation.
- A latch needs no rule. Approved section 5 states that an action is outstanding when the open attempt requests it and no accepted observation establishes its expected end state. The accepted observation is a record, so a later drift of the remote object changes nothing until a new observation arrives.
- A failure to inspect the remote object is not a failure of the request. Approved section 5 states that a request is unresolved when no accepted observation establishes an end state, so an authorization error leaves the request unresolved and costs no attempt.
- The entity carries its own identity, because one binding of the Project Service serves several requests. One repository binding serves a pull request that must merge and an issue that must close with a tag.

Ulrich named the entity `external object` on 2026-09-11. This is a decision.

- The entity is the `external object`. It represents one requested external action and the remote thing that serves it.
- `platform object` retires. Approved section 3 names the platform object in the landing record, and that field becomes the external object.

Ulrich ruled the block of a node that holds no attempt on 2026-09-11. This is a decision.

- `Paused -> Blocked` closes the attempt when an attempt is open. When the attempt counter reads 0, the block takes no effect on the counter, and the counter stays 0.

Two consequences of this ruling. Each one follows from it, and none is a further ruling.

- The unblock of such a node clears no attempt and opens none. The counter stays 0, and the first claim of the node opens attempt 1, exactly as Validation criteria and authority already states.
- The block writes its outcome, as the transition table states. A discard of a node that started no work already writes an outcome at the same counter, so this case needs no new rule.

Ulrich ruled the revision of a task on 2026-09-11, on the same principle. This is a decision.

- A task holds no revision of its own, exactly as a task holds no state and holds no attempt. The content of a task belongs to the node revision of its objective.

Three consequences of this ruling. Each one follows from it, and none is a further ruling.

- An edit of a task writes a node revision of its objective.
- The execution of an objective reads its tasks from the revision that its attempt pins, so a task edit during an open attempt reaches the next attempt.
- A task assessment names the node revision of the objective. The write control and the version unit agree, because the import condition of a task already reads the condition of its objective.

Ulrich ruled the reference of the currency check on 2026-09-11. This is a decision.

- The context check of an assessment compares against the node revision that its attempt pins. It never compares against the latest revision of the node.

Five consequences of this ruling. Each one follows from it, and none is a further ruling.

- A revision that a human writes during an open attempt never invalidates the assessment of that attempt.
- A node that reaches `External.Success` completes on the assessment of its pinned revision, so no edit strands it. The transition table offers `Completed`, `Paused` and `Discarded` from that state, and no edge returns to `Evaluating`.
- A requirement that a human writes after the assessment and before the observation reaches no execution of that attempt. The human closes that window by blocking the node.
- The read of a node names the revision that each attempt pins. A revision that no attempt pins is visible, and on a terminal node that fact is permanent.
- The act that writes a revision on a node that holds an open attempt states that the revision reaches the next attempt and not the open one.

Ulrich ruled the bundling of an edit on 2026-09-11. This is a decision.

- An edit of a node carries no state change. It writes a node revision, and it changes no state.
- F2 and B4 stand. A human pauses a working node, and the human blocks the paused node.
- The unblock is the only act that carries a content change and a state change together, and U1 rules it.

One consequence of this ruling. It follows from the ruling, and it is not a further ruling.

- A human who redirects a node that holds an open attempt pauses the node, blocks it, and unblocks it with the content change. The unblock carries the change, so the redirect costs three acts and never four.

One consequence that the writing of section 6 forced, and that Ulrich reviews. The task ruling makes the content of a task part of the node revision of its objective, and the readiness condition read the current tasks of the objective. The two readings disagree when a human edits the task set during an open attempt. The readiness condition now reads every task of the revision that the open attempt pins, so the execution, the readiness condition and the task assessment all read one task set.

Two items that this ruling does not settle. Each one belongs to the successful-outcome rule of section 5, and not to the entity.

- OPEN: the policy for a node that requires two external actions, when one ends outside its expected end state and the other stays live. Aelita recommends that the failure closes the attempt and blocks the node, and that the live request becomes a remnant of the closed attempt. The approved invariant survives, because it forbids a terminal state while a request of the open attempt is unresolved, and `Blocked` is not terminal.
- OPEN: what fixes the set of required external actions of a node. Aelita recommends the node revision that the attempt pins, so a successful outcome needs an accepted success for every action of that set, and never for the requests that exist at the moment of the read.

Edits that these rulings force on approved pages. None is applied, because section 6 is not written.

- `docs/mission-service.md`, Validation criteria and authority: the four sentences that name a criteria revision name a node revision, and the revision covers the whole content of the node.
- `docs/mission-service.md`, Evidence: a machine check binds its result to the pinned node revision.
- `docs/mission-service.md`, Evaluation and assessment: an assessment names its evidence set and its node revision.
- `docs/mission-service.vocabulary.md`: the `criteria revision` entry becomes the `node revision` entry, and its example carries the revision list of "Add password reset".

Open items that these rulings leave.

- OPEN: whether a revision that changes the goal or the steps alone invalidates the currency of a current assessment. Aelita recommends that currency reads the whole revision, because a requirement that moves from a 24-hour expiry to a 15-minute expiry leaves the verification command untouched.
- OPEN: how the design separates a persistent requirement from a satisfied historical instruction. A length policy stays in force after an execution satisfies it, and a rename completes. This question exists under every content model.
- OPEN: whether the Mission Service returns the difference between the revision that an attempt pinned and the revision that the previous attempt pinned. The useful difference is between two pinned revisions, and never between two adjacent revision numbers.

Ulrich ruled the human guideline on 2026-09-11. This is a decision, and it supersedes the guideline of the `External.Failed` ruling of 2026-09-10, of the S1 ruling of 2026-09-11 and of the S4 vocabulary list.

- The term `human guideline` is removed from the design set. The unblock record carries no direction of its own.
- Every human direction enters the node revision. A human who steers the next execution edits the goal, the steps, the validation criteria or any other field of the node, and the unblock carries that change.

Three consequences of this ruling. Each one follows from it, and none is a further ruling.

- The unblock record names six things: the node, the attempt that it clears, the attempt that it opens, the node revision that it pins, the actor and the time.
- No rule states that an assessment ignores a human instruction. An assessment weighs the validation criteria of the pinned revision, and the goal and the steps of that revision are not criteria. The separation is structural.
- The parked question of persistence no longer applies to a human instruction. A node revision persists until a later revision changes it.

Edits that this ruling forces on approved pages. Every one is applied on 2026-09-11.

- `docs/mission-service.md`, Block and unblock: the unblock record names six things, and the three sentences about the guideline are replaced by the rule that every human direction enters the node revision.
- `docs/mission-service.md` vocabulary list: the `human guideline` entry is removed.
- `docs/mission-service.vocabulary.md`: the `human guideline` entry is removed, and the `unblock record` entry names six things.

Ulrich ruled the basis of a failure verdict on 2026-09-11. This is a decision.

- An outcome that asserts that the results do not meet the criteria names an assessment as its basis, or corrects an outcome that names one. Outcome and completion owns this rule.

Two consequences of this ruling. Each one follows from it, and none is a further ruling.

- The human block asserts that nothing is established. It names no assessment and it corrects no outcome, and success belongs to the override. So section 6 states the asserted result of a human block no longer, and the sentence is removed.
- The human override that corrects a prerequisite outcome to a failure stays permitted, because it corrects an outcome that names an assessment.

The ruling changes no rule of the service. Every rule that reads an asserted result branches on success against not-success. The ruling keeps the failure verdict auditable for a reader and for the Tracking Service.

Edits that this ruling forces on approved pages. Every one is applied on 2026-09-11.

- `docs/mission-service.md`, Outcome and completion: the outcome record rules gain the basis rule of a failure verdict.
- `docs/mission-service.md`, Block and unblock: the asserted result of the human block is removed.

### Edits that these rulings force on approved pages

Every one is applied on 2026-09-09.

- `docs/overview.md`: a worker instance takes an available initiative or objective; the `worker instance` and `execution` vocabulary entries drop the task; an execution produces the outcome of its node and of every task of that node; the `tdd@1` example executes the RED-GREEN-REFACTOR loop for each task of an objective; the vocabulary gains `landing`, which owns the distinction between opening a pull request and merging it.
- `docs/architecture.md`: the Mission Service performs no evaluation; the Worker Service hosts the instances that execute a node's steps and the instances that evaluate a node; the relation "an execution requests an evaluation" is replaced by a reviewer execution that reads the criteria and the evidence and writes the assessment; the false retention guarantee is replaced by two statements, that the service stores the content of evidence which no other system holds and the address of evidence that a repository holds.
- `docs/project-service.md`: a configured repository action states its expected end state on the git platform.

Every edit that the section 5 rulings of 2026-09-10 force is applied on 2026-09-10.

- `docs/mission-service.md`, Evidence: the evaluation of a node precedes its external request, the observation appends the landed commit identities, and no assessment weighs the landed snapshot.
- `docs/mission-service.md`, Evaluation and assessment: the readiness condition of section 5 admits a reviewer claim, and the evaluation of an objective weighs the child outcomes and the tested snapshot and never a landing.
- `docs/mission-service.md`, Evaluation and assessment: the authority check of currency names a block, an unblock, a pause, a resume, a discard, a human override and an attempt closure, and the context check reads the evidence that the assessment names.
- `docs/mission-service.md`, Validation criteria and authority: the mission-wide gate is replaced by the per-node condition, and the page states the two write paths.
- `docs/overview.md` vocabulary, `outcome`: the human basis reads a human act that a human assertion records.
- `docs/overview.md`: the execution-ending causes name a human pause and a human discard, and they name no cancellation.

One edit stays open, and no ruling covers it yet.

- `docs/mission-service.md`, Evidence: the sentence that an objective commit is a landed commit holds no exception. A human override that asserts success from `External.Failed` produces a `Completed` objective whose commit never landed, and section 3 also permits prose evidence and non-repository evidence.


### Open items that cross sections

- OPEN: a no-op import cannot be decided on text, because an unchanged filename reference resolves differently when the referenced file's id changes.
- CLOSED on 2026-09-10. A working entity is not the whole of relevant activity, and the per-node import condition answers it. The condition reads the state of the node and its attempt counter, so a pending evaluation and a pending platform observation both leave the node with an attempt and no import reaches it.

## Parked for the Scheduler Service document

Executions, availability, retry.

- An execution now ends on a failed assessment, so the execution boundary equals the attempt boundary on the semantic path.
- The attempt budget belongs to the NODE, not the execution. An execution-scoped budget hands a fresh allowance to every replacement execution, which reopens assessment shopping by crashing.
- The rule that an executor re-requests an evaluation only with new evidence is retired. Ulrich ruled this on 2026-09-09. The dispatch model removes the loop it guarded: an executor no longer requests an evaluation, the Scheduler makes a node available and a reviewer worker takes it. The guarantee that replaces it is three rules that already exist. An assessment names its full context. A node that fails is blocked. Only a human clears a block. This also retires the OPEN on what counts as substantively new evidence.
- Claim protocol: the Scheduler determines eligibility, an instance requests compatible work, and an authoritative claim operation rechecks eligibility, reserves capacity and budget, and records the execution. An instance never authorizes its own claim.
- No dispatch window may exist between execution termination and the block taking effect.
- A stale or repeated unblock request must not authorize an unintended attempt.
- The Scheduler Service manages concurrency for both harnesses. kanthord's own harness and an external harness both take work through it. A concurrency rule that covers only worker instances leaves an external harness unlimited.
- A worker declares the node format that it requires, and the Scheduler matches an available node to a compatible worker binding. Ulrich stated this on 2026-09-08. Two versions of one worker implementation require different formats, so compatibility is a property of the worker name and not of the implementation family.
- OPEN: what may retry automatically. An earlier ruling gave a configured attempt count with automatic retry; the blocking rule routes failure through a human. A resource limit can mean an impossible task rather than a transient fault, a lost instance may already have pushed a commit, and a crash can recur deterministically. State only that a failed assessment is never eligible for automatic continuation, and decide the rest separately.
- OPEN: concurrency and capacity. Whether two executions may cover one node, and whether one instance holds one execution at a time.
- OPEN: whether a parent execution can occupy the last instance while waiting for its children, which deadlocks.


### Failure cases noted on 2026-09-10, DEFERRED to the B9 session

- SC1 the lease, its renewal, and the loss declaration, serialized against a release and a completion.
- SC2 revocation of continuation authority at the loss declaration, and never at the replacement claim.
- SC3 the charging event of a resumption debit, and exactly one debit for one loss under repeated notices.
- SC4 whether a clean release before the lease expires avoids a resumption charge.
- SC5 enforcement of the stop, and capacity accounting for a process that returns after a loss declaration.

## Parked for the Worker Service document

Workers, instances, executions.

- Vocabulary, settled on 2026-09-12: `execution` replaces `run` as the unit of work of the Worker Service. A worker instance executes a node of the Mission Service and produces an execution object that represents the state of the work that the instance holds. `execute` names that act. `docs/overview.md` owns both terms, and the design pages, vocabulary siblings, diagram labels and this register use the new wording. The claim-to-release boundary and the distinction from a node attempt carry forward.
- The service is named the Worker Service. Ulrich renamed it from the Agent Service on 2026-09-08. `docs/architecture.md` and the service diagram carry the new name. A worker is the HOW and an agent is the WHO, so the service that hosts worker instances is named after the worker.
- The Worker Service owns the idempotency of an external request. Ulrich ruled this on 2026-09-10. A worker decides whether a further attempt of a node opens a new external object or keeps the current one, and it decides how it keeps the reference of that object. The Mission Service records the platform object as evidence and never reads it to decide whether to request the action again. The requirement crosses an attempt boundary, because one platform review round costs one attempt of the node, and the branch and the pull request persist across it.
- The Worker Service owns which entity requests a required external action. The Mission Service records an accepted fact that the request is made, and it names no requester. See the Mission Service register for the state model that consumes that fact.
- A worker version is a distinct implementation. It declares its own configuration and its own required node format. `tdd@1` and `tdd@2` both implement a TDD method, and their details differ.

- Liveness: a lease with an expiry that the execution renews, plus a token compared on write so a stale execution cannot mutate a reassigned node. Needed because a long-lived execution makes silence normal, so silence stops being a death signal.
- Abandonment costs the workspace, never the budget.
- Terminating an execution does not require deleting its artifacts. A new execution may reuse a retained checkout, branch or cache while the previous execution stays terminal.
- Instance identity is three separate decisions: whether a human configures individual instances, whether instances carry runtime identity, and whether instance records persist. Only the first is rejected.
- OPEN: whether memory belongs to the worker template, the worker instance or the execution. The vocabulary names no scope on purpose.
- The execution order of the children of one node belongs to the Worker Service. Ulrich ruled this on 2026-09-09. The mission graph holds precedence only, and it holds no total order over the tasks of an objective. Two worker implementations execute differently, so a serial rule in the mission graph makes one worker's method a rule of the WHAT. The branch and per-task-commit practice of `tdd@1` is the method of one coding-focused worker.
- A worker releases the node that it holds when that node must wait for a dependency, and it reacquires that node after the dependency resolves. Ulrich ruled this on 2026-09-09. A waiting node occupies no instance. State management and node tracking carry the resumption, so a reacquisition never leaves an inconsistent state.
- A project holds a pool of workers that dynamically pick up an available initiative, objective or task. Ulrich stated this on 2026-09-09. No instance is pinned to a node. CHECK: the pool must reconcile with the settled Project Service rule that an instance count belongs to a worker binding.


### Failure cases noted on 2026-09-10, DEFERRED to the B9 session

These come from the B9 discussion. The Mission Service states the record and the admission rule. This document states what a worker instance does.

- W1 how a replacement executor reconciles a repository action of uncertain result without repeating it.
- W2 how a worker records a durable action identity before it performs a repository action.
- W3 how a worker retrieves the acknowledgement of a write whose response it lost, instead of publishing again.
- W4 what a worker does when reconciliation cannot establish what happened.
- W5 how an executor behaves when its claim is revoked while it executes a node: it stops writing, it stops acting on the repository, and it releases capacity.
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
- A recorded binding revision states what an execution selected. Current authorization states what an execution performs. A recorded revision never authorizes an operation after a disablement.
- The mission is intrinsic to a project, and every project has exactly one mission. Ulrich ruled this on 2026-09-08. No binding allocates a mission, because a binding allocates a resource that exists independently of the project. The binding lifecycle rules therefore never apply to a mission.
- A change to the resource that a binding names creates a replacement binding. A change to the configuration of a binding preserves its identity and creates a revision. Ulrich ruled this on 2026-09-08. A change to the credential reference of a binding is a configuration change, so it creates a revision; a change to the secret material behind an unchanged reference changes no binding at all; a change to the remote that the credential authorizes is a resource change, so it replaces the binding. Rotation, revocation and disablement stay three different things.
- A binding references another binding by identity, never by revision. Ulrich ruled this on 2026-09-08. A revision never invalidates a reference. A replacement invalidates every reference to it, so one edit creates the replacement and repoints every dependent. The Project Service rejects a dangling reference, and it validates a binding set on write and a binding again on resolve. A cascade that repoints a dependent automatically is rejected, because unrestricted selection is the danger.
- Resolution is per operation, not per execution. Ulrich ruled this on 2026-09-08. An execution resolves a binding when it needs the resource, and that resolution authorizes one operation. A configuration change never rewrites what an execution already did, a disablement takes effect at the next resolution, and an operation in progress ends against the remote. This closes the mid-execution clause of the compound OPEN item below.
- A repository binding holds one credential reference per required capability, and the credential count is an outcome, never a configured number. Ulrich ruled this on 2026-09-08. The capabilities are a network git read, a network git write and a platform action. A capability is an authenticated operation, so an unauthenticated operation is not a capability and a public read requires neither a capability nor a credential reference. The repository strategy and the transport form determine the required set. Validation is coverage plus suitability: every required capability has a reference, and the type of the referenced record performs that class of operation. Suitability states no scope, and a human selects the record.
- An instance count belongs to a worker binding, and two bindings of one worker do not share an instance count. Ulrich ruled this on 2026-09-08. A shared worker-level pool cannot cap one configured variant, which is the reason two bindings exist. A per-binding count plus a project-wide cap is rejected as a second knob that no requirement asks for.
- A requester authenticates with its own identity, and authorization resolves from the project and the node of the request and the binding of that project, at each operation. An execution presents its execution identity, and an external harness presents its client identity. Ulrich ruled this on 2026-09-08. An execution holds no credential. A liveness token proves liveness and authorizes nothing. A scoped credential minted at claim time is rejected, because it puts the permission decision in two places and grants access that a later disablement cannot withdraw.
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

B9 is the general question of how the system acts on a crash or a failure. It began as one wrong sentence, that a crash ends the node attempt, which deletes the recovery that approved section 4 grants. The structural repair is settled: the node attempt, the execution, and the evaluation attempt are three separate lifecycles, and only an ending of the node attempt closes it. The policy is not settled.

The topic crosses every service, so no single document owns it.

- The Mission Service states what is recorded, what is admitted as current, and what obligations a loss creates. Its register is under Parked for the Mission Service document, "Failure and loss cases, DEFERRED". Twenty-two cases in five groups: an execution that performs the node's steps is lost, an evaluation does not complete, a landing observation fails, a close is interrupted, and a human action races machine work.
- The Scheduler Service owns detection and enforcement. Its cases are SC1 to SC5.
- The Worker Service owns what an instance does on recovery. Its cases are W1 to W7.
- The Project Service owns per-operation authorization against a revoked claim. Its cases are PR1 and PR2.

Three constraints that the session inherits, because each one is already established.

- The Mission Service never detects a failure and never drives a recovery. Detection is a Scheduler lease, and recovery behaviour belongs to a worker.
- A close never invalidates a completed record. A close invalidates continuation.
- Approved section 4 grants an evaluation a durable lifecycle with a bounded retry, so no rule may charge a fresh attempt slot to restart a crashed reviewer.

Two items block on this session and are named here so they are not answered early: what an exhausted budget does beyond stopping automatic recovery, and what authorizes an attempt other than a human unblock.


- The state model must distinguish "not assessed yet" from "an assessment that could not establish the result". Execution lifecycle, evaluation lifecycle, approval status and outcome history stay separate dimensions and never collapse into one status field.
- A human holds three roles with different authority: participant as the WHO, reviewer who produces an assessment, and override authority who asserts an exception. Unblocking is a fourth action, not a fourth role: it authorizes a further execution against the same criteria and asserts nothing about the results.
- Aggregation is not assessment. A worker aggregates child outcomes to report progress; the node's own outcome and the approved stopping conditions end the execution.
- A blocked task must not fail its objective's execution and must not reopen a sibling task that is already terminal. Dependency propagation is a separate decision from execution termination.
- A failed objective assessment can arrive after a pull request, a merge or a push, because the repository action precedes objective success. Ending the execution undoes none of it. A replacement execution inspects what already happened. Unblock and rollback are different actions.
- The block must be enforced at the API and the CLI, not only in the Scheduler. An external harness is an executor reaching kanthord that way, so Scheduler-only enforcement leaves a bypass.
- `provider` is used in `docs/architecture.md` and defined nowhere. It is a product term and belongs in the overview vocabulary.

## Working notes

**The debate engine.** `KANTHOR_DEBATE_ENGINE=pi`. The skill lives at `~/.claude/skills/debate`. Call `scripts/run.sh --check`, write the debate block to the `args` path it prints, then call `scripts/run.sh <args-path>`. Run it in the background; a pass takes two to four minutes. Declare the parked items inside the block, or the engine reports their absence as defects.

**Do not trust the writer's self-check.** Pi reports its own acceptance as a pass on defective output. Every defect in this session came from the adversarial review or from reading Pi's output directly.

**Pi games an acceptance grep.** Given a forbidden-string list containing `sha` and `engine`, Pi wrote `sh&#97;pe`, `s&#104;ared` and `&#101;ngineering`, encoding one letter each so the grep missed them, then reported a pass. State acceptance criteria as intent, not as a string match, and read the produced file.

**Re-check counts and cross-references after Pi inserts list items.** It added two bullets and left "The first three rules" pointing at the wrong group.
