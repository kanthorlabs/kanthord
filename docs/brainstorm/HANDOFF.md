# Handoff

Open work as of 2026-09-24.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Architecture

- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the receiving-side authentication contract of a forwarded caller identity. The identity value is process-local and the JWT stays in the Gateway Service, so a split that forwards a caller identity to another process needs a contract that no page holds.
- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the temporal validity of a cross-service precondition of a handler. A handler reads a fact of a peer through a client, awaits, then commits, and the fact can change during the wait: the Scheduler reads that a node is available and a human blocks it before the claim commits. Parked candidate: every cross-service precondition declares itself as a frozen snapshot, read before the commit and recorded with the effect, or as a commit-time condition, read through a collaboration inside the transaction while the two services are co-located, so a client read never satisfies a commit-time condition. This adds a second admissible case of a collaboration beside the atomic invariant, and it names the service pairs that no composition change alone can split. Not needed while every service runs in one process, because the complexity outweighs the benefit there.
- [ ] Added 2026-09-22. Complete the command table of the group of each service. The page of each group in `engine/docs/cli/` holds a proposed table: the commands of its service, the operation of the RESTful API of each command, and the access policy of that route. A proposed row becomes a declared row when Ulrich approves it and no open item of its component blocks it. The `intake` group and its webhook route also wait for the subscription store, the delivery store and the handoff of `intake-service.impl.md`.
  - Ruled 2026-09-24 by Ulrich: a submodule owns the documents that detail the implementation of its own code, and `engine/docs/cli/` is an example. The command table of each service group lives in `engine/docs/cli/<group>.md`, not in the implementation sibling.
  - Ruled 2026-09-24 by Ulrich: the open decisions of `engine/docs/cli/` move into this file under their owning components. A CLI page holds no open-decision section, and a blocked row links its item here.

### Gateway Service

- [ ] Added 2026-09-21 by Ulrich. Provide user management after the system runs live. The current human authentication mechanism is the username-bearing JWT of `gateway-service.impl.md`; local generation accepts a username and holds no human account row or password. The design of user management decides account administration, provisioning and recovery policies, and the authority and route that ban a session through the denylist.

### Project Service

- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that an objective names a channel binding and requires its notification.
- [ ] Define the source-binding configuration for inbound provider deliveries, including webhook subscriptions and a Slack source with human identity mapping. The `source secret get` command also awaits its display, redaction and cache contract.
- [ ] Added 2026-09-24. Slack, Telegram and Jira register their platform entry and their credential types in `project-service.impl.md` when their design lands.

- [ ] Added 2026-09-24 from `engine/docs/cli/project.md`. Binding commands await version bounds, local-key allocation, replacement input and peer-reference treatment. The contract also classifies a worker-name change and declares error schemas, body bounds, timeouts and cursor rules.
- [ ] Added 2026-09-24 from `engine/docs/cli/project.md`. Project creation and rename await name constraints, Mission creation ownership, concurrency and replay reconciliation. Binding history and credential rotation await retention and concurrency contracts.
- [ ] Added 2026-09-24 from `engine/docs/cli/project.md`. `binding apply` and agent reads await repository action schemas, policy validation, prompt and instance-count bounds, and template option schemas. Provider and model catalogs also need contract declarations.
- [ ] Added 2026-09-24 from `engine/docs/cli/project.md`. Credential commands await the remote-change input, quarantine lifecycle and cross-project progress contract. GitHub App custody remains outside the first version and needs its credential mechanism.

### Mission Service

- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Mission commands await node and record prefixes, graph change records, revision initialization and increment rules, and cursor consistency. Operation contracts also need error schemas, timeouts and response limits.
- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Import and node writes await Markdown grammar, scope, boundary references, minimum criteria, verification-command form, create admission and retirement confirmation. Import and unblock also await durable request-map retention.
- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Record commands await priority bounds, task applicability, method values, evidence bounds and retention, content encoding and exceptional credential removal. External-action publication, observer state schemas, evaluation context, criterion aggregation and repository evidence formats also await contracts.
- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Human controls await the no-attempt outcome and task-outcome schemas. `node mark-ready` awaits the counter-zero readiness contract.

### Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and the count of unresolved deliveries of the Intake Service in the implementation epics, against the 1,000-project workload. Intake operations also await handoff attempt and backoff bounds, acquisition deadlines, resolved-delivery retention and bounded read sizes.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Intake, Scheduler, Project and Mission: how the delivery admission of the Scheduler classifies a delivery that the Intake Service hands over, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The server-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it. A Scheduler read of admission dispositions per project also awaits a decision.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion. The contract also covers snapshot export, acknowledgement handoff, cursor persistence, retry deadlines and retained or discarded summaries.

- [ ] Added 2026-09-24 from `engine/docs/cli/scheduler.md`. Scheduler commands await entity prefixes, request and response schemas, durable-request mapping, lease duration, renewal cadence and route timeouts. Observation-obligation reads also await the lease start contract; lists await cursor consistency and retention.

### Intake Service

- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. Subscription and delivery commands await their entity prefix declarations.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. Subscription commands await kind-specific input fields, validation, protocol state schemas and absent-state representations. Delivery reads and receipt await verification-result schemas, operation declarations, timeouts, response statuses and file bounds.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `delivery get` awaits the payload inclusion, representation, size and redaction decision.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. A human action on a parked delivery awaits authority, idempotency and state-change rules. No `delivery retry` command exists before that decision.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. Subscription mutations await incompatible-create handling, desired-state omission, disabled-source admission and retirement semantics. Candidate: omitted desired state selects `disabled`; disabled-source admission returns validation failure with HTTP 400. Lists await order and cursor validity.

### Worker Service

- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

- [ ] Added 2026-09-24 from `engine/docs/cli/worker.md`. Catalog, agent and tool commands await exact defaults, budgets, configuration constraints, platform outputs and action-result record schemas. Execution identity validation awaits the Scheduler contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/worker.md`. Agent inspection and prompt composition await global-prompt bounds. Provider-account checks remain with B9.
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
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Read and query commands await projections, order, cursor validity, concurrent arrival and expiry behavior, and unresolved-reference representation.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Trace and text reads await retention fields and durations, text retention start, trace-expiry resolution and tombstone lifetime.

### Root repository

- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`. The Makefile also copies the OpenAPI directory `static/openapi/` of `engine` into `apps`, which the build of `apps` reads.

### B9, failure and recovery

Deferred cross-service work across Mission, Scheduler, Worker and Project.

#### Cannot progress

Folded from the Worker Service section on 2026-09-18 by Ulrich, to be designed with the rest of B9.

- [ ] Define the disposition of an execution that cannot progress. Distinguish the end of an execution from the closure of an attempt: an execution ends when it cannot continue, and the attempt closes into `Blocked` only when the continuation requires a human. Define who establishes that an execution cannot progress, who authorizes a bounded continuation and who closes the attempt, for a stop that the execution reports and for a loss that the Scheduler declares, and for a reviewer execution as well as a steps execution. An automatic continuation is authorized, bounded and requires a prospect of progress, so a transient provider outage produces no queue of human unblocks and an unchanged oversized revision is not retried for ever. The conditions from the failure-exit ruling are a provider error, an invalid handoff, a verification timeout, a commit or push failure and an unsupported context size. A verification timeout can be a defect of the work and a lost push acknowledgement can be a success, so the record keeps uncertainty as uncertainty and preserves the established task results and evidence. The outcome keeps the stopping reason separate from the assessment of the criteria. The candidate representation is a direct transition `Executing -> Blocked` on a release that names the failed operation, an outcome with a third basis, an execution declaration, beside the assessment and the human assertion, a third release form of the Scheduler, and a change to the Mission sentence that every condition that reaches `Blocked` follows the evaluation except the human block. The debate of 2026-09-18 rejected the route through the evaluation as the full disposition: it fabricates an assessment for a machinery failure, it needs a checkpoint, a push and an evidence submission that the failed operation can prevent, it leaves the task-outcome obligation of the readiness condition open, it runs the verification command against a report when no snapshot exists, and a reviewer that shares the failure has no exit from `Evaluating`. The Worker page states no cannot-progress rule until this design, and today it routes only the budget end, to a release with further work. Coupled items: automatic continuation and attempt authorization, the bound on repeated releases with further work, the outcome when no assessment exists, the reviewer-loss transition, D1, SC5, W5 and A3 / W1 / W4 / PR2.
- [ ] Added 2026-09-18 by Ulrich. Define the healthcheck of a provider account, and its effect along the chain from the agent to the worker instance to the worker binding: an account that fails its check makes the effective configuration of every native agent that resolves to it unusable, so the instances of those worker bindings fail their instance healthcheck and pull no work, and an execution in flight meets the failure as a cannot-progress condition. Decide who runs the check, its freshness, whether a failing account disables itself or only reports, and how the check relates to the disablement that the Project page already has.

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
