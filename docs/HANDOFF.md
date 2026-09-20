# Handoff

Open work as of 2026-09-20.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Next session

- [ ] Resolve the Phase 1 items below, one at a time, with the protocol: debate, pi, debate. The pairwise interaction review of the five service pages closed on 2026-09-20 and produced every one of them. Start with the Project Service, because two rounds found the same missing contract there. B9 is the last section, and only Ulrich opens it.

## Phase 1

The completion of the design set. An item here changes a design page, a vocabulary sibling or an implementation sibling at the root.

The pairwise interaction review of 2026-09-20 found every item below. It reviewed the ten pairs of the five service pages in ten rounds. Each round built the interaction inventory of its pair, then a debate engine challenged the finding list. The Worker Service against the Tracking Service produced no defect. Resolve one item at a time with the protocol: debate, pi, debate.

### Design set

- [ ] Rule whether a design page with no parked mechanism needs an implementation sibling. Only `worker-service.md` and `tracking-service.md` have one today. The custody item of the Project Service already directs a mechanism to `project-service.impl.md`, which does not exist. Either create `project-service.impl.md`, `mission-service.impl.md` and `scheduler-service.impl.md`, or state that a sibling appears with its first mechanism.

### Gateway Service

The sixth service. `gateway-service.md` and `gateway-service.vocabulary.md` hold its rules, and every ruling of 2026-09-20 is written there, on `architecture.md`, on `overview.md` or on the page that the ruling names. The rulings left this file on 2026-09-20.

- [ ] Decide whether the credential custody of the Project Service covers the credentials of a human account, or whether the Gateway Service holds its own custody of them. `project-service.md:94-96` makes custody a dedicated component of the Project Service and puts secret material behind the protected facility. `gateway-service.vocabulary.md` gives the Gateway Service an account store for the accounts of humans. One page must state which component holds the credentials of a human account. Raised by the writing of 2026-09-20 and not yet ruled.
- [ ] Write `gateway-service.impl.md`, with the other implementation siblings. It holds the mechanism of the RESTful API, of the logging and of the request validation, the mechanism by which a human authenticates from the CLI, and the mechanism of the account store. Ulrich stated on 2026-09-20 that the engine already holds Hono for the RESTful API, pino for the logging and zod for the validation.

### Mission Service

- [ ] Use the claim kinds that `scheduler-service.vocabulary.md:66-67` owns, `steps claim` and `evaluation claim`. `mission-service.md:487` says `Execution claim`, and `mission-service.md:498,523` say `Reviewer claim`. Correct the Mermaid edge labels at `mission-service.md:540,551`. The Scheduler item on `scheduler-service.md:286` is the other half. Found by round 5.
- [ ] Qualify the verification input of `mission-service.md:194`. The sentence states without qualification that the files the command reads belong to the repository and stay mutable. `worker-service.md:473-474` states that the reviewer execution places the produced evidence in its workspace when the evidence names no repository snapshot, and the command runs there. The steps method of `worker-service.md:314` produces a report for an initiative, not a snapshot. State also what the tested snapshot names in the produced-evidence case, because `worker-service.md:475` binds the machine-check result to it and `mission-service.md:431` requires the assessment to name it. Found by round 6.
- [ ] Name the actor or the event that supplies the accepted fact for `Available -> Waiting` at `mission-service.md:488`, or delete the row when the transition is unreachable. `mission-service.md:353` holds no claim on an `Available` node, so no live execution exists, and `scheduler-service.md:262-263` releases only from a live execution. Found by round 5.
- [ ] Rename the evidence submission of `mission-service.md:273`, which uses the term `ingestion`. `tracking-service.vocabulary.md:120-122` defines an ingestion as one finite import that a human issues from the local store of an external harness, and `tracking-service.impl.md:59-69` uses that meaning. Ulrich rules which page keeps the term before the repair. Found by round 7.

### Scheduler Service

- [ ] Use `evaluation claim` at `scheduler-service.md:286`, which says `reviewer claim` against the vocabulary that the page owns at `scheduler-service.vocabulary.md:66-67`. The Mission item on the same term is the other half. Found by round 5.
- [ ] Add a citation near `scheduler-service.md:201` that names the Project Service as the source of the availability state of a binding. `scheduler-service.md:254` cites the Project Service for the instance count, and `project-service.md:66` owns both fields together. Found by round 2.
- [ ] Delete `with a default of 0` from `scheduler-service.md:59`, and keep the cross-reference at `scheduler-service.md:61`. `mission-service.md:75` owns the fact that an absent priority reads 0. Found by round 5.
- [ ] Replace the restatement at `scheduler-service.md:30` with a link to `mission-service.md#boundary`, and keep the coalescing sentence. `mission-service.md:605` owns the fact that the Mission Service wakes the Scheduler Service after the commit. Found by round 5.
- [ ] Replace the transaction language at `scheduler-service.md:28,47-48` with a link to `mission-service.md#boundary`. `mission-service.md:604` owns the fact that the Mission Service writes the queue entries in the transaction that commits the accepted claimability-changing facts. Found by round 5.
- [ ] Replace `scheduler-service.md:250` with a link to `mission-service.md#evaluation-and-assessment`. `mission-service.md:295` owns the policy that kanthord does not verify the separation of duties inside an external harness. Found by round 5.

### Worker Service

- [ ] Rename the `gateway` term to `connector` across the set, as Ulrich ruled on 2026-09-20. The closed set of `worker-service.vocabulary.md:120-127` becomes the model connector, the repository connector and the platform connector. The term appears 60 times in six files: `worker-service.md` 35, `worker-service.vocabulary.md` 10, `worker-service.impl.md` 6, `architecture.md` 2, `scheduler-service.vocabulary.md` 2 and `scheduler-service.md` 1. The rename moves the heading at `worker-service.md:379`, the anchor that `scheduler-service.md:119` targets, the anchor that `worker-service.md:47,381` target, and participant labels in four Mermaid diagrams. The reason is that the Gateway Service is the inbound door and a connector is the outbound door, so one word must not name both.
- [ ] State in `worker-service.md` that the execution receives the trace identity and the root span identity from the claim response, and that it tags its telemetry with them. `scheduler-service.md:228-229,231` returns both fields, and `tracking-service.md:143` requires the trace identity on every telemetry record. `worker-service.md:200` enumerates what the execution takes for its method without them, and the diagram at `worker-service.md:190` omits them. Name the trace identity at `worker-service.impl.md:123` among the fields that the transcript telemetry carries. Found by round 8.
- [ ] Delete the sentence at `worker-service.md:387` that repeats the prohibition of `project-service.md:35-36`, that no service infers the platform from the repository address. Keep the gateway-selection sentence and the existing link at `worker-service.md:385`. Found by round 3.
- [ ] Change the anchor at `worker-service.md:207` to `mission-service.md#the-unblock`. The current anchor targets `mission-service.md#the-read` at `mission-service.md:727`, which describes the client reads of a blocked node. The execution reads after an unblock are at `mission-service.md:685-692`. Found by round 6.
- [ ] Add a navigable reference on the ownership sentence of `worker-service.vocabulary.md:246`, which repeats the heading `instance healthcheck` that `scheduler-service.vocabulary.md:115` owns. Keep the heading, because a removal breaks an inbound anchor. Found by round 8.
- [ ] Qualify `worker-service.impl.md:31` so that the resolution of an evaluation method stops at the repository binding and reads no workspace agent file. The line resolves the project prompt from the repository binding, then `AGENTS.md`, then `CLAUDE.md` of the workspace root, with no method distinction. `worker-service.md:93-94` states that the evaluation method uses the configured source only, read through the Project Service per `project-service.md:55-56`. Found by round 3.
- [ ] Replace the handoff at `worker-service.impl.md:128` with the concrete step it stands for: the agent declares its work done, and the execution writes the task assessment and the task outcome. The handoff as a worker-owned protocol is open work of Phase 2, so the sibling describes a mechanism that no design page defines. Found by round 6.

### Tracking Service

- [ ] Repair `tracking-service.impl.md:65-67` after the removal of `Deferred`. The cursor holds the position of the last record of a contiguous run of terminal dispositions, and the extension keeps a record with a terminal disposition that follows a record without one. Every disposition is now terminal, so the run and the gap that these lines handle cannot occur. The cursor advances to the last acknowledged record. Ulrich ruled the removal of `Deferred` on 2026-09-20, and every implementation sibling comes last.
- [ ] Replace `of its claim` with `of its execution` at `tracking-service.md:123`, then follow the repair at `tracking-service.impl.md:36`. `scheduler-service.md:228-229` places the trace identity and the root span identity on the execution record, not on the claim. Found by round 9.
- [ ] Name the service that opens and writes the root span of an execution at `tracking-service.md:53-54`, which names the daemon. The Scheduler Service page never states that it writes a root span, and `tracking-service.vocabulary.md:39` gives the Scheduler as its example. The obligation cannot join the atomic claim operation, because `tracking-service.md:107-110` states that a telemetry write is never part of the operation that it records. Found by round 9.
- [ ] State at `tracking-service.impl.md:87-88` that the authentication of the human applies to the ingestion call, not the client identity of the extension. The lines give the extension the ownership of the ingestion, and `tracking-service.md:134` requires a human to issue it. `project-service.md:90` states that the client secret authenticates the instance and authorizes no operation, and `project-service.md:110-116` gives the client identity no path for a non-resource operation. Found by round 4.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Project Service

- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that an objective names a channel binding and requires its notification.
- [ ] Define the source-binding configuration for inbound provider deliveries, including webhook subscriptions and a Slack source with human identity mapping.
- [ ] Added 2026-09-18 by Ulrich. Design how custody stores the credentials and the secrets that the platform-specific implementations use: the credential types of each platform, GitHub, Slack, Telegram, Jira, the storage of the secret material at rest and its key, the OAuth refresh, and how a platform-specific implementation receives the secret at the moment of the operation without the secret leaving the daemon. The Project Service owns custody, so the answer goes to `project-service.md` for the rule and to `project-service.impl.md` for the mechanism.

### Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and inbox depth in the implementation epics, against the 1,000-project workload.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Scheduler, Project and Mission: how a delivery is classified, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The daemon-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion.
- [ ] Define the freshness of the instance healthcheck for a work pull that waits before the Scheduler serves it.

### Worker Service

- [ ] POSTPONED 2026-09-18 by Ulrich to phase 2. The first version supplies the workers `general@1` and `reviewer@1`. Reconcile the one-agent rule of `worker-service.md` with the `tdd@1` worked example of `overview.md`, whose execution runs `swe@1`, `te@1` and `re@1`, and decide whether the Worker Service supplies `tdd@1`.
- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

#### Next phase

After the first native-agent worker runs the acceptance path.

- [ ] The handoff as a worker-owned protocol: a typed handoff tool with the three assertions and the stopping reason of the agent, a state machine of working, quiescing, candidate frozen, verification, judgement, recorded, and the handling of a missing, malformed, duplicate or out-of-phase handoff. The execution owns the stopping reason on a deadline, a runtime failure or a lease loss.
- [ ] Multi-agent workers, after the `tdd@1` reconciliation above. pi has no sub-agents.
- [ ] Token and currency budgets and project-level accounting. pi reports usage and cost per message.
- [ ] A clarification interface. The pi ask_question tool is the seed, and the block and unblock flow carries ambiguity until then.
- [ ] Live streaming of a running turn. pi emits streaming events. The Tracking Service page bounds this to the harness that the daemon hosts, because an external harness reaches the Tracking Service only through an import that a human issues.
- [ ] Containment beyond the minimum trust boundary, the quality and replay suite, provenance tags on tool results.

### Root repository

- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`.

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

