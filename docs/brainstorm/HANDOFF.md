# Handoff

Open work as of 2026-10-23.
Read the owning design document before taking an item, and remove the item once its answer or change is documented.

## Fix first: blockers of the Tracking Service dogfood run

Ulrich ruled on 2026-10-23 that these items block all other work. KanthorD built the Tracking Service redesign on 2026-10-22 with one `coder@1` and one `reviewer@1` instance in containers: engine #179–#185, apps #59–#65. During the run, the operator worked around each item by hand and made no engine fix. The evidence is in `.dev/notes.md`, section "Tracking Service dogfood program".

- [ ] Added 2026-10-23. Refuse an edit of the workspace during a judgement. `judgeTask` of `engine/src/worker/unit/steps-implement.ts` runs no dirty check after the judgement turn. On n02, n03 and n04, `swe@1` implemented the task inside the judgement and answered `criterion_met: true`. The task loop then did not run, `commitWork` committed nothing, and the review answered `criterion-not-met`. Count a dirty checkout after a judgement as not met, and run the change through the task loop. A sentence in the plan Requirement that forbids edits during a judgement stopped the defect from n05 on.
- [ ] Added 2026-10-23. Make a worker commit independent of the git hooks of the target repository. `commitWork` of `engine/src/worker/unit/local-git.ts` runs `git commit` with the hooks of the repository, and `isolatedGitEnvironment` of `engine/src/kernel/git-environment.ts` keeps `HUSKY`. The commitlint `commit-msg` hook of `kanthord-apps` refused every commit of n08, two executions in a row. The operator recreated the `coder@1` container with `HUSKY=0`. The verifications of the node run the checks of the repository.
- [ ] Added 2026-10-23. Name each worker commit and each node pull request in the form `<type>(<scope>): <subject>`. `taskCommitMessage` of `engine/src/worker/unit/local-git.ts` writes `kanthord: task <id> attempt <n>`, and `PULL_REQUEST_TITLE_PREFIX` of `engine/src/intake/action-perform.ts` gives the title `kanthord <node id>`. Both break the commit rule of `AGENTS.md` and the commitlint hook of `kanthord-apps`.
- [ ] Added 2026-10-23. Keep the cause of an uncoded error in the stop of an execution. `stopOf` of `engine/src/worker/unit/execution-run.ts` keeps only the code of a `CodedError` and drops the message of any other error. The refused commit of n08 ended `operation_failed` with code `null`, and the stop, the log and the trace held no cause.
- [ ] Added 2026-10-23. Do not count an infrastructure kill of a verification as `criterion-not-met`. `judge` of `engine/src/worker/unit/evaluation.ts` answers `criterion-not-met` for every failed verification. A kernel out-of-memory kill (exit 137) of `tsc` in the n07 review and a load failure of the n08 `pnpm run verify` each caused a false rework. Classify a signal kill as an infrastructure failure and run the verification again.
- [ ] Added 2026-10-23. Bound the memory of each worker container, and document the memory size of a host that runs one server and two workers. The Podman VM held 3.9 GiB with no swap. The kernel log shows two global out-of-memory kills, at 15:22:45 UTC in `reviewer@1` and at 15:35:57 UTC in `coder@1`. Each killed a node process of about 1.9 GiB, while the other worker ran a full verification. At the second kill, both workers failed the heartbeat and the instance exchange. A global kill can stop any process of the host, including the server. The operator added 6 GiB of swap in the VM, and no kill followed. The item "Decide the resource limits of a `container` slot" of the Worker Service is related.
- [ ] Added 2026-10-23. Make the worker image run the full engine suite. The dev-node image holds no `sshd` and no `procps`. In a worker container, 32 tests of the engine suite failed, most of them for the missing `sshd`. On 2 CPUs, 3 or 4 timing tests also fail in each run. No node of the run could run the full suite, and the operator ran it on the host after each merge.
- [ ] Added 2026-10-23. Accept binding names in the change of an unblock, as an import does. An unblock change with binding names fails with `mission.node.bindings_invalid`, and only binding ids pass. The n07 redirect failed once for this reason.
- [ ] Added 2026-10-23. Document the plan file name rule `^[a-z][a-z0-9_-]*\.md$` of `planFileNameSchema` in `engine/src/mission/contract.ts`, and check it before the preview. The designer and the review missed the rule, and only the server preview refused the plan files.
- [ ] Added 2026-10-23. Correct the `E2E_GH_TOKEN` sentence of `AGENTS.md`. It says that the token covers only `kanthorlabs/kanthord-verify`. The token also covers `kanthord-engine` and `kanthord-apps`, and it added the deploy keys of both repositories in the run. "Administration: write" on these repositories also permits their delete.

## Phase 2

Every item below waits for the completion of the design set. Ulrich moved them here on 2026-09-20.

### Architecture

- [ ] RULED 2026-10-07 by Ulrich. Rename the ten camelCase operation ids to the underscore form of `architecture.impl.md` section The operation ids: `gateway.openapi_file`, `mission.execution.cleared_outcome.get`, `mission.execution.pinned_revision.get`, `mission.external_action.get`, `mission.external_action.list`, `project.agent_configuration.get`, `project.agent_configuration.list`, `project.binding_revision.list`, `project.binding_set.get` and `project.binding_set.write`. Update the engine contracts, `engine/docs/cli/`, `docs/reference/gateway/openapi.md`, the hand-written `apps` wire types in `apps/src/api/types.ts`, and regenerate `docs/reference/workbench/tools.md`. Run it after the prompt composer implementation, which edits the same engine tree.
- [ ] Added 2026-10-19 from the onboarding docs. Read the project readiness panel again after a plan import, a new live registration or an enable, and offer a refresh. [architecture.impl.md](architecture.impl.md#the-project-readiness-panel) states the gap. `useProjectReadiness` of `apps/src/features/projects/view/use-project-readiness.ts` reads again only on a change of `project.id` or `binding_set_version`, so `Plan import` stays `Open` until a reload.
- [ ] Added 2026-10-19 from the onboarding docs. State a failed read in the detail line of a readiness item. `readinessItemsOf` of `apps/src/features/projects/view/use-project-readiness.ts` treats a failed read as an empty record, so the detail says, for example, that the project holds no repository binding. [architecture.impl.md](architecture.impl.md#the-project-readiness-panel) states the gap.

- [ ] RULED 2026-10-02 by Ulrich, from the Intake redesign. Each service enforces system authorization for its own operations and entities, and the protected facility consumes the authorization result of the service that owns the entity of the release. The design pages hold the moves since 2026-10-03. Remaining: the `engine/docs/cli/` page of each Mission command that answers `mission.authorization.refused` adds that code. Ulrich sent the rulings to the pi session of `engine/.agents/plan/erd-02-execution/` on 2026-10-03.

- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the receiving-side authentication contract of a forwarded caller identity. The identity value is process-local and the JWT stays in the Gateway Service, so a split that forwards a caller identity to another process needs a contract that no page holds.
- [ ] POSTPONED 2026-09-23 by Ulrich until a service moves into a separate process. Declare the temporal validity of a cross-service precondition of a handler. A handler reads a fact of a peer through a client, awaits, then commits, and the fact can change during the wait: the Scheduler reads that a node is available and a human blocks it before the claim commits. Parked candidate: every cross-service precondition declares itself as a frozen snapshot, read before the commit and recorded with the effect, or as a commit-time condition, read through a collaboration inside the transaction while the two services are co-located, so a client read never satisfies a commit-time condition. This adds a second admissible case of a collaboration beside the atomic invariant, and it names the service pairs that no composition change alone can split. Not needed while every service runs in one process, because the complexity outweighs the benefit there.

### LLM component

- [ ] RULED 2026-10-20 by Ulrich (Group B, R2). The server listens on one Gateway port only. No design adds a second port or listener, for example a private listener for machine operations. This rule is hard.
- [ ] RULED 2026-10-20 by Ulrich (Group B, S2 of the build item). A credential copy stays sealed to the long-lived instance key. Reset key and a rotation of each copy replace it. KanthorD has no ephemeral key for each handover, because the server holds no plaintext of an instance copy.
- [ ] POSTPONED 2026-10-05 by Ulrich until Ulrich holds an active OpenCode Go subscription. Verify the success case of the `opencode-go` check with `deepseek-v4-flash` through the scratchpad e2e call. The e2e key answers 403 "An active OpenCode Go subscription is required" today, so only the refusal case is verified. The model membership check of the Worker configuration also reads the `models` metadata through `compatibleMetadataSchema` in `worker/contract.ts`, and it moves with the same decision.

### Repository component

- [ ] Added 2026-09-26 from the responsibility audit of Project, Worker and Intake. The `ls-remote` of a binding write and of the repository healthcheck runs on the server host. It proves no network path from the host of a `worker` application. Decide whether a check covers the worker host. Since 2026-10-19 the handover carries the SSH key, so the item covers only the network path.

### Project Service

- [ ] Added 2026-10-19 from SD1 of the SSH identity epic. Log the step and the cause of `repository.connector.ssh_agent_failed` in the binding check, verify, apply and instruction file read, without key material. Today `checkBindingAddress`, `checkRepository` and `refuseUnreadable` of `engine/src/project/service.ts` keep only the `failure_reason` `identity_unavailable`, so a legacy key and an agent fault (for example a long `TMPDIR`) look the same. [Project bindings](../reference/project/binding.md#failure-reasons-of-the-address-entry) states the gap.
- [ ] Define the channel binding and its notification policy, the first policy beside the repository strategy, so that a node names a channel binding and requires its notification.
- [ ] Added 2026-09-24. Slack, Telegram and Jira register their platform entry and their credential types in `project-service.impl.md` when their design lands.
- [ ] Added 2026-09-26 from the pin-and-use ruling. The UI shows a removed binding with the records that reference it. No page declares that read, and the records live in the Mission, Worker and Scheduler Services. Declare the reverse lookup and the service that answers it.

### Mission Service

- [ ] Added 2026-10-02 from the debate of the Intake redesign. A human-act admission invokes the Mission operation under the linked human identity, and since 2026-10-03 no admission row exists. A crash after the act lets a repeat of the same inbound event repeat the human act. Decide how the human act becomes idempotent by the event identity.

- [ ] Added 2026-09-24 from `engine/docs/cli/mission.md`. Record commands await external-action publication and terminal-state retention. The debated proposals wait in `.dev/cannot/mission-record-contracts.md`.
- [ ] POSTPONED 2026-09-28 by Ulrich until budgets or agent limits land. Design the handoff from one execution to the next execution of a node. `mission_run_output` is dropped on 2026-09-28; the human direction stays in the node revision, and the checkpoint commit stays the only carrier inside an attempt.
- [ ] POSTPONED 2026-09-29 by Ulrich until a need for redaction arises. Design the redaction of evidence content and how an asset states it.

### Scheduler Service and delivery

- [ ] RULED 2026-10-09 by Ulrich. The ERD 3 values of the Intake Service bounds stand: `PENDING_EVENT_LIMIT`, `ERROR_ARRAY_MAX_BYTES`, `ERROR_MESSAGE_MAX_BYTES`, `RESULT_MAX_BYTES`, `DELETE_IDS_MAX`, `PLATFORM_CALL_DEADLINE_MS`, `GIT_WRITE_DEADLINE_MS`, `ACTION_PERFORM_TIMEOUT_MS`, `ADMISSION_CONCURRENCY` and `READ_ANSWER_MARGIN_MS`. Decision D12 of `engine/.agents/plan/erd-03-integration/decisions.md` holds the values, and `engine/src/intake/contract.ts` declares them. The Intake Service refuses a range delete that matches more than `DELETE_IDS_MAX` rows. The poll loops that start with the server start at offsets spread evenly over the poll interval. The item stays open only for the acceptance tests of discovery lag, claim latency and the count of pending inbound events against the 1,000-project workload.
- [ ] POSTPONED 2026-09-17 by Ulrich, a separate design effort. Design the inbound request contract across Intake, Scheduler, Project and Mission: how the delivery admission of the Scheduler classifies a delivery that the Intake Service hands over, how it is dispatched and how each kind is handled, including new work arriving through Slack and the authority to create nodes, goals and validation criteria. Parked recommendation: a fifth delivery disposition, acceptance as a work request; the Mission Service records the work request with its source, its linked human identity, its text and its time; it is no node and schedules nothing; the human import that creates its nodes names it and closes it. The gap that motivates it: the four dispositions on the Scheduler page fit no request for new WHAT, and the inbox retention deletes it. The Project item on the source-binding configuration belongs to the same effort. The server-owner ruling of 2026-09-20 gives every authenticated human the same authority, so a person that a delivery maps to a human identity gains that authority, and this effort revisits it. A Scheduler read of admission dispositions per project also awaits a decision.
- [ ] Add the skills and extensions that support external-harness integration. `tracking-service.md` obliges the extension to capture, to hold its capture in a bounded local store, and to import it when a human issues an ingestion. The contract also covers snapshot export, acknowledgement handoff, cursor persistence, retry deadlines and retained or discarded summaries.

### Intake Service

- [ ] RULED 2026-09-30 by Ulrich. Reimplement push notifications in the Intake Service using Kukuroo only as a reference for its logic and ideas. Install no Kukuroo package and deploy no Kukuroo relay. The temporary proposal and its debate review live at `.dev/intake-push-notifications-plan.md`; the native push mechanism awaits its design ruling.
- [ ] RULED 2026-09-26 by Ulrich. The inbound replaces the source binding. A Slack inbound with human identity mapping waits for its platform design. That design also declares the source of the Slack signing secret, which Slack issues and kanthord cannot derive, so a passive Slack webhook needs it from custody. A platform whose challenge arrives as an unsigned `GET`, for example Meta or Twitter, needs a `GET` receipt route in its own platform design. The secret display of `intake.inbound.get` awaits its display, redaction and cache contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `inbound create` awaits the `configuration` fields beyond `resource` per kind and platform. The event reads and the receipt await timeouts and file bounds.
- [ ] Added 2026-09-24 from `engine/docs/cli/intake.md`. `event get` awaits the content inclusion, representation, size and redaction decision.

### Agent component

Added 2026-10-06 by Ulrich, from the evaluation of the agent. The Worker Service and the Workbench Service consume the component.

- [ ] Give an agent session a budget input that the consumer supplies. `ExecutionBudget` reads `createdAt` and `expiredAt` of the claim.
- [ ] Move the native agent runtime, the prompt composer and the tool table from the Worker pages to the Agent pages, and split `NativeAgentInput` of `engine/src/worker/unit/native-agent.ts` into a session input that names no execution.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Show the cooldown of each chain entry on the agent page of `apps`, with a badge and a Clear action, as [agent.md](agent.md#views) requires. Since 2026-10-21 the Fallback chain card of the agent page shows the cooldown of each entry, but it has no Clear action, so only `kanthord agent cooldown clear` clears it. [native-agent.md](../explanation/native-agent.md#the-fallback-chain) states the gap.

### Workbench Service

Added 2026-10-06 by Ulrich. A human drives a workbench session through the chat of `apps` or through the API.

- [ ] Define how a workbench session reaches the workspace directory of each project that it acts on.
- [ ] Define how the workspace directory of a project relates to the execution workspaces under `workspaces/` of the state directory.
- [ ] Define how a workbench session pulls and executes a task through the Worker and Scheduler Services. The Workbench Service owns no worker, no registration and no claim.
- [ ] The composer of the chat shows a model picker and a reasoning-effort picker, as in the screenshot of Ulrich on 2026-10-06. Its `+` menu offers images and files, commands (`/`), context (`@`) and a shell command (`!`). Define each of the four from the capability of pi that serves it: prompt templates, file references, bash and image input.

### Worker Service

- [ ] Decide whether a node names a worker binding, so that one worker binding claims it. Today any worker binding that matches the intent, the tags and the state of a node claims it, so two `implement` nodes with the same intent and tags cannot use different models or prompts. Ulrich deferred this on 2026-10-11.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Make a `reviewer@1` execution that claims from `External.Requested` skip the evaluation and only call `worker.action.request`, as [worker-service.md](worker-service.md#evaluation-and-required-external-actions) requires. `runNativeExecution` of `engine/src/worker/unit/native-method.ts` runs `runEvaluation` for every evaluation claim, so a chained action evaluates the node again, and a `criterion-not-met` there blocks the node because the attempt holds a request. [worker.md](../explanation/worker.md#how-reviewer1-judges) states the gap.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Decide how a rework reaches a task when the rationale names no task id: an unmet criterion of the `implement` node or a default-standard violation that `re@1` lists under the node id. `startCheck` of `engine/src/worker/unit/steps-implement.ts` matches task ids only. When `swe@1` judges every task met, the execution releases the same head, and the next review can block the node at `mission.rework_limit`. [coder-worker.md](../explanation/coder-worker.md#step-6-the-start-check) states the behavior.
- [ ] Added 2026-10-13 from the rewrite of the worker explanation pages. Make the workspace hold cover every worker process of one host. [worker-service.md](worker-service.md#executions) requires that an execution confirms that no earlier execution still acts in a workspace before the reuse. `WorkspaceRoot` of `engine/src/worker/unit/workspace.ts` keeps the hold in memory, so it covers one process only. Two `kanthord serve worker` processes of one host share `workspaces/` of the state directory. An execution of the second process can reuse the workspace of an `implement` node while a lost execution of the first process still runs a command in it. [coder-worker.md](../explanation/coder-worker.md#limits) states the gap. `worker-service.impl.md` section Stop and budget records that the quiescence check needs a mechanism, and B9 item W5 owns the workspace disposition after a revocation. Added 2026-10-14: each pool slot of the `server` placement holds its own `workspaces/` under [the slot root](worker-service.impl.md#isolation-of-a-thread-slot). The gap therefore covers only `worker` processes that share one state directory. Added 2026-10-20 from the Group B rulings: each worker instance holds its own data directory `$XDG_DATA_HOME/kanthord/workers/<name>/`, so two instances share no `workspaces/`. One residual stays: a superseded process of the same instance acts in the same workspace for up to one heartbeat interval, until it kills its tool process group.
- [ ] Added 2026-10-14. Run a slot thread of the `server` placement from the single binary live. The release smoke starts a thread from the embedded `worker-thread.cjs`, but no test runs an agent session in that thread.
- [ ] Added 2026-10-14. Carry the MCP path over the port transport when a native agent calls an MCP tool, for a slot of the `server` or the `container` placement. `servePort` refuses a `stream` operation today, and the worker unit calls none.
- [ ] Added 2026-10-14. Decide a heap limit for a worker thread of the `server` placement through `resourceLimits`, and its configuration key in the `worker` section. A thread without a limit can exhaust the memory of the server process.
- [ ] Added 2026-10-14. Decide the OS containment of the agent tool and verification child processes at the `server` and the `worker` placements. These processes run as the OS user of their host process. At the `server` placement, they can read the database files and `kanthord.yaml` of the server and can signal the server process. [worker-service.md](worker-service.md#instances-and-hosting) states this limit. The options are a separate OS user, bwrap or landlock on Linux, and sandbox-exec on macOS. The item "Containment beyond the minimum trust boundary" of the next phase is related. Added 2026-10-20: a per-command sandbox that blocks reads of the config and data directories and blocks `ptrace` covers the `server` and `worker` placements and the server image with no root: Landlock on Linux, Seatbelt on macOS. A move of the key file, an env scrub or another `HOME` gives no protection, because a tool can read `/proc/<server pid>/environ` and `cmdline`. Added 2026-10-20 from the Group B rulings: the sandbox also removes the cross-project reach of a worker instance. A tool of any binding that the instance serves reads the instance key and the data directory, as [the trust boundary](worker-service.vocabulary.md#trust-boundary) states.
- [ ] Added 2026-10-14. Decide the checks of a pi version bump beyond the tool set: the `PI_*` environment variables and the `settings.json` keys that pi reads, the programs that the session path of pi spawns, and a session test that blocks every network call except the model provider.
- [ ] POSTPONED 2026-10-20 by Ulrich until the next container e2e run. Sleep the Mac for 5 minutes during an execution at `placement: container`. Raise the frame deadline to 30 s when the slots restart after the wake.
- [ ] Added 2026-10-20 from the Group A rulings. Decide the resource limits of a `container` slot: memory, CPU and pids. A cgroup limit needs cgroup v2 delegation on a rootless host. [The run command](worker-service.impl.md#the-run-command) holds no limit today.

- [ ] POSTPONED 2026-09-17 by Ulrich. Design the memory of a native agent after a worker and an agent work end to end. `worker-service.md` keeps its Memory section until then.

#### Next phase

After the first native-agent worker runs the acceptance path.

- [ ] The handoff as a worker-owned protocol: a typed handoff tool with the three assertions and the stopping reason of the agent, a state machine of working, quiescing, candidate frozen, verification, judgement, recorded, and the handling of a missing, malformed, duplicate or out-of-phase handoff. The execution owns the stopping reason on a deadline, a runtime failure or a lease loss.
- [ ] Multi-agent workers, `tdd@1` first. pi has no sub-agents.
- [ ] Token and currency budgets and project-level accounting. pi reports usage and cost per message.
- [ ] A clarification interface. The pi ask_question tool is the seed, and the block and unblock flow carries ambiguity until then.
- [ ] Containment beyond the minimum trust boundary, the quality and replay suite, provenance tags on tool results.

### Gateway Service

- [ ] POSTPONED 2026-09-28 by Ulrich until Ulrich rules it. Decide whether `kanthord auth jwt inspect` verifies the signature, the header and the closed claim set with the server configuration.

### Tracking Service

- [ ] POSTPONED 2026-09-29 by Ulrich until the audit action is added. Added 2026-09-29 from the evidence redesign. Design the audit record of a human act, for example a content removal or a pending cleanup, so that a human who regrets a delete reads what it removed. A delete removes the row, and `architecture.impl.md` bans a soft delete. Added 2026-10-12 from the harness-1 run: the reason of an unblock, a pause, a resume and a ready is validated and stored nowhere. Only a block, a discard and an override store their reason, in the outcome.
- [ ] Added 2026-10-12 from the worker tracing. The `steps` method of an `examine` node writes only verification spans, no `worker.phase` and no `worker.task` span.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. RULED 2026-10-11 by Ulrich: [worker-contract.md](../explanation/worker-contract.md#identities) rules the span, record and text identities of worker records, the split of a text above 60 KiB, and the attribute names of the worker span catalog. Execution identity validation awaits the Scheduler contract.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. `telemetry ingest` awaits conflicting-record and repeated-value rules, status finalization, structural refusal codes and batch-failure boundaries. Operation contracts also need timeouts and partial acknowledgement schemas.
- [ ] Added 2026-09-24 from `engine/docs/cli/tracking.md`. Ingestion awaits byte and count limits, local-log and segment bounds, and `fsync` bounds.
- [ ] Added 2026-10-22 from the Tracking Service redesign. Implement the capture of the Claude Code transcript as the session entries of an agent session with the format `claude_code`. [tracking-service.impl.md](tracking-service.impl.md#claude-code-hooks) holds the rules, and the build of 2026-10-22 implements only the `pi` format of the native worker.
- [ ] Added 2026-10-22 from the Tracking Service redesign. Add `worker.git` to the span catalog of [worker-contract.md](../explanation/worker-contract.md#the-span-catalog). The worker writes it, with `kanthord.git.step`, and the catalog does not list it.

### Root repository

- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Re-author the planning standard in the root repository from the preserved method. The legacy `engine/.agents/plan/authoring.md` and the `/plan` and `/author` skills are no input; the reset of the engine submodule removes them.
- [ ] POSTPONED 2026-09-18 by Ulrich until every document of phase 1 and phase 2 is done. Change the root Makefile and `scripts/`. Both assume the legacy layout of `engine` and `apps`. The Makefile also copies the OpenAPI directory `static/openapi/` of `engine` into `apps`, which the build of `apps` reads.
- [ ] Added 2026-10-19 from the first-day plan. The first-day plan of 2026-10-19 replaces six open rulings of the plan of 2026-10-18. The READY workstreams of the plan of 2026-10-18 are merged, and root `#113` moved the pointers. "Old" names an item of the plan of 2026-10-18. Remove this item when each listed old ruling is ruled or moved to the HANDOFF section of its owning component.
  - Sources, not versioned: `.dev/first-day-experiment/fix-plan.md` holds the plan of 2026-10-18. `.dev/first-day-2026-10-19/` holds `first-day-plan.md`, `first-day-findings.md` and `first-day-plan-review.md`.
  - Continued by the plan of 2026-10-19:
    - Old B1 and B2, the first public release and the first image push to `docker.io/kanthorlabs/kanthord`: by Q6.
      - Q6 raises the first public release now. Ruled 2026-10-19 by Ulrich: no public Docker Hub image yet. User docs assume that `podman pull docker.io/kanthorlabs/kanthord:<version>` succeeds. A test builds the image locally under that name and starts the flow at the step after the pull. The Docker Hub repository, its secrets and the version change wait for a later release ruling.
      - Before the release, create the public Docker Hub repository `kanthorlabs/kanthord`. The version goes from `28.0.1` to `26.10.1` once.
  - Open old rulings that the plan of 2026-10-19 depends on:
    - Old C-B1, the code `gateway.client.unreachable` for a refused connect. The `gateway liveness` command of Q14 follows the `gateway verify` pattern and answers `cli.gateway.liveness.indeterminate` for a refused connect. A ruling of old C-B1 changes both commands together.
    - Old C-S8, the remote message in the CLI. Until old C-S8 is ruled, the CLI shows the Q4 `details.host` and `details.field` but not the hint in the message.
  - Open old rulings with no effect on the plan of 2026-10-19. Old E2b, the engine CLI docs of C-B2, C-S10, C-S12, C-S14 and C-S15, stays with those rulings.
    - Old S3, the fields `version`, `base_path` and `url` of the Gateway start record.
    - Old B6, the details of `gateway.client.version_unavailable`.
    - Old B7a, the build commit in the version.
    - Old B7b, the claim release on worker shutdown, a B9 item.
    - Old S14, mode `0600` for a file with no secret.
    - Old S20, the default `target` on resume.
    - Old S22, the phase and the last activity of an execution.
    - Old C-B2, a check body equal to the create body.
    - Old C-B3, the secret input.
    - Old C-S1, the table output.
    - Old C-S2, the node watch.
    - Old C-S4, the shell completion.
    - Old C-S6, the reason of a 401.
    - Old C-S10, the model list under `llm`.
    - Old C-S12, the names in `changes`.
    - Old C-S14, the mission id on the project.
    - Old C-S15, the one-step import.

### End-to-end run harness-1

Ulrich stopped the run on 2026-10-12. The items below come from `.dev/notes.md`. Read `scripts/e2e/` and `docs/brainstorm/assets/todoapp/plan` first.

- [ ] Added 2026-10-12. Run the fresh attempt of S23 live: a human block, then an unblock with `start_point: "base_branch"`, then a native steps execution and a review on the branch `kanthord/<node id>-a<k>`. The engine e2e layer covers only the server path.

### Findings of the harness-1 run

Each item names its owner. Read the owning design document before taking an item.

- [ ] Added 2026-10-12. Worker and Project Services (S25 gap). A fresh workspace that continues an attempt with no repository evidence starts from the base branch with no signal, although the remote node branch is gone.
- [ ] Added 2026-10-12. Project Service (S21). `POST .../binding/<worker binding>/verify` answers `project.binding.not_found`. Return a code that names the worker binding.
- [ ] Added 2026-10-12. `apps` (S19). After an unblock, the proposal of the earlier attempt keeps the badge "proposed". Show a "superseded" badge when `proposal.attempt` is below the attempt of the `examine` node.

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
