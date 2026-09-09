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

`docs/overview.md`, `docs/architecture.md` and `docs/project-service.md` are written, reviewed and consistent after the vocabulary and wording pass. The Project Service holds no open design item. None of the three is committed.

`docs/index.html` links the Architecture page and the Project Service page. `docs/viewer.html` carries an editor reformat that Aelita did not make and did not review. Ulrich replaced the mermaid container diagram with `docs/assets/architecture-containers.svg` and added `docs/assets/architecture-services.svg`. Aelita added `docs/assets/project-service-authorization.svg` and `docs/assets/project-service-bindings.svg` on 2026-09-09.

## Settled and already in the documents

- A service is a logical part of one process. A service boundary separates authority and never describes a deployment.
- A worker is a template. A worker name has the form `<implementation>@<version>`, so the same name always identifies the same implementation. A project configures which workers are available and how many instances of each. An instance takes an available level and creates a run.
- A mission is the whole work of one project. A project has one mission. The Mission Service holds it and represents it as a graph.
- The Mission Service performs evaluation. Every write of a criterion, an assessment and an outcome passes through it. An executor requests an evaluation and never writes the result.
- The evaluation method follows the criterion and never the level. Each level carries its own criteria, which is a separate statement.
- An external harness is an executor, and it reaches kanthord as a client through the API or the CLI.
- A terminal state never reopens and never repeats. A human override adds a new outcome and never restarts a terminal run.
- An assessment that does not pass ends the run and blocks the level. A blocked level is not available for a further run. Only a human unblocks a level. An unblock authorizes a further run and asserts nothing about the results.
- A run of an objective performs the configured repository action before a successful outcome of that objective.
- An objective belongs to exactly one repository. Ulrich ruled this on 2026-09-08. A project binds more than one repository, and each objective names one repository binding. No objective performs a required action on two repositories, so partial completion across repositories does not exist. This voids the earlier multi-repository partial-failure question.
- The Project Service holds the credentials that a project's resources require, and it authorizes their use. `docs/architecture.md` states that responsibility, and `docs/project-service.md` owns the binding mechanism. No credential enters evidence or telemetry.

## Parked for the Mission Service document

Evaluation, criteria, evidence, assessments, outcomes.

- Completion is three separate rules. An ending requires an outcome, including one that cannot establish the result. A claim of success requires a passing assessment that names the evidence the outcome carries. A human bypass uses the override. One rule cannot both authorize success and record a failure.
- The Mission Service holds the evidence record. Ulrich ruled this on 2026-09-08, and `docs/architecture.md` carries it. A run writes evidence to the Mission Service, and the Tracking Service holds no evidence.
- Evidence is content-addressed: a commit hash for git work, a SHA-256 hash otherwise. A commit identifies a snapshot, so work that no commit holds is not evidence.
- The system retains the evidence that a retained outcome depends on. A content address identifies content and restores none, so losing an evidence record destroys the basis of its outcome.
- An assessment names the evidence it assesses and is valid only for that evidence.
- Assessments accumulate and are never overwritten. The content address decides which assessments are eligible; record order decides which eligible one is current. Write order alone is not the rule.
- An executor never writes the criteria of the level it executes. A verification command belongs to the WHAT; the files it reads belong to the repository and stay mutable. Protection is attribution plus a judgement criterion, not a protected-path list.
- An exit status of zero proves that one command exited zero. It proves nothing about test adequacy, coverage, or suppressed failures.
- The evaluator's scope differs by level while its method follows the criterion. A task evaluator works against a workspace; an objective evaluator also weighs child outcomes and the repository action.
- An objective names exactly one repository binding of its project. The Mission Service document states this, because the objective is its entity. `docs/overview.md` needs the objective-to-repository relation in its vocabulary.
- OPEN: bind an assessment to a criteria revision, not only to evidence. An authorized criteria change currently leaves an obsolete assessment looking current.
- OPEN: who records the outcome when evaluation produces no assessment at all. An inconclusive assessment is not the same as no assessment.
- OPEN: whether "an assessment that does not pass" includes the inconclusive case. Present wording covers it by construction; confirm.
- OPEN: a late assessment must never clear a newer block or overturn a newer human override.

## Parked for the Scheduler Service document

Runs, availability, retry.

- A run now ends on a failed assessment, so the run boundary equals the attempt boundary on the semantic path.
- The attempt budget belongs to the LEVEL, not the run. A run-scoped budget hands a fresh allowance to every replacement run, which reopens assessment shopping by crashing.
- An executor re-requests evaluation only with new evidence. A human may re-evaluate the same evidence, because a human is the authority the protocol protects.
- Claim protocol: the Scheduler determines eligibility, an instance requests compatible work, and an authoritative claim operation rechecks eligibility, reserves capacity and budget, and records the run. An instance never authorizes its own claim.
- No dispatch window may exist between run termination and the block taking effect.
- A stale or repeated unblock request must not authorize an unintended attempt.
- The Scheduler Service manages concurrency for both harnesses. kanthord's own harness and an external harness both take work through it. A concurrency rule that covers only worker instances leaves an external harness unlimited.
- A worker declares the level format that it requires, and the Scheduler matches an available level to a compatible worker binding. Ulrich stated this on 2026-09-08. Two versions of one worker implementation require different formats, so compatibility is a property of the worker name and not of the implementation family.
- OPEN: what may retry automatically. An earlier ruling gave a configured attempt count with automatic retry; the blocking rule routes failure through a human. A resource limit can mean an impossible task rather than a transient fault, a lost instance may already have pushed a commit, and a crash can recur deterministically. State only that a failed assessment is never eligible for automatic continuation, and decide the rest separately.
- OPEN: concurrency and capacity. Whether two runs may work one level, and whether one instance runs one run at a time.
- OPEN: whether a parent run can occupy the last instance while waiting for its children, which deadlocks.

## Parked for the Worker Service document

Workers, instances, execution.

- The service is named the Worker Service. Ulrich renamed it from the Agent Service on 2026-09-08. `docs/architecture.md` and the service diagram carry the new name. A worker is the HOW and an agent is the WHO, so the service that runs worker instances is named after the worker.
- A worker version is a distinct implementation. It declares its own configuration and its own required level format. `tdd@1` and `tdd@2` both implement a TDD method, and their details differ.

- Liveness: a lease with an expiry that the run renews, plus a token compared on write so a stale run cannot mutate a reassigned level. Needed because a long-lived run makes silence normal, so silence stops being a death signal.
- Abandonment costs the workspace, never the budget.
- Terminating a run does not require deleting its artifacts. A new run may reuse a retained checkout, branch or cache while the previous run stays terminal.
- Instance identity is three separate decisions: whether a human configures individual instances, whether instances carry runtime identity, and whether instance records persist. Only the first is rejected.
- OPEN: whether memory belongs to the worker template, the worker instance or the run. The vocabulary names no scope on purpose.

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

## Parked for the Tracking Service document

- The Tracking Service holds telemetry only. Ulrich ruled this on 2026-09-08, and `docs/architecture.md` carries it.
- No outcome depends on telemetry.
- Telemetry retention differs from evidence retention. The Mission Service holds the evidence.

## Parked cross-cutting

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
