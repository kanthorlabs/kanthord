# Handoff

Open work as of 2026-09-24.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Architecture

- [ ] RULED 2026-10-07 by Ulrich. Rename the ten camelCase operation ids to the underscore form of `architecture.impl.md` section The operation ids: `gateway.openapi_file`, `mission.execution.cleared_outcome.get`, `mission.execution.pinned_revision.get`, `mission.external_action.get`, `mission.external_action.list`, `project.agent_configuration.get`, `project.agent_configuration.list`, `project.binding_revision.list`, `project.binding_set.get` and `project.binding_set.write`. Update the engine contracts, `engine/docs/cli/`, `docs/reference/gateway/openapi.md`, the hand-written `apps` wire types in `apps/src/api/types.ts`, and regenerate `docs/reference/workbench/tools.md`. Run it after the prompt composer implementation, which edits the same engine tree.
- [ ] Added 2026-10-05 by Ulrich. Rebuild the `Context` implementation of `engine/src/kernel/context.ts` on the Node-native `AbortController`, `AbortSignal` and `AsyncLocalStorage`.

- [ ] RULED 2026-10-02 by Ulrich, from the Intake redesign. Each service enforces system authorization for its own operations and entities, and the protected facility consumes the authorization result of the service that owns the entity of the release. The design pages hold the moves since 2026-10-03. Remaining: `engine/docs/cli/worker.md` renames `project.authorization.refused` to `worker.authorization.refused`, and the `engine/docs/cli/` page of each Mission command that answers `mission.authorization.refused` adds that code. Ulrich sent the rulings to the pi session of `engine/.agents/plan/erd-02-execution/` on 2026-10-03.

- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the receiving-side authentication contract of a forwarded caller identity. The identity value is process-local and the JWT stays in the Gateway Service, so a split that forwards a caller identity to another process needs a contract that no page holds.
- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the temporal validity of a cross-service precondition of a handler. A handler reads a fact of a peer through a client, awaits, then commits, and the fact can change during the wait: the Scheduler reads that a node is available and a human blocks it before the claim commits. Parked candidate: every cross-service precondition declares itself as a frozen snapshot, read before the commit and recorded with the effect, or as a commit-time condition, read through a collaboration inside the transaction while the two services are co-located, so a client read never satisfies a commit-time condition. This adds a second admissible case of a collaboration beside the atomic invariant, and it names the service pairs that no composition change alone can split. Not needed while every service runs in one process, because the complexity outweighs the benefit there.

### LLM component

- [ ] POSTPONED 2026-10-05 by Ulrich until Ulrich holds an active OpenCode Go subscription. Verify the success case of the `opencode-go` check with `deepseek-v4-flash` through the scratchpad e2e call. The e2e key answers 403 "An active OpenCode Go subscription is required" today, so only the refusal case is verified. The model membership check of the Worker configuration also reads the `models` metadata through `compatibleMetadataSchema` in `worker/contract.ts`, and it moves with the same decision.

### Repository component

- [ ] Added 2026-09-26 from the responsibility audit of Project, Worker and Intake. The `ls-remote` of a binding write and of the repository healthcheck runs with the SSH configuration of the server host. It proves no reachability from the host of a `worker` application. Decide whether a check covers the worker host.

### Project Service

- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that a node names a channel binding and requires its notification.
- [ ] Added 2026-09-24. Slack, Telegram and Jira register their platform entry and their credential types in `project-service.impl.md` when their design lands.
- [ ] Added 2026-09-26 from the pin-and-use ruling. The UI shows a removed binding with the records that reference it. No page declares that read, and the records live in the Mission, Worker and Scheduler Services. Declare the reverse lookup and the service that answers it.

### Mission Service

- [ ] RULED 2026-10-17 by Ulrich. Implement the flat-node model of [mission-service.md](mission-service.md): no node kinds and no containment, `work` and `requires` on each node, tasks as content of a `change` node with `task_<ulid>` identities, and the [match](scheduler-service.md#match) of the Scheduler Service. kanthord is not deployed, so the refactor rewrites the mission schema in place with no data migration. The design pages already state the result; update the engine code, the tests, the OpenAPI files, `engine/docs/cli/`, `apps`, `docs/reference/`, `docs/explanation/`, `docs/README.md:27`, the ERD anchor `#edge-kind` of `docs/reference/erd/01-setup.md:196`, and the work and trait match of the dashboard "no taker" view in `apps/src/lib/claim-takers.ts`.

- [ ] Added 2026-10-02 from the debate of the Intake redesign. A human-act admission invokes the Mission operation under the linked human identity, and since 2026-10-03 no admission row exists. A crash after the act lets a repeat of the same inbound event repeat the human act. Decide how the human act becomes idempotent by the event identity.

- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Record commands await external-action publication and terminal-state retention. The debated proposals wait in `.dev/cannot/mission-record-contracts.md`.
  - Next session 2026-09-25: open with external-action publication.
- [ ] POSTPONED 2026-09-28 by Ulrich until budgets or agent limits land. Design the handoff from one execution to the next execution of a node. `mission_run_output` is dropped on 2026-09-28; the human direction stays in the node revision, and the checkpoint commit stays the only carrier inside an attempt.
- [ ] POSTPONED 2026-09-29 by Ulrich until a need for redaction arises. Design the redaction of evidence content and how an asset states it.

### Scheduler Service and delivery

- [ ] RULED 2026-10-09 by Ulrich. The ERD 3 values of the Intake Service bounds stand: `PENDING_EVENT_LIMIT`, `ERROR_ARRAY_MAX_BYTES`, `ERROR_MESSAGE_MAX_BYTES`, `RESULT_MAX_BYTES`, `DELETE_IDS_MAX`, `PLATFORM_CALL_DEADLINE_MS`, `GIT_WRITE_DEADLINE_MS`, `ACTION_PERFORM_TIMEOUT_MS`, `ADMISSION_CONCURRENCY` and `READ_ANSWER_MARGIN_MS`. Decision D12 of `engine/.agents/plan/erd-03-integration/decisions.md` holds the values, and `engine/src/intake/contract.ts` declares them. The Intake Service refuses a range delete that matches more than `DELETE_IDS_MAX` rows. The poll loops that start with the server start at offsets spread evenly over the poll interval. The item stays open only for the acceptance tests of discovery lag, claim latency and the count of pending inbound events against the 1,000-project workload.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Intake, Scheduler, Project and Mission: how the delivery admission of the Scheduler classifies a delivery that the Intake Service hands over, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The server-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it. A Scheduler read of admission dispositions per project also awaits a decision.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion. The contract also covers snapshot export, acknowledgement handoff, cursor persistence, retry deadlines and retained or discarded summaries.

### Intake Service

- [ ] Added 2026-10-04 from the credential end-to-end test. The engine has no Intake Service, so `src/apps/server/index.ts` wires `inboundsNaming` as a stand-in that answers `[]`. An inbound cannot refuse a credential archive until the Intake Service replaces the stand-in.
- [ ] RULED 2026-09-30 by Ulrich. Reimplement push notifications in the Intake Service using Kukuroo only as a reference for its logic and ideas. Install no Kukuroo package and deploy no Kukuroo relay. The temporary proposal and its debate review live at `.dev/intake-push-notifications-plan.md`; the native push mechanism awaits its design ruling.
- [ ] RULED 2026-09-26 by Ulrich. The inbound replaces the source binding. A Slack inbound with human identity mapping waits for its platform design. That design also declares the source of the Slack signing secret, which Slack issues and kanthord cannot derive, so a passive Slack webhook needs it from custody. A platform whose challenge arrives as an unsigned `GET`, for example Meta or Twitter, needs a `GET` receipt route in its own platform design. The secret display of `intake.inbound.get` awaits its display, redaction and cache contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `inbound create` awaits the `configuration` fields beyond `resource` per kind and platform. The event reads and the receipt await timeouts and file bounds.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `event get` awaits the content inclusion, representation, size and redaction decision.

### Agent component

Added 2026-10-06 by Ulrich, from the evaluation of the agent. The Worker Service and the Workbench Service consume the component.

- [ ] Added 2026-10-07 by Ulrich. Build the working layer switches of the repository binding form in `apps`. The `Settings` section and the prompt sections of the agent page landed on 2026-10-07.
- [ ] Give an agent session a budget input that the consumer supplies. `ExecutionBudget` reads `createdAt` and `expiredAt` of the claim.
- [ ] Move the native agent runtime, the prompt composer and the tool table from the Worker pages to the Agent pages, and split `NativeAgentInput` of `engine/src/worker/native-agent.ts` into a session input that names no execution.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Show the cooldown of each chain entry on the agent page of `apps`, with a badge and a Clear action, as [agent.md](agent.md#views) requires. `apps/src` reads no cooldown today, so only `kanthord agent cooldown list` and `clear` serve it. [native-agent.md](../explanation/native-agent.md#the-fallback-chain) states the gap.

### Workbench Service

Added 2026-10-06 by Ulrich. A human drives a workbench session through the chat of `apps` or through the API.

- [ ] Define how a workbench session reaches the workspace directory of each project that it acts on.
- [ ] Define how the workspace directory of a project relates to the execution workspaces under `workspaces/` of the state directory.
- [ ] Define how a workbench session pulls and executes a task through the Worker and Scheduler Services. The Workbench Service owns no worker, no registration and no claim.
- [ ] The composer of the chat shows a model picker and a reasoning-effort picker, as in the screenshot of Ulrich on 2026-10-06. Its `+` menu offers images and files, commands (`/`), context (`@`) and a shell command (`!`). Define each of the four from the capability of pi that serves it: prompt templates, file references, bash and image input.

### Worker Service

- [x] RULED 2026-10-11 by Ulrich. Rename the worker `general@1` to `coder@1`, which holds only `swe@1` and the method `steps`. Remove the worker `developer@1`, the method `reviewed_steps`, the `review` and `fix` prompt templates and the task review code. The native workers are `coder@1` and `reviewer@1`; `RELEASED_WORKER_NAMES` lists both. The design pages and `docs/` already state the result; update the engine code, the tests, `engine/docs/cli/worker.md` and the `apps` worker lists.
- [ ] Decide whether a node names a worker binding, so that one worker binding claims it. Today any worker binding that matches the work, the requires list and the state of a node claims it, so two `change` nodes with the same work and requires list cannot use different models or prompts. Ulrich deferred this on 2026-10-11.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Make a `reviewer@1` execution that claims from `External.Requested` skip the evaluation and only call `worker.action.request`, as [worker-service.md](worker-service.md#evaluation-and-required-external-actions) requires. `runNativeExecution` of `engine/src/worker/native-method.ts` runs `runEvaluation` for every evaluation claim, so a chained action evaluates the node again, and a `criterion-not-met` there blocks the node because the attempt holds a request. [worker.md](../explanation/worker.md#how-reviewer1-judges) states the gap.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Decide how a rework reaches a task when the rationale names no task id: an unmet criterion of the `change` node or a default-standard violation that `re@1` lists under the node id. `startCheck` of `engine/src/worker/steps-objective.ts` matches task ids only. When `swe@1` judges every task met, the execution releases the same head, and the next review can block the node at `mission.rework_limit`. [coder-worker.md](../explanation/coder-worker.md#step-6-the-start-check) states the behavior.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Make the workspace hold cover every worker process of one host. [worker-service.md](worker-service.md#executions) requires that an execution confirms that no earlier execution still acts in a workspace before the reuse. `WorkspaceRoot` of `engine/src/worker/workspace.ts` keeps the hold in memory, so it covers one process only. Two `kanthord serve worker` processes of one host share `workspaces/` of the state directory. An execution of the second process can reuse the workspace of a `change` node while a lost execution of the first process still runs a command in it. [coder-worker.md](../explanation/coder-worker.md#limits) states the gap. `worker-service.impl.md` section Stop and budget records that the quiescence check needs a mechanism, and B9 item W5 owns the workspace disposition after a revocation. Added 2026-10-14: each pool slot of the `server` placement holds its own `workspaces/` under [the slot root](worker-service.impl.md#isolation-of-a-server-placement-instance). The gap therefore covers only `worker` processes that share one state directory.
- [ ] Added 2026-10-14. Run a slot thread of the `server` placement from the single binary live. The release embeds `worker-thread.cjs`, and no test starts a thread from that asset.
- [ ] Added 2026-10-14. Carry the MCP path over the port transport when a native agent calls an MCP tool. `servePort` refuses a `stream` operation today, and the worker unit calls none.
- [ ] Added 2026-10-14. Decide a heap limit for a worker thread of the `server` placement through `resourceLimits`, and its configuration key in the `worker` section. A thread without a limit can exhaust the memory of the server process.
- [ ] Added 2026-10-14. Decide the removal of a slot root `workers/<client_id>/` after the removal of its binding or a lowered count. The root keeps the log, the transcripts and the workspaces of the slot, and no rule removes it today.
- [ ] Added 2026-10-14. Decide the OS containment of the agent tool and verification child processes at both placements. These processes run as the OS user of their host process. At the `server` placement, they can read the database files and `kanthord.yaml` of the server and can signal the server process. [worker-service.md](worker-service.md#instances-and-hosting) states this limit. The options are a separate OS user, bwrap or landlock on Linux, and sandbox-exec on macOS. The item "Containment beyond the minimum trust boundary" of the next phase is related.
- [ ] Added 2026-10-14. Decide the checks of a pi version bump beyond the tool set: the `PI_*` environment variables and the `settings.json` keys that pi reads, the programs that the session path of pi spawns, and a session test that blocks every network call except the model provider.

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

- [ ] POSTPONED 2026-09-28 by Ulrich until Ulrich rules it. Decide whether `kanthord auth jwt inspect` verifies the signature, the header and the closed claim set with the server configuration.

### Tracking Service

- [ ] POSTPONED 2026-09-29 by Ulrich until the audit action is added. Added 2026-09-29 from the evidence redesign. Design the audit record of a human act, for example a content removal or a pending cleanup, so that a human who regrets a delete reads what it removed. A delete removes the row, and `architecture.impl.md` bans a soft delete. Added 2026-10-12 from the harness-1 run: the reason of an unblock, a pause, a resume and a ready is validated and stored nowhere. Only a block, a discard and an override store their reason, in the outcome.
- [ ] Added 2026-10-12 from the worker tracing. Review the values that the implementation chose without a ruling: `EXECUTION_RECORD_LIMIT` 50000, the refusal reason enum, the dispositions `Stored` and `Refused`, the root producer `scheduler`, and the root end status `Error` on a stop or a loss.
- [ ] Added 2026-10-12 from the worker tracing. `kanthord upgrade` does not migrate `tracking.db`. A fresh file migrates at the server start. Add the upgrade path before the second tracking migration.
- [ ] Added 2026-10-12 from the worker tracing. The `steps` method of a `report` node writes only verification spans, no `worker.phase` and no `worker.task` span.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Tracking commands await the OpenTelemetry mapping and the canonical identity-attribute registry. RULED 2026-10-11 by Ulrich: [worker-contract.md](../explanation/worker-contract.md#identities) rules the span, record and text identities of worker records, the split of a text above 60 KiB, and the attribute names of the worker span catalog. Execution identity validation awaits the Scheduler contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. `telemetry ingest` awaits conflicting-record and repeated-value rules, status finalization, structural refusal codes and batch-failure boundaries. Operation contracts also need timeouts and partial acknowledgement schemas.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Ingestion and reads await byte and count limits, execution bounds, local-log and segment bounds, and `fsync` bounds. Large transcript and chunk contracts also remain open.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Read and query commands await projections, expiry behavior, and unresolved-reference representation.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Trace and text reads await retention fields and durations, text retention start, trace-expiry resolution and tombstone lifetime.

### Root repository

- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`. The Makefile also copies the OpenAPI directory `static/openapi/` of `engine` into `apps`, which the build of `apps` reads.
- [x] Added 2026-10-12 from the harness-1 run. `make sync` pushes the root `main` directly in phase 8, and the `main` ruleset accepts a change only through a pull request. Decide whether `make sync` keeps a parent push.
  - Ruled 2026-10-16 by Ulrich: phase 8 pushes the parent to a branch `sync/<yymmdd-HHMM>` and opens a pull request with `gh pr create`. Phase 9 checks only the submodules. `AGENTS.md` records the rule.

### End-to-end run harness-1

Ulrich stopped the run on 2026-10-12. The items below come from `.dev/notes.md`. Read `scripts/e2e/` and `docs/brainstorm/assets/todoapp/plan` first.

- [x] Added 2026-10-12. Resume or replace the run. State: `foundation`, `operations`, `persistence` and `authentication` are Completed. `todos` is Paused on attempt 1 with one commit `0fccccf`. `todo-api` is Available. `acceptance` is Pending. The workers `coder-1` and `reviewer-1` are stopped. To resume, run `make e2e-restart RUN=harness-1`, then resume `todos` with target `Available`. Run data is in `.dev/e2e/harness-1`.
  - Ruled 2026-10-16 by Ulrich: the run ends. The dev database holds no `harness-1` project, and the run directory is gone.
- [x] Added 2026-10-12. The run needs a provider with enough quota (S47). On 2026-10-12 every free provider was exhausted: the OpenRouter daily cap of 1,000 requests (reset 00:00 UTC), the NVIDIA rate limit, both Codex accounts and every Qwen free model. The fallback chain then spent more time in cooldown than in work. Decide between a wait for the OpenRouter reset, the paid `E2E_ANTHROPIC_KEY` and the unused `E2E_LLM_OPENCODE_KEY`.
  - Ruled 2026-10-16 by Ulrich: `todoapp.json` runs `claude-haiku-5-5` for `swe@1` and `re@1` through the LLM credential `anthropic-subscription`. The repository names no machine-specific credential. The [todo app README](assets/todoapp/README.md) states the login step.
  - Closed 2026-10-16: the ruling above settles the provider.
- [x] Added 2026-10-12. Merge without a human step (S12 layer 2). Add an auto-merge option and a model rotation command.
  - Ruled 2026-10-15 by Ulrich: auto-merge plan approved. The pages record the release fold, the deferred check, the merge write and the merge request. The model rotation command stays open in this item.
    - Green: the passing kanthord assessment of the tested commit, plus every rule that GitHub enforces at the merge call. kanthord reads no CI state.
    - kanthord does not retry a refused merge.
    - Live run `automerge-1` done on 2026-10-16: kanthord merged pull requests #47 to #52 with no human merge. The conflict rework path ran only in engine e2e E08.14.
  - Ruled 2026-10-16 by Ulrich: the model rotation command is dropped. No page defines it, and the fallback chain and an enablement edit cover a model change.
- [ ] Added 2026-10-12. Run the fresh attempt of S23 live: a human block, then an unblock with `start_point: "base_branch"`, then a native steps execution and a review on the branch `kanthord/<node id>-a<k>`. The engine e2e layer covers only the server path.

### Findings of the harness-1 run

Each item names its owner. Read the owning design document before taking an item.

- [x] Added 2026-10-12. Worker Service (S16). The pull loop claims again at once after a `provider_failed` stop. Check whether the cooldown of the fallback chain now bounds this. If not, keep a backoff after a stop.
  - Closed 2026-10-16: an advancing `provider_failed` stop sets a chain cooldown, and the next claim takes the next chain entry or answers no work. Every other `provider_failed` code counts as a failure, and the [stop backoff](scheduler-service.md#claims-and-counts) holds the node.
- [ ] Added 2026-10-12. Worker and Project Services (S25 gap). A fresh workspace that continues an attempt with no repository evidence starts from the base branch with no signal, although the remote node branch is gone.
- [ ] Added 2026-10-12. Project Service (S21). `POST .../binding/<worker binding>/verify` answers `project.binding.not_found`. Return a code that names the worker binding.
- [x] Added 2026-10-12. Agent component (S28). The chain view shows an expired cooldown row (`until_at` in the past), and `active_position` skips it. Decide whether the view keeps the row for the dashboard to badge only a live `until_at`, or answers null for an expired row. `agent.impl.md` section The chain view records the first reading.
  - Ruled 2026-10-16 by Ulrich: the view keeps the expired row, because its strikes decide the next cooldown. The dashboard reads only `cooling`, which is null unless every chain entry has a live cooldown.
- [ ] Added 2026-10-12. `apps` (S19). After an unblock, the proposal of the earlier attempt keeps the badge "proposed". Show a "superseded" badge when `proposal.attempt` is below the attempt of the `report` node.
- [ ] Added 2026-10-12. Council. Engine PR #37 and root PR #53 wait for the review of the team. Open: the eslint `apps-cli` allowance for the mission `plan-file.ts` and `parser.ts`, the six council agents are not in `agent.impl.md`, and council has no live run.

### Findings of the automerge-1 run

Run data is in `.dev/e2e/automerge-1`. Each item names its owner.

Ruled 2026-10-16 by Ulrich: the run ends with the project paused. `todo-api.md` stays Blocked with two app defects of the initiative review: `src/http/errors.js` leaks log data through `console.error`, and `RepositoryError database_busy` answers 500 instead of 503.

Ruled 2026-10-16 by Ulrich: one engine pull request fixes the findings below, branched from engine main after engine PR #59 merges. The layer order is the unpushed work loss (S25 gap), the git error text, the git spans of the finish, the claim backoff, then the flaky test. Each layer carries a test that fails without its change.

- [x] Added 2026-10-16. Repository component. `runGitTask` of `src/repository/connector.ts` catches every git error and throws `repository.connector.git_failed` without the git message. No log line and no span holds the cause. On 2026-10-15 at 23:47 UTC, `persistence.md` failed at its finish and `operations.md` failed at its prepare, and the git error text is lost. Keep the git operation and its stderr in the error cause and in a span event, with no secret.
  - Done 2026-10-16: [repository.impl.md](repository.impl.md) records the cause, and [worker-service.impl.md](worker-service.impl.md#traces) records the span text.
- [x] Added 2026-10-16. Worker Service. `settleObjective` of `src/worker/unit/steps-objective.ts` runs the base fetch, the base refresh and the node branch push with no child span. A failed finish shows only the finish span. Add one span for each git operation.
  - Done 2026-10-16: [worker-service.impl.md](worker-service.impl.md#traces) records the `worker.git` spans.
- [x] Added 2026-10-16. Worker Service. The SSH proof of the finish runs `ssh -G`, which reads only the configuration. It passes when the SSH agent holds no key.
  - Ruled 2026-10-16 by Ulrich: the proof stays a local pin check. The push is the connection proof, and the git error text item makes its failure readable.
- [x] Added 2026-10-16. Worker Service (S25 gap). A finish that fails before the push leaves the agent commits only in the workspace. The next prepare finds no remote node branch and no evidence, and it resets the branch to the base branch. `persistence.md` held three unpushed commits at `c768be36`. Keep unpushed workspace commits of the same attempt, or push them before the finish fails.
  - Ruled 2026-10-16 by Ulrich: when the remote node branch is missing and no record shows a push, the prepare keeps the local node branch. Every other prepare resets the local node branch to the remote. [worker-service.impl.md](worker-service.impl.md#workspace) records the rule.
- [x] Added 2026-10-16. Scheduler Service (S16 gap). After a `git_failed` stop, the claims of two nodes repeated five times in 700 ms, and the failure limit paused both nodes. Add a backoff before the next claim of a node after an `operation_failed` stop.
  - Ruled 2026-10-16 by Ulrich: after each counted failure, the job of the node waits `scheduler.stop_backoff` seconds (default `30`), doubled for each further consecutive failure. [scheduler-service.md](scheduler-service.md#claims-and-counts) records the rule.

- [x] Added 2026-10-16. Worker Service, test. `src/apps/server/worker-thread.test.ts:137` asserts that `kanthord.log` exists right after the registration. It failed once in four full verify runs on 2026-10-16. Wait for the log file, or assert it after the thread stops.
  - Done 2026-10-16: the test waits for the log file through `until`.

### B9, failure and recovery

Deferred cross-service work across Mission, Scheduler, Worker and Project.

#### Cannot progress

Folded from the Worker Service section on 2026-09-18 by Ulrich, to be designed with the rest of B9.

- [ ] Define the rest of the disposition of an execution that cannot progress. The stop release, the consecutive failure limit and the cleanup on a stop are ruled in [mission-service.md](mission-service.md#consecutive-failure-limit) and [worker-service.impl.md](worker-service.impl.md#stop-and-budget). Open: a stop that requires a human, for example `repository.node_branch.missing`, with a direct `Executing -> Blocked` and an outcome with an execution-declaration basis; the outcome when no assessment exists; a verification timeout that is a defect of the work; a lost push acknowledgement that can be a success; and an unchanged oversized revision that the failure limit only pauses. The debate of 2026-09-18 rejected the route through the evaluation as the full disposition: it fabricates an assessment for a machinery failure, it needs a checkpoint, a push and an evidence submission that the failed operation can prevent, and a reviewer that shares the failure has no exit from `Evaluating`. Coupled items: automatic continuation and attempt authorization, the bound on repeated releases with further work on a budget end with no progress, the reviewer-loss transition, D1, SC5, W5 and A3 / W1 / W4 / PR2.

#### Policy and budgets

- [ ] Decide which other failures permit automatic continuation. The [rework limit](mission-service.md#rework-limit) rules a `criterion-not-met` assessment, the [consecutive failure limit](mission-service.md#consecutive-failure-limit) rules a stop, and a human unblock alone opens a further node attempt.
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
