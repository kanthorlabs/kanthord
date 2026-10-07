# Handoff

Open work as of 2026-09-24.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Architecture

- [ ] RULED 2026-10-07 by Ulrich. Rename the ten camelCase operation ids to the underscore form of `architecture.impl.md` section The operation ids: `gateway.openapi_file`, `mission.execution.cleared_outcome.get`, `mission.execution.pinned_revision.get`, `mission.external_action.get`, `mission.external_action.list`, `project.agent_configuration.get`, `project.agent_configuration.list`, `project.binding_revision.list`, `project.binding_set.get` and `project.binding_set.write`. Update the engine contracts, `engine/docs/cli/`, `docs/reference/gateway/openapi.md`, the `apps` contract through `make contract-sync`, and regenerate `docs/reference/workbench/tools.md`. Run it after the prompt composer implementation, which edits the same engine tree.
- [ ] Added 2026-10-05 by Ulrich. Rebuild the `Context` implementation of `engine/src/kernel/context.ts` on the Node-native `AbortController`, `AbortSignal` and `AsyncLocalStorage`.

- [ ] RULED 2026-10-02 by Ulrich, from the Intake redesign. Each service enforces system authorization for its own operations and entities, and the protected facility consumes the authorization result of the service that owns the entity of the release. The design pages hold the moves since 2026-10-03. Remaining: `engine/docs/cli/worker.md` renames `project.authorization.refused` to `worker.authorization.refused`, and the `engine/docs/cli/` page of each Mission command that answers `mission.authorization.refused` adds that code. Ulrich sent the rulings to the pi session of `engine/.agents/plan/erd-02-execution/` on 2026-10-03.

- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the receiving-side authentication contract of a forwarded caller identity. The identity value is process-local and the JWT stays in the Gateway Service, so a split that forwards a caller identity to another process needs a contract that no page holds.
- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the temporal validity of a cross-service precondition of a handler. A handler reads a fact of a peer through a client, awaits, then commits, and the fact can change during the wait: the Scheduler reads that a node is available and a human blocks it before the claim commits. Parked candidate: every cross-service precondition declares itself as a frozen snapshot, read before the commit and recorded with the effect, or as a commit-time condition, read through a collaboration inside the transaction while the two services are co-located, so a client read never satisfies a commit-time condition. This adds a second admissible case of a collaboration beside the atomic invariant, and it names the service pairs that no composition change alone can split. Not needed while every service runs in one process, because the complexity outweighs the benefit there.

### Custody component

- [ ] Added 2026-10-07 from the snake_case rename. The in-use message of a credential in `apps/src/lib/credential-message.ts` (`dependentLabel`) looks for `name` or `id` on each dependent. The engine sends `{agent_name, provider_name}` and `{binding_id, project_id}`, so the label falls back to raw JSON. Label each dependent by its own fields.

### LLM component

- [ ] POSTPONED 2026-10-05 by Ulrich until Ulrich holds an active OpenCode Go subscription. Verify the success case of the `opencode-go` check with `deepseek-v4-flash` through the scratchpad e2e call. The e2e key answers 403 "An active OpenCode Go subscription is required" today, so only the refusal case is verified. The model membership check of the Worker configuration also reads the `models` metadata through `compatibleMetadataSchema` in `worker/contract.ts`, and it moves with the same decision.

### Repository component

- [ ] Added 2026-09-26 from the responsibility audit of Project, Worker and Intake. The `ls-remote` of a binding write and of the repository healthcheck runs with the SSH configuration of the server host. It proves no reachability from the host of a `worker` application. Decide whether a check covers the worker host.

### Project Service

- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that an objective names a channel binding and requires its notification.
- [ ] Added 2026-09-24. Slack, Telegram and Jira register their platform entry and their credential types in `project-service.impl.md` when their design lands.
- [ ] Added 2026-09-26 from the pin-and-use ruling. The UI shows a removed binding with the records that reference it. No page declares that read, and the records live in the Mission, Worker and Scheduler Services. Declare the reverse lookup and the service that answers it.

### Mission Service

- [ ] Added 2026-10-02 from the debate of the Intake redesign. A human-act admission invokes the Mission operation under the linked human identity, and since 2026-10-03 no admission row exists. A crash after the act lets a repeat of the same inbound event repeat the human act. Decide how the human act becomes idempotent by the event identity.

- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Record commands await external-action publication and terminal-state retention. The debated proposals wait in `.dev/cannot/mission-record-contracts.md`.
  - Next session 2026-09-25: open with external-action publication.
- [ ] Added 2026-09-28 from the attempt simplification. The consecutive-loss count reads every `scheduler_execution` row of the node, because the rules forbid a non-unique index. Decide whether that scan stands.
- [ ] POSTPONED 2026-09-28 by Ulrich until budgets or agent limits land. Design the handoff from one execution to the next execution of a node. `mission_run_output` is dropped on 2026-09-28; the human direction stays in the node revision, and the checkpoint commit stays the only carrier inside an attempt.
- [ ] POSTPONED 2026-09-29 by Ulrich until a need for redaction arises. Design the redaction of evidence content and how an asset states it.

### Scheduler Service and delivery

- [ ] Set numerical acceptance bounds for discovery lag, claim latency and the count of pending inbound events of the Intake Service in the implementation epics, against the 1,000-project workload. Intake operations also await acquisition deadlines, the byte bound of the `error` array, the row bound of an event delete and bounded read sizes.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Intake, Scheduler, Project and Mission: how the delivery admission of the Scheduler classifies a delivery that the Intake Service hands over, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The server-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it. A Scheduler read of admission dispositions per project also awaits a decision.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion. The contract also covers snapshot export, acknowledgement handoff, cursor persistence, retry deadlines and retained or discarded summaries.

### Intake Service

- [ ] Added 2026-10-04 from the TODO fixture end-to-end test. When the Intake Service replaces its stand-in, run the `External.Success` and `External.Failed` rows of the state transition table for an objective, with a repository action. `node check` answers `system.operation.unknown` today, so those rows and every row after them are untested. The scripts and the matrix live in `.dev/e2e/261004-todo-mission/`.
- [ ] Added 2026-10-04 from the credential end-to-end test. The engine has no Intake Service, so `src/apps/server/index.ts` wires `inboundsNaming` as a stand-in that answers `[]`. An inbound cannot refuse a credential archive until the Intake Service replaces the stand-in.
- [ ] RULED 2026-09-30 by Ulrich. Reimplement push notifications in the Intake Service using Kukuroo only as a reference for its logic and ideas. Install no Kukuroo package and deploy no Kukuroo relay. The temporary proposal and its debate review live at `.dev/intake-push-notifications-plan.md`; the native push mechanism awaits its design ruling.
- [ ] RULED 2026-09-26 by Ulrich. The inbound replaces the source binding. A Slack inbound with human identity mapping waits for its platform design. That design also declares the source of the Slack signing secret, which Slack issues and kanthord cannot derive, so a passive Slack webhook needs it from custody. A platform whose challenge arrives as an unsigned `GET`, for example Meta or Twitter, needs a `GET` receipt route in its own platform design. The secret display of `intake.inbound.get` awaits its display, redaction and cache contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `inbound create` awaits the `configuration` fields beyond `resource` per kind and platform. The event reads and the receipt await timeouts and file bounds.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `event get` awaits the content inclusion, representation, size and redaction decision.

### Agent component

Added 2026-10-06 by Ulrich, from the evaluation of the agent. The Worker Service and the Workbench Service consume the component.

- [ ] Added 2026-10-07 by Ulrich. Hide the inactive prompt sources on the agent page by default. An inactive source has the state `absent` or `off`. A source with the state `invalid` stays visible, because it needs attention.
  - One switch labelled `Show inactive sources` sits in the toolbar above the layer cards. It is off by default, it applies to every layer card, and the browser keeps it per viewer in `localStorage`.
  - A layer card that hides sources shows a footer line, for example `2 inactive sources hidden`, as a button that turns the switch on. A layer card with every source hidden shows that line in place of the list.
  - A switch change on a visible row never hides that row before the next page load, so a row does not vanish under the pointer.
  - Record the rule in `agent.md` beside the other agent page rules when it lands.
- [ ] Added 2026-10-07 by Ulrich. Build the working layer switches of the repository binding form in `apps`. The `Settings` section and the prompt sections of the agent page landed on 2026-10-07.
- [ ] Give an agent session a budget input that the consumer supplies. `ExecutionBudget` reads `createdAt` and `expiredAt` of the claim.
- [ ] Move the native agent runtime, the prompt composer and the tool table from the Worker pages to the Agent pages, and split `NativeAgentInput` of `engine/src/worker/native-agent.ts` into a session input that names no execution.

### Workbench Service

Added 2026-10-06 by Ulrich. A human drives a workbench session through the chat of `apps` or through the API.

- [ ] Define how a workbench session reaches the workspace directory of each project that it acts on.
- [ ] Define how the workspace directory of a project relates to the execution workspaces under `workspaces/` of the state directory.
- [ ] Define how a workbench session pulls and executes a task through the Worker and Scheduler Services. The Workbench Service owns no worker, no registration and no claim.
- [ ] The composer of the chat shows a model picker and a reasoning-effort picker, as in the screenshot of Ulrich on 2026-10-06. Its `+` menu offers images and files, commands (`/`), context (`@`) and a shell command (`!`). Define each of the four from the capability of pi that serves it: prompt templates, file references, bash and image input.

### Worker Service

- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

#### Next phase

After the first native-agent worker runs the acceptance path.

- [ ] The handoff as a worker-owned protocol: a typed handoff tool with the three assertions and the stopping reason of the agent, a state machine of working, quiescing, candidate frozen, verification, judgement, recorded, and the handling of a missing, malformed, duplicate or out-of-phase handoff. The execution owns the stopping reason on a deadline, a runtime failure or a lease loss.
- [ ] Multi-agent workers, `tdd@1` first. pi has no sub-agents.
- [ ] Token and currency budgets and project-level accounting. pi reports usage and cost per message.
- [ ] A clarification interface. The pi ask_question tool is the seed, and the block and unblock flow carries ambiguity until then.
- [ ] Live streaming of a running turn. pi emits streaming events. The Tracking Service page bounds this to the harness that kanthord hosts, because an external harness reaches the Tracking Service only through an import that a human issues. A Tracking command awaits event schemas, start position, order, resume and loss behavior, limits, timeout, access and cancellation.
- [ ] Containment beyond the minimum trust boundary, the quality and replay suite, provenance tags on tool results.

### Gateway Service

- [ ] Added 2026-10-05 from the component split. `gateway-service.impl.md` says that the `shared` scope of the health report holds exactly `custody` and that its map holds `credential`. The engine fills that entry from the inventories of the LLM, Repository and Storage components. Decide whether `shared` becomes `{ llm, repository, storage }`.
- [ ] POSTPONED 2026-09-28 by Ulrich until Ulrich rules it. Decide whether `kanthord jwt inspect` verifies the signature, the header and the closed claim set with the server configuration.

### Tracking Service

- [ ] POSTPONED 2026-09-29 by Ulrich until the audit action is added. Added 2026-09-29 from the evidence redesign. Design the audit record of a human act, for example a content removal or a pending cleanup, so that a human who regrets a delete reads what it removed. A delete removes the row, and `architecture.impl.md` bans a soft delete.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Tracking commands await text and record identity contracts, OpenTelemetry mapping and the canonical identity-attribute registry. Execution identity validation awaits the Scheduler contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. `telemetry ingest` awaits conflicting-record and repeated-value rules, status finalization, structural refusal codes and batch-failure boundaries. Operation contracts also need timeouts and partial acknowledgement schemas.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Ingestion and reads await byte and count limits, execution bounds, local-log and segment bounds, and `fsync` bounds. Large transcript and chunk contracts also remain open.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Read and query commands await projections, expiry behavior, and unresolved-reference representation.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Trace and text reads await retention fields and durations, text retention start, trace-expiry resolution and tombstone lifetime.

### Root repository

- [ ] Added 2026-10-03 by Ulrich. Trim "Rejected proposals" of `AGENTS.md` to the narrow rule: each entry is one line that names the rejected alternative and links the page section that holds the decision, and an alternative that a page already forbids by name loses its entry.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`. The Makefile also copies the OpenAPI directory `static/openapi/` of `engine` into `apps`, which the build of `apps` reads.
  - `make contract-sync` has no publish pipeline: `engine/package.json` has no `contract:publish` script, and `apps` has no `docs/api/contract`. The `apps` wire types are written by hand in `apps/src/api/types.ts`.
  - The mock daemon of `apps/mock/` has no route for `GET /api/project/:project_id/binding`, `/api/agent/prompt*`, `/api/agent/enablement/:agent_name` or `/api/repository/credential/ssh/discover`.

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

- [ ] **B2:** Define recovery and its budget when the currency check rejects a completed assessment as stale.
- [ ] **B4 / B5:** Settle exhaustion-notice precedence after an accepted assessment and during a human override that asserts failure.
- [ ] **C3:** Define the deduplication key for an observation of an unchanged external state.
- [ ] **C5:** Decide how to handle a platform state that reverses after an accepted observation.
- [ ] **C6:** Decide how to handle an external request for which no end state ever arrives.
- [ ] **D1:** Specify recovery of an interrupted attempt closure that wrote only some owed outcomes, including idempotency, resumption and the recovery owner.
- [ ] **E2:** Confirm precedence when a non-success human override is followed by a successful machine outcome.
- [ ] **E3:** Settle human pause or discard races with completion.

#### Scheduler Service

- [ ] **SC5:** Define physical-stop enforcement and safe resource and capacity reuse when a runtime returns after a loss declaration.
- [ ] Added 2026-09-28 by Ulrich. Fence two live processes of one machine JWT. A resumed registration reuses its runtime identity, so an old process with the same JWT passes every execution proof. Ulrich accepts the risk until this item lands.

#### Worker and Project Services

- [ ] **A3 / W1 / W4 / PR2:** Specify reconciliation of repository actions with uncertain results, including remote effects that complete after revocation, and what happens when reconciliation cannot establish the result.
- [ ] **W2:** Specify how a worker records a durable action identity before performing a repository action. Since 2026-10-03 the Intake outbound request is the durable dispatch record of a configured action, so W2 covers only the writes outside the Intake Service, today the node-branch push of a steps execution.
- [ ] **W3:** Specify how a worker retrieves the acknowledgement of a write whose response it lost.
- [ ] **W5:** Specify worker stop behaviour after claim revocation, including repository operations, release of runtime resources and the workspace disposition.
- [ ] **W7:** Specify how a reviewer resumes an incomplete evaluation without repeating node execution or a repository action.
