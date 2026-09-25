# Handoff

Open work as of 2026-09-24.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Architecture

- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the receiving-side authentication contract of a forwarded caller identity. The identity value is process-local and the JWT stays in the Gateway Service, so a split that forwards a caller identity to another process needs a contract that no page holds.
- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the temporal validity of a cross-service precondition of a handler. A handler reads a fact of a peer through a client, awaits, then commits, and the fact can change during the wait: the Scheduler reads that a node is available and a human blocks it before the claim commits. Parked candidate: every cross-service precondition declares itself as a frozen snapshot, read before the commit and recorded with the effect, or as a commit-time condition, read through a collaboration inside the transaction while the two services are co-located, so a client read never satisfies a commit-time condition. This adds a second admissible case of a collaboration beside the atomic invariant, and it names the service pairs that no composition change alone can split. Not needed while every service runs in one process, because the complexity outweighs the benefit there.
- [ ] Added 2026-09-25 by Ulrich. Every external resource that the system registers has a resource healthcheck. Only the check method of a subscription remains open.
  - [architecture.md](architecture.md#resource-healthcheck), [gateway-service.md](gateway-service.md#health-report-and-liveness-answer) and their siblings hold the other rulings of 2026-09-25 by Ulrich.
  - Parked 2026-09-25, exposed by the check method ruling. Rule the resource healthcheck of a subscription. The Intake Service holds acquisition material only inside a grant session, so a disabled subscription has no material. A passive webhook, a poll and a stream hold no registration to read.

### Project Service

- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that an objective names a channel binding and requires its notification.
- [ ] Define the source-binding configuration for inbound provider deliveries, including webhook subscriptions and a Slack source with human identity mapping. The `source secret get` command also awaits its display, redaction and cache contract.
- [ ] Added 2026-09-24. Slack, Telegram and Jira register their platform entry and their credential types in `project-service.impl.md` when their design lands.

### Mission Service

- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Import and node writes await Markdown grammar, scope, boundary references, minimum criteria, verification-command form, create admission and retirement confirmation. Import and unblock also await durable request-map retention.
  - Ruled 2026-09-25 by Ulrich: the verification command is a list of commands, for example [`npm run lint`, `npm run verify`, `bash ./scripts/validate.sh`], and each item is a full bash command. Written.
  - Ruled 2026-09-25 by Ulrich: the commands of the list run in list order, one by one, never in parallel. Written.
  - Ruled 2026-09-25 by Ulrich: the run stops at the first item that exits nonzero. Each item runs through `bash -c` in the workspace root. The machine check records one result per item that ran, with the command and its exit code, and the overall exit code is that of the failing item, or 0 when every item passes. The start refuses a host without bash. `mission-service.md` states that the verification command is an ordered list of commands. The CLI `VerificationCommand` becomes a nonempty `Text[]` with no `workingDirectory`, and `MachineCheck` records `results: { command, exitCode }[]` and the overall `exitCode`. Written.
  - Input 2026-09-25 from Ulrich, not yet ruled, for a debate on the node structure: every node, whether initiative, objective or task, holds four fields: `name`; `requirement`, text; `criterion`, text; and `verifications`, an array of bash commands under the verification command rulings above. The kinds differ in how the fields are described: the verifications of an initiative hold only end-to-end tests, an objective holds end-to-end and unit tests, and a task holds unit tests and specific functional checks. The minimum-criteria question waits for the node structure that the debate aligns.
  - Debate 2026-09-25 on the node structure (engine `pi`, 8 catches, 6 merged): one content shape for every kind, `name`, `requirement`, `criterion` and `verifications`; `requirement` replaces `goal` and `steps`; one `criterion` text replaces the criterion list, its keys, its methods and `humanAuthorshipClaim`; test-kind guidance is not validated. Split out as separate rulings: the minimum length of `verifications`, whether a nonzero or unrun item fails the assessment, and the verification target of an initiative, whose per-objective checkout proposal is withdrawn. Proposed structure not yet ruled.
  - Ruled 2026-09-25 by Ulrich: every node, whether initiative, objective or task, holds `name`, a required nonblank title that is no identity and is not unique; `requirement`, required nonblank text; `criterion`, required nonblank text that can hold several checkable statements; `verifications`, a list of bash commands; and `bindings`, under the rule table below. The identity, the kind, the node revision, the state, the attempt counter, the priority and the edges stay outside the content. `goal`, `steps`, the criteria list with its `key`, `method` and `humanAuthorshipClaim`, `verificationCommand` and `repositoryBindingId` are removed. The verification guidance per kind is end-to-end tests for an initiative, end-to-end and unit tests for an objective, and unit tests and functional checks for a task, and it is not validated. `overview.md:15`, `overview.vocabulary.md`, `worker-service.md:82` and the "when the task carries one" conditionals of `worker-service.md` change, which is a product-vocabulary change across the set. This answers the minimum-criteria question: every node holds a nonblank criterion text. Written.
  - Ruled 2026-09-25 by Ulrich: a node holds a generic `bindings` list of binding names of its project instead of a dedicated `repositoryBinding` field. A rule table states how many bindings of each binding kind a node of each kind names. The first version: a repository binding, 0 on an initiative, exactly 1 on an objective, 0 on a task; a worker, provider account or source binding, 0 on every kind. A new binding kind adds a row. A violation answers `mission.node.bindings_invalid`. `mission-service.md` states that a node names the bindings that its kind permits, and each binding kind states how many a node of each kind names. Written.
  - Ruled 2026-09-25 by Ulrich: every node holds at least one verification command. A node with no verification need holds a command that always succeeds, such as `true`, and never an empty list. A write that leaves an empty list answers `mission.node.verifications_missing`. Written.
  - Ruled 2026-09-25 by Ulrich: an assessment does not pass when a verification item exits nonzero or does not run; judgement decides only a node whose verification items all pass. The Mission Service refuses a passing assessment that holds a failed or unrun item with `mission.assessment.verification_failed`. `worker-service.md:256` and the evaluation paragraph change from "the exit status as an input" to this gate, for the task assessment and for the reviewer. Written.
  - Ruled 2026-09-25 by Ulrich: an initiative names no binding. Its reviewer derives the repository bindings of the current objectives of the initiative and removes duplicates, so two objectives on one repository give one checkout. It checks out the head of the base branch of each binding under a directory named after that binding, because every objective is terminal and a completed objective has landed on that base branch. The commands run from the workspace root, and the tested input names every commit, one per binding. A discarded objective still contributes its repository. An end-to-end suite lives in a repository of one of the objectives. An initiative whose objectives name no repository keeps the evidence-placement rule. `mission-service.md` extends "derives its repositories from the objectives" to the verifications. Written.
  - Ruled 2026-09-25 by Ulrich, a rename across the design set: the product term **requirement** replaces **goal** and **steps**; **criterion** replaces **validation criteria**; **verification**, one bash command of the list that the field `verifications` holds, replaces **verification command**. `overview.md:15` becomes "Initiative, objective, and task each state a requirement, a criterion and the verifications that check it." `overview.vocabulary.md` replaces "its own validation criteria" with "its own criterion" in the initiative, objective and task entries, adds `requirement`, `criterion` and `verification`, and removes the old terms. Every page and sibling replaces every use in the same edit. `default standard` is unaffected. Written.
  - Ruled 2026-09-25 by Ulrich: a plan file is YAML front matter with the closed keys `id` (absent on a new node), `kind`, `parent` (a plan file name, absent on an initiative), `dependsOn` (plan file names, forbidden on a task), `bindings` and `verifications`, followed by one H1 that is the name and exactly one `## Requirement` and one `## Criterion` section, each running to the next H2 or the end of the file. Parsing is strict: an unknown key, an unknown H2 or a repeated section is refused with the file named. The file name is the import-set key. Not yet written.
  - Ruled 2026-09-25 by Ulrich, a design change: the Mission Service owns the Markdown format of a plan, beside its SQLite structure and its JSON format. The JSON format and the Markdown format are what the Mission Service exports to a user and what a user imports back. This replaces "The Mission Service owns what an import carries, and it owns no syntax", "The command line interface converts a plan into an import" and "The Mission Service writes no plan file" in `mission-service.md`, and the grammar lives in `mission-service.impl.md`, not in the CLI page. Not yet written.
  - Pending question 2026-09-25: the export operation, its scope and its answer form, and the plan file name of a node on export, because `name` is not unique while the file name is the import-set key.
  - Pending: the import scope and boundary references, the retirement cascade, create admission, and request-map retention.
- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Record commands await priority bounds, task applicability, method values, evidence bounds and retention, content encoding and exceptional credential removal. External-action publication, observer state schemas, evaluation context, criterion aggregation and repository evidence formats also await contracts.
- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Human controls await the no-attempt outcome and task-outcome schemas. `node mark-ready` awaits the counter-zero readiness contract.

### Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and the count of unresolved deliveries of the Intake Service in the implementation epics, against the 1,000-project workload. Intake operations also await handoff attempt and backoff bounds, acquisition deadlines, resolved-delivery retention and bounded read sizes.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Intake, Scheduler, Project and Mission: how the delivery admission of the Scheduler classifies a delivery that the Intake Service hands over, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The server-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it. A Scheduler read of admission dispositions per project also awaits a decision.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion. The contract also covers snapshot export, acknowledgement handoff, cursor persistence, retry deadlines and retained or discarded summaries.

- [ ] Added 2026-09-24 from `engine/docs/cli/scheduler.md`. Scheduler commands await entity prefixes, request and response schemas, durable-request mapping, lease duration, renewal cadence and route timeouts. Observation-obligation reads also await the lease start contract; lists await retention.

### Intake Service

- [ ] Added 2026-09-24. Declare the subscription store, the delivery store and the handoff in `intake-service.impl.md`. The webhook receipt route of the `intake` group waits for them.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. Subscription and delivery commands await their entity prefix declarations.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. Subscription commands await kind-specific input fields, validation, protocol state schemas and absent-state representations. Delivery reads and receipt await verification-result schemas, operation declarations, timeouts, response statuses and file bounds.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `delivery get` awaits the payload inclusion, representation, size and redaction decision.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. A human action on a parked delivery awaits authority, idempotency and state-change rules. No `delivery retry` command exists before that decision.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. Subscription mutations await incompatible-create handling, desired-state omission, disabled-source admission and retirement semantics. Candidate: omitted desired state selects `disabled`; disabled-source admission returns validation failure with HTTP 400.

### Worker Service

- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

- [ ] Added 2026-09-24 from `engine/docs/cli/worker.md`. Catalog, agent and tool commands await exact defaults, budgets, configuration constraints, platform outputs and action-result record schemas. Execution identity validation awaits the Scheduler contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/worker.md`. Human inspection, self-deregistration replay and the REST-to-MCP projection await approval. MCP commands also await endpoint declarations and assessment-state filtering of the tool list.
- [ ] Added 2026-09-24 from `engine/docs/cli/other.md`. `serve worker` awaits its option declarations, readiness output and shutdown contract. Failure recovery stays with B9.

#### Next phase

After the first native-agent worker runs the acceptance path.

- [ ] The handoff as a worker-owned protocol: a typed handoff tool with the three assertions and the stopping reason of the agent, a state machine of working, quiescing, candidate frozen, verification, judgement, recorded, and the handling of a missing, malformed, duplicate or out-of-phase handoff. The execution owns the stopping reason on a deadline, a runtime failure or a lease loss.
- [ ] Multi-agent workers, `tdd@1` first. pi has no sub-agents.
- [ ] Token and currency budgets and project-level accounting. pi reports usage and cost per message.
- [ ] A clarification interface. The pi ask_question tool is the seed, and the block and unblock flow carries ambiguity until then.
- [ ] Live streaming of a running turn. pi emits streaming events. The Tracking Service page bounds this to the harness that kanthord hosts, because an external harness reaches the Tracking Service only through an import that a human issues. A Tracking command awaits event schemas, start position, order, resume and loss behavior, limits, timeout, access and cancellation.
- [ ] Containment beyond the minimum trust boundary, the quality and replay suite, provenance tags on tool results.

### Tracking Service

- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Tracking commands await trace, span, text and record identity contracts, OpenTelemetry mapping and the canonical identity-attribute registry. Execution identity validation awaits the Scheduler contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. `telemetry ingest` awaits conflicting-record and repeated-value rules, status finalization, structural refusal codes and batch-failure boundaries. Operation contracts also need timeouts and partial acknowledgement schemas.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Ingestion and reads await byte and count limits, execution bounds, local-log and segment bounds, and `fsync` bounds. Large transcript and chunk contracts also remain open.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Read and query commands await projections, expiry behavior, and unresolved-reference representation.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Trace and text reads await retention fields and durations, text retention start, trace-expiry resolution and tombstone lifetime.

### Root repository

- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`. The Makefile also copies the OpenAPI directory `static/openapi/` of `engine` into `apps`, which the build of `apps` reads.

### B9, failure and recovery

Deferred cross-service work across Mission, Scheduler, Worker and Project.

#### Cannot progress

Folded from the Worker Service section on 2026-09-18 by Ulrich, to be designed with the rest of B9.

- [ ] Define the disposition of an execution that cannot progress. Distinguish the end of an execution from the closure of an attempt: an execution ends when it cannot continue, and the attempt closes into `Blocked` only when the continuation requires a human. Define who establishes that an execution cannot progress, who authorizes a bounded continuation and who closes the attempt, for a stop that the execution reports and for a loss that the Scheduler declares, and for a reviewer execution as well as a steps execution. An automatic continuation is authorized, bounded and requires a prospect of progress, so a transient provider outage produces no queue of human unblocks and an unchanged oversized revision is not retried for ever. The conditions from the failure-exit ruling are a provider error, an invalid handoff, a verification timeout, a commit or push failure and an unsupported context size. A verification timeout can be a defect of the work and a lost push acknowledgement can be a success, so the record keeps uncertainty as uncertainty and preserves the established task results and evidence. The outcome keeps the stopping reason separate from the assessment of the criteria. The candidate representation is a direct transition `Executing -> Blocked` on a release that names the failed operation, an outcome with a third basis, an execution declaration, beside the assessment and the human assertion, a third release form of the Scheduler, and a change to the Mission sentence that every condition that reaches `Blocked` follows the evaluation except the human block. The debate of 2026-09-18 rejected the route through the evaluation as the full disposition: it fabricates an assessment for a machinery failure, it needs a checkpoint, a push and an evidence submission that the failed operation can prevent, it leaves the task-outcome obligation of the readiness condition open, it runs the verification command against a report when no snapshot exists, and a reviewer that shares the failure has no exit from `Evaluating`. The Worker page states no cannot-progress rule until this design, and today it routes only the budget end, to a release with further work. Coupled items: automatic continuation and attempt authorization, the bound on repeated releases with further work, the outcome when no assessment exists, the reviewer-loss transition, D1, SC5, W5 and A3 / W1 / W4 / PR2.

#### Policy and budgets

- [ ] Decide which failures permit automatic continuation and what authorizes a further node attempt.
- [ ] **SC3 / SC4:** Define resumption charging, exactly one debit per loss under repeated notices, whether a clean release avoids a charge, and budget reset authority, including whether a fresh evaluation identity resets its allowance.
- [ ] **A7 / B3:** Decide whether exhaustion of a resumption or evaluation-retry budget closes the attempt, publishes an outcome and gives that outcome current effect.
- [ ] Define the publisher and meaning of an outcome when an evaluation produces no assessment.
- [ ] Bound the repetition of a release with further work on a resource budget end when the execution makes no progress.

#### Mission Service

- [ ] Define the task outcomes of the tasks that an execution did not execute when a recorded task assessment does not pass, their basis and evidence, and how the readiness condition treats the release. `worker-service.md` releases with no further work and writes no outcome for those tasks.
- [ ] Specify the reviewer-loss transition out of `Evaluating` that permits a bounded retry.
- [ ] **B2:** Define recovery and its budget when the currency check rejects a completed assessment as stale.
- [ ] **B4 / B5:** Settle exhaustion-notice precedence after an accepted assessment and during a human override that asserts failure.
- [ ] **C3:** Define the deduplication key for an observation of an unchanged external state.
- [ ] **C5:** Decide how to handle a platform state that reverses after an accepted observation.
- [ ] **C6:** Decide how to handle an external request for which no end state ever arrives.
- [ ] **D1:** Specify recovery of an interrupted attempt closure that wrote only some owed outcomes, including idempotency, resumption and the recovery owner.
- [ ] **E2:** Confirm precedence when a non-success human override is followed by a successful machine outcome.
- [ ] **E3:** Settle human pause or discard races with completion.

#### Scheduler Service

- [ ] **C1:** Specify recovery of an observation obligation when the observer is lost before recording the observation.
- [ ] **SC5:** Define physical-stop enforcement and safe resource and capacity reuse when a runtime returns after a loss declaration.

#### Worker and Project Services

- [ ] **A3 / W1 / W4 / PR2:** Specify reconciliation of repository actions with uncertain results, including remote effects that complete after revocation, and what happens when reconciliation cannot establish the result.
- [ ] **W2:** Specify how a worker records a durable action identity before performing a repository action.
- [ ] **W3:** Specify how a worker retrieves the acknowledgement of a write whose response it lost.
- [ ] **W5:** Specify worker stop behaviour after claim revocation, including repository operations, release of runtime resources and the workspace disposition.
- [ ] **W7:** Specify how a reviewer resumes an incomplete evaluation without repeating node execution or a repository action.
