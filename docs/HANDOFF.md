# Handoff

Open work as of 2026-09-22.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Architecture

- [ ] Added 2026-09-22. Declare the command table of the group of each service. `architecture.impl.md` rules that the implementation sibling of a service declares the table of its own group, and `gateway-service.impl.md` declares the one table that exists. The groups `project`, `mission`, `scheduler`, `worker` and `tracking` hold no table, so the surface names six groups and serves one. Each table needs the commands of its service, the operation of the RESTful API of each command, and the access policy of that route.

### Gateway Service

- [ ] Added 2026-09-21 by Ulrich. Provide user management after the system runs live. The server seeds one human account at the first start and prints its username and its password once, and it holds no second human account. Recovery of a lost credential deletes the account row and restarts the server, which seeds the account again. The design of user management decides the account routes, the authority to create an account, the password change, the revocation of the session of another account, and the route that bans one session through the denylist of `gateway-service.impl.md`.

### Project Service

- [ ] Added 2026-09-22. **Defect.** `project-service.impl.md` states that the per-operation socket holds mode `0600`. A Unix socket that Node.js creates under umask `077` holds `0700`, which a check confirmed, because `listen` takes no mode argument. The sibling needs the whole custody creation sequence: it creates and validates a fresh operation directory, creates and validates the public key, binds the socket and sets and verifies its mode before it publishes the path, and establishes and validates the known-hosts file before it launches `ssh`, and it states whether `ssh` may recreate that file. `architecture.impl.md` rules the per-kind mode and the barrier, and this sequence is the custody instance of it. Ruled 2026-09-22 by Ulrich: the first version supports both the SSH and the HTTPS transport form, so the `ssh key` credential type, the ssh-agent implementation and the socket all stay, and this defect needs its fix. Aelita proposed dropping the type to delete the agent, the socket, the per-operation directory, the public-key file and the known-hosts file, and Ulrich rejected that.
- [ ] Added 2026-09-22. Decide who removes an orphaned per-operation directory of custody. `project-service.impl.md` removes it when the operation ends, and a fatal exit of the server ends no operation, so the directory and the public key inside it stay in the state directory. This item stands, because Ulrich ruled on 2026-09-22 that both transport forms stay.
- [ ] Added 2026-09-22. Declare the basenames that custody needs: the known-hosts file of the data directory, the per-operation directory of the state directory, the socket inside it and the public-key file inside it. `project-service.impl.md` names none of them, and the file index of `architecture.impl.md` references them.
- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that an objective names a channel binding and requires its notification.
- [ ] Define the source-binding configuration for inbound provider deliveries, including webhook subscriptions and a Slack source with human identity mapping.
- [ ] Added 2026-09-18 by Ulrich. Design how custody stores the credentials and the secrets that the platform-specific implementations use: the credential types of each platform, GitHub, Slack, Telegram, Jira, the storage of the secret material at rest and its key, the OAuth refresh, and how a platform-specific implementation receives the secret at the moment of the operation without the secret leaving the server. The Project Service owns custody, so the answer goes to `project-service.md` for the rule and to `project-service.impl.md` for the mechanism. Ruled 2026-09-21 by Ulrich: `project-service.impl.md` rules custody for GitHub alone. It rules the platform-independent mechanism, the record shape, the storage of the secret material at rest with its key, the OAuth refresh, and the delivery of a secret to one operation. Slack, Telegram and Jira stay open, and each one registers its platform entry when its design lands. Ruled 2026-09-21 by Ulrich: a child process that the server spawns is part of the server, so custody passes a platform token to the `git` child and the rule that no credential leaves the server holds.

### Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and inbox depth in the implementation epics, against the 1,000-project workload.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Scheduler, Project and Mission: how a delivery is classified, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The server-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion.
- [ ] Define the freshness of the instance healthcheck for a work pull that waits before the Scheduler serves it.

### Worker Service

- [ ] Added 2026-09-22. Rule the remote runtime of an instance at the `worker` placement: the access to a provider, the repository operation, the resolution of the effective configuration of the agent, and the trust boundary of the tool and of the verification command. Each facility sits inside the server process today, and the `worker` application holds no service and reaches the server through the public API alone.
- [ ] Added 2026-09-22. Rule the end of a registration when a `worker` application dies. `worker-service.md` ends a registration on a deregistration of the program, on a restart of the server and on the loss of the client identity, so a dead `worker` application holds its registrations and a replacement meets a binding at its instance count.
- [ ] Added 2026-09-22. Place the workspace root of an execution. No page states its directory, so the file index of `architecture.impl.md` holds no row for it. The earlier candidate, the cache directory, rests on the claim that a deletion costs nothing, which an uncommitted change or locally held evidence can contradict.
- [ ] Added 2026-09-22. Declare the configuration field of the global prompt. `worker-service.impl.md` states that the prompt composer resolves the global prompt from the server configuration, and it declares no field. The field index of `architecture.impl.md` exposed the gap. The name, the format and the default are a Worker Service decision.
- [ ] POSTPONED 2026-09-18 by Ulrich to phase 2. The first version supplies the workers `general@1` and `reviewer@1`. Reconcile the one-agent rule of `worker-service.md` with the `tdd@1` worked example of `overview.md`, whose execution runs `swe@1`, `te@1` and `re@1`, and decide whether the Worker Service supplies `tdd@1`.
- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

#### Next phase

After the first native-agent worker runs the acceptance path.

- [ ] The handoff as a worker-owned protocol: a typed handoff tool with the three assertions and the stopping reason of the agent, a state machine of working, quiescing, candidate frozen, verification, judgement, recorded, and the handling of a missing, malformed, duplicate or out-of-phase handoff. The execution owns the stopping reason on a deadline, a runtime failure or a lease loss.
- [ ] Multi-agent workers, after the `tdd@1` reconciliation above. pi has no sub-agents.
- [ ] Token and currency budgets and project-level accounting. pi reports usage and cost per message.
- [ ] A clarification interface. The pi ask_question tool is the seed, and the block and unblock flow carries ambiguity until then.
- [ ] Live streaming of a running turn. pi emits streaming events. The Tracking Service page bounds this to the harness that kanthord hosts, because an external harness reaches the Tracking Service only through an import that a human issues.
- [ ] Containment beyond the minimum trust boundary, the quality and replay suite, provenance tags on tool results.

### Root repository

- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`. The Makefile also copies `static/openapi.yaml` of `engine` into `apps`, which the build of `apps` reads.

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

