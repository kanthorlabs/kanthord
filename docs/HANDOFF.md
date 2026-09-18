# Handoff

Open work as of 2026-09-18.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Next session

- [ ] Rule the remaining open Worker Service items one per message, the `tdd@1` reconciliation first, then the hierarchical prompt, then the external-harness repository action. Then the Tracking Service document. B9 is the last section, and only Ulrich opens it.
- [ ] Decide the link target of a definition now that no design page holds a `## Vocabulary` section. Five pages link `overview.md#vocabulary`, an anchor that no longer exists, and the vocabulary siblings link `<page>.md#vocabulary`. One set-wide editorial change follows the ruling.

## Project Service

- [ ] Decide whether the sentence `Two worker bindings of one worker carry different configuration` requires unequal values or only permits them, and reword it. Two bindings of one worker with identical values are a plausible configuration.
- [ ] Define the source-binding configuration for inbound provider deliveries, including webhook subscriptions and a Slack source with human identity mapping.
- [ ] State what a configured action follows: the passing assessment, or the expected end state of another configured action of the node. State how a policy on a binding of another kind, for example a channel, decides when a node requires its configured action, the repository strategy being the first such policy. Both wait for the notification policy design, because a notification lives on a channel binding that no page defines yet.

## Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and inbox depth in the implementation epics, against the 1,000-project workload.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Scheduler, Project and Mission: how a delivery is classified, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort.
- [ ] Add the skills and extensions that support external-harness integration.
- [ ] Define the freshness of the instance healthcheck for a work pull that waits before the Scheduler serves it.

## Worker Service

- [ ] Reconcile the one-agent rule of `worker-service.md` with the `tdd@1` worked example of `overview.md`, whose execution runs `swe@1`, `te@1` and `re@1`, and decide whether the Worker Service supplies `tdd@1`.
- [ ] Design the hierarchical prompt of a native agent: a generic prompt that the worker fixes for the agent, for example `re@1`, and a project-specific layer for the programming language, the development style and the coding conventions. `worker-service.md` today says that a worker fixes the prompt of its agent and that a project sets no prompt, so the design changes that rule. Decide whether a convention file in the repository, `AGENTS.md` or `CLAUDE.md`, informs the prompt. The first run uses the worker-fixed prompt and the pinned revision only, with repository context-file discovery disabled.
- [ ] State which service performs a configured repository action that an external harness invokes through the API, and how that path reaches the operand and reuse rules of `worker-service.md`.
- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

### Next phase

After the first native-agent worker runs the acceptance path.

- [ ] The handoff as a worker-owned protocol: a typed handoff tool with the three assertions and the stopping reason of the agent, a state machine of working, quiescing, candidate frozen, verification, judgement, recorded, and the handling of a missing, malformed, duplicate or out-of-phase handoff. The execution owns the stopping reason on a deadline, a runtime failure or a lease loss.
- [ ] Multi-agent workers, after the `tdd@1` reconciliation above. pi has no sub-agents.
- [ ] Token and currency budgets and project-level accounting. pi reports usage and cost per message.
- [ ] A clarification interface. The pi ask_question tool is the seed, and the block and unblock flow carries ambiguity until then.
- [ ] Live streaming of a running turn, after the Tracking Service page. pi emits streaming events.
- [ ] Containment beyond the minimum trust boundary, the quality and replay suite, provenance tags on tool results.

## Worker Service implementation rulings

Rulings that Ulrich made for the mechanisms of the Worker Service. A design page holds no mechanism, so the implementation epics of phase 3 consume them.

- The native agent of `general@1` runs the pi-coding-agent SDK in-process behind a kanthord-owned adapter. `worker-service.md` keeps its definition of a native agent and names no package.
- The daemon gives pi its own directories, disables discovery of user extensions, skills, prompt templates and themes, uses an in-memory session manager, disables the version check, the install telemetry and the provider catalog refresh, and pins the exact pi version. A pi version bump is a deliberate change to the workers that run on it. Every runtime setup call carries an abort signal with a deadline.
- One interception point carries every inference call of a native agent, including compaction and retries. It resolves the current binding entry under the execution identity, maps the model identifier and the reasoning effort, fails closed, and holds per-execution state so that no credential crosses executions. A custom pi provider that forwards to the model gateway is the candidate. Environment hygiene of the pi process belongs to the same mechanism.
- Tools: the tool table of a native agent holds three sources. The pi built-in tools: `general@1` enables read, edit, write, grep, find, ls and bash, and `re@1` enables read, grep, find and ls. kanthord's own tools, which the daemon serves through an MCP server that it embeds and that pi reaches as a tool source. Other tools that a project adds, including other MCP servers. The first version supports MCP v2, https://ts.sdk.modelcontextprotocol.io/v2/. The tool register and the abstraction layer for tool instances manage the three sources. The interactive ask_question tool is excluded. The page states the minimum trust boundary around tool and verification execution.
- The page requires that every commit of the execution is attributable to its task and its attempt. The carrier of that attribution is an epic decision.
- Stop and budget: the lease runs in the execution. On revocation or loss the execution aborts the pi session and dispatches nothing after. Abort is not proven to kill every descendant process, so the quiescence check before workspace reuse that the page states needs a mechanism. The page states the budget as a turn count and a wall time, enforced on pi turn events and by abort, with the bash timeout below the remaining budget.
- Traces: the pi session entries of an execution become its transcript telemetry, with the execution identity and the attempt, redacted of secrets. pi keeps its own compaction logic, and kanthord designs nothing for it.
- The acceptance path: `general@1` loop, handoff, commit and verification, push, release, independent `reviewer@1` evaluation, the configured repository action, the authoritative observation of its end state, and the `Completed` outcome. A scripted fake provider runs it deterministically, and a bounded real-provider smoke run proves the real configuration.

## Tracking Service

- [ ] Write the Tracking Service document after the Worker Service document.

## B9, failure and recovery

Deferred cross-service work across Mission, Scheduler, Worker and Project.

### Cannot progress

Folded from the Worker Service section on 2026-09-18 by Ulrich, to be designed with the rest of B9.

- [ ] Define the disposition of an execution that cannot progress. Distinguish the end of an execution from the closure of an attempt: an execution ends when it cannot continue, and the attempt closes into `Blocked` only when the continuation requires a human. Define who establishes that an execution cannot progress, who authorizes a bounded continuation and who closes the attempt, for a stop that the execution reports and for a loss that the Scheduler declares, and for a reviewer execution as well as a steps execution. An automatic continuation is authorized, bounded and requires a prospect of progress, so a transient provider outage produces no queue of human unblocks and an unchanged oversized revision is not retried for ever. The conditions from the failure-exit ruling are a provider error, an invalid handoff, a verification timeout, a commit or push failure and an unsupported context size. A verification timeout can be a defect of the work and a lost push acknowledgement can be a success, so the record keeps uncertainty as uncertainty and preserves the established task results and evidence. The outcome keeps the stopping reason separate from the assessment of the criteria. The candidate representation is a direct transition `Executing -> Blocked` on a release that names the failed operation, an outcome with a third basis, an execution declaration, beside the assessment and the human assertion, a third release form of the Scheduler, and a change to the Mission sentence that every condition that reaches `Blocked` follows the evaluation except the human block. The debate of 2026-09-18 rejected the route through the evaluation as the full disposition: it fabricates an assessment for a machinery failure, it needs a checkpoint, a push and an evidence submission that the failed operation can prevent, it leaves the task-outcome obligation of the readiness condition open, it runs the verification command against a report when no snapshot exists, and a reviewer that shares the failure has no exit from `Evaluating`. The Worker page states no cannot-progress rule until this design, and today it routes only the budget end, to a release with further work. Coupled items: automatic continuation and attempt authorization, the bound on repeated releases with further work, the outcome when no assessment exists, the reviewer-loss transition, D1, SC5, W5 and A3 / W1 / W4 / PR2.
- [ ] Added 2026-09-18 by Ulrich. Define the healthcheck of a provider account, and its effect along the chain from the agent to the worker instance to the worker binding: an account that fails its check makes the effective configuration of every native agent that resolves to it unusable, so the instances of those worker bindings fail their instance healthcheck and pull no work, and an execution in flight meets the failure as a cannot-progress condition. Decide who runs the check, its freshness, whether a failing account disables itself or only reports, and how the check relates to the disablement that the Project page already has.

### Policy and budgets

- [ ] Decide which failures permit automatic continuation and what authorizes a further node attempt.
- [ ] **SC3 / SC4:** Define resumption charging, exactly one debit per loss under repeated notices, whether a clean release avoids a charge, and budget reset authority, including whether a fresh evaluation identity resets its allowance.
- [ ] **A7 / B3:** Decide whether exhaustion of a resumption or evaluation-retry budget closes the attempt, publishes an outcome and gives that outcome current effect.
- [ ] Define the publisher and meaning of an outcome when an evaluation produces no assessment.
- [ ] Bound the repetition of a release with further work on a resource budget end when the execution makes no progress.

### Mission Service

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

### Scheduler Service

- [ ] **C1:** Specify recovery of an observation obligation when the observer is lost before recording the observation.
- [ ] **SC5:** Define physical-stop enforcement and safe resource and capacity reuse when a runtime returns after a loss declaration.

### Worker and Project Services

- [ ] **A3 / W1 / W4 / PR2:** Specify reconciliation of repository actions with uncertain results, including remote effects that complete after revocation, and what happens when reconciliation cannot establish the result.
- [ ] **W2:** Specify how a worker records a durable action identity before performing a repository action.
- [ ] **W3:** Specify how a worker retrieves the acknowledgement of a write whose response it lost.
- [ ] **W5:** Specify worker stop behaviour after claim revocation, including repository operations, release of runtime resources and the workspace disposition.
- [ ] **W7:** Specify how a reviewer resumes an incomplete evaluation without repeating node execution or a repository action.
